/**
 * The readiness check — one short sitting that answers, before any
 * practice history exists, "could I pass this exam today, and if not,
 * where do I study first?".
 *
 * Readiness proper (readiness.ts) is coverage-gated: it says nothing
 * about a domain until a dozen first attempts are in, which a fresh
 * learner reaches over days. The check gets there in one sitting by
 * being a STRATIFIED SAMPLE: every blueprint domain is dealt a floor of
 * questions so it can be judged at all, the rest of the budget follows
 * the blueprint weights (or bank size when the pack declares none —
 * the same fallback readiness uses), and unseen questions come first so
 * the sitting is a cold look. The floor is deliberately lower than the
 * readiness gate — three questions per domain, not twelve — which is
 * why the result is labelled a quick read and ranks domains by point
 * estimate rather than pretending the per-domain bands are tight.
 *
 * The check is a learning session too: feedback after every question,
 * as in practice. What keeps it honest is that each question is asked
 * once, so every attempt is a first attempt — readiness.ts's
 * latest-cold-look rule then counts the sitting as ordinary history and
 * the Progress estimate moves on from it.
 *
 * Pure functions over the readiness domain inputs, a bank of
 * `{ id, categoryKey }` and stored attempts/sessions; the React runner
 * (src/pack/CheckRunner.tsx) is the I/O shell.
 */
import type { Attempt, Session, SessionMode } from '@/data/types';
import {
  computeReadiness,
  type DomainReadiness,
  type ExamGoal,
  type ReadinessDomainInput,
  type ReadinessReport,
} from './readiness';
import { pickSessionQuestions, shuffle, type Rng, type SelectableQuestion } from './selection';

/** The sitting's mode on its session and attempts. */
export const CHECK_MODE: SessionMode = 'check';
/** Session pseudo-subject; attempts keep their real category key. */
export const CHECK_SUBJECT = 'check';

/** First attempts per domain the check aims for — enough to notice a
 *  domain is weak, far from enough for a tight band (see the header). */
export const CHECK_DOMAIN_FLOOR = 3;
/** Share of the real exam's length the check targets when the pack
 *  declares `questionCount`. */
export const CHECK_EXAM_FRACTION = 1 / 3;

export interface CheckPlan {
  /** Questions the sitting deals in total. */
  count: number;
  /** Questions per domain, in the order the domains were given; domains
   *  with an empty bank are left out. */
  perDomain: { key: string; count: number }[];
  /** The per-domain floor the plan was built with. */
  floor: number;
  /** Minutes at the real exam's pace when the pack declares both
   *  `durationMinutes` and `questionCount`; null when it can't be known. */
  minutes: number | null;
}

/** Blueprint share per domain: weights when any are set, else bank
 *  size, else equal — readiness.ts's rule, over the live domains only. */
function shares(domains: readonly ReadinessDomainInput[]): number[] {
  const weight = domains.map((d) => Math.max(0, d.weight));
  const available = domains.map((d) => Math.max(0, d.available));
  const pick = weight.some((w) => w > 0) ? weight : available;
  const total = pick.reduce((s, v) => s + v, 0);
  if (total <= 0) return domains.map(() => 1 / Math.max(1, domains.length));
  return pick.map((v) => v / total);
}

/**
 * Split `count` questions across the domains: each gets at least its
 * floor (capped at what it holds), the rest follows the blueprint
 * shares, nobody gets more than their bank. Water-filling: a domain
 * whose share would fall below its floor, or rise above its bank, is
 * pinned there and the remainder is reshared among the others; the last
 * free domains are rounded by largest remainder so the total is exact.
 */
function allocate(
  domains: readonly ReadinessDomainInput[],
  count: number,
  floor: number,
): number[] {
  const base = domains.map((d) => Math.min(floor, Math.max(0, d.available)));
  const cap = domains.map((d) => Math.max(0, d.available));
  const share = shares(domains);
  const alloc = base.slice();
  const pinned = domains.map((_, i) => cap[i] <= base[i]);

  for (;;) {
    const free = domains.map((_, i) => i).filter((i) => !pinned[i]);
    const remaining = count - alloc.reduce((s, v, i) => s + (pinned[i] ? v : 0), 0);
    if (free.length === 0) break;
    const shareSum = free.reduce((s, i) => s + share[i], 0);
    const ideal = free.map((i) => (shareSum > 0 ? (remaining * share[i]) / shareSum : remaining / free.length));
    let repinned = false;
    free.forEach((i, k) => {
      if (ideal[k] < base[i]) {
        alloc[i] = base[i];
        pinned[i] = true;
        repinned = true;
      } else if (ideal[k] > cap[i]) {
        alloc[i] = cap[i];
        pinned[i] = true;
        repinned = true;
      }
    });
    if (repinned) continue;
    // Largest-remainder rounding; ties go to the larger share, then order.
    const whole = ideal.map((v) => Math.floor(v));
    let left = remaining - whole.reduce((s, v) => s + v, 0);
    const order = free
      .map((i, k) => ({ i, k, frac: ideal[k] - whole[k] }))
      .sort((a, b) => b.frac - a.frac || share[b.i] - share[a.i] || a.i - b.i);
    for (const { k } of order) {
      if (left <= 0) break;
      whole[k] += 1;
      left -= 1;
    }
    free.forEach((i, k) => {
      alloc[i] = whole[k];
    });
    break;
  }
  return alloc;
}

/**
 * Size one check for an exam over its domains: a floor per domain so
 * each can be judged, topped up to about a third of the real exam when
 * the pack says how long that is, never more than the bank holds. Null
 * when no domain has a question.
 */
