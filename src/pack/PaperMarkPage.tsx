'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Eraser,
  RefreshCw,
} from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { PackChip } from '@/components/PackChip';
import { McqMarkdown } from '@/components/McqMarkdown';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  attemptsForSession,
  loadAchievements,
  loadAttempts,
  loadSessions,
  recordEarnedAchievements,
  amendAttempt,
  saveAttempt,
  saveSession,
} from '@/lib/storage';
import { newlyEarnedAchievements } from '@/pack/achievements-engine';
import {
  isMultiAnswer,
  packQuestions,
  PACK_CATEGORY_LABEL,
  type OptionKey,
} from '@/pack/data';
import { nextSelection } from '@/pack/runner';
import {
  buildPaperResult,
  decodePaperPayload,
  getPaperSheet,
  recordSheetMarked,
  resolveSheetQuestions,
  sheetFromPayload,
  type PaperMark,
  type PaperResultRows,
  type PaperSheet,
} from '@/pack/paper';

// Same event bus the storage hooks use (see src/lib/useStorage.ts) — the
// writes here happen outside those hooks, so re-emit for mounted pages.
const STORAGE_EVENT = 'quizmill:storage';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** How the page was opened, resolved from the URL hash. */
type Source =
  | { kind: 'ready'; sheet: PaperSheet }
  | { kind: 'wrong-pack'; pack: string }
  | { kind: 'bad-payload' }
  | { kind: 'not-found' }
  | { kind: 'none' };

async function sourceFromHash(): Promise<Source> {
  if (typeof window === 'undefined') return { kind: 'none' };
  const h = window.location.hash;
  if (h.startsWith('#s=')) {
    // Async: the compressed payload form inflates via DecompressionStream.
    const payload = await decodePaperPayload(h.slice('#s='.length));
    if (!payload) return { kind: 'bad-payload' };
    if (payload.pack !== APP_CONFIG.packId) {
      return { kind: 'wrong-pack', pack: payload.pack };
    }
    return { kind: 'ready', sheet: sheetFromPayload(payload) };
  }
  if (h.startsWith('#sheet=')) {
    const sheet = getPaperSheet(decodeURIComponent(h.slice('#sheet='.length)));
    return sheet ? { kind: 'ready', sheet } : { kind: 'not-found' };
  }
  return { kind: 'none' };
}

/**
 * Mark a paper sheet back into progress: for each printed question, tap
 * the letter(s) the learner wrote, then save. Saving writes a normal
 * `mode: 'paper'` session + attempts (deterministic ids — see
 * src/pack/paper.ts), so sync, streaks, the mistakes queue, readiness
 * and stickers all pick it up like any other practice.
 *
 * Opened via `#s=<payload>` (the printed QR — self-describing, works on
 * any device with this pack active) or `#sheet=<id>` (a sheet stored on
 * this device).
 */
