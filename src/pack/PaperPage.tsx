'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Printer,
  Trash2,
} from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { PackChip } from '@/components/PackChip';
import { McqMarkdown } from '@/components/McqMarkdown';
import { QrCode } from '@/components/QrCode';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useStorageData } from '@/lib/useStorage';
import { loadLevelFilter } from '@/lib/storage';
import {
  packLevels,
  packManifest,
  packQuestions,
  packScenarios,
  PACK_CATEGORY_ICON,
  PACK_CATEGORY_LABEL,
  PACK_CATEGORY_TONE,
  PACK_LEVEL_LABEL,
  type PackQuestion,
} from '@/pack/data';
import { attemptHistory, bankForCategory, filterByLevel } from '@/pack/runner';
import { PackImage } from '@/pack/PackImage';
import {
  answerBoxLabel,
  composePaperSheet,
  deletePaperSheet,
  encodePaperPayload,
  loadPaperSheets,
  payloadFromSheet,
  resolveSheetQuestions,
  savePaperSheet,
  DEFAULT_PAPER_COUNT,
  PAPER_COUNT_CHOICES,
  type PaperSheet,
} from '@/pack/paper';

/** What the URL hash points at: the list/compose screen, or one sheet. */
function sheetIdFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash;
  return h.startsWith('#sheet=') ? decodeURIComponent(h.slice('#sheet='.length)) : null;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const SCENARIOS_BY_ID = new Map(packScenarios.map((s) => [s.id, s]));

/**
 * Paper practice — print a worksheet, then mark it back in. Two screens
 * on one static route: the compose/list screen, and one sheet
 * (`#sheet=<id>`) with its print layout, so the browser's back button
 * returns to the list. The marking flow lives at /paper/mark — the
 * printed QR deep-links there so any device with this pack (and the
 * same sync key) can enter the answers.
 */
