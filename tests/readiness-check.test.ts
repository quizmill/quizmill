import { describe, expect, it } from 'vitest';
import type { Attempt, Session } from '@/data/types';
import { seededRng } from '@/lib/selection';
import {
  CHECK_BUDGETS_MINUTES,
  CHECK_DOMAIN_FLOOR,
  CHECK_MAX_MINUTES,
  canDealAnother,
  checkHistory,
  checkPaceHint,
  checkResult,
  checkVerdictGap,
  compareChecks,
  dealCheck,
  planCheck,
  projectedCheckLength,
  recommendedCheckMinutes,
  type CheckPlan,
} from '@/lib/readinessCheck';
import type { ExamGoal, ReadinessDomainInput } from '@/lib/readiness';

const NOON = new Date('2026-10-22T12:00:00').getTime();

const GOAL: ExamGoal = { label: 'Mock exam', passPct: 70 };

/** Ten equally weighted domains of three questions — the shape of a
 *  certification sampler with no blueprint weights. */
const TEN: ReadinessDomainInput[] = Array.from({ length: 10 }, (_, i) => ({
  key: `d${i}`,
  label: `Domain ${i}`,
  weight: 0,
  available: 3,
}));

/** Two weighted domains with a deep bank — the demo pack's shape. */
const TWO: ReadinessDomainInput[] = [
  { key: 'planets', label: 'Planets', weight: 0.6, available: 13 },
  { key: 'space', label: 'Exploration', weight: 0.4, available: 5 },
];

type Q = { id: string; categoryKey: string };

function bankFor(domains: readonly ReadinessDomainInput[]): Q[] {
  return domains.flatMap((d) =>
    Array.from({ length: d.available }, (_, i) => ({ id: `${d.key}-${i}`, categoryKey: d.key })),
  );
}

/** The per-domain split without the shares, for exact comparisons. */
function counts(plan: CheckPlan): { key: string; count: number }[] {
  return plan.perDomain.map(({ key, count }) => ({ key, count }));
}

/** Questions per domain in a slice of a deck. */
function tally(qs: readonly Q[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const q of qs) t[q.categoryKey] = (t[q.categoryKey] ?? 0) + 1;
  return t;
}

let n = 0;
function attempt(over: Partial<Attempt> = {}): Attempt {
  n += 1;
  return {
    id: `a${n}`,
    sessionId: 'check-1',
    questionId: `q${n}`,
    answeredAt: NOON + n * 1000,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'planets',
    topic: `q${n}`,
    difficulty: 2,
    mode: 'check',
    ...over,
  };
}

/** `count` answers in `subject` for session `sessionId`, `correct` right. */
function answers(subject: string, count: number, correct: number, sessionId = 'check-1'): Attempt[] {
  return Array.from({ length: count }, (_, i) =>
    attempt({ subject, questionId: `${subject}-${i}`, isCorrect: i < correct, sessionId }),
  );
}

function session(id: string, startedAt: number, over: Partial<Session> = {}): Session {
  return {
    id,
    subject: 'check',
    startedAt,
    endedAt: startedAt + 60_000,
    questionCount: 6,
    correctCount: 4,
    mode: 'check',
    ...over,
  };
}

