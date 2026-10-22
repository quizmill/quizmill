'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import type { Attempt, Session } from '@/data/types';
import { cn } from '@/lib/cn';
import { compareChecks, type CheckResult } from '@/lib/readinessCheck';
import { ScoreGauge, VERDICT_META } from '@/pack/ExamReadiness';
import { checkResultFor } from '@/pack/check';
import { PACK_CONCEPT_BY_ID, packQuestions, type PackQuestion } from '@/pack/data';

const QUESTION_BY_ID: Map<string, PackQuestion> = new Map(packQuestions.map((q) => [q.id, q]));

/**
 * The page a readiness check ends on — richer than the per-question
 * feedback, and what the learner plans from: the verdict and band
 * against the pass line, the study order (weak domains ranked by
 * blueprint share × shortfall, each a tap into practice restricted to
 * it), every domain's standing with the questions it missed and the
 * concepts behind them, and how it moved since the previous check.
 *
 * Everything here is derived from the sitting's stored attempts, so a
 * past check reads back identically from its session id.
 */
export function CheckResultView({
  sessionId,
  previous,
  attempts,
}: {
  sessionId: string;
  /** The completed check before this one, when there is one. */
  previous: Session | null;
  attempts: readonly Attempt[];
}) {
  const exam = APP_CONFIG.exam;
  const result = checkResultFor(attempts, sessionId);
  if (!exam || !result) return null;
  const before = previous ? checkResultFor(attempts, previous.id) : null;
  const diff = before ? compareChecks(result, before) : null;
  const deltaOf = (key: string): number | null =>
    diff?.domains.find((d) => d.key === key)?.delta ?? null;

  const { report } = result;
  const meta = VERDICT_META[report.verdict];
  const examName = exam.label ?? 'the exam';
  const thin = result.domains.filter((d) => d.status === 'thin' || d.status === 'untested');

  return (
    <div className="flex flex-col gap-5" data-testid="check-result">
      {/* Verdict, score, band */}
      <section className="flex flex-col gap-4 rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Readiness check
            </div>
            <div
              className={cn(
                'mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                meta.pill,
              )}
              data-testid="check-verdict"
              data-verdict={report.verdict}
            >
              <span>{meta.emoji}</span>
              {meta.label}
            </div>
            <p className="mt-2 text-sm text-ink-600">{meta.blurb(report, examName)}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className={cn('text-3xl font-bold tabular-nums', meta.text)}>
              {report.estimatePct}%
            </div>
            <div className="text-xs text-ink-400">
              {report.lowPct}–{report.highPct}% range
            </div>
            <div className="mt-1 text-xs text-ink-500" data-testid="check-score">
              {result.correct}/{result.answered} correct
            </div>
          </div>
        </div>

        {report.judgedWeightPct > 0 ? <ScoreGauge report={report} tone={meta.tone} /> : null}

        {diff && before ? (
          <p className="text-sm text-ink-600" data-testid="check-comparison">
            Last check: {before.report.estimatePct}% →{' '}
            <strong className="text-ink-900">{report.estimatePct}%</strong>{' '}
            <Delta value={diff.estimateDelta} />
          </p>
        ) : null}
      </section>

      {/* Study order */}
      <section className="flex flex-col gap-2" data-testid="check-study-order">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Study order
        </h2>
        {result.studyOrder.length === 0 ? (
          <div className="rounded-2xl border border-ink-200 bg-surface p-4 text-sm text-ink-600 shadow-xs">
            {thin.length === result.domains.length
              ? 'Nothing could be judged from this sitting.'
              : `Every judged domain cleared the ${report.passPct}% pass line in this sitting. Keep practising to tighten the range.`}
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {result.studyOrder.map((s, i) => {
              const domain = result.domains.find((d) => d.key === s.key);
              return (
                <li key={s.key}>
                  <Link
                    href={`/practice/?subject=${s.key}`}
                    data-testid={`check-study-${s.key}`}
                    className="tap-feedback group flex items-center gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs transition hover:border-brand-300 hover:shadow-md"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warn-100 text-sm font-bold text-warn-700">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink-900">{s.label}</div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {s.accuracyPct}% here · {s.shortfallPct} points below the pass line ·{' '}
                        {s.weightPct}% of the exam
                      </div>
                      {domain ? <MissedLine domain={domain} /> : null}
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand-600 group-hover:underline">
                      Practise
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Every domain */}
      <section className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          By domain
        </h2>
        {result.domains.map((d) => (
          <div key={d.key} data-testid={`check-domain-${d.key}`} data-status={d.status}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-semibold text-ink-900">{d.label}</span>
              <span className="shrink-0 text-ink-500">
                {d.attempted === 0 ? (
                  <span className="text-ink-400">not asked</span>
                ) : (
                  <>
                    {d.correct}/{d.attempted} · {d.accuracyPct}%{' '}
                    <Delta value={deltaOf(d.key)} />{' '}
                    <span className={cn('font-semibold', STATUS_TEXT[d.status])}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </>
                )}
              </span>
            </div>
            <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className={cn('h-full rounded-full', STATUS_BG[d.status])}
                style={{ width: `${d.attempted === 0 ? 0 : Math.max(d.accuracyPct, 4)}%` }}
              />
              <div
                className="absolute top-0 h-full border-l border-dashed border-ink-400"
                style={{ left: `${report.passPct}%` }}
              />
            </div>
          </div>
        ))}
        <p className="text-[11px] leading-relaxed text-ink-400">
          A quick read, not a verdict: each domain got about {result.domains.length > 0 ? Math.max(...result.domains.map((d) => d.attempted)) : 0}{' '}
          questions, so one miss moves it a long way. Weak means below the {report.passPct}%
          pass line on this sitting; thin means too few questions to say. Every answer here
          counts as a first attempt toward the readiness estimate on Progress, which needs
          more per domain before it commits.
          {report.scaled
            ? ' This exam is scored on a scaled curve, so treat the pass mark as approximate.'
            : ''}
        </p>
      </section>
    </div>
  );
}

/** The questions a domain missed, as prompt excerpts, and the concepts
 *  behind them when the pack links any. */
function MissedLine({ domain }: { domain: CheckResult['domains'][number] }) {
  if (domain.missedIds.length === 0) return null;
  const missed = domain.missedIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean) as PackQuestion[];
  const concepts = [...new Set(missed.flatMap((q) => (q.conceptId ? [q.conceptId] : [])))]
    .map((id) => PACK_CONCEPT_BY_ID[id]?.title)
    .filter(Boolean) as string[];
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <ul className="flex flex-col gap-0.5 text-xs text-ink-600">
        {missed.map((q) => (
          <li key={q.id} className="truncate">
            ✗ {excerpt(q.prompt)}
          </li>
        ))}
      </ul>
      {concepts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {concepts.map((c) => (
            <span
              key={c}
              className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600"
            >
              📖 {c}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  if (value === 0) return <span className="text-ink-400">(±0)</span>;
  return (
    <span className={value > 0 ? 'text-success-600' : 'text-warn-600'}>
      ({value > 0 ? '+' : ''}
      {value})
    </span>
  );
}

const STATUS_LABEL: Record<CheckResult['domains'][number]['status'], string> = {
  solid: 'solid',
  weak: 'weak',
  thin: 'thin',
  untested: 'untested',
};
const STATUS_TEXT: Record<CheckResult['domains'][number]['status'], string> = {
  solid: 'text-success-600',
  weak: 'text-warn-600',
  thin: 'text-ink-400',
  untested: 'text-ink-400',
};
const STATUS_BG: Record<CheckResult['domains'][number]['status'], string> = {
  solid: 'bg-success-500',
  weak: 'bg-warn-500',
  thin: 'bg-ink-300',
  untested: 'bg-ink-200',
};

/** First line of a prompt, trimmed. Prompts are markdown; stripping
 *  syntax chars is enough for a one-line preview (as on Progress). */
function excerpt(prompt: string, max = 80): string {
  const flat = prompt.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
