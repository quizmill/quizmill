/**
 * Exam-readiness estimation — "when am I ready to sit this?".
 *
 * The honest version of that question, computed from practice history the
 * way Strava predicts a race time from training. Three deliberate choices
 * keep the number from lying:
 *
 *  1. LATEST COLD LOOK. The mistakes engine re-asks a question until it's
 *     rescued, so counting every (or the latest) answer inflates accuracy
 *     toward eventually-correct — grinding Review would look like mastery.
 *     Instead we take your FIRST answer within each session (same-session
 *     rescue retries don't count) and keep the MOST RECENT session's result.
 *     That resists brute-forcing yet still rises as you genuinely re-learn a
 *     question in a later sitting — the fair proxy for cold exam performance.
 *  2. COVERAGE-GATED. A domain you've barely touched can't be judged; below a
 *     sample floor it's reported as "needs more data", never a confident pass.
 *  3. A CONFIDENCE BAND, not a point. Each domain's accuracy carries a Wilson
 *     interval that widens with small samples; the overall estimate is the
 *     blueprint-weighted (category `weight`) combination. The verdict reads
 *     the band against the pass line, so a borderline learner is told so.
 *
 * Pure functions over plain arrays + injected lookups (the engine never sees
 * question shapes — same boundary as `stats.ts`/`levelNudge`). Attempts carry
 * the category key denormalised as `subject`, so per-domain aggregation needs
 * no join; an optional `inScope` predicate restricts to exam-relevant
 * questions (e.g. a pack's `exam` level band).
 */
import type { Attempt } from '@/data/types';

/** The pack's declared exam goal (mirrors the manifest `exam` block). */
export interface ExamGoal {
  label?: string;
  passPct: number;
  scaled?: boolean;
  questionCount?: number;
}

/** One domain (= pack category) the readiness estimate is built over. */
export interface ReadinessDomainInput {
  key: string;
  label: string;
  /** Blueprint weight (share of the exam). Need not be normalised — the
   *  estimate normalises across the domains given. When all are 0/absent
   *  the caller should pass bank size as the weight instead. */
  weight: number;
  /** In-scope questions in this domain's bank — the coverage denominator. */
  available: number;
}

export type DomainStatus = 'untested' | 'thin' | 'weak' | 'solid';

export interface DomainReadiness {
  key: string;
  label: string;
  /** Normalised share of the exam, as a percentage (domains sum to ~100). */
  weightPct: number;
  /** Distinct in-scope questions answered at least once (first attempts). */
  attempted: number;
  correct: number;
  /** First-attempt accuracy point estimate. */
  accuracyPct: number;
  /** Wilson 95% interval on that accuracy. */
  lowPct: number;
  highPct: number;
  /** attempted / available, as a percentage (capped at 100). */
  coveragePct: number;
  /** Enough first attempts to be counted toward the verdict. */
  judged: boolean;
  status: DomainStatus;
}

export interface ReadinessNudge {
  key: string;
  label: string;
  weightPct: number;
  /** 'cover' = answer more here (too little data); 'improve' = accuracy is
   *  below the pass line. Ordered most-urgent-first by the caller. */
  kind: 'cover' | 'improve';
  accuracyPct: number;
  reason: string;
}

export type ReadinessVerdict =
  | 'no-data'
  | 'not-ready'
  | 'borderline'
  | 'likely'
  | 'ready';

export interface ReadinessReport {
  passPct: number;
  scaled: boolean;
  /** Blueprint-weighted first-attempt accuracy over the JUDGED domains. */
  estimatePct: number;
  lowPct: number;
  highPct: number;
  /** Share of the blueprint (by weight) that has enough data to judge. */
  judgedWeightPct: number;
  verdict: ReadinessVerdict;
  domains: DomainReadiness[];
  /** Where to grind next, most-urgent-first (blueprint-weighted). */
  nudges: ReadinessNudge[];
}

export interface ReadinessOptions {
  /** First attempts needed before a domain counts (capped at its bank size). */
  minDomainSample?: number;
  /** Need at least this share of the blueprint judged before a real verdict. */
  minJudgedWeightPct?: number;
  /** Wilson interval z-score (1.96 ≈ 95%). */
  z?: number;
  /** Restricts which questions count — defaults to all in. */
  inScope?: (questionId: string) => boolean;
  /** Cap on the nudge list. */
  maxNudges?: number;
}

export const DEFAULT_MIN_DOMAIN_SAMPLE = 12;
export const DEFAULT_MIN_JUDGED_WEIGHT_PCT = 50;
const DEFAULT_Z = 1.96;
const DEFAULT_MAX_NUDGES = 3;

/**
 * Wilson score interval for a binomial proportion — a small-sample-honest
 * confidence band that, unlike the normal approximation, stays within [0,1]
 * and widens sensibly when `n` is tiny. Returns [low, high] as fractions.
 */