export function PaperPage() {
  const { attempts, sessions } = useStorageData();
  const [mounted, setMounted] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  // Bumped after create/delete so the list re-reads localStorage.
  const [sheetsVersion, setSheetsVersion] = useState(0);

  useEffect(() => {
    setMounted(true);
    setSheetId(sheetIdFromHash());
    const onHash = () => setSheetId(sheetIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const sheets = useMemo(
    () => (mounted ? loadPaperSheets() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sheetsVersion invalidates the localStorage read
    [mounted, sheetsVersion],
  );

  if (!mounted) return null;

  const sheet = sheetId ? sheets.find((s) => s.id === sheetId) : undefined;
  if (sheetId && sheet) {
    return (
      <SheetView
        sheet={sheet}
        marked={
          sheet.markedAt !== undefined || sessions.some((s) => s.id === sheet.id)
        }
        onDelete={() => {
          deletePaperSheet(sheet.id);
          setSheetsVersion((v) => v + 1);
          window.location.hash = '';
        }}
      />
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <header>
        <PackChip className="mb-2" />
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-3xl font-bold text-ink-900">Paper practice</h1>
          <Link
            href="/"
            className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
        </div>
        <p className="mt-1 text-ink-500">
          Print a worksheet, practise away from the screen, then mark the
          answers back in — progress counts just like on-screen practice.
        </p>
      </header>

      <ComposeCard
        attempts={attempts}
        onCreated={(created) => {
          setSheetsVersion((v) => v + 1);
          window.location.hash = `sheet=${encodeURIComponent(created.id)}`;
        }}
      />

      {sheetId && !sheet ? (
        <p className="rounded-2xl border border-warn-500/40 bg-warn-50 p-4 text-sm text-ink-700">
          That sheet isn&apos;t stored on this device — it may have been
          printed elsewhere or deleted. Scan the QR on the printout to mark
          it anyway.
        </p>
      ) : null}

      {sheets.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink-700">Your sheets</h2>
          <div className="flex flex-col gap-2.5" data-testid="paper-sheet-list">
            {sheets.map((s) => {
              const marked =
                s.markedAt !== undefined || sessions.some((ses) => ses.id === s.id);
              return (
                // A plain anchor, NOT next/link: the router navigates
                // hash-only hrefs via history.pushState, which never fires
                // the `hashchange` event this page (and Coach) key off —
                // the URL would change but the view wouldn't. Native hash
                // navigation fires it and keeps the back button working.
                <a
                  key={s.id}
                  href={`#sheet=${encodeURIComponent(s.id)}`}
                  data-testid={`sheet-row-${s.code}`}
                  className="tap-feedback flex items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-ink-900">
                        {s.code}
                      </span>
                      {marked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-semibold text-success-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Marked
                        </span>
                      ) : (
                        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                          Waiting
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-ink-500">
                      {PACK_CATEGORY_LABEL[s.categoryKey] ?? s.categoryKey} ·{' '}
                      {s.questionIds.length} questions ·{' '}
                      {DATE_FORMAT.format(s.createdAt)}
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 flex-shrink-0 text-ink-400" />
                </a>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}

/** Category + level + count picker; creates and stores a sheet. */
function ComposeCard({
  attempts,
  onCreated,
}: {
  attempts: readonly { questionId: string; subject: string; answeredAt: number; isCorrect: boolean }[];
  onCreated: (sheet: PaperSheet) => void;
}) {
  const [categoryKey, setCategoryKey] = useState(
    APP_CONFIG.categories[0]?.key ?? '',
  );
  // Default to the practice level filter so paper matches what the
  // learner is working on.
  const [level, setLevel] = useState<string | null>(null);
  useEffect(() => setLevel(loadLevelFilter()), []);
  const [count, setCount] = useState<number>(DEFAULT_PAPER_COUNT);

  const bank = filterByLevel(bankForCategory(packQuestions, categoryKey), level);

  const create = () => {
    const history = attemptHistory([...attempts], categoryKey);
    const composed = composePaperSheet(bank, history, {
      categoryKey,
      count,
      ...(level ? { level } : {}),
    });
    if (!composed) return;
    savePaperSheet(composed.sheet);
    onCreated(composed.sheet);
  };

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm"
      data-testid="paper-compose"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
        <Printer className="h-5 w-5 text-ink-500" />
        New sheet
      </h2>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-600">Category</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
          {APP_CONFIG.categories.map((cat) => {
            const active = categoryKey === cat.key;
            const tone = PACK_CATEGORY_TONE[cat.key];
            return (
              <button
                key={cat.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategoryKey(cat.key)}
                className={cn(
                  'tap-feedback inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold',
                  active
                    ? cn('shadow-sm', tone.card, 'text-ink-900')
                    : 'border-ink-200 bg-surface text-ink-600 hover:text-ink-900',
                )}
              >
                <span aria-hidden>{PACK_CATEGORY_ICON[cat.key]}</span>
                {cat.shortLabel ?? cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {packLevels.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink-600">
            {packManifest.levelsLabel ?? 'Level'}
          </span>
          <div
            className="flex gap-1 rounded-full bg-ink-100 p-1"
            role="radiogroup"
            aria-label={packManifest.levelsLabel ?? 'Level'}
          >
            {[{ key: null as string | null, label: 'All' }, ...packLevels].map((lv) => (
              <button
                key={lv.key ?? '__all'}
                type="button"
                role="radio"
                aria-checked={level === lv.key}
                onClick={() => setLevel(lv.key)}
                className={cn(
                  'tap-feedback flex-1 rounded-full px-2.5 py-1.5 text-sm font-semibold transition-colors',
                  level === lv.key
                    ? 'bg-surface text-ink-900 shadow-sm'
                    : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {lv.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-600">Questions</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Question count">
          {PAPER_COUNT_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={count === c}
              onClick={() => setCount(c)}
              className={cn(
                'tap-feedback flex-1 rounded-xl border px-3 py-2 text-sm font-semibold',
                count === c
                  ? 'border-brand-500/40 bg-brand-50 text-brand-800 shadow-sm'
                  : 'border-ink-200 bg-surface text-ink-600 hover:text-ink-900',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <Button
        onClick={create}
        disabled={bank.length === 0}
        data-testid="create-sheet"
      >
        <Printer className="h-4 w-4" />
        Create sheet
        <span className="text-sm font-normal opacity-80">
          · {Math.min(count, bank.length)} of {bank.length} available
        </span>
      </Button>
    </section>
  );
}

/** One sheet: actions + the print layout (also the on-screen preview). */
function SheetView({
  sheet,
  marked,
  onDelete,
}: {
  sheet: PaperSheet;
  marked: boolean;
  onDelete: () => void;
}) {
  const marks = useMemo(
    () => resolveSheetQuestions(sheet.questionIds, packQuestions),
    [sheet],
  );
  const missing = marks.filter((m) => m.question === null).length;

  // The print stylesheet only strips the app chrome while a sheet is on
  // screen (body[data-paper-print] — see globals.css), so printing any
  // other page keeps working normally. The tab title becomes the sheet's
  // stamp while it's open: browsers derive the "Save as PDF" filename
  // from document.title, so each sheet saves under a unique name
  // (app - code - date) instead of piles of identically named PDFs.
  useEffect(() => {
    const original = document.title;
    const date = new Date(sheet.createdAt).toISOString().slice(0, 10);
    document.title = `${APP_CONFIG.title} - ${sheet.code} - ${date}`;
    document.body.setAttribute('data-paper-print', '1');
    return () => {
      document.title = original;
      document.body.removeAttribute('data-paper-print');
    };
  }, [sheet]);

  // The QR deep-links to the marking page with the whole sheet in the
  // fragment, so marking works on any device with this pack active.
  const [markUrl, setMarkUrl] = useState<string | null>(null);
  useEffect(() => {
    const payload = encodePaperPayload(payloadFromSheet(sheet, APP_CONFIG.packId));
    const base = new URL('mark/', window.location.href.split('#')[0]);
    setMarkUrl(`${base.href}#s=${payload}`);
  }, [sheet]);

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            window.location.hash = '';
          }}
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Sheets
        </button>
        <button
          type="button"
          aria-label="Delete sheet"
          onClick={() => {
            if (window.confirm('Delete this sheet? The printout stops being markable from this device (the QR still works).')) {
              onDelete();
            }
          }}
          className="tap-feedback inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-warn-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-2xl font-bold text-ink-900">{sheet.code}</h1>
          {marked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Marked
            </span>
          ) : null}
        </div>
        <p className="text-sm text-ink-500">
          {PACK_CATEGORY_LABEL[sheet.categoryKey] ?? sheet.categoryKey}
          {sheet.level ? ` · ${PACK_LEVEL_LABEL[sheet.level] ?? sheet.level}` : ''} ·{' '}
          {sheet.questionIds.length} questions · {DATE_FORMAT.format(sheet.createdAt)}
        </p>
        {missing > 0 ? (
          <p className="text-sm text-warn-600">
            {missing} question{missing === 1 ? '' : 's'} from this sheet{' '}
            {missing === 1 ? 'is' : 'are'} no longer in the pack and will print
            blank.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button onClick={() => window.print()} data-testid="print-sheet" block>
            <Printer className="h-4 w-4" />
            Print / PDF
          </Button>
          <Button
            variant="secondary"
            block
            data-testid="mark-sheet"
            onClick={() => {
              window.location.href = `mark/#sheet=${encodeURIComponent(sheet.id)}`;
            }}
          >
            <ClipboardCheck className="h-4 w-4" />
            Mark answers
          </Button>
        </div>
        <p className="text-center text-xs text-ink-500">
          No printer handy? Choose “Save as PDF” in the print dialog to send
          the sheet somewhere that has one.
        </p>
      </div>

      <PrintableSheet sheet={sheet} markUrl={markUrl} />
    </main>
  );
}

/**
 * The worksheet itself — on screen a "paper" preview (explicit white,
 * whatever the app theme), in print the ONLY visible element. Plain
 * borders and black text: worksheet aesthetics, and printers strip
 * background colour anyway.
 */
function PrintableSheet({
  sheet,
  markUrl,
}: {
  sheet: PaperSheet;
  markUrl: string | null;
}) {
  const marks = resolveSheetQuestions(sheet.questionIds, packQuestions);
  return (
    <div
      className="paper-sheet rounded-2xl border border-ink-200 bg-white p-6 text-neutral-900 shadow-sm"
      data-testid="paper-sheet"
    >
      <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-900 pb-4">
        <div className="min-w-0">
          <div className="text-lg font-bold">{APP_CONFIG.title}</div>
          <div className="mt-0.5 text-sm text-neutral-600">
            {PACK_CATEGORY_LABEL[sheet.categoryKey] ?? sheet.categoryKey}
            {sheet.level
              ? ` · ${PACK_LEVEL_LABEL[sheet.level] ?? sheet.level}`
              : ''}{' '}
            · {sheet.questionIds.length} questions
          </div>
          <div className="mt-6 flex gap-6 text-sm text-neutral-600">
            <span className="flex-1 border-b border-neutral-400 pb-0.5">Name</span>
            <span className="flex-1 border-b border-neutral-400 pb-0.5">Date</span>
          </div>
        </div>
        <div className="flex flex-col items-center">
          {markUrl ? <QrCode value={markUrl} className="h-24 w-24" /> : null}
          <span className="mt-1 font-mono text-sm font-bold">{sheet.code}</span>
        </div>
      </div>

      <ol className="mt-4 flex flex-col divide-y divide-neutral-200">
        {marks.map((mark, i) => {
          const q = mark.question;
          // Print a shared scenario stem once per run of questions, not
          // above every one of them — lookback instead of mutation.
          const prevScenarioId = i > 0 ? marks[i - 1].question?.scenarioId : undefined;
          const scenario =
            q?.scenarioId && q.scenarioId !== prevScenarioId
              ? SCENARIOS_BY_ID.get(q.scenarioId)
              : undefined;
          return (
            <li key={mark.questionId} className="paper-question flex gap-3 py-4">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 border-neutral-900 text-sm font-bold">
                {i + 1}
              </span>
              {q ? (
                <div className="min-w-0 flex-1 text-sm leading-relaxed">
                  {scenario?.stem ? (
                    <p className="mb-1.5 rounded-lg bg-neutral-100 p-2 italic text-neutral-700">
                      <McqMarkdown text={scenario.stem} />
                    </p>
                  ) : null}
                  <div className="font-medium">
                    <McqMarkdown text={q.prompt} />
                  </div>
                  {q.image ? (
                    <PackImage src={q.image} className="mt-2 max-h-44 rounded-lg" />
                  ) : null}
                  <ul className="mt-2 flex flex-col gap-1">
                    {q.options.map((opt) => (
                      <li key={opt.key} className="flex items-start gap-2">
                        <span className="font-bold">{opt.key}.</span>
                        <span className="min-w-0">
                          <McqMarkdown text={opt.text} />
                          {opt.image ? (
                            <PackImage
                              src={opt.image}
                              className="mt-1 max-h-24 rounded"
                            />
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex-1 text-sm italic text-neutral-400">
                  (This question is no longer in the pack.)
                </div>
              )}
              {q ? (
                <div className="flex w-16 flex-shrink-0 flex-col items-center gap-1">
                  <span className="h-12 w-14 rounded-lg border-2 border-neutral-900" />
                  <span className="text-center text-[9px] leading-tight text-neutral-500">
                    {answerBoxLabel(q)}
                  </span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-2 border-t-2 border-neutral-900 pt-3 text-center text-[10px] text-neutral-500">
        Sheet {sheet.code} · scan the code to enter the answers · made with
        quizmill
      </div>
    </div>
  );
}
