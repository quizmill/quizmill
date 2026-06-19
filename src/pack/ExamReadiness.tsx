'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import type { Attempt } from '@/data/types';
import {
  computeReadiness,
  type DomainReadiness,
  type ReadinessReport,
  type ReadinessVerdict,
} from '@/lib/readiness';
import { EXAM_AVAILABLE_BY_CATEGORY, examInScope } from '@/pack/data';
import { cn } from '@/lib/cn';

/** Build the readiness report for the active pack's exam goal, or null when
 *  the pack declares none. Shared by the Progress panel and the Home chip. */
export function readinessFor(attempts: readonly Attempt[]): ReadinessReport | null {
  const exam = APP_CONFIG.exam;
  if (!exam) return null;
  const domains = APP_CONFIG.categories.map((c) => ({
    key: c.key,
    label: c.shortLabel ?? c.label,
    weight: c.weight ?? 0,
    available: EXAM_AVAILABLE_BY_CATEGORY[c.key] ?? 0,
  }));
  return computeReadiness(exam, domains, attempts, { inScope: examInScope });
}

/**
 * Exam-readiness panel for the Progress page — "when am I ready to sit this?".
 * Renders only when the pack declares an `exam` goal. A score-band gauge
 * (estimate + confidence interval vs the pass line), per-domain readiness,
 * a prioritised "focus next" list, and the honesty caveats that keep the
 * number from over-promising. See src/lib/readiness.ts for the model.
 */
