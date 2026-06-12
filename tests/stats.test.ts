import { describe, expect, it } from 'vitest';
import type { Attempt, Session } from '@/data/types';
import {
  accuracyByCategory,
  accuracyByDay,
  completedSessionDates,
  levelNudge,
  sessionsByWeekday,
  sessionSummary,
  weakestQuestions,
} from '@/lib/stats';
import { currentStreak } from '@/lib/streak';

const NOON = new Date('2026-06-10T12:00:00').getTime();

let n = 0;
function attempt(over: Partial<Attempt> = {}): Attempt {
  n += 1;
  return {
    id: `a${n}`,
    sessionId: 's1',
    questionId: `q${n}`,
    answeredAt: NOON,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'alpha',
    topic: `q${n}`,
    difficulty: 2,
    ...over,
  };
}

const CATEGORIES = [
  { key: 'alpha', label: 'Alpha' },
  { key: 'beta', label: 'Beta', shortLabel: 'B' },
];

describe('accuracyByCategory', () => {
  it('returns all categories, zeroed when unattempted, in given order', () => {
    const rows = accuracyByCategory([], CATEGORIES);
    expect(rows.map((r) => r.key)).toEqual(['alpha', 'beta']);
    expect(rows[0]).toMatchObject({ attempted: 0, correct: 0, accuracyPct: 0 });
  });

  it('aggregates and rounds per category, using shortLabel for display', () => {
    const attempts = [
      attempt({ subject: 'alpha', isCorrect: true }),
      attempt({ subject: 'alpha', isCorrect: true }),
      attempt({ subject: 'alpha', isCorrect: false }),
      attempt({ subject: 'beta', isCorrect: false }),
    ];
    const [alpha, beta] = accuracyByCategory(attempts, CATEGORIES);
    expect(alpha).toMatchObject({ attempted: 3, correct: 2, accuracyPct: 67 });
    expect(beta).toMatchObject({ label: 'B', attempted: 1, accuracyPct: 0 });
  });

  it('ignores attempts for categories not in the pack', () => {
    const rows = accuracyByCategory([attempt({ subject: 'other' })], CATEGORIES);
    expect(rows.every((r) => r.attempted === 0)).toBe(true);
  });
});

describe('accuracyByDay', () => {
  it('buckets by local day, sorted oldest-first, omitting empty days', () => {
    const day = 24 * 3600_000;
    const attempts = [
      attempt({ answeredAt: NOON, isCorrect: true }),
      attempt({ answeredAt: NOON, isCorrect: false }),
      attempt({ answeredAt: NOON - 2 * day, isCorrect: true }),
    ];
    const points = accuracyByDay(attempts, null);
    expect(points.map((p) => p.date)).toEqual(['2026-06-08', '2026-06-10']);
    expect(points[1]).toMatchObject({ attempted: 2, correct: 1, accuracyPct: 50 });
  });

  it('filters to one category when asked', () => {
    const attempts = [
      attempt({ subject: 'alpha' }),
      attempt({ subject: 'beta' }),
    ];
    expect(accuracyByDay(attempts, 'beta')[0].attempted).toBe(1);
  });
});

describe('weakestQuestions', () => {
  it('applies the minimum-attempts floor and sorts weakest-first', () => {
    const attempts = [
      // q-hard: 0/2
      attempt({ questionId: 'q-hard', isCorrect: false }),
      attempt({ questionId: 'q-hard', isCorrect: false }),
      // q-meh: 1/2
      attempt({ questionId: 'q-meh', isCorrect: false }),
      attempt({ questionId: 'q-meh', isCorrect: true }),
      // q-once: below the floor, excluded
      attempt({ questionId: 'q-once', isCorrect: false }),
    ];
    const rows = weakestQuestions(attempts);
    expect(rows.map((r) => r.questionId)).toEqual(['q-hard', 'q-meh']);
    expect(rows[0].accuracyPct).toBe(0);
  });

  it('breaks accuracy ties toward more attempts (stronger signal)', () => {
    const attempts = [
      attempt({ questionId: 'q-two', isCorrect: false }),
      attempt({ questionId: 'q-two', isCorrect: false }),
      attempt({ questionId: 'q-three', isCorrect: false }),
      attempt({ questionId: 'q-three', isCorrect: false }),
      attempt({ questionId: 'q-three', isCorrect: false }),
    ];
    expect(weakestQuestions(attempts)[0].questionId).toBe('q-three');
  });
});