describe('planCheck', () => {
  it('buys as many questions as the budget allows at the exam\'s pace, a floor per domain first', () => {
    // The demo's 9-question, 15-minute mock exam: 10 minutes buy 6 at
    // 1.67 min a question — exactly the floor for two domains.
    const plan = planCheck(TWO, { questionCount: 9, durationMinutes: 15 }, { minutes: 10 })!;
    expect(plan.count).toBe(6);
    expect(counts(plan)).toEqual([
      { key: 'planets', count: 3 },
      { key: 'space', count: 3 },
    ]);
    expect(plan.perDomain.map((d) => d.share)).toEqual([0.6, 0.4]);
    expect(plan.floor).toBe(CHECK_DOMAIN_FLOOR);
    expect(plan.minutes).toBe(10);
  });

  it('shares the questions by blueprint weight once every domain clears the floor', () => {
    // No pace declared → a minute a question: 10 minutes buy 10, split
    // 60/40 → 6 and 4, both above the floor of 3.
    const plan = planCheck(TWO, { questionCount: 30 }, { minutes: 10 })!;
    expect(plan.count).toBe(10);
    expect(counts(plan)).toEqual([
      { key: 'planets', count: 6 },
      { key: 'space', count: 4 },
    ]);
  });

  it('defaults to the full budget and never exceeds it', () => {
    // Ten domains of three at a minute each: the ceiling buys all 30.
    let plan = planCheck(TEN, {})!;
    expect(plan.count).toBe(30);
    expect(plan.minutes).toBe(CHECK_MAX_MINUTES);
    expect(plan.perDomain.every((d) => d.count === 3)).toBe(true);
    // Asking for an hour is clamped to the ceiling: still 30.
    plan = planCheck(TEN, {}, { minutes: 60 })!;
    expect(plan.minutes).toBe(CHECK_MAX_MINUTES);
    expect(plan.count).toBe(30);
  });

  it('never deals more than a domain holds, and spends the slack elsewhere', () => {
    const domains: ReadinessDomainInput[] = [
      { key: 'big', label: 'Big', weight: 0.5, available: 50 },
      { key: 'tiny', label: 'Tiny', weight: 0.5, available: 1 },
    ];
    // Eight minutes buy 8: floor 3 + 1 = 4, the 4 extras all to `big`
    // because `tiny` is already exhausted.
    const plan = planCheck(domains, { questionCount: 24 }, { minutes: 8 })!;
    expect(counts(plan)).toEqual([
      { key: 'big', count: 7 },
      { key: 'tiny', count: 1 },
    ]);
    expect(plan.count).toBe(8);
  });

  it('weights by bank size when the pack declares no weights', () => {
    const domains: ReadinessDomainInput[] = [
      { key: 'wide', label: 'Wide', weight: 0, available: 30 },
      { key: 'narrow', label: 'Narrow', weight: 0, available: 10 },
    ];
    // 14 questions split 3:1 → 10.5 and 3.5; the odd question goes to
    // the larger share.
    const plan = planCheck(domains, { questionCount: 42 }, { minutes: 14 })!;
    expect(counts(plan)).toEqual([
      { key: 'wide', count: 11 },
      { key: 'narrow', count: 3 },
    ]);
  });

  it('drops the floor when the budget can\'t afford it, so every domain still gets a look', () => {
    // A 75-question, 180-minute exam allows 2.4 min a question: 30 min
    // buys 12, not the 30 the floor would ask for over ten domains.
    const plan = planCheck(TEN, { questionCount: 75, durationMinutes: 180 })!;
    expect(plan.count).toBe(12);
    expect(plan.floor).toBe(1);
    expect(plan.perDomain.reduce((s, d) => s + d.count, 0)).toBe(12);
    expect(plan.perDomain.every((d) => d.count >= 1 && d.count <= 2)).toBe(true);
    expect(plan.perDomain.filter((d) => d.count === 2)).toHaveLength(2);
    expect(plan.minutes).toBe(30);
    // Ten minutes buy 4: more domains than questions, the floor is gone.
    const short = planCheck(TEN, { questionCount: 75, durationMinutes: 180 }, { minutes: 10 })!;
    expect(short.count).toBe(4);
    expect(short.floor).toBe(0);
    expect(short.perDomain.reduce((s, d) => s + d.count, 0)).toBe(4);
  });

  it('caps an unpaced pack at 30 questions, a minute each', () => {
    const twelve: ReadinessDomainInput[] = Array.from({ length: 12 }, (_, i) => ({
      key: `d${i}`,
      label: `Domain ${i}`,
      weight: 0,
      available: 3,
    }));
    // The floor would want 36; the cap is 30, so two each and six extras.
    const plan = planCheck(twelve, {})!;
    expect(plan.count).toBe(30);
    expect(plan.floor).toBe(2);
    expect(plan.perDomain.map((d) => d.count)).toEqual([3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2]);
  });

  it('always deals exactly the advertised count when floors and caps both bind', () => {
    // A heavy domain pinned at its bank hands its share to a light one
    // that the floor alone would have left at three.
    let plan = planCheck(
      [
        { key: 'a', label: 'A', weight: 0.8, available: 4 },
        { key: 'b', label: 'B', weight: 0.2, available: 50 },
      ],
      { questionCount: 30 },
      { minutes: 10 },
    )!;
    expect(plan.count).toBe(10);
    expect(counts(plan)).toEqual([
      { key: 'a', count: 4 },
      { key: 'b', count: 6 },
    ]);
    // The light domain's floor binds; the heavy one takes the rest
    // without overshooting the count.
    plan = planCheck(
      [
        { key: 'a', label: 'A', weight: 0.99, available: 19 },
        { key: 'b', label: 'B', weight: 0.01, available: 100 },
      ],
      { questionCount: 60 },
      { minutes: 20 },
    )!;
    expect(plan.count).toBe(20);
    expect(counts(plan)).toEqual([
      { key: 'a', count: 17 },
      { key: 'b', count: 3 },
    ]);
  });

  it('spends the whole budget within every domain\'s bounds, whatever the shape', () => {
    // A few awkward shapes, checked for the invariants rather than the
    // exact split: total = count, floor ≤ each ≤ bank.
    const shapes: ReadinessDomainInput[][] = [
      [
        { key: 'a', label: 'A', weight: 0.9, available: 3 },
        { key: 'b', label: 'B', weight: 0.05, available: 40 },
        { key: 'c', label: 'C', weight: 0.05, available: 2 },
      ],
      [
        { key: 'a', label: 'A', weight: 0, available: 1 },
        { key: 'b', label: 'B', weight: 0, available: 1 },
        { key: 'c', label: 'C', weight: 0, available: 60 },
      ],
      [
        { key: 'a', label: 'A', weight: 1, available: 4 },
        { key: 'b', label: 'B', weight: 1, available: 4 },
        { key: 'c', label: 'C', weight: 1, available: 4 },
        { key: 'd', label: 'D', weight: 1, available: 4 },
      ],
    ];
    for (const domains of shapes) {
      for (const minutes of [1, 3, 8, 20, 30]) {
        const plan = planCheck(domains, { questionCount: 100 }, { minutes })!;
        const total = plan.perDomain.reduce((s, d) => s + d.count, 0);
        expect(total, `minutes ${minutes}`).toBe(plan.count);
        expect(plan.count).toBeLessThanOrEqual(minutes);
        for (const { key, count } of plan.perDomain) {
          const d = domains.find((x) => x.key === key)!;
          expect(count).toBeLessThanOrEqual(d.available);
          expect(count).toBeGreaterThanOrEqual(Math.min(plan.floor, d.available));
        }
      }
    }
  });

  it('skips empty domains and is null when the bank is empty', () => {
    const plan = planCheck(
      [
        { key: 'a', label: 'A', weight: 0.5, available: 4 },
        { key: 'b', label: 'B', weight: 0.5, available: 0 },
      ],
      {},
    )!;
    expect(counts(plan)).toEqual([{ key: 'a', count: 4 }]);
    expect(planCheck([{ key: 'a', label: 'A', weight: 1, available: 0 }], {})).toBeNull();
  });
});

