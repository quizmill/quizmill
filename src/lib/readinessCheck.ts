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
 * readiness gate — three questions per domain, not twelve — and it
 * drops further when the time budget can't afford it. That is why the
 * result is labelled a temperature check and ranks domains by point
 * estimate rather than pretending the per-domain bands are tight.
 *
 * The sitting is TIME-BOXED, not question-counted. The learner picks how
 * long they have (`CHECK_BUDGETS_MINUTES`, never more than
 * `CHECK_MAX_MINUTES`); the plan says how many questions that buys at
 * the real exam's pace, and the deck is dealt in ROUNDS — one question
 * per domain, then a second per domain, … — so that however many the
 * clock allows, the questions reached still span the blueprint. A
 * quicker learner runs past the plan into an extension apportioned by
 * blueprint share; a slower one is stopped by the clock, and the result
 * reads over what was answered. Nothing ever asks for more time.
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
  verdictFor,
  wilsonInterval,
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
/** The time budgets a learner can pick for one sitting, in minutes. The
 *  last is the hard ceiling: the check is a temperature check, not a
 *  mock exam, and must fit in a lunch break. When a budget can't afford
 *  the floor for every domain, the floor drops (to two, then one) so the
 *  sitting still spans the blueprint. */
export const CHECK_BUDGETS_MINUTES = [10, 20, 30] as const;
export const CHECK_MAX_MINUTES: number = CHECK_BUDGETS_MINUTES[CHECK_BUDGETS_MINUTES.length - 1];
/** Minutes per question assumed when the pack declares no exam pace
 *  (`durationMinutes` + `questionCount`) — a practice pace, with
 *  feedback read. */
export const CHECK_DEFAULT_MINUTES_PER_QUESTION = 1;

export interface CheckPlan {
  /** Questions the budget buys at the real exam's pace — the advertised
   *  size; the clock decides the real one (see `canDealAnother`). */
  count: number;
  /** Questions per domain, in the order the domains were given, with the
   *  domain's blueprint share (weights, else bank size — readiness's
   *  rule); domains with an empty bank are left out. */
  perDomain: { key: string; count: number; share: number }[];
  /** The per-domain floor the plan honours — `CHECK_DOMAIN_FLOOR` unless
   *  the budget forced it down (0 when there are more domains than
   *  questions, in which case the heaviest domains get the look). */
  floor: number;
  /** The time budget the plan was sized for — the sitting's hard stop. */
  minutes: number;
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

const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0);

/**
 * Split `count` questions across the domains: each gets at least its
 * floor (capped at what it holds), the rest follows the blueprint
 * shares, nobody gets more than their bank. Water-filling: every domain
 * takes `level × share`, clamped to [floor, bank], and the level is
 * raised until the total meets `count` — that total is continuous and
 * non-decreasing in the level, so bisection finds it, and a domain
 * pinned at either bound is reconsidered as the level moves (pinning
 * floor and bank violators in one pass from one provisional split can
 * land short of, or past, the count). The exact split is then rounded
 * by largest remainder within the same bounds. Requires
 * Σ min(floor, bank) ≤ count ≤ Σ bank, which `planCheck` guarantees.
 */