export function wilsonInterval(
  correct: number,
  n: number,
  z = DEFAULT_Z,
): [number, number] {
  if (n <= 0) return [0, 0];
  const p = correct / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/**
 * The "latest cold look" outcome per question — the cold-performance signal.
 * For each question we keep one result per session (the FIRST attempt in that
 * session, so a rescue loop re-asking until correct can't inflate it), then
 * take the MOST RECENT session's result (so genuine re-learning later counts).
 * Optionally restricted to in-scope questions.
 */
function latestColdLook(
  attempts: readonly Attempt[],
  inScope: (questionId: string) => boolean,
): Attempt[] {
  // First attempt per (question, session) = that session's cold look.
  const perSession = new Map<string, Attempt>();
  for (const a of attempts) {
    if (!inScope(a.questionId)) continue;
    const key = `${a.questionId} ${a.sessionId}`;
    const cur = perSession.get(key);
    if (!cur || a.answeredAt < cur.answeredAt) perSession.set(key, a);
  }
  // Most recent cold look per question.
  const latest = new Map<string, Attempt>();
  for (const a of perSession.values()) {
    const cur = latest.get(a.questionId);
    if (!cur || a.answeredAt > cur.answeredAt) latest.set(a.questionId, a);
  }
  return [...latest.values()];
}

const pct = (frac: number) => Math.round(frac * 100);

/** Per-category "latest cold look" accuracy + coverage — the standard
 *  per-category metric for the Progress page (used with or without an exam
 *  goal). Same cold-look basis as the readiness estimate, so the two never
 *  disagree. `available` is the in-scope bank size (the coverage denominator). */
export interface CategoryColdLook {
  key: string;
  label: string;
  /** Distinct in-scope questions answered (one cold look each). */
  attempted: number;
  correct: number;
  accuracyPct: number;
  available: number;
  /** attempted / available, as a percentage (capped at 100). */
  coveragePct: number;
}

export function coldLookByCategory(
  attempts: readonly Attempt[],
  categories: readonly { key: string; label: string; available: number }[],
  opts: { inScope?: (questionId: string) => boolean } = {},
): CategoryColdLook[] {
  const inScope = opts.inScope ?? (() => true);
  const looks = latestColdLook(attempts, inScope);
  const bySubject = new Map<string, { attempted: number; correct: number }>();
  for (const a of looks) {
    const row = bySubject.get(a.subject) ?? { attempted: 0, correct: 0 };
    row.attempted += 1;
    if (a.isCorrect) row.correct += 1;
    bySubject.set(a.subject, row);
  }
  return categories.map((c) => {
    const agg = bySubject.get(c.key) ?? { attempted: 0, correct: 0 };
    return {
      key: c.key,
      label: c.label,
      attempted: agg.attempted,
      correct: agg.correct,
      accuracyPct: agg.attempted ? pct(agg.correct / agg.attempted) : 0,
      available: c.available,
      coveragePct: c.available > 0 ? Math.min(100, pct(agg.attempted / c.available)) : 0,
    };
  });
}

/**
 * Build the full readiness report for an exam goal over its domains.
 *
 * `domains` carries each category's blueprint weight and in-scope bank size;
 * `attempts` is the whole history (this function extracts first attempts and
 * filters scope itself).
 */
export function computeReadiness(
  goal: ExamGoal,
  domains: readonly ReadinessDomainInput[],
  attempts: readonly Attempt[],
  opts: ReadinessOptions = {},
): ReadinessReport {
  const {
    minDomainSample = DEFAULT_MIN_DOMAIN_SAMPLE,
    minJudgedWeightPct = DEFAULT_MIN_JUDGED_WEIGHT_PCT,
    z = DEFAULT_Z,
    inScope = () => true,
    maxNudges = DEFAULT_MAX_NUDGES,
  } = opts;

  const looks = latestColdLook(attempts, inScope);
  const bySubject = new Map<string, { attempted: number; correct: number }>();
  for (const a of looks) {
    const row = bySubject.get(a.subject) ?? { attempted: 0, correct: 0 };
    row.attempted += 1;
    if (a.isCorrect) row.correct += 1;
    bySubject.set(a.subject, row);
  }

  // Normalise weights across the domains we were given; if every weight is 0
  // (no blueprint), fall back to bank size so larger domains count for more.
  const totalWeight = domains.reduce((s, d) => s + Math.max(0, d.weight), 0);
  const totalAvailable = domains.reduce((s, d) => s + Math.max(0, d.available), 0);
  const shareOf = (d: ReadinessDomainInput): number => {
    if (totalWeight > 0) return Math.max(0, d.weight) / totalWeight;
    if (totalAvailable > 0) return Math.max(0, d.available) / totalAvailable;
    return domains.length ? 1 / domains.length : 0;
  };

  const passFrac = goal.passPct / 100;

  const domainReports: DomainReadiness[] = domains.map((d) => {
    const agg = bySubject.get(d.key) ?? { attempted: 0, correct: 0 };
    const gate = Math.min(minDomainSample, Math.max(1, d.available));
    const judged = agg.attempted >= gate;
    const accFrac = agg.attempted ? agg.correct / agg.attempted : 0;
    const [lo, hi] = wilsonInterval(agg.correct, agg.attempted, z);

    let status: DomainStatus;
    if (agg.attempted === 0) status = 'untested';
    else if (!judged) status = 'thin';
    else if (accFrac >= passFrac) status = 'solid';
    else status = 'weak';

    return {
      key: d.key,
      label: d.label,
      weightPct: pct(shareOf(d)),
      attempted: agg.attempted,
      correct: agg.correct,
      accuracyPct: pct(accFrac),
      lowPct: pct(lo),
      highPct: pct(hi),
      coveragePct: d.available > 0 ? Math.min(100, pct(agg.attempted / d.available)) : 0,
      judged,
      status,
    };
  });

  // Overall estimate: weighted over JUDGED domains only, renormalised. The
  // band sums each domain's weighted Wilson bounds — a conservative,
  // monotone combination (not a rigorous joint CI, but honest and stable).
  const judged = domains.filter((_, i) => domainReports[i].judged);
  const judgedWeight = judged.reduce((s, d) => s + shareOf(d), 0);
  const judgedWeightPct = pct(judgedWeight);

  let estimatePct = 0;
  let lowPct = 0;
  let highPct = 0;
  if (judgedWeight > 0) {
    let est = 0;
    let lo = 0;
    let hi = 0;
    for (const d of judged) {
      const r = domainReports.find((x) => x.key === d.key)!;
      const w = shareOf(d) / judgedWeight; // renormalise to the judged set
      est += w * (r.accuracyPct / 100);
      lo += w * (r.lowPct / 100);
      hi += w * (r.highPct / 100);
    }
    estimatePct = pct(est);
    lowPct = pct(lo);
    highPct = pct(hi);
  }

  // Verdict reads the confidence band AND the point estimate against the pass
  // line, so a high estimate with a wide band isn't mislabelled. Tiers, most
  // confident first:
  //   ready     — whole band clears the line (low ≥ pass): confident pass
  //   likely    — estimate clears it but the band dips below (low < pass ≤ est):
  //               on track, just not yet certain (usually thin coverage)
  //   borderline— estimate below but band reaches above (est < pass ≤ high)
  //   not-ready — whole band below the line (high < pass)
  let verdict: ReadinessVerdict;
  if (judgedWeightPct < minJudgedWeightPct) verdict = 'no-data';
  else if (lowPct >= goal.passPct) verdict = 'ready';
  else if (estimatePct >= goal.passPct) verdict = 'likely';
  else if (highPct >= goal.passPct) verdict = 'borderline';
  else verdict = 'not-ready';

  // Nudges: one per domain that needs work, urgency = blueprint share × the
  // gap below the pass line. For a judged-weak domain that gap is CONFIRMED
  // (pass − accuracy). For a thin/untested one it's SPECULATIVE: we assume it
  // could be a full pass-gap below, scaled by how little we've seen and
  // discounted (`COVER_SPECULATION`) so a confirmed-weak heavy domain
  // outranks a lightly-unknown one. Both end up on the same 0..1 scale.
  const COVER_SPECULATION = 0.5;
  const nudges: (ReadinessNudge & { urgency: number })[] = [];
  for (const d of domains) {
    const r = domainReports.find((x) => x.key === d.key)!;
    const share = shareOf(d);
    if (r.status === 'untested' || r.status === 'thin') {
      const gate = Math.min(minDomainSample, Math.max(1, d.available));
      const deficit = Math.max(0, (gate - r.attempted) / gate);
      nudges.push({
        key: d.key,
        label: d.label,
        weightPct: r.weightPct,
        kind: 'cover',
        accuracyPct: r.accuracyPct,
        reason:
          r.attempted === 0
            ? `Untested — ${r.weightPct}% of the exam, no questions answered yet`
            : `Only ${r.attempted} seen — not enough to judge ${r.weightPct}% of the exam`,
        urgency: share * passFrac * deficit * COVER_SPECULATION,
      });
    } else if (r.status === 'weak') {
      nudges.push({
        key: d.key,
        label: d.label,
        weightPct: r.weightPct,
        kind: 'improve',
        accuracyPct: r.accuracyPct,
        reason: `${r.accuracyPct}% so far — below the ${goal.passPct}% pass line (${r.weightPct}% of the exam)`,
        urgency: share * Math.max(0, (goal.passPct - r.accuracyPct) / 100),
      });
    }
  }
  nudges.sort((a, b) => b.urgency - a.urgency);

  return {
    passPct: goal.passPct,
    scaled: Boolean(goal.scaled),
    estimatePct,
    lowPct,
    highPct,
    judgedWeightPct,
    verdict,
    domains: domainReports,
    nudges: nudges.slice(0, maxNudges).map(({ urgency, ...n }) => n),
  };
}