describe('recommendedCheckMinutes', () => {
  it('offers the shortest budget that affords the full floor, else the ceiling', () => {
    expect(CHECK_BUDGETS_MINUTES).toEqual([10, 20, 30]);
    // The demo: six questions fit in ten minutes.
    expect(recommendedCheckMinutes(TWO, { questionCount: 9, durationMinutes: 15 })).toBe(10);
    // Ten domains at a minute each need all thirty.
    expect(recommendedCheckMinutes(TEN, {})).toBe(30);
    // Ten domains at 2.4 min a question never fit the floor: the ceiling.
    expect(recommendedCheckMinutes(TEN, { questionCount: 75, durationMinutes: 180 })).toBe(30);
  });
});

describe('dealCheck', () => {
  it('deals the plan first, in rounds across the domains, unseen questions first', () => {
    const plan = planCheck(TWO, { questionCount: 30 }, { minutes: 10 })!;
    const bank = bankFor(TWO);
    // Three planets questions already seen: with 6 to deal from 13, all
    // six must come from the ten unseen.
    const seen = new Set(['planets-0', 'planets-1', 'planets-2']);
    const deck = dealCheck(plan, bank, seen, seededRng(7));
    const hand = deck.slice(0, plan.count);
    expect(tally(hand)).toEqual({ planets: 6, space: 4 });
    expect(new Set(hand.map((q) => q.id)).size).toBe(10);
    expect(hand.some((q) => seen.has(q.id))).toBe(false);
    // Rounds: a sitting cut short after any even number of questions has
    // dealt both domains the same, until the lighter one is spent.
    expect(tally(hand.slice(0, 2))).toEqual({ planets: 1, space: 1 });
    expect(tally(hand.slice(0, 4))).toEqual({ planets: 2, space: 2 });
    expect(tally(hand.slice(0, 8))).toEqual({ planets: 4, space: 4 });
    expect(hand.slice(8).every((q) => q.categoryKey === 'planets')).toBe(true);
  });

  it('continues past the plan with the rest of the bank, apportioned by share', () => {
    const plan = planCheck(TWO, { questionCount: 30 }, { minutes: 10 })!;
    const bank = bankFor(TWO);
    const deck = dealCheck(plan, bank, new Set(), seededRng(3));
    // The whole in-scope bank, each question once.
    expect(deck).toHaveLength(18);
    expect(new Set(deck.map((q) => q.id)).size).toBe(18);
    // After 6/4 the highest average is planets (0.6/7 > 0.4/5), then
    // space (0.4/5 > 0.6/8); space is spent at 5, the rest is planets.
    const extension = deck.slice(plan.count).map((q) => q.categoryKey);
    expect(extension.slice(0, 2)).toEqual(['planets', 'space']);
    expect(tally(deck.slice(0, 14))).toEqual({ planets: 9, space: 5 });
    expect(extension.slice(4).every((k) => k === 'planets')).toBe(true);
  });

  it('spans every domain in the first round even when the budget affords no floor', () => {
    // Four questions over ten domains: the plan gives four domains one
    // each, and the deck's first round is exactly those four.
    const plan = planCheck(TEN, { questionCount: 75, durationMinutes: 180 }, { minutes: 10 })!;
    const deck = dealCheck(plan, bankFor(TEN), new Set(), seededRng(5));
    expect(deck).toHaveLength(30);
    const first = deck.slice(0, 4).map((q) => q.categoryKey);
    expect(new Set(first).size).toBe(4);
    expect(first.sort()).toEqual(plan.perDomain.filter((d) => d.count > 0).map((d) => d.key).sort());
    // The extension then gives every other domain its first look before
    // any domain gets a second.
    expect(new Set(deck.slice(0, 10).map((q) => q.categoryKey)).size).toBe(10);
  });

  it('falls back to seen questions once the unseen run out', () => {
    const plan = planCheck(TWO, {}, { minutes: 6 })!;
    const bank = bankFor(TWO);
    const seen = new Set(bank.filter((q) => q.categoryKey === 'space').map((q) => q.id));
    const deck = dealCheck(plan, bank, seen, seededRng(1));
    expect(tally(deck.slice(0, plan.count))).toEqual({ planets: 3, space: 3 });
  });

  it('is deterministic for a given rng', () => {
    const plan = planCheck(TWO, {})!;
    const bank = bankFor(TWO);
    const a = dealCheck(plan, bank, new Set(), seededRng(42)).map((q) => q.id);
    const b = dealCheck(plan, bank, new Set(), seededRng(42)).map((q) => q.id);
    expect(a).toEqual(b);
  });
});