function allocate(
  domains: readonly ReadinessDomainInput[],
  count: number,
  floor: number,
): number[] {
  const cap = domains.map((d) => Math.max(0, d.available));
  const base = cap.map((c) => Math.min(floor, c));
  const share = shares(domains);
  const take = (level: number): number[] =>
    base.map((b, i) => Math.min(cap[i], Math.max(b, level * share[i])));

  // The level at which every domain with a share sits at its bank.
  let hi = Math.max(1, ...domains.map((_, i) => (share[i] > 0 ? cap[i] / share[i] : 0)));
  let lo = 0;
  if (sum(take(hi)) <= count) {
    lo = hi; // the whole bank is the sitting
  } else {
    for (let n = 0; n < 64; n++) {
      const mid = (lo + hi) / 2;
      if (sum(take(mid)) < count) lo = mid;
      else hi = mid;
    }
  }
  const exact = take(lo);

  // Largest-remainder rounding within the bounds; ties (to six decimals,
  // so float noise can't flip them) go to the larger share, then order.
  const whole = exact.map((v, i) => Math.min(cap[i], Math.max(base[i], Math.floor(v + 1e-6))));
  const frac = exact.map((v, i) => Math.round((v - whole[i]) * 1e6) / 1e6);
  const order = domains
    .map((_, i) => i)
    .sort((a, b) => frac[b] - frac[a] || share[b] - share[a] || a - b);
  let left = count - sum(whole);
  for (const i of order) {
    if (left <= 0) break;
    if (whole[i] < cap[i]) {
      whole[i] += 1;
      left -= 1;
    }
  }
  for (const i of order.slice().reverse()) {
    if (left >= 0) break;
    if (whole[i] > base[i]) {
      whole[i] -= 1;
      left += 1;
    }
  }
  return whole;
}

/** Minutes one question takes at the real exam's pace — what a time
 *  budget is converted into questions with. A minute a question when
 *  the pack declares no pace. */
export function checkPace(
  exam: Pick<ExamGoal, 'questionCount'> & { durationMinutes?: number },
): number {
  return exam.questionCount && exam.durationMinutes
    ? exam.durationMinutes / exam.questionCount
    : CHECK_DEFAULT_MINUTES_PER_QUESTION;
}

/**
 * The per-domain floor `count` questions can afford over the live
 * domains: the full floor when every domain can have it (capped at its
 * bank), else an equal share — two, one, none. The plan sizes with it
 * and a result is judged with it over the questions actually answered,
 * so a sitting the learner kept short, or the clock cut short, is read
 * at the floor its own size allowed rather than a longer plan's.
 */
export function checkFloorFor(
  domains: readonly ReadinessDomainInput[],
  count: number,
  wanted: number = CHECK_DOMAIN_FLOOR,
): number {
  const live = domains.filter((d) => d.available > 0);
  if (live.length === 0) return 0;
  const floorTotal = sum(live.map((d) => Math.min(wanted, d.available)));
  return floorTotal <= count ? wanted : Math.floor(count / live.length);
}

/**
 * Size one check for an exam over its domains and a time budget: as
 * many questions as the budget buys at the real exam's pace (a minute a
 * question when the pack declares none), never more than the bank holds
 * and never more than `CHECK_MAX_MINUTES` worth. A floor per domain so
 * each can be judged; when the budget can't afford the floor for every
 * domain, the floor drops uniformly so the sitting still spans the
 * whole blueprint before weight decides the rest. Null when no domain
 * has a question.
 */
export function planCheck(
  domains: readonly ReadinessDomainInput[],
  exam: Pick<ExamGoal, 'questionCount'> & { durationMinutes?: number },
  opts: { floor?: number; minutes?: number } = {},
): CheckPlan | null {
  const wanted = opts.floor ?? CHECK_DOMAIN_FLOOR;
  const minutes = Math.min(CHECK_MAX_MINUTES, Math.max(1, opts.minutes ?? CHECK_MAX_MINUTES));
  const live = domains.filter((d) => d.available > 0);
  if (live.length === 0) return null;

  const timeCap = Math.max(1, Math.floor(minutes / checkPace(exam)));
  const totalAvailable = sum(live.map((d) => d.available));
  const count = Math.min(totalAvailable, timeCap);
  const floor = checkFloorFor(live, count, wanted);

  const alloc = allocate(live, count, floor);
  const share = shares(live);
  const perDomain = live.map((d, i) => ({ key: d.key, count: alloc[i], share: share[i] }));
  return { count, perDomain, floor, minutes };
}

/**
 * The budget to offer first: the shortest that affords the full floor
 * for every domain at the exam's pace (the demo's two domains fit in
 * ten minutes), else the ceiling — a ten-domain pack at 2.4 minutes a
 * question needs all thirty and still gets one or two per domain.
 */