describe('currentStreak', () => {
  const today = new Date('2026-06-10T12:00:00');
  const day = (offset: number) =>
    new Date(today.getTime() - offset * 24 * 3600_000);

  it('is 0 with no completed sessions', () => {
    expect(currentStreak([], today)).toBe(0);
  });

  it('counts consecutive days back from today', () => {
    expect(currentStreak([day(0), day(1), day(2)], today)).toBe(3);
  });

  it("doesn't require today yet — counts back from yesterday", () => {
    expect(currentStreak([day(1), day(2)], today)).toBe(2);
  });

  it('breaks on a gap', () => {
    expect(currentStreak([day(0), day(2), day(3)], today)).toBe(1);
  });
});

describe('completedSessionDates', () => {
  it('keeps only sessions with an end timestamp', () => {
    const sessions: Session[] = [
      {
        id: 's1', subject: 'alpha', startedAt: NOON, endedAt: NOON + 60_000,
        questionCount: 10, correctCount: 5,
      },
      {
        id: 's2', subject: 'alpha', startedAt: NOON, endedAt: null,
        questionCount: 10, correctCount: 0,
      },
    ];
    const dates = completedSessionDates(sessions);
    expect(dates).toHaveLength(1);
    expect(dates[0].getTime()).toBe(NOON + 60_000);
  });
});

let sn = 0;
function session(over: Partial<Session> = {}): Session {
  sn += 1;
  return {
    id: `s${sn}`,
    subject: 'alpha',
    startedAt: NOON,
    endedAt: NOON + 5 * 60_000,
    questionCount: 10,
    correctCount: 7,
    mode: 'practice',
    ...over,
  };
}

describe('sessionSummary', () => {
  it('is all zeroes with no sessions', () => {
    expect(sessionSummary([])).toEqual({
      sessions: 0,
      questions: 0,
      medianDurationSeconds: 0,
      medianQuestions: 0,
    });
  });

  it('ignores unfinished sessions', () => {
    const summary = sessionSummary([
      session({ endedAt: null }),
      session({ questionCount: 8 }),
    ]);
    expect(summary.sessions).toBe(1);
    expect(summary.questions).toBe(8);
    expect(summary.medianQuestions).toBe(8);
  });

  it('reports medians for duration and question count (odd case)', () => {
    const summary = sessionSummary([
      session({ startedAt: NOON, endedAt: NOON + 60_000, questionCount: 5 }),
      session({ startedAt: NOON, endedAt: NOON + 120_000, questionCount: 10 }),
      session({ startedAt: NOON, endedAt: NOON + 600_000, questionCount: 30 }),
    ]);
    expect(summary).toEqual({
      sessions: 3,
      questions: 45,
      medianDurationSeconds: 120,
      medianQuestions: 10,
    });
  });

  it('averages the middle pair for an even count', () => {
    const summary = sessionSummary([
      session({ startedAt: NOON, endedAt: NOON + 60_000, questionCount: 5 }),
      session({ startedAt: NOON, endedAt: NOON + 180_000, questionCount: 10 }),
    ]);
    expect(summary.medianDurationSeconds).toBe(120);
    expect(summary.medianQuestions).toBe(8); // (5+10)/2 rounded
  });

  it('clamps a clock-skewed negative duration to zero', () => {
    const summary = sessionSummary([
      session({ startedAt: NOON, endedAt: NOON - 60_000 }),
    ]);
    expect(summary.medianDurationSeconds).toBe(0);
  });
});