describe('canDealAnother', () => {
  const budget = 600;
  it('always deals the first question, then only while the learner\'s own pace fits the time left', () => {
    expect(canDealAnother({ elapsedSeconds: 0, budgetSeconds: budget, answered: 0, deckSize: 18 })).toBe(true);
    // 100 s a question so far, 500 s left: yes.
    expect(canDealAnother({ elapsedSeconds: 100, budgetSeconds: budget, answered: 1, deckSize: 18 })).toBe(true);
    // 250 s a question, 100 s left: no — the next one would not fit.
    expect(canDealAnother({ elapsedSeconds: 500, budgetSeconds: budget, answered: 2, deckSize: 18 })).toBe(false);
    // Exactly one more fits.
    expect(canDealAnother({ elapsedSeconds: 300, budgetSeconds: budget, answered: 1, deckSize: 18 })).toBe(true);
    // Time's up.
    expect(canDealAnother({ elapsedSeconds: 600, budgetSeconds: budget, answered: 6, deckSize: 18 })).toBe(false);
  });

  it('stops when the deck is spent, however quick the learner', () => {
    expect(canDealAnother({ elapsedSeconds: 30, budgetSeconds: budget, answered: 18, deckSize: 18 })).toBe(false);
    expect(canDealAnother({ elapsedSeconds: 0, budgetSeconds: budget, answered: 0, deckSize: 0 })).toBe(false);
  });
});