export function recommendedCheckMinutes(
  domains: readonly ReadinessDomainInput[],
  exam: Pick<ExamGoal, 'questionCount'> & { durationMinutes?: number },
  budgets: readonly number[] = CHECK_BUDGETS_MINUTES,
): number {
  for (const minutes of budgets) {
    const plan = planCheck(domains, exam, { minutes });
    if (!plan || plan.floor >= CHECK_DOMAIN_FLOOR) return minutes;
  }
  return budgets[budgets.length - 1] ?? CHECK_MAX_MINUTES;
}

/**
 * Deal the whole deck for a sitting from an in-scope bank. The planned
 * hand comes first, in ROUNDS — one question from every domain that
 * still has a planned question, the domains shuffled within each round
 * so the sitting mixes them as on the real exam — so that a sitting the
 * clock cuts short still spans the blueprint evenly. Beyond the plan,
 * for a learner quicker than the exam's pace, the rest of the bank
 * follows as an extension apportioned by blueprint share (highest-
 * averages rule: the next question goes to the domain with the largest
 * share per question already dealt). Within a domain unseen questions
 * come first (the selection engine's rule). The runner deals from the
 * front and stops when the clock says so (`canDealAnother`).
 */
export function dealCheck<Q extends SelectableQuestion & { categoryKey: string }>(
  plan: CheckPlan,
  bank: readonly Q[],
  attemptedIds: ReadonlySet<Q['id']>,
  rng: Rng = Math.random,
): Q[] {
  const seen = new Set(attemptedIds);
  const domains = plan.perDomain.map(({ key, count, share }) => {
    const pool = bank.filter((q) => q.categoryKey === key);
    const queue = pickSessionQuestions(pool, {
      count: pool.length,
      historicalAttemptedIds: seen,
      currentSessionIds: new Set(),
      rng,
    });
    return { key, share, planned: Math.min(count, queue.length), dealt: 0, queue };
  });

  const deck: Q[] = [];
  const rounds = Math.max(0, ...domains.map((d) => d.planned));
  for (let r = 0; r < rounds; r++) {
    for (const d of shuffle(domains.filter((d) => d.planned > r), rng)) {
      deck.push(d.queue[d.dealt++]);
    }
  }
  for (;;) {
    let best = -1;
    let bestScore = -1;
    domains.forEach((d, i) => {
      if (d.dealt >= d.queue.length) return;
      const score = d.share / (d.dealt + 1);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best < 0) break;
    deck.push(domains[best].queue[domains[best].dealt++]);
  }
  return deck;
}

/**
 * Whether the sitting should deal one more question: only while the
 * budget still holds another at the learner's own pace so far (answer
 * plus feedback), and the deck has one. The first question is always
 * dealt. Nothing here ever extends the budget — the clock is the hard
 * stop, this is the clean one.
 */
export function canDealAnother(args: {
  elapsedSeconds: number;
  budgetSeconds: number;
  answered: number;
  deckSize: number;
}): boolean {
  const { elapsedSeconds, budgetSeconds, answered, deckSize } = args;
  if (answered >= deckSize) return false;
  if (answered === 0) return true;
  const perQuestion = elapsedSeconds / answered;
  return budgetSeconds - elapsedSeconds >= perQuestion;
}

/**
 * How many questions the sitting looks like running to, for the
 * progress chip: the plan's estimate until an answer is in, then the
 * learner's own pace projected over the time left — never fewer than
 * already dealt, never more than the deck.
 */
export function projectedCheckLength(args: {
  elapsedSeconds: number;
  budgetSeconds: number;
  answered: number;
  dealt: number;
  deckSize: number;
  planned: number;
}): number {
  const { elapsedSeconds, budgetSeconds, answered, dealt, deckSize, planned } = args;
  const guess =
    answered === 0 || elapsedSeconds <= 0
      ? planned
      : answered + Math.floor(Math.max(0, budgetSeconds - elapsedSeconds) / (elapsedSeconds / answered));
  return Math.max(dealt, Math.min(deckSize, guess));
}

/**
 * The projection worded as a hint, never as a total: the sitting is
 * time-boxed, so "13/16" with a moving 16 reads as a bug. Before the
 * first answer it is the plan's count at the exam's pace; after, what
 * is left beyond the questions dealt at the learner's own pace.
 */
export function checkPaceHint(args: { answered: number; dealt: number; projected: number }): string {
  const { answered, dealt, projected } = args;
  if (answered === 0) return `about ${projected} at the exam's pace`;
  const more = projected - dealt;
  return more > 0 ? `about ${more} more at your pace` : 'last one at your pace';
}

/**
 * Answers still needed before a sitting can end early with a verdict:
 * every domain with a bank — dealt by the plan or not, since the result
 * reads them all — must reach the stricter of the plan's floor and the
 * floor `checkResult` would judge at (at least one look, never more than
 * the domain holds). That result floor rises with the answer count, so
 * the gap is the fewest further answers k after which the shortfall,
 * summed per domain so a surplus in one never covers another, fits in
 * k. 0 when ending now gets every domain judged.
 */
export function checkVerdictGap(
  domains: readonly ReadinessDomainInput[],
  plan: CheckPlan,
  answeredKeys: readonly string[],
): number {
  const live = domains.filter((d) => d.available > 0);
  const got = new Map<string, number>();
  for (const k of answeredKeys) got.set(k, (got.get(k) ?? 0) + 1);
  const answered = answeredKeys.length;
  const shortfall = (n: number): number => {
    const floor = Math.max(1, plan.floor, checkFloorFor(live, n));
    return sum(live.map((d) => Math.max(0, Math.min(floor, d.available) - (got.get(d.key) ?? 0))));
  };
  const most = sum(live.map((d) => d.available)) - answered;
  for (let k = 0; k < most; k++) if (shortfall(answered + k) <= k) return k;
  return Math.max(0, most);
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
   *  floor, its band the Wilson interval of the sitting as one sample —
   *  its verdict is the headline, its band the gauge. */
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
 * Domains are judged at the floor the sitting's own size could afford
 * (`checkFloorFor`, at least one) unless `opts.floor` says otherwise: a
 * learner who picked ten minutes, or was stopped by the clock, is read
 * at the floor they had, not called thin everywhere by a longer plan's.
 */
export function checkResult(
  goal: ExamGoal,
  domains: readonly ReadinessDomainInput[],
  attempts: readonly Attempt[],
  sessionId: string,
  opts: { floor?: number; inScope?: (questionId: string) => boolean } = {},
): CheckResult {
  const own = attempts
    .filter((a) => a.sessionId === sessionId)
    .sort((a, b) => a.answeredAt - b.answeredAt);
  const floor = opts.floor ?? Math.max(1, checkFloorFor(domains, own.length));
  const perDomain = computeReadiness(goal, domains, own, {
    minDomainSample: floor,
    inScope: opts.inScope,
    maxNudges: domains.length,
  });
  // readiness.ts sums each domain's Wilson band, which is honest over a
  // dozen first attempts a domain and meaningless over one: ten domains
  // of one question each span nearly 0–100 and call 2/9 "borderline". A
  // check is one stratified sample, so its band is the Wilson interval
  // of the weighted estimate at the sitting's judged sample size — tight
  // enough to say something, still wide enough at nine answers to say it
  // carefully — and the verdict reads off that band on readiness's tiers.
  const judgedKeys = new Set(perDomain.domains.filter((d) => d.judged).map((d) => d.key));
  const judgedN = own.filter((a) => judgedKeys.has(a.subject)).length;
  const [lo, hi] = wilsonInterval((perDomain.estimatePct / 100) * judgedN, judgedN);
  const band = { ...perDomain, lowPct: Math.round(lo * 100), highPct: Math.round(hi * 100) };
  const report: ReadinessReport = { ...band, verdict: verdictFor(band, goal.passPct) };

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
