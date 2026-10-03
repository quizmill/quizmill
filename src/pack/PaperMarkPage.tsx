'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Eraser,
  Pencil,
  RefreshCw,
  Undo2,
} from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { PackChip } from '@/components/PackChip';
import { McqMarkdown } from '@/components/McqMarkdown';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
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
import { SaveDestination } from '@/pack/SaveDestination';
import {
  adoptPaperSheet,
  buildPaperResult,
  decodePaperPayload,
  getPaperSheet,
  markStatus,
  recordSheetMarked,
  resolveSheetQuestions,
  savedMarksForSheet,
  sheetFromPayload,
  type MarkStatus,
  type PaperMark,
  type PaperResultRows,
  type PaperSheet,
  type SavedMark,
} from '@/pack/paper';

// Same event bus the storage hooks use (see src/lib/useStorage.ts) — the
// writes here happen outside those hooks, so re-emit for mounted pages.
const STORAGE_EVENT = 'quizmill:storage';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "earlier today" / "Sat 26 Sept" — when an earlier batch was entered. */
function whenLabel(ts: number): string {
  const then = new Date(ts);
  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  return sameDay ? 'earlier today' : DATE_FORMAT.format(ts);
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/** How the page was opened, resolved from the URL hash. */
type Source =
  | { kind: 'ready'; sheet: PaperSheet }
  | { kind: 'wrong-pack'; pack: string }
  | { kind: 'bad-payload' }
  | { kind: 'not-found' }
  | { kind: 'none' };

/** What one press of Save did — the saved screen reports it in full so
 *  a second batch never reads as the first one being entered again. */
interface SaveOutcome {
  /** The whole sheet so far (earlier batches included). */
  result: PaperResultRows;
  added: number;
  corrected: number;
  /** Answered previously and left alone — not rewritten. */
  kept: number;
}

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
    // Scanned here → this device keeps the sheet too (list, re-mark,
    // answer key), and the "Marked" stamp on save has a record to land on.
    return { kind: 'ready', sheet: adoptPaperSheet(sheetFromPayload(payload)) };
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
 * A sheet is often entered in batches (1–10 today, 11–20 tomorrow) and
 * on whichever phone scanned the QR, so the screen is explicit about
 * both: rows the sheet already has are shown settled as "Answered
 * previously" — read live from storage, so a batch entered on another
 * device appears the moment sync pulls it down — and Save writes only
 * what was added or corrected. `SaveDestination` says whose progress
 * that lands in.
 *
 * Opened via `#s=<payload>` (the printed QR — self-describing, works on
 * any device with this pack active, and is adopted into this device's
 * sheet list on arrival) or `#sheet=<id>` (a sheet stored on this
 * device).
 */
export function PaperMarkPage() {
  const [mounted, setMounted] = useState(false);
  const [source, setSource] = useState<Source>({ kind: 'none' });
  // Letters picked in THIS visit, by sheet position. A row absent here
  // shows what storage holds for it (or nothing).
  const [edits, setEdits] = useState<Record<number, OptionKey[] | null>>({});
  // Previously answered rows the marker has opened up to correct.
  const [reopened, setReopened] = useState<ReadonlySet<number>>(new Set());
  const [storageVersion, setStorageVersion] = useState(0);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

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
      setOutcome(null);
      setEdits({});
      setReopened(new Set());
    };
    const onHash = () => void resolve();
    onHash();
    // Attempts can land underneath an open sheet: sync pulling a batch
    // that was entered on another device.
    const onStorage = () => setStorageVersion((v) => v + 1);
    window.addEventListener('hashchange', onHash);
    window.addEventListener(STORAGE_EVENT, onStorage);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(STORAGE_EVENT, onStorage);
    };
  }, []);

  const sheet = source.kind === 'ready' ? source.sheet : null;
  const marks: PaperMark[] = useMemo(
    () => (sheet ? resolveSheetQuestions(sheet.questionIds, packQuestions) : []),
    [sheet],
  );
  const saved = useMemo(
    () => (sheet ? savedMarksForSheet(sheet, loadAttempts()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storageVersion invalidates the localStorage read
    [sheet, storageVersion],
  );

  if (!mounted) return null;

  if (outcome && sheet) {
    return <SavedView sheet={sheet} outcome={outcome} />;
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

  /** The letters a row stands at: this visit's pick, else what storage
   *  holds. An emptied pick over a stored answer falls back to it — a
   *  stored answer can be corrected, never blanked. */
  const selectionAt = (
    i: number,
    stored: (SavedMark | null)[],
  ): OptionKey[] | null => {
    const draft = edits[i];
    if (draft && draft.length > 0) return draft;
    return stored[i]?.keys ?? null;
  };

  const statuses: (MarkStatus | null)[] = marks.map((m, i) =>
    m.question ? markStatus(saved[i] ?? null, selectionAt(i, saved)) : null,
  );
  const count = (s: MarkStatus) => statuses.filter((x) => x === s).length;
  const added = count('new');
  const changed = count('changed');
  const blank = count('blank');
  const previously = count('saved') + changed;
  const markable = marks.filter((m) => m.question !== null).length;
  const missing = marks.length - markable;

  const save = () => {
    const now = Date.now();
    // Read storage afresh rather than trusting the render's snapshot —
    // the rows written below must be judged against what is there NOW.
    const all = loadAttempts();
    const stored = savedMarksForSheet(sheet, all);
    const existing = new Map(all.map((a) => [a.id, a]));
    // The result covers the whole sheet so far (earlier batches keep
    // their own answeredAt — see buildPaperResult), so the session row
    // counts every answer the sheet has, not just this batch.
    const result = buildPaperResult(
      sheet,
      marks.map((m, i) => ({ ...m, selected: selectionAt(i, stored) })),
      now,
      new Map(all.map((a) => [a.id, a.answeredAt])),
    );
    // Deterministic ids + write-only-what-moved: a row answered
    // previously is left untouched, a corrected one is amended in place,
    // and only new rows are appended — nothing is ever double-counted.
    let addedNow = 0;
    let correctedNow = 0;
    for (const attempt of result.attempts) {
      const prior = existing.get(attempt.id);
      if (!prior) {
        saveAttempt(attempt);
        addedNow++;
      } else if (prior.selectedAnswer !== attempt.selectedAnswer) {
        amendAttempt(attempt.id, attempt);
        correctedNow++;
      } else if (prior.isCorrect !== attempt.isCorrect) {
        // Same letters, but the pack's answer key has changed since.
        amendAttempt(attempt.id, attempt);
      }
    }
    saveSession(result.session);
    recordSheetMarked(sheet.id, now);
    // Quiet sticker check (same evaluation the runners do) — the learner
    // sees anything new in the cabinet.
    const earned = new Set(loadAchievements().map((e) => e.id));
    const fresh = newlyEarnedAchievements(loadSessions(), loadAttempts(), earned);
    if (fresh.length > 0) recordEarnedAchievements(fresh);
    window.dispatchEvent(new Event(STORAGE_EVENT));
    setOutcome({
      result,
      added: addedNow,
      corrected: correctedNow,
      kept: result.attempts.length - addedNow - correctedNow,
    });
  };

  // First marking: progress through the sheet ("Save 7/20 answers").
  // Later batches: only what this press will actually write.
  let saveLabel: string;
  if (previously === 0) {
    saveLabel = `Save ${added}/${markable} answer${added === 1 ? '' : 's'}`;
  } else if (added + changed === 0) {
    saveLabel = 'Nothing new to save';
  } else {
    const parts = [
      added > 0 ? plural(added, 'new answer') : null,
      changed > 0 ? plural(changed, 'change') : null,
    ].filter(Boolean);
    saveLabel = `Save ${parts.join(' + ')}`;
  }

  const footnote = [
    previously > 0 ? `${previously} answered previously` : null,
    previously > 0 && blank > 0 ? `${blank} still to enter` : null,
    missing > 0 ? `${plural(missing, 'question')} no longer in the pack — skipped` : null,
  ].filter(Boolean);

  return (
    <main className="flex flex-col gap-5">
      <Header />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-2xl font-bold text-ink-900">{sheet.code}</h2>
          {previously > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-700"
              data-testid="previously-count"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {previously}/{markable} answered previously
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-ink-500">
          {PACK_CATEGORY_LABEL[sheet.categoryKey] ?? sheet.categoryKey} ·{' '}
          {sheet.questionIds.length} questions · printed{' '}
          {DATE_FORMAT.format(sheet.createdAt)}
        </p>
        <p className="mt-2 text-sm text-ink-600">
          {previously === 0 ? (
            <>
              Tap the letters written in each answer box. Left blank on the
              sheet? Leave it unset here — you can save part of the sheet now
              and come back for the rest.
            </>
          ) : blank + added === 0 ? (
            <>
              Every question on this sheet is already saved. Tap{' '}
              <strong>Change</strong> on one to correct it.
            </>
          ) : (
            <>
              Questions answered previously are already saved and stay as
              they are. Tap the letters for the rest — only what you add or
              change now is saved, so nothing is counted twice.
            </>
          )}
        </p>
      </div>

      <SaveDestination phase="before" />

      <ol className="flex flex-col gap-2.5" data-testid="mark-rows">
        {marks.map((mark, i) => (
          <MarkRow
            key={mark.questionId}
            index={i}
            mark={mark}
            saved={saved[i] ?? null}
            selected={selectionAt(i, saved)}
            status={statuses[i] ?? 'blank'}
            reopened={reopened.has(i)}
            onReopen={(open) => {
              setReopened((prev) => {
                const next = new Set(prev);
                if (open) next.add(i);
                else next.delete(i);
                return next;
              });
              // Closing a row puts back what was stored for it.
              if (!open) {
                setEdits((prev) => {
                  const next = { ...prev };
                  delete next[i];
                  return next;
                });
              }
            }}
            onSelect={(next) => setEdits((prev) => ({ ...prev, [i]: next }))}
          />
        ))}
      </ol>

      {/* Floats over the rows, so both pieces carry their own backing:
          the page colour behind the button (a disabled one is
          translucent) and a solid pill for the footnote. */}
      <div className="sticky bottom-4 flex flex-col items-stretch gap-1.5">
        <div className="flex flex-col rounded-xl bg-ink-50">
          <Button
            onClick={save}
            disabled={added + changed === 0}
            data-testid="save-marks"
            size="lg"
          >
            <ClipboardCheck className="h-5 w-5" />
            {saveLabel}
          </Button>
        </div>
        {footnote.length > 0 ? (
          <p
            className="self-center rounded-full border border-ink-200 bg-surface px-3 py-0.5 text-center text-xs text-ink-600 shadow-sm"
            data-testid="save-footnote"
          >
            {footnote.join(' · ')}
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
  saved,
  selected,
  status,
  reopened,
  onReopen,
  onSelect,
}: {
  index: number;
  mark: PaperMark;
  /** What storage already holds for this row (an earlier batch). */
  saved: SavedMark | null;
  selected: OptionKey[] | null;
  status: MarkStatus;
  /** A previously answered row opened up for correcting. */
  reopened: boolean;
  onReopen: (open: boolean) => void;
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
  const number = (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">
      {index + 1}
    </span>
  );

  // Answered in an earlier batch and not being corrected: shown settled,
  // with no letters to tap — it can't be mistaken for input still owed.
  if (saved && !reopened) {
    return (
      <li
        className="flex flex-col gap-2 rounded-2xl border border-ink-200 bg-ink-50 px-4 py-3"
        data-testid={`mark-row-${index + 1}`}
        data-status={status}
      >
        <div className="flex items-start gap-2 text-sm text-ink-500">
          {number}
          <span className="line-clamp-1 min-w-0 flex-1 leading-6">
            <McqMarkdown text={q.prompt} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Answered previously
          </span>
          <span className="truncate text-xs text-ink-500">
            {whenLabel(saved.answeredAt)}
          </span>
          <span className="flex-1" />
          <span
            className="rounded-lg border border-ink-200 bg-surface px-2 py-0.5 font-mono text-sm font-bold text-ink-700"
            aria-label={`Saved answer: ${saved.keys.join(', ')}`}
          >
            {saved.keys.join(' ')}
          </span>
          <button
            type="button"
            aria-label={`Question ${index + 1}: change answer`}
            onClick={() => onReopen(true)}
            className="tap-feedback inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-ink-600 hover:bg-ink-100"
          >
            <Pencil className="h-3.5 w-3.5" />
            Change
          </button>
        </div>
      </li>
    );
  }

  const multi = isMultiAnswer(q);
  const keys = selected ?? [];
  return (
    <li
      className={cn(
        'flex flex-col gap-2.5 rounded-2xl border bg-surface p-4 shadow-sm',
        status === 'changed' ? 'border-warn-500/60' : 'border-ink-200',
      )}
      data-testid={`mark-row-${index + 1}`}
      data-status={status}
    >
      <div className="flex items-start gap-2 text-sm text-ink-800">
        {number}
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
        {saved ? (
          // A stored answer has no eraser — the way out of a correction
          // is back to what was saved.
          <button
            type="button"
            aria-label={`Question ${index + 1}: keep the saved answer`}
            onClick={() => onReopen(false)}
            className="tap-feedback inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-ink-600 hover:bg-ink-100"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Keep {saved.keys.join(' ')}
          </button>
        ) : keys.length > 0 ? (
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
      {saved ? (
        <p
          className={cn(
            'text-xs',
            status === 'changed' ? 'font-semibold text-warn-600' : 'text-ink-500',
          )}
        >
          {status === 'changed' ? (
            <>
              Changing the saved answer ({saved.keys.join(' ')}) — this
              corrects it, it doesn&apos;t add a second one.
            </>
          ) : (
            <>
              Answered previously ({whenLabel(saved.answeredAt)}) — pick a
              different letter to correct it.
            </>
          )}
        </p>
      ) : null}
    </li>
  );
}

function SavedView({ sheet, outcome }: { sheet: PaperSheet; outcome: SaveOutcome }) {
  const { result, added, corrected, kept } = outcome;
  const wrong = result.answeredCount - result.correctCount;
  const wrote = [
    added > 0 ? `${plural(added, 'new answer')} added` : null,
    corrected > 0 ? `${plural(corrected, 'answer')} corrected` : null,
  ].filter(Boolean);
  return (
    <main className="flex flex-col gap-5" data-testid="mark-saved">
      <Header />
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-6 text-center shadow-sm">
        <CheckCircle2 className="h-10 w-10 text-brand-600" />
        <div>
          <div className="text-2xl font-bold text-ink-900">
            {result.correctCount}/{result.answeredCount} correct
          </div>
          {kept === 0 && corrected === 0 ? (
            <p className="mt-1 text-sm text-ink-600">
              Sheet {sheet.code} is in the books — it counts like any practice
              session.
            </p>
          ) : (
            // A later batch (or a correction): spell out what this save
            // wrote, and that the score above is the sheet, not the batch.
            <p className="mt-1 text-sm text-ink-600" data-testid="saved-breakdown">
              {wrote.join(', ')}
              {kept > 0 ? (
                <>
                  {' '}
                  — the {kept} answered previously{' '}
                  {kept === 1 ? 'was left as it was' : 'were left as they were'},
                  so nothing is counted twice
                </>
              ) : null}
              . The score is for sheet {sheet.code} so far.
            </p>
          )}
          {wrong > 0 ? (
            <p className="mt-1 text-sm text-ink-600">
              The {wrong === 1 ? 'question' : `${wrong} questions`} answered
              wrong {wrong === 1 ? 'is' : 'are'} waiting in mistakes review.
            </p>
          ) : null}
          {result.blankCount > 0 ? (
            <p className="mt-1 text-sm text-ink-600">
              {result.blankCount} {result.blankCount === 1 ? 'question' : 'questions'}{' '}
              left blank — open this sheet again to add{' '}
              {result.blankCount === 1 ? 'it' : 'them'} later; what you entered
              stays filled in.
            </p>
          ) : null}
        </div>
      </div>
      <SaveDestination phase="after" />
      <div className="flex flex-col gap-2">
        {wrong > 0 ? (
          // Scoped to this sheet — the plain queue is oldest-first across
          // all history and would open on unrelated mistakes.
          <Link
            href={`/practice/review/#session=${encodeURIComponent(sheet.id)}`}
            className="w-full"
          >
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