describe('projectedCheckLength', () => {
  it('shows the plan until an answer is in, then the learner\'s pace over the time left', () => {
    const base = { budgetSeconds: 600, deckSize: 18, planned: 6 };
    expect(projectedCheckLength({ ...base, elapsedSeconds: 0, answered: 0, dealt: 1 })).toBe(6);
    // 50 s a question: 11 more fit in the 550 s left → 12, capped by the deck of 18.
    expect(projectedCheckLength({ ...base, elapsedSeconds: 50, answered: 1, dealt: 2 })).toBe(12);
    // 20 s a question would project 30: the deck is the ceiling.
    expect(projectedCheckLength({ ...base, elapsedSeconds: 20, answered: 1, dealt: 2 })).toBe(18);
    // Slow: 250 s a question, 100 s left → 2, but 3 are already dealt.
    expect(projectedCheckLength({ ...base, elapsedSeconds: 500, answered: 2, dealt: 3 })).toBe(3);
  });
});

describe('checkPaceHint', () => {
  it('names the plan before an answer, then what is left at the learner\'s pace — never a bare total', () => {
    expect(checkPaceHint({ answered: 0, dealt: 1, projected: 14 })).toBe("about 14 at the exam's pace");
    expect(checkPaceHint({ answered: 12, dealt: 13, projected: 16 })).toBe('about 3 more at your pace');
    expect(checkPaceHint({ answered: 13, dealt: 13, projected: 14 })).toBe('about 1 more at your pace');
    expect(checkPaceHint({ answered: 13, dealt: 13, projected: 13 })).toBe('last one at your pace');
  });
});