describe('sessionsByWeekday', () => {
  // 2026-06-10 (NOON) is a Wednesday.
  const day = 24 * 3600_000;

  it('always returns all seven days, Monday-first', () => {
    const rows = sessionsByWeekday([]);
    expect(rows.map((r) => r.label)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
    expect(rows.every((r) => r.sessions === 0)).toBe(true);
  });

  it('buckets completed sessions by the local weekday they started', () => {
    const rows = sessionsByWeekday([
      session({ startedAt: NOON }), // Wed
      session({ startedAt: NOON }), // Wed
      session({ startedAt: NOON + 3 * day }), // Sat
      session({ startedAt: NOON + 4 * day }), // Sun
    ]);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.sessions]));
    expect(byLabel).toMatchObject({ Wed: 2, Sat: 1, Sun: 1, Mon: 0 });
  });

  it('ignores unfinished sessions', () => {
    const rows = sessionsByWeekday([session({ endedAt: null })]);
    expect(rows.every((r) => r.sessions === 0)).toBe(true);
  });
});

describe('levelNudge', () => {
  const KEYS = ['basics', 'advanced'];
  // questionId encodes its level: "basics-1", "advanced-2", …
  const levelOf = (id: string) => id.split('-')[0];
  // n attempts at a level, `correct` of them right, spaced 1s apart.
  const at = (level: string, n: number, correct: number): Attempt[] =>
    Array.from({ length: n }, (_, i) =>
      attempt({
        questionId: `${level}-${i}`,
        answeredAt: NOON + i * 1000,
        isCorrect: i < correct,
      }),
    );

  it('returns null when no level is selected (All)', () => {
    expect(levelNudge(at('basics', 8, 8), levelOf, KEYS, null)).toBeNull();
  });

  it('returns null below the minimum sample', () => {
    expect(levelNudge(at('basics', 4, 4), levelOf, KEYS, 'basics')).toBeNull();
  });

  it('suggests moving up when consistently strong and a higher level exists', () => {
    const nudge = levelNudge(at('basics', 6, 6), levelOf, KEYS, 'basics');
    expect(nudge).toMatchObject({ direction: 'up', from: 'basics', to: 'advanced', accuracyPct: 100 });
  });

  it('does not suggest up at the top of the ladder', () => {
    expect(levelNudge(at('advanced', 8, 8), levelOf, KEYS, 'advanced')).toBeNull();
  });

  it('suggests moving down when struggling and a lower level exists', () => {
    const nudge = levelNudge(at('advanced', 8, 2), levelOf, KEYS, 'advanced');
    expect(nudge).toMatchObject({ direction: 'down', from: 'advanced', to: 'basics' });
  });

  it('does not suggest down at the bottom of the ladder', () => {
    expect(levelNudge(at('basics', 8, 1), levelOf, KEYS, 'basics')).toBeNull();
  });

  it('returns null for unremarkable mid-range accuracy', () => {
    expect(levelNudge(at('basics', 8, 5), levelOf, KEYS, 'basics')).toBeNull();
  });

  it('only weighs attempts at the current level', () => {
    // Strong at basics, but selected level is advanced with too few attempts.
    const attempts = [...at('basics', 8, 8), ...at('advanced', 3, 3)];
    expect(levelNudge(attempts, levelOf, KEYS, 'advanced')).toBeNull();
  });

  it('weighs only the most recent window, so a fixed slump still nudges down', () => {
    // Old perfect run, then a recent slump — recency wins within window=8.
    const old = at('advanced', 10, 10).map((a, i) => ({ ...a, answeredAt: NOON - 10_000 + i }));
    const recent = at('advanced', 8, 2).map((a, i) => ({ ...a, questionId: `advanced-r${i}`, answeredAt: NOON + i }));
    const nudge = levelNudge([...old, ...recent], levelOf, KEYS, 'advanced');
    expect(nudge).toMatchObject({ direction: 'down', to: 'basics' });
  });
});
