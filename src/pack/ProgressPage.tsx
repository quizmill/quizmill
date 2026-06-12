'use client';

import Link from 'next/link';
import { ArrowLeft, Flame } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { APP_CONFIG } from '@/config';
import { useStorageData } from '@/lib/useStorage';
import {
  accuracyByCategory,
  accuracyByDay,
  completedSessionDates,
  sessionsByWeekday,
  sessionSummary,
  weakestQuestions,
} from '@/lib/stats';
import { currentStreak } from '@/lib/streak';
import { packQuestions, PACK_CATEGORY_LABEL } from '@/pack/data';
import { cn } from '@/lib/cn';

const WEAK_SPOT_LIMIT = 8;
const DAILY_POINT_LIMIT = 30;

/**
 * Progress page: accuracy per category, accuracy over time, and a
 * weakest-questions list with practise links. All charts are plain
 * CSS/flex — no charting dependency; packs stay lightweight.
 */
export default function ProgressPage() {
  const { sessions, attempts } = useStorageData();

  const streak = currentStreak(completedSessionDates(sessions));
  const summary = sessionSummary(sessions);
  const byWeekday = sessionsByWeekday(sessions);
  const maxWeekday = Math.max(...byWeekday.map((d) => d.sessions), 1);
  const byCategory = accuracyByCategory(attempts, APP_CONFIG.categories);
  const byDay = accuracyByDay(attempts, null).slice(-DAILY_POINT_LIMIT);
  const weakest = weakestQuestions(attempts).slice(0, WEAK_SPOT_LIMIT);
  const promptById = new Map(packQuestions.map((q) => [q.id, q.prompt]));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        {streak > 0 ? (
          <div
            data-testid="daily-streak"
            className="inline-flex items-center gap-1 rounded-full bg-warn-100 px-3 py-1 text-sm font-semibold text-warn-700"
          >
            <Flame className="h-4 w-4" />
            {streak}-day streak
          </div>
        ) : null}
      </header>

      <div>
        <h1 className="text-3xl font-bold text-ink-900">Progress</h1>
        <p className="mt-1 text-ink-500">
          Your sessions, accuracy by category and over time, and where to
          focus next.
        </p>
      </div>

      {attempts.length === 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-sm">
          <p className="text-ink-600">
            No practice yet — answer some questions and your progress
            shows up here.
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button size="lg">Start practising</Button>
          </Link>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Sessions
            </h2>
            <div data-testid="session-summary" className="grid grid-cols-3 gap-2.5">
              <SummaryTile value={String(summary.sessions)} label="sessions" />
              <SummaryTile
                value={formatDuration(summary.medianDurationSeconds)}
                label="typical length"
              />
              <SummaryTile
                value={String(summary.medianQuestions)}
                label="questions / session"
              />
            </div>
            <div
              data-testid="weekday-chart"
              className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm"
            >
              <div className="flex h-20 items-end gap-1.5">
                {byWeekday.map((d) => (
                  <div
                    key={d.label}
                    data-testid={`weekday-${d.label.toLowerCase()}`}
                    data-count={d.sessions}
                    className="flex h-full flex-1 flex-col justify-end"
                    title={`${d.label}: ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
                  >
                    <div
                      className={cn(
                        'w-full rounded-t',
                        d.sessions === 0 ? 'bg-ink-100' : 'bg-brand-500',
                      )}
                      style={{
                        height: `${d.sessions === 0 ? 4 : Math.max((d.sessions / maxWeekday) * 100, 12)}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5 text-xs text-ink-500">
                {byWeekday.map((d) => (
                  <span key={d.label} className="flex-1 text-center">
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Accuracy by category
            </h2>
            <div className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
              {byCategory.map((row) => (
                <div key={row.key} data-testid={`category-accuracy-${row.key}`}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-ink-900">{row.label}</span>
                    <span className="text-ink-500">
                      {row.attempted === 0
                        ? 'not started'
                        : `${row.accuracyPct}% · ${row.correct}/${row.attempted}`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={cn('h-full rounded-full', accuracyTone(row.accuracyPct))}
                      style={{ width: `${row.attempted === 0 ? 0 : Math.max(row.accuracyPct, 4)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Accuracy over time
            </h2>
            <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
              <div className="flex h-28 items-end gap-1">
                {byDay.map((p) => (
                  <div
                    key={p.date}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                    title={`${p.date}: ${p.accuracyPct}% (${p.correct}/${p.attempted})`}
                  >
                    <div
                      className={cn('w-full rounded-t', accuracyTone(p.accuracyPct))}
                      style={{ height: `${Math.max(p.accuracyPct, 4)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-ink-500">
                <span>{byDay[0]?.date}</span>
                <span>
                  {byDay.length > 1 ? byDay[byDay.length - 1]?.date : null}
                </span>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Weak spots
            </h2>
            {weakest.length === 0 ? (
              <div className="rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-600 shadow-sm">
                Weak spots appear once questions have been tried more than
                once — keep practising.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {weakest.map((w) => (
                  <Link
                    key={w.questionId}
                    href={`/practice/${w.categoryKey}/`}
                    className="tap-feedback group flex items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow-md"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink-900">
                        {excerpt(promptById.get(w.questionId) ?? w.questionId)}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {PACK_CATEGORY_LABEL[w.categoryKey] ?? w.categoryKey} ·{' '}
                        {w.accuracyPct}% · {w.correct}/{w.attempted} correct
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-xs font-semibold text-brand-600 group-hover:underline">
                      Practise
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function SummaryTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-3 text-center shadow-sm">
      <div className="text-xl font-bold text-ink-900">{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </div>
  );
}

/** "45s", "4m", "4m 30s" — session lengths are short, hours never show. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Bar colour by accuracy band — calm, no neon (matches the palette). */
function accuracyTone(pct: number): string {
  if (pct >= 80) return 'bg-success-500';
  if (pct >= 60) return 'bg-brand-500';
  return 'bg-warn-500';
}

/** First line of a prompt, trimmed for the weak-spots list. Prompts are
 *  markdown; stripping syntax chars is enough for a one-line preview. */
function excerpt(prompt: string, max = 90): string {
  const flat = prompt.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
