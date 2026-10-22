import { describe, expect, it } from 'vitest';
import type { Attempt, Session } from '@/data/types';
import { seededRng } from '@/lib/selection';
import {
  CHECK_DOMAIN_FLOOR,
  CHECK_MAX_MINUTES,
  checkHistory,
  checkResult,
  compareChecks,
  dealCheck,
  planCheck,
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
  it('gives every domain the floor, then tops up to a third of the real exam by weight', () => {
    // 9-question mock exam → a third is 3, but two domains need the floor
    // each: 6 questions, no extras to share.
    const plan = planCheck(TWO, { questionCount: 9, durationMinutes: 15 })!;
    expect(plan.count).toBe(6);
    expect(plan.perDomain).toEqual([
      { key: 'planets', count: 3 },
      { key: 'space', count: 3 },
    ]);
    expect(plan.floor).toBe(CHECK_DOMAIN_FLOOR);
    // 6 questions at 15 min / 9 questions = 10 min.
    expect(plan.minutes).toBe(10);
  });

  it('shares the questions by blueprint weight once every domain clears the floor', () => {
    // A 30-question exam → 10 questions, split 60/40 → 6 and 4, both
    // above the floor of 3.
    const plan = planCheck(TWO, { questionCount: 30 })!;
    expect(plan.count).toBe(10);
    expect(plan.perDomain).toEqual([
      { key: 'planets', count: 6 },
      { key: 'space', count: 4 },
    ]);
    expect(plan.minutes).toBeNull();
  });

  it('is the floor times the domains when the exam is unsized', () => {
    const plan = planCheck(TEN, {})!;
    expect(plan.count).toBe(30);
    expect(plan.perDomain.every((d) => d.count === 3)).toBe(true);
  });

  it('never deals more than a domain holds, and spends the slack elsewhere', () => {
    const domains: ReadinessDomainInput[] = [
      { key: 'big', label: 'Big', weight: 0.5, available: 50 },
      { key: 'tiny', label: 'Tiny', weight: 0.5, available: 1 },
    ];
    // Floor 3 + 1 = 4; a third of 24 is 8 → 4 extras, all to `big`
    // because `tiny` is already exhausted.
    const plan = planCheck(domains, { questionCount: 24 })!;
    expect(plan.perDomain).toEqual([
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
    // A third of 42 is 14, split 3:1 → 10.5 and 3.5; the odd question
    // goes to the larger share.
    const plan = planCheck(domains, { questionCount: 42 })!;
    expect(plan.perDomain).toEqual([
      { key: 'wide', count: 11 },
      { key: 'narrow', count: 3 },
    ]);
  });

  it('never runs past 30 minutes at the real exam\'s pace: the floor drops so every domain still gets a look', () => {
    // A 75-question, 180-minute exam allows 2.4 min a question: 30 min
    // buys 12, not the 30 the floor would ask for over ten domains.
    const plan = planCheck(TEN, { questionCount: 75, durationMinutes: 180 })!;
    expect(plan.count).toBe(12);
    expect(plan.floor).toBe(1);
    expect(plan.perDomain.reduce((s, d) => s + d.count, 0)).toBe(12);
    expect(plan.perDomain.every((d) => d.count >= 1 && d.count <= 2)).toBe(true);
    expect(plan.perDomain.filter((d) => d.count === 2)).toHaveLength(2);
    expect(plan.minutes).toBe(29);
    expect(plan.minutes!).toBeLessThanOrEqual(CHECK_MAX_MINUTES);
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
    expect(plan.minutes).toBeNull();
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
    )!;
    expect(plan.count).toBe(10);
    expect(plan.perDomain).toEqual([
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
    )!;
    expect(plan.count).toBe(20);
    expect(plan.perDomain).toEqual([
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
      for (const questionCount of [0, 9, 24, 60, 300]) {
        const plan = planCheck(domains, { questionCount })!;
        const total = plan.perDomain.reduce((s, d) => s + d.count, 0);
        expect(total, `count ${questionCount}`).toBe(plan.count);
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
    expect(plan.perDomain).toEqual([{ key: 'a', count: 3 }]);
    expect(planCheck([{ key: 'a', label: 'A', weight: 1, available: 0 }], {})).toBeNull();
  });
});

describe('dealCheck', () => {
  it('deals exactly the plan per domain, unseen questions first, mixed together', () => {
    const plan = planCheck(TWO, { questionCount: 30 })!;
    const bank = bankFor(TWO);
    // Three planets questions already seen: with 6 to deal from 13, all
    // six must come from the ten unseen.
    const seen = new Set(['planets-0', 'planets-1', 'planets-2']);
    const dealt = dealCheck(plan, bank, seen, seededRng(7));
    expect(dealt).toHaveLength(10);
    expect(dealt.filter((q) => q.categoryKey === 'planets')).toHaveLength(6);
    expect(dealt.filter((q) => q.categoryKey === 'space')).toHaveLength(4);
    expect(new Set(dealt.map((q) => q.id)).size).toBe(10);
    expect(dealt.some((q) => seen.has(q.id))).toBe(false);
    // Not grouped by domain — the sitting mixes them like the real exam.
    const keys = dealt.map((q) => q.categoryKey);
    expect(keys.slice(0, 6)).not.toEqual(Array(6).fill('planets'));
  });

  it('falls back to seen questions once the unseen run out', () => {
    const plan = planCheck(TWO, {})!;
    const bank = bankFor(TWO);
    const seen = new Set(bank.filter((q) => q.categoryKey === 'space').map((q) => q.id));
    const dealt = dealCheck(plan, bank, seen, seededRng(1));
    expect(dealt.filter((q) => q.categoryKey === 'space')).toHaveLength(3);
  });

  it('is deterministic for a given rng', () => {
    const plan = planCheck(TWO, {})!;
    const bank = bankFor(TWO);
    const a = dealCheck(plan, bank, new Set(), seededRng(42)).map((q) => q.id);
    const b = dealCheck(plan, bank, new Set(), seededRng(42)).map((q) => q.id);
    expect(a).toEqual(b);
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
