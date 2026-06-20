import { describe, expect, it } from 'vitest';
import type { Attempt } from '@/data/types';
import {
  computeReadiness,
  wilsonInterval,
  type ExamGoal,
  type ReadinessDomainInput,
} from '@/lib/readiness';

const NOON = new Date('2026-06-10T12:00:00').getTime();

let n = 0;
function attempt(over: Partial<Attempt> = {}): Attempt {
  n += 1;
  return {
    id: `a${n}`,
    sessionId: 's1',
    questionId: `q${n}`,
    answeredAt: NOON + n * 1000,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'alpha',
    topic: `q${n}`,
    difficulty: 2,
    ...over,
  };
}

/** `count` first attempts in `subject`, `correct` of them right, each a
 *  distinct question id so they're all counted as first attempts. */
function answers(subject: string, count: number, correct: number): Attempt[] {
  return Array.from({ length: count }, (_, i) =>
    attempt({
      subject,
      questionId: `${subject}-${i}`,
      isCorrect: i < correct,
    }),
  );
}

const GOAL: ExamGoal = { label: 'Mock exam', passPct: 70 };

// Two evenly-weighted domains, 100 questions each — gate is the sample floor.
const DOMAINS: ReadinessDomainInput[] = [
  { key: 'alpha', label: 'Alpha', weight: 0.5, available: 100 },
  { key: 'beta', label: 'Beta', weight: 0.5, available: 100 },
];