describe('checkVerdictGap', () => {
  const plan: CheckPlan = {
    count: 6,
    floor: 3,
    minutes: 10,
    perDomain: [
      { key: 'planets', count: 3, share: 0.6 },
      { key: 'space', count: 3, share: 0.4 },
    ],
  };
  const judgesAll = (domains: readonly ReadinessDomainInput[], attempts: Attempt[]): boolean =>
    checkResult(GOAL, domains, attempts, 'check-1').report.domains.every((d) => d.judged);

  it("counts the answers still short of the plan's floor in every domain", () => {
    expect(checkVerdictGap(TWO, plan, [])).toBe(6);
    expect(checkVerdictGap(TWO, plan, ['planets', 'space', 'planets'])).toBe(3);
    // Extra answers in one domain don't make up for another's gap.
    expect(checkVerdictGap(TWO, plan, ['planets', 'planets', 'planets', 'planets', 'space'])).toBe(2);
    expect(checkVerdictGap(TWO, plan, ['planets', 'space', 'planets', 'space', 'planets', 'space'])).toBe(0);
  });

  it('wants a look at every domain with a bank, even one a floor-0 plan left out', () => {
    // Four questions over ten equal domains: the plan deals four, but the
    // result still reads all ten — four answers would be 40% coverage.
    const four: CheckPlan = {
      count: 4,
      floor: 0,
      minutes: 10,
      perDomain: TEN.map((d, i) => ({ key: d.key, count: i < 4 ? 1 : 0, share: 0.1 })),
    };
    const dealt = ['d0', 'd1', 'd2', 'd3'];
    expect(judgesAll(TEN, dealt.map((k) => attempt({ subject: k })))).toBe(false);
    expect(checkVerdictGap(TEN, four, dealt)).toBe(6);
    const all = TEN.map((d) => d.key);
    expect(checkVerdictGap(TEN, four, all)).toBe(0);
    expect(judgesAll(TEN, all.map((k) => attempt({ subject: k })))).toBe(true);
  });

  it("keeps up with the result's floor as an extension raises it", () => {
    // A 3/1/1 plan at floor 1, extended to 4/1/1: six answers over three
    // domains are judged at a floor of two, so b and c are still thin.
    const three: ReadinessDomainInput[] = ['a', 'b', 'c'].map((key) => ({ key, label: key, weight: 0, available: 5 }));
    const short: CheckPlan = {
      count: 5,
      floor: 1,
      minutes: 10,
      perDomain: [
        { key: 'a', count: 3, share: 1 / 3 },
        { key: 'b', count: 1, share: 1 / 3 },
        { key: 'c', count: 1, share: 1 / 3 },
      ],
    };
    const atFive = ['a', 'a', 'a', 'b', 'c'];
    expect(checkVerdictGap(three, short, atFive)).toBe(0);
    const extended = [...atFive, 'a'];
    expect(judgesAll(three, [...answers('a', 4, 4), ...answers('b', 1, 1), ...answers('c', 1, 1)])).toBe(false);
    // Two more (one each to b and c) bring eight answers, still floor two.
    expect(checkVerdictGap(three, short, extended)).toBe(2);
    expect(checkVerdictGap(three, short, [...extended, 'b', 'c'])).toBe(0);
    expect(judgesAll(three, [...answers('a', 4, 4), ...answers('b', 2, 2), ...answers('c', 2, 2)])).toBe(true);
  });

  it('asks a small domain for no more than its bank', () => {
    const tiny: ReadinessDomainInput[] = [
      { key: 'big', label: 'Big', weight: 0, available: 10 },
      { key: 'tiny', label: 'Tiny', weight: 0, available: 1 },
    ];
    const p: CheckPlan = {
      count: 4,
      floor: 3,
      minutes: 10,
      perDomain: [
        { key: 'big', count: 3, share: 0.9 },
        { key: 'tiny', count: 1, share: 0.1 },
      ],
    };
    expect(checkVerdictGap(tiny, p, ['big', 'big', 'big', 'tiny'])).toBe(0);
  });

  it('closes once checkResult can judge every domain', () => {
    const attempts = [...answers('planets', 3, 2), ...answers('space', 3, 1)];
    expect(checkVerdictGap(TWO, plan, attempts.map((a) => a.subject))).toBe(0);
    expect(judgesAll(TWO, attempts)).toBe(true);
  });
});