export function planCheck(
  domains: readonly ReadinessDomainInput[],
  exam: Pick<ExamGoal, 'questionCount'> & { durationMinutes?: number },
  opts: { floor?: number; fraction?: number } = {},
): CheckPlan | null {
  const floor = opts.floor ?? CHECK_DOMAIN_FLOOR;
  const fraction = opts.fraction ?? CHECK_EXAM_FRACTION;
  const live = domains.filter((d) => d.available > 0);
  if (live.length === 0) return null;

  const totalAvailable = live.reduce((s, d) => s + d.available, 0);
  const floorTotal = live.reduce((s, d) => s + Math.min(floor, d.available), 0);
  const target = exam.questionCount ? Math.round(exam.questionCount * fraction) : 0;
  const count = Math.min(totalAvailable, Math.max(floorTotal, target));

  const alloc = allocate(live, count, floor);
  const perDomain = live.map((d, i) => ({ key: d.key, count: alloc[i] }));
  const minutes =
    exam.questionCount && exam.durationMinutes
      ? Math.round((count * exam.durationMinutes) / exam.questionCount)
      : null;
  return { count, perDomain, floor, minutes };
}

/**
 * Deal the sitting from an in-scope bank: per domain, the planned
 * number of questions with unseen ones first (the selection engine's
 * rule), then the whole hand shuffled so the domains are mixed as on
 * the real exam.
 */
export function dealCheck<Q extends SelectableQuestion & { categoryKey: string }>(
  plan: CheckPlan,
  bank: readonly Q[],
  attemptedIds: ReadonlySet<Q['id']>,
  rng: Rng = Math.random,
): Q[] {
  const dealt: Q[] = [];
  const seen = new Set(attemptedIds);
  for (const { key, count } of plan.perDomain) {
    const pool = bank.filter((q) => q.categoryKey === key);
    dealt.push(
      ...pickSessionQuestions(pool, {
        count,
        historicalAttemptedIds: seen,
        currentSessionIds: new Set(),
        rng,
      }),
    );
  }
  return shuffle(dealt, rng);
}

export interface CheckDomainResult extends DomainReadiness {
  /** Questions answered wrong in this check, in the order they came. */
  missedIds: string[];
}

export interface CheckStudyItem {
  key: string;
  label: string;
  weightPct: number;
  accuracyPct: number;
  /** Points below the pass line. */
  shortfallPct: number;
}

export interface CheckResult {
  sessionId: string;
  /** The readiness report over this sitting alone, judged at the check
   *  floor — its verdict is the headline, its band the gauge. */
  report: ReadinessReport;
  domains: CheckDomainResult[];
  /** Weak domains, the one to study first at the top: ranked by
   *  blueprint share × shortfall, so time goes to what is both heavy on
   *  the exam and weak, not to what the learner already knows. */
  studyOrder: CheckStudyItem[];
  answered: number;
  correct: number;
  scorePct: number;
}

/**
 * Read one completed check: the verdict and band over its attempts, each
 * domain's standing with the questions it missed, and the study order.
 */
export function checkResult(
  goal: ExamGoal,
  domains: readonly ReadinessDomainInput[],
  attempts: readonly Attempt[],
  sessionId: string,
  opts: { floor?: number; inScope?: (questionId: string) => boolean } = {},
): CheckResult {
  const floor = opts.floor ?? CHECK_DOMAIN_FLOOR;
  const own = attempts
    .filter((a) => a.sessionId === sessionId)
    .sort((a, b) => a.answeredAt - b.answeredAt);
  const report = computeReadiness(goal, domains, own, {
    minDomainSample: floor,
    inScope: opts.inScope,
    maxNudges: domains.length,
  });

  const missedBy = new Map<string, string[]>();
  for (const a of own) {
    if (a.isCorrect) continue;
    const list = missedBy.get(a.subject) ?? [];
    list.push(a.questionId);
    missedBy.set(a.subject, list);
  }
  const domainResults = report.domains.map((d) => ({
    ...d,
    missedIds: missedBy.get(d.key) ?? [],
  }));

  const urgency = (s: CheckStudyItem): number => (s.weightPct / 100) * (s.shortfallPct / 100);
  const studyOrder: CheckStudyItem[] = domainResults
    .filter((d) => d.status === 'weak')
    .map((d) => ({
      key: d.key,
      label: d.label,
      weightPct: d.weightPct,
      accuracyPct: d.accuracyPct,
      shortfallPct: Math.max(0, goal.passPct - d.accuracyPct),
    }))
    .sort((a, b) => urgency(b) - urgency(a) || b.weightPct - a.weightPct);

  const correct = own.filter((a) => a.isCorrect).length;
  return {
    sessionId,
    report,
    domains: domainResults,
    studyOrder,
    answered: own.length,
    correct,
    scorePct: own.length ? Math.round((correct / own.length) * 100) : 0,
  };
}

/** Completed checks, newest first — what "sit it again" compares to. */
export function checkHistory(sessions: readonly Session[]): Session[] {
  return sessions
    .filter((s) => s.mode === CHECK_MODE && s.endedAt !== null)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export interface CheckComparison {
  /** Change in the overall estimate, in points. */
  estimateDelta: number;
  /** Per-domain change in first-attempt accuracy, in `current` order. */
  domains: { key: string; delta: number }[];
}

/** How the current check moved against a previous one. */
export function compareChecks(current: CheckResult, previous: CheckResult): CheckComparison {
  const before = new Map(previous.domains.map((d) => [d.key, d.accuracyPct]));
  return {
    estimateDelta: current.report.estimatePct - previous.report.estimatePct,
    domains: current.domains.map((d) => ({
      key: d.key,
      delta: d.accuracyPct - (before.get(d.key) ?? 0),
    })),
  };
}