describe('wilsonInterval', () => {
  it('is [0,0] for no data and brackets the point estimate', () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
    const [lo, hi] = wilsonInterval(8, 10);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(0.8);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('narrows as the sample grows', () => {
    const small = wilsonInterval(8, 10);
    const big = wilsonInterval(80, 100);
    expect(big[1] - big[0]).toBeLessThan(small[1] - small[0]);
  });
});

describe('computeReadiness — latest cold look', () => {
  it('ignores same-session rescue retries, keeping the first answer of the session', () => {
    // One question, first wrong then rescued correct twice in the SAME
    // session. The brute-forced retries don't count — cold = wrong.
    const attempts = [
      attempt({ subject: 'alpha', questionId: 'alpha-x', sessionId: 's1', isCorrect: false, answeredAt: NOON }),
      attempt({ subject: 'alpha', questionId: 'alpha-x', sessionId: 's1', isCorrect: true, answeredAt: NOON + 5000 }),
      attempt({ subject: 'alpha', questionId: 'alpha-x', sessionId: 's1', isCorrect: true, answeredAt: NOON + 9000 }),
    ];
    const r = computeReadiness(GOAL, DOMAINS, attempts);
    const alpha = r.domains.find((d) => d.key === 'alpha')!;
    expect(alpha).toMatchObject({ attempted: 1, correct: 0, accuracyPct: 0 });
  });

  it('updates to the most recent session, so re-learning a question later counts', () => {
    // Missed cold in session 1, then got it right (first try) in a later
    // session → the recent result wins.
    const attempts = [
      attempt({ subject: 'alpha', questionId: 'alpha-x', sessionId: 's1', isCorrect: false, answeredAt: NOON }),
      attempt({ subject: 'alpha', questionId: 'alpha-x', sessionId: 's2', isCorrect: true, answeredAt: NOON + 86_400_000 }),
    ];
    const r = computeReadiness(GOAL, DOMAINS, attempts);
    const alpha = r.domains.find((d) => d.key === 'alpha')!;
    expect(alpha).toMatchObject({ attempted: 1, correct: 1, accuracyPct: 100 });
  });
});

describe('computeReadiness — per-domain status & coverage gate', () => {
  it('marks an untested domain and a thin (below-gate) domain', () => {
    const r = computeReadiness(GOAL, DOMAINS, answers('alpha', 5, 5), {
      minDomainSample: 12,
    });
    const alpha = r.domains.find((d) => d.key === 'alpha')!;
    const beta = r.domains.find((d) => d.key === 'beta')!;
    expect(alpha.status).toBe('thin'); // 5 < 12
    expect(alpha.judged).toBe(false);
    expect(beta.status).toBe('untested');
  });

  it('judges a covered domain and tones it solid vs weak by the pass line', () => {
    const attempts = [...answers('alpha', 20, 18), ...answers('beta', 20, 10)];
    const r = computeReadiness(GOAL, DOMAINS, attempts, { minDomainSample: 12 });
    const alpha = r.domains.find((d) => d.key === 'alpha')!;
    const beta = r.domains.find((d) => d.key === 'beta')!;
    expect(alpha).toMatchObject({ judged: true, status: 'solid', accuracyPct: 90 });
    expect(beta).toMatchObject({ judged: true, status: 'weak', accuracyPct: 50 });
    expect(alpha.coveragePct).toBe(20); // 20 / 100
  });

  it('caps the gate at the bank size for tiny domains', () => {
    const small: ReadinessDomainInput[] = [
      { key: 'alpha', label: 'Alpha', weight: 1, available: 3 },
    ];
    const r = computeReadiness(GOAL, small, answers('alpha', 3, 3), {
      minDomainSample: 12,
    });
    expect(r.domains[0].judged).toBe(true); // 3 of 3 covered, gate capped at 3
  });
});

describe('computeReadiness — verdict from the confidence band', () => {
  it('is no-data until enough of the blueprint is judged', () => {
    // Only alpha covered → 50% of blueprint judged, equal to the default floor
    // but beta untested. With a higher floor it must be no-data.
    const r = computeReadiness(GOAL, DOMAINS, answers('alpha', 20, 20), {
      minJudgedWeightPct: 60,
    });
    expect(r.verdict).toBe('no-data');
  });

  it('is ready when the lower band clears the pass line', () => {
    const attempts = [...answers('alpha', 60, 57), ...answers('beta', 60, 57)];
    const r = computeReadiness(GOAL, DOMAINS, attempts);
    expect(r.estimatePct).toBe(95);
    expect(r.lowPct).toBeGreaterThanOrEqual(GOAL.passPct);
    expect(r.verdict).toBe('ready');
  });

  it('is not-ready when the upper band sits below the pass line', () => {
    const attempts = [...answers('alpha', 60, 24), ...answers('beta', 60, 24)];
    const r = computeReadiness(GOAL, DOMAINS, attempts);
    expect(r.highPct).toBeLessThan(GOAL.passPct);
    expect(r.verdict).toBe('not-ready');
  });

  it('is borderline when the band straddles the pass line', () => {
    const attempts = [...answers('alpha', 30, 21), ...answers('beta', 30, 21)];
    const r = computeReadiness(GOAL, DOMAINS, attempts);
    expect(r.estimatePct).toBe(70);
    expect(r.lowPct).toBeLessThan(GOAL.passPct);
    expect(r.highPct).toBeGreaterThanOrEqual(GOAL.passPct);
    expect(r.verdict).toBe('borderline');
  });
});

describe('computeReadiness — blueprint weighting', () => {
  it('weights the overall estimate by category weight, not raw counts', () => {
    // Heavy domain strong, light domain weak. Weighted estimate leans heavy.
    const weighted: ReadinessDomainInput[] = [
      { key: 'alpha', label: 'Alpha', weight: 0.8, available: 100 },
      { key: 'beta', label: 'Beta', weight: 0.2, available: 100 },
    ];
    const attempts = [...answers('alpha', 50, 50), ...answers('beta', 50, 0)];
    const r = computeReadiness(GOAL, weighted, attempts);
    // 0.8*100% + 0.2*0% = 80%, not the unweighted 50%.
    expect(r.estimatePct).toBe(80);
    expect(r.domains.find((d) => d.key === 'alpha')!.weightPct).toBe(80);
  });

  it('falls back to bank-size weighting when no weights are given', () => {
    const unweighted: ReadinessDomainInput[] = [
      { key: 'alpha', label: 'Alpha', weight: 0, available: 75 },
      { key: 'beta', label: 'Beta', weight: 0, available: 25 },
    ];
    const r = computeReadiness(GOAL, unweighted, answers('alpha', 20, 20), {
      minJudgedWeightPct: 50,
    });
    expect(r.domains.find((d) => d.key === 'alpha')!.weightPct).toBe(75);
  });
});

describe('computeReadiness — nudges', () => {
  it('orders by blueprint-weighted urgency and labels cover vs improve', () => {
    const weighted: ReadinessDomainInput[] = [
      { key: 'alpha', label: 'Alpha', weight: 0.7, available: 100 }, // big, weak
      { key: 'beta', label: 'Beta', weight: 0.3, available: 100 }, // small, untested
    ];
    const attempts = [...answers('alpha', 30, 12)]; // 40% on the big domain
    const r = computeReadiness(GOAL, weighted, attempts);
    expect(r.nudges[0]).toMatchObject({ key: 'alpha', kind: 'improve' });
    expect(r.nudges.find((x) => x.key === 'beta')).toMatchObject({ kind: 'cover' });
  });

  it('emits no nudge for a solid domain', () => {
    const attempts = [...answers('alpha', 20, 20), ...answers('beta', 20, 20)];
    const r = computeReadiness(GOAL, DOMAINS, attempts);
    expect(r.nudges).toHaveLength(0);
  });
});

describe('computeReadiness — scope filter', () => {
  it('counts only in-scope questions', () => {
    const attempts = [
      ...answers('alpha', 10, 10), // ids alpha-0..9 → in scope
      ...answers('alpha', 10, 0), // ids alpha-10..19 → out of scope
    ];
    const inScope = (id: string) => {
      const i = Number(id.split('-')[1]);
      return i < 10;
    };
    const r = computeReadiness(GOAL, DOMAINS, attempts, { inScope });
    const alpha = r.domains.find((d) => d.key === 'alpha')!;
    expect(alpha.attempted).toBe(10);
    expect(alpha.correct).toBe(10);
  });
});