describe('checkResult', () => {
  it('judges every domain at the check floor and ranks the study order by weight × shortfall', () => {
    // planets (60%): 1/3 = 33% → shortfall 37 → 0.6 × 0.37 = 0.22
    // space   (40%): 0/3 =  0% → shortfall 70 → 0.4 × 0.70 = 0.28 → first
    const attempts = [...answers('planets', 3, 1), ...answers('space', 3, 0)];
    const r = checkResult(GOAL, TWO, attempts, 'check-1');
    expect(r.answered).toBe(6);
    expect(r.correct).toBe(1);
    expect(r.scorePct).toBe(17);
    expect(r.report.domains.every((d) => d.judged)).toBe(true);
    expect(r.studyOrder.map((s) => s.key)).toEqual(['space', 'planets']);
    expect(r.studyOrder[0]).toMatchObject({ shortfallPct: 70, weightPct: 40 });
  });

  it('reads the band off the sitting as a whole, not the sum of one-question domains', () => {
    // Ten domains, one question each in nine of them, two right. Summing
    // nine one-question Wilson bands spans nearly everything (0–80 on a
    // miss, 21–100 on a hit) and would call 22% "borderline"; nine
    // answers read as one sample put the whole band under a 70% line.
    const attempts = TEN.slice(0, 9).flatMap((d, i) => answers(d.key, 1, i < 2 ? 1 : 0));
    const r = checkResult(GOAL, TEN, attempts, 'check-1');
    expect(r.report.estimatePct).toBe(22);
    expect(r.report.judgedWeightPct).toBe(90);
    expect(r.report.lowPct).toBeLessThanOrEqual(22);
    expect(r.report.highPct).toBeGreaterThanOrEqual(22);
    expect(r.report.highPct).toBeLessThan(GOAL.passPct);
    expect(r.report.verdict).toBe('not-ready');
    // Per-domain standings are untouched: nine judged on one answer each.
    expect(r.domains.filter((d) => d.status === 'weak')).toHaveLength(7);
    expect(r.domains.filter((d) => d.status === 'solid')).toHaveLength(2);
  });

  it('reads the verdict off the check-sized band, so a blank sitting is not-ready', () => {
    const r = checkResult(GOAL, TWO, [...answers('planets', 3, 0), ...answers('space', 3, 0)], 'check-1');
    expect(r.report.verdict).toBe('not-ready');
    expect(r.report.judgedWeightPct).toBe(100);
  });

  it('puts the heavier domain first when the shortfall ties', () => {
    const attempts = [...answers('planets', 3, 1), ...answers('space', 3, 1)];
    const r = checkResult(GOAL, TWO, attempts, 'check-1');
    expect(r.studyOrder.map((s) => s.key)).toEqual(['planets', 'space']);
  });

  it('leaves solid domains out of the study order and lists the missed questions per domain', () => {
    const attempts = [...answers('planets', 3, 3), ...answers('space', 3, 2)];
    const r = checkResult(GOAL, TWO, attempts, 'check-1');
    expect(r.studyOrder.map((s) => s.key)).toEqual(['space']);
    const planets = r.domains.find((d) => d.key === 'planets')!;
    const space = r.domains.find((d) => d.key === 'space')!;
    expect(planets.status).toBe('solid');
    expect(planets.missedIds).toEqual([]);
    expect(space.status).toBe('weak');
    expect(space.missedIds).toEqual(['space-2']);
    expect(r.report.verdict).not.toBe('no-data');
  });

  it('only counts the attempts of the given session', () => {
    const attempts = [
      ...answers('planets', 3, 3, 'other'),
      ...answers('planets', 3, 0),
      ...answers('space', 3, 3),
    ];
    const r = checkResult(GOAL, TWO, attempts, 'check-1');
    expect(r.domains.find((d) => d.key === 'planets')!.accuracyPct).toBe(0);
    expect(r.answered).toBe(6);
  });

  it('judges at the floor the sitting itself could afford, not a longer plan\'s', () => {
    // Four deep domains, no weights. The learner picked the short budget
    // and answered eight — two a domain — where the recommended budget
    // would have dealt three. Judged at three every domain is thin and
    // there is nothing to study; the sitting could afford two, so it is
    // judged at two and the misses rank.
    const four: ReadinessDomainInput[] = Array.from({ length: 4 }, (_, i) => ({
      key: `d${i}`,
      label: `Domain ${i}`,
      weight: 0,
      available: 10,
    }));
    const attempts = [
      ...answers('d0', 2, 2),
      ...answers('d1', 2, 1),
      ...answers('d2', 2, 2),
      ...answers('d3', 2, 0),
    ];
    const r = checkResult(GOAL, four, attempts, 'check-1');
    expect(r.domains.every((d) => d.judged)).toBe(true);
    expect(r.studyOrder.map((s) => s.key)).toEqual(['d3', 'd1']);
    // An explicit floor still wins.
    expect(checkResult(GOAL, four, attempts, 'check-1', { floor: 3 }).studyOrder).toEqual([]);
    // More domains than answers: a one-question look is still a look.
    const one = checkResult(GOAL, TEN, [...answers('d0', 1, 0), ...answers('d1', 1, 1)], 'check-1');
    expect(one.domains.find((d) => d.key === 'd0')!.status).toBe('weak');
    expect(one.domains.find((d) => d.key === 'd1')!.status).toBe('solid');
    expect(one.domains.find((d) => d.key === 'd2')!.status).toBe('untested');
  });

  it('marks a domain thin when the bank could not reach the floor', () => {
    const domains: ReadinessDomainInput[] = [
      { key: 'planets', label: 'Planets', weight: 0.5, available: 13 },
      { key: 'space', label: 'Exploration', weight: 0.5, available: 2 },
    ];
    // Both space questions answered: that IS the whole domain, so it is
    // judged (the floor caps at the bank size, as readiness does).
    let r = checkResult(GOAL, domains, [...answers('planets', 3, 3), ...answers('space', 2, 2)], 'check-1');
    expect(r.domains.find((d) => d.key === 'space')!.status).toBe('solid');
    // One of three answered in a three-deep domain is below the floor.
    r = checkResult(GOAL, TWO, [...answers('planets', 3, 3), ...answers('space', 1, 1)], 'check-1');
    expect(r.domains.find((d) => d.key === 'space')!.status).toBe('thin');
    expect(r.studyOrder.map((s) => s.key)).toEqual([]);
  });
});