export default function ExamReadiness({ attempts }: { attempts: readonly Attempt[] }) {
  const exam = APP_CONFIG.exam;
  const report = readinessFor(attempts);
  if (!exam || !report) return null;

  const meta = VERDICT_META[report.verdict];
  const hasReadings = report.judgedWeightPct > 0;
  const examName = exam.label ?? 'the exam';

  return (
    <section className="flex flex-col gap-3" data-testid="exam-readiness">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Exam readiness
        </h2>
        <span className="text-xs text-ink-400">{examName}</span>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
        {/* Verdict + headline number */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                meta.pill,
              )}
              data-testid="readiness-verdict"
              data-verdict={report.verdict}
            >
              <span>{meta.emoji}</span>
              {meta.label}
            </div>
            <p className="mt-2 text-sm text-ink-600">{meta.blurb(report, examName)}</p>
          </div>
          {hasReadings ? (
            <div className="flex-shrink-0 text-right">
              <div className={cn('text-3xl font-bold tabular-nums', meta.text)}>
                {report.estimatePct}%
              </div>
              <div className="text-xs text-ink-400">
                {report.lowPct}–{report.highPct}% range
              </div>
            </div>
          ) : null}
        </div>

        {/* Score-band gauge: confidence band + estimate marker vs the pass line */}
        {hasReadings ? (
          <ScoreGauge report={report} tone={meta.tone} />
        ) : (
          <div className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600">
            Answer more questions across the domains below and a readiness
            estimate appears here — we need a representative sample first.
          </div>
        )}

        {/* Per-domain readiness */}
        <div className="flex flex-col gap-3">
          {report.domains.map((d) => (
            <DomainRow key={d.key} d={d} passPct={report.passPct} />
          ))}
        </div>

        {/* Focus next */}
        {report.nudges.length > 0 ? (
          <div className="flex flex-col gap-2" data-testid="readiness-nudges">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Focus next
            </h3>
            {report.nudges.map((n) => (
              <Link
                key={n.key}
                href={`/practice/${n.key}/`}
                className="tap-feedback group flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-ink-50 p-3 transition hover:border-brand-300 hover:bg-white"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                    {n.label}
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        n.kind === 'improve'
                          ? 'bg-warn-100 text-warn-700'
                          : 'bg-ink-200 text-ink-600',
                      )}
                    >
                      {n.kind === 'improve' ? 'grind' : 'cover'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">{n.reason}</div>
                </div>
                <span className="flex-shrink-0 text-xs font-semibold text-brand-600 group-hover:underline">
                  Practise
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {/* Honesty caveats */}
        <p className="text-[11px] leading-relaxed text-ink-400">
          Estimate uses your <strong>first answer</strong> to each question (re-tries
          after a miss don&apos;t count) across {report.judgedWeightPct}% of the exam
          blueprint covered so far.{' '}
          {report.scaled
            ? 'This exam is scored on a scaled curve, so treat the pass mark as approximate. '
            : ''}
          Practice questions aren&apos;t the real exam — use this as a guide, not a guarantee.
        </p>
      </div>
    </section>
  );
}

/** Horizontal gauge: a confidence band over a 0–100 track with the estimate
 *  marker and a dashed pass-line. CSS-only, no charting dep. */
function ScoreGauge({ report, tone }: { report: ReadinessReport; tone: Tone }) {
  const { lowPct, highPct, estimatePct, passPct } = report;
  return (
    <div className="pt-1">
      <div className="relative h-3 rounded-full bg-ink-100">
        {/* confidence band */}
        <div
          className={cn('absolute top-0 h-full rounded-full', BAND_BG[tone])}
          style={{ left: `${lowPct}%`, width: `${Math.max(highPct - lowPct, 1)}%` }}
        />
        {/* estimate marker */}
        <div
          className={cn('absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full', MARK_BG[tone])}
          style={{ left: `${estimatePct}%` }}
        />
        {/* pass line */}
        <div
          className="absolute -top-1 h-5 border-l-2 border-dashed border-ink-500"
          style={{ left: `${passPct}%` }}
          title={`Pass mark ${passPct}%`}
        />
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-ink-400">
        <span className="absolute left-0">0%</span>
        <span
          className="absolute -translate-x-1/2 font-semibold text-ink-500"
          style={{ left: `${passPct}%` }}
        >
          pass {passPct}%
        </span>
        <span className="absolute right-0">100%</span>
      </div>
    </div>
  );
}

/**
 * Compact Home-screen banner: verdict + estimate vs the pass mark, linking
 * to the full Progress breakdown. Hidden until there's a reading to show.
 */
export function ExamReadinessChip({ attempts }: { attempts: readonly Attempt[] }) {
  const report = readinessFor(attempts);
  if (!report || report.judgedWeightPct === 0) return null;
  const meta = VERDICT_META[report.verdict];
  return (
    <Link
      href="/progress"
      data-testid="exam-readiness-chip"
      className={cn(
        'tap-feedback flex items-center justify-between gap-3 rounded-2xl border p-4 shadow-sm',
        meta.banner,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/70 text-xl">
          {meta.emoji}
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold text-ink-900">
            Exam readiness: {meta.label}
          </div>
          <div className="text-sm text-ink-600">
            Estimated {report.estimatePct}% · pass mark {report.passPct}%
            {report.scaled ? ' (scaled)' : ''}
          </div>
        </div>
      </div>
      <ArrowRight className="h-5 w-5 flex-shrink-0 text-ink-500" />
    </Link>
  );
}

function DomainRow({ d, passPct }: { d: DomainReadiness; passPct: number }) {
  const seen = d.attempted === 0 ? 'not started' : `${d.coveragePct}% seen`;
  return (
    <div data-testid={`readiness-domain-${d.key}`}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-ink-900">{d.label}</span>
        <span className="text-ink-500">
          {d.attempted === 0 ? (
            <span className="text-ink-400">untested</span>
          ) : (
            <>
              {d.accuracyPct}% · {seen}
              {!d.judged ? <span className="text-warn-600"> · thin</span> : null}
            </>
          )}
        </span>
      </div>
      {/* accuracy bar with a pass-line marker */}
      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn('h-full rounded-full', DOMAIN_BG[d.status])}
          style={{ width: `${d.attempted === 0 ? 0 : Math.max(d.accuracyPct, 4)}%` }}
        />
        <div
          className="absolute top-0 h-full border-l border-dashed border-ink-400"
          style={{ left: `${passPct}%` }}
        />
      </div>
    </div>
  );
}

type Tone = 'success' | 'warn' | 'brand' | 'ink';

const BAND_BG: Record<Tone, string> = {
  success: 'bg-success-200',
  warn: 'bg-warn-200',
  brand: 'bg-brand-200',
  ink: 'bg-ink-300',
};
const MARK_BG: Record<Tone, string> = {
  success: 'bg-success-600',
  warn: 'bg-warn-600',
  brand: 'bg-brand-600',
  ink: 'bg-ink-600',
};
const DOMAIN_BG: Record<DomainReadiness['status'], string> = {
  solid: 'bg-success-500',
  weak: 'bg-warn-500',
  thin: 'bg-ink-300',
  untested: 'bg-ink-200',
};

interface VerdictMeta {
  label: string;
  emoji: string;
  tone: Tone;
  pill: string;
  text: string;
  /** Tint for the compact Home banner. */
  banner: string;
  blurb: (r: ReadinessReport, examName: string) => string;
}

const VERDICT_META: Record<ReadinessVerdict, VerdictMeta> = {
  ready: {
    label: 'On track to pass',
    emoji: '🎯',
    tone: 'success',
    pill: 'bg-success-100 text-success-700',
    text: 'text-success-600',
    banner: 'border-success-500/30 bg-success-50',
    blurb: (r, name) =>
      `Your estimated score clears the ${r.passPct}% mark for ${name} even at the low end. Keep your streak warm.`,
  },
  borderline: {
    label: 'Right on the line',
    emoji: '⚖️',
    tone: 'warn',
    pill: 'bg-warn-100 text-warn-700',
    text: 'text-warn-700',
    banner: 'border-warn-500/30 bg-warn-50',
    blurb: (r) =>
      `You're hovering around the ${r.passPct}% pass mark — too close to call. Shore up the weak domains below to build a margin.`,
  },
  'not-ready': {
    label: 'Not ready yet',
    emoji: '📚',
    tone: 'warn',
    pill: 'bg-warn-100 text-warn-700',
    text: 'text-warn-700',
    banner: 'border-warn-500/30 bg-warn-50',
    blurb: (r) =>
      `Your estimate sits below the ${r.passPct}% pass mark. The focus areas below are where the points are.`,
  },
  'no-data': {
    label: 'Keep practising',
    emoji: '🌱',
    tone: 'brand',
    pill: 'bg-brand-100 text-brand-700',
    text: 'text-brand-600',
    banner: 'border-brand-500/30 bg-brand-50',
    blurb: () =>
      `Not enough of the blueprint covered yet to estimate readiness. Spread your practice across the domains below.`,
  },
};