export function PaperMarkPage() {
  const [mounted, setMounted] = useState(false);
  const [source, setSource] = useState<Source>({ kind: 'none' });
  const [selections, setSelections] = useState<(OptionKey[] | null)[]>([]);
  const [alreadyMarked, setAlreadyMarked] = useState(false);
  const [saved, setSaved] = useState<PaperResultRows | null>(null);

  useEffect(() => {
    setMounted(true);
    // Guard against a hashchange landing while an earlier decode is
    // still inflating — only the latest resolution may set state.
    let latest = 0;
    const resolve = async () => {
      const token = ++latest;
      const next = await sourceFromHash();
      if (token !== latest) return;
      setSource(next);
      setSaved(null);
      if (next.kind === 'ready') {
        // Pre-fill from an earlier marking of this same sheet, so
        // re-opening it edits instead of starting blank.
        const prior = attemptsForSession(next.sheet.id);
        const byQuestion = new Map(prior.map((a) => [a.questionId, a]));
        setAlreadyMarked(prior.length > 0);
        setSelections(
          next.sheet.questionIds.map((qid) => {
            const a = byQuestion.get(qid);
            if (!a) return null;
            const keys = a.selectedAnswer.split(',').filter(Boolean) as OptionKey[];
            return keys.length > 0 ? keys : null;
          }),
        );
      } else {
        setAlreadyMarked(false);
        setSelections([]);
      }
    };
    const onHash = () => void resolve();
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const sheet = source.kind === 'ready' ? source.sheet : null;
  const marks: PaperMark[] = useMemo(
    () => (sheet ? resolveSheetQuestions(sheet.questionIds, packQuestions) : []),
    [sheet],
  );

  if (!mounted) return null;

  if (saved && sheet) {
    return <SavedView sheet={sheet} result={saved} />;
  }

  if (!sheet) {
    return (
      <main className="flex flex-col gap-4">
        <Header />
        <p className="rounded-2xl border border-warn-500/40 bg-warn-50 p-4 text-sm text-ink-700">
          {source.kind === 'wrong-pack' ? (
            <>
              This sheet belongs to a different pack (<strong>{source.pack}</strong>),
              but this app has <strong>{APP_CONFIG.packId}</strong> active. Swap
              packs first, then scan the code again.
            </>
          ) : source.kind === 'bad-payload' ? (
            <>This link couldn&apos;t be read — try scanning the QR code on the printed sheet again.</>
          ) : source.kind === 'not-found' ? (
            <>That sheet isn&apos;t stored on this device. Scan the QR code on the printout instead.</>
          ) : (
            <>Nothing to mark — open a sheet from Paper practice, or scan the QR code on a printed one.</>
          )}
        </p>
        <Link
          href="/paper/"
          className="tap-feedback inline-flex items-center gap-1 self-start rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Paper practice
        </Link>
      </main>
    );
  }

  const answered = selections.filter((s) => s !== null && s.length > 0).length;
  const markable = marks.filter((m) => m.question !== null).length;
  const missing = marks.length - markable;

  const save = () => {
    const withSelections = marks.map((m, i) => ({
      ...m,
      selected: selections[i] ?? null,
    }));
    const result = buildPaperResult(sheet, withSelections, Date.now());
    // Deterministic ids + amend-or-append = marking twice upserts the
    // same rows (saveAttempt alone would duplicate them).
    const existing = new Set(loadAttempts().map((a) => a.id));
    for (const attempt of result.attempts) {
      if (existing.has(attempt.id)) amendAttempt(attempt.id, attempt);
      else saveAttempt(attempt);
    }
    saveSession(result.session);
    recordSheetMarked(sheet.id, Date.now());
    // Quiet sticker check (same evaluation the runners do) — the learner
    // sees anything new in the cabinet.
    const earned = new Set(loadAchievements().map((e) => e.id));
    const fresh = newlyEarnedAchievements(loadSessions(), loadAttempts(), earned);
    if (fresh.length > 0) recordEarnedAchievements(fresh);
    window.dispatchEvent(new Event(STORAGE_EVENT));
    setSaved(result);
  };

  return (
    <main className="flex flex-col gap-5">
      <Header />
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-2xl font-bold text-ink-900">{sheet.code}</h2>
          {alreadyMarked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Marked before
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-ink-500">
          {PACK_CATEGORY_LABEL[sheet.categoryKey] ?? sheet.categoryKey} ·{' '}
          {sheet.questionIds.length} questions · printed{' '}
          {DATE_FORMAT.format(sheet.createdAt)}
        </p>
        <p className="mt-2 text-sm text-ink-600">
          Tap the letters written in each answer box. Left blank on the
          sheet? Leave it unset here.
        </p>
        {alreadyMarked ? (
          <p className="mt-1 text-sm text-warn-600">
            Saving again updates the same session — nothing is double-counted.
          </p>
        ) : null}
      </div>

      <ol className="flex flex-col gap-2.5" data-testid="mark-rows">
        {marks.map((mark, i) => (
          <MarkRow
            key={mark.questionId}
            index={i}
            mark={mark}
            selected={selections[i] ?? null}
            onSelect={(next) =>
              setSelections((prev) => {
                const copy = [...prev];
                copy[i] = next;
                return copy;
              })
            }
          />
        ))}
      </ol>

      <div className="sticky bottom-4 flex flex-col gap-1">
        <Button
          onClick={save}
          disabled={answered === 0}
          data-testid="save-marks"
          size="lg"
        >
          <ClipboardCheck className="h-5 w-5" />
          Save {answered}/{markable} answer{answered === 1 ? '' : 's'}
        </Button>
        {missing > 0 ? (
          <p className="text-center text-xs text-ink-500">
            {missing} question{missing === 1 ? '' : 's'} no longer in the pack —
            skipped.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function Header() {
  return (
    <header>
      <PackChip className="mb-2" />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-3xl font-bold text-ink-900">Mark a sheet</h1>
        <Link
          href="/paper/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Sheets
        </Link>
      </div>
    </header>
  );
}

function MarkRow({
  index,
  mark,
  selected,
  onSelect,
}: {
  index: number;
  mark: PaperMark;
  selected: OptionKey[] | null;
  onSelect: (next: OptionKey[] | null) => void;
}) {
  const q = mark.question;
  if (!q) {
    return (
      <li className="rounded-2xl border border-ink-200 bg-ink-50 p-4 text-sm italic text-ink-400">
        {index + 1}. This question is no longer in the pack.
      </li>
    );
  }
  const multi = isMultiAnswer(q);
  const keys = selected ?? [];
  return (
    <li
      className="flex flex-col gap-2.5 rounded-2xl border border-ink-200 bg-surface p-4 shadow-sm"
      data-testid={`mark-row-${index + 1}`}
    >
      <div className="flex items-start gap-2 text-sm text-ink-800">
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <McqMarkdown text={q.prompt} />
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {q.options.map((opt) => {
          const active = keys.includes(opt.key);
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={active}
              aria-label={`Question ${index + 1}: answer ${opt.key}`}
              onClick={() => {
                const next = nextSelection(keys, opt.key, multi);
                onSelect(next.length > 0 ? next : null);
              }}
              className={cn(
                'tap-feedback flex h-11 w-11 items-center justify-center rounded-xl border text-base font-bold',
                active
                  ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                  : 'border-ink-200 bg-surface text-ink-700 hover:border-ink-300',
              )}
            >
              {opt.key}
            </button>
          );
        })}
        {multi ? (
          <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-800">
            all that apply
          </span>
        ) : null}
        <span className="flex-1" />
        {keys.length > 0 ? (
          <button
            type="button"
            aria-label={`Question ${index + 1}: clear answer`}
            onClick={() => onSelect(null)}
            className="tap-feedback inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            <Eraser className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function SavedView({ sheet, result }: { sheet: PaperSheet; result: PaperResultRows }) {
  const wrong = result.answeredCount - result.correctCount;
  return (
    <main className="flex flex-col gap-5" data-testid="mark-saved">
      <Header />
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-6 text-center shadow-sm">
        <CheckCircle2 className="h-10 w-10 text-brand-600" />
        <div>
          <div className="text-2xl font-bold text-ink-900">
            {result.correctCount}/{result.answeredCount} correct
          </div>
          <p className="mt-1 text-sm text-ink-600">
            Sheet {sheet.code} is in the books — it counts like any practice
            session.
          </p>
          {wrong > 0 ? (
            <p className="mt-1 text-sm text-ink-600">
              The {wrong === 1 ? 'question' : `${wrong} questions`} answered
              wrong {wrong === 1 ? 'is' : 'are'} waiting in mistakes review.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {wrong > 0 ? (
          <Link href="/practice/review/" className="w-full">
            <Button block variant="secondary">
              <RefreshCw className="h-4 w-4" />
              Review the mistakes together
            </Button>
          </Link>
        ) : null}
        <Link href="/" className="w-full">
          <Button block>
            Home
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </main>
  );
}