describe('checkHistory', () => {
  it('lists completed checks newest first and ignores other modes and abandoned sittings', () => {
    const sessions: Session[] = [
      session('old', NOON - 3 * 86_400_000),
      session('practice', NOON - 2 * 86_400_000, { mode: 'practice', subject: 'planets' }),
      session('abandoned', NOON - 86_400_000, { endedAt: null }),
      session('new', NOON),
    ];
    expect(checkHistory(sessions).map((s) => s.id)).toEqual(['new', 'old']);
  });
});

describe('compareChecks', () => {
  it('reports the change in the estimate and per domain since the previous check', () => {
    const previous = checkResult(
      GOAL,
      TWO,
      [...answers('planets', 3, 1, 'check-0'), ...answers('space', 3, 1, 'check-0')],
      'check-0',
    );
    const current = checkResult(
      GOAL,
      TWO,
      [...answers('planets', 3, 3), ...answers('space', 3, 1)],
      'check-1',
    );
    const diff = compareChecks(current, previous);
    expect(diff.estimateDelta).toBe(current.report.estimatePct - previous.report.estimatePct);
    expect(diff.estimateDelta).toBeGreaterThan(0);
    expect(diff.domains).toEqual([
      { key: 'planets', delta: 67 },
      { key: 'space', delta: 0 },
    ]);
  });
});
