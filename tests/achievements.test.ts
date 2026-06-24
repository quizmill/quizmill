import { describe, expect, it } from 'vitest';
import type { Attempt, Session } from '@/data/types';
import { buildAchievements } from '@/pack/achievements';
import {
  achievementProgress,
  buildProgressContext,
  evaluateAchievements,
  maxConsecutiveCorrect,
  newlyEarnedAchievements,
  MASTERY_MIN_ATTEMPTS,
  PERFECT_SESSION_MIN_QUESTIONS,
} from '@/pack/achievements-engine';

const byId = (id: string) => {
  const def = DEFS.find((a) => a.id === id);
  if (!def) throw new Error(`no achievement ${id}`);
  return def;
};

/** Synthetic two-category pack so tests don't depend on the active pack. */
const CATEGORIES = [
  { key: 'alpha', label: 'Alpha' },
  { key: 'beta', label: 'Beta', shortLabel: 'B' },
];
const DEFS = buildAchievements(CATEGORIES);

const NOW = new Date('2026-06-10T12:00:00');

let nextId = 0;
function attempt(over: Partial<Attempt> = {}): Attempt {
  nextId += 1;
  return {
    id: `a${nextId}`,
    sessionId: 's1',
    questionId: `q${nextId}`,
    answeredAt: NOW.getTime() - 1000 + nextId, // stable chronological order
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'alpha',
    topic: `q${nextId}`,
    difficulty: 2,
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  nextId += 1;
  return {
    id: `s${nextId}`,
    subject: 'alpha',
    startedAt: NOW.getTime() - 60_000,
    endedAt: NOW.getTime(),
    questionCount: 10,
    correctCount: 7,
    mode: 'practice',
    ...over,
  };
}

function evaluate(sessions: Session[], attempts: Attempt[]): Set<string> {
  return evaluateAchievements(sessions, attempts, DEFS, NOW);
}

describe('buildAchievements', () => {
  it('appends one mastery sticker per pack category, keyed stably', () => {
    const mastery = DEFS.filter((a) => a.category === 'mastery');
    expect(mastery.map((a) => a.id)).toEqual(['mastery-alpha', 'mastery-beta']);
    expect(mastery[0].categoryKey).toBe('alpha');
  });

  it('uses the shortLabel when present', () => {
    const beta = DEFS.find((a) => a.id === 'mastery-beta')!;
    expect(beta.name).toBe('B mastery');
  });
});

describe('maxConsecutiveCorrect', () => {
  it('is 0 for an empty history', () => {
    expect(maxConsecutiveCorrect([])).toBe(0);
  });

  it('resets the run on a wrong answer and keeps the best run', () => {
    const attempts = [
      attempt({ isCorrect: true }),
      attempt({ isCorrect: true }),
      attempt({ isCorrect: false }),
      attempt({ isCorrect: true }),
      attempt({ isCorrect: true }),
      attempt({ isCorrect: true }),
    ];
    expect(maxConsecutiveCorrect(attempts)).toBe(3);
  });

  it('orders by answeredAt, not array order', () => {
    const late = attempt({ isCorrect: false, answeredAt: NOW.getTime() + 999 });
    const attempts = [late, attempt(), attempt(), attempt()];
    // The wrong answer comes chronologically LAST, so the run of 3 stands.
    expect(maxConsecutiveCorrect(attempts)).toBe(3);
  });
});

describe('evaluateAchievements — thresholds', () => {
  it('earns nothing on an empty history', () => {
    expect(evaluate([], []).size).toBe(0);
  });

  it('volume stickers unlock exactly at their thresholds', () => {
    const at49 = Array.from({ length: 49 }, () => attempt());
    expect(evaluate([], at49).has('volume-50')).toBe(false);
    const at50 = [...at49, attempt()];
    const earned = evaluate([], at50);
    expect(earned.has('volume-50')).toBe(true);
    expect(earned.has('volume-100')).toBe(false);
  });

  it('streak stickers track the best in-a-row run', () => {
    const attempts = Array.from({ length: 10 }, () => attempt({ isCorrect: true }));
    const earned = evaluate([], attempts);
    expect(earned.has('streak-5')).toBe(true);
    expect(earned.has('streak-10')).toBe(true);
    expect(earned.has('streak-25')).toBe(false);
  });

  it('daily stickers follow consecutive practice days', () => {
    const day = 24 * 3600_000;
    // A day counts toward the streak once a full round (10 questions) is
    // answered — finishing the session isn't required. Ten questions on each
    // of three consecutive days is a 3-day streak.
    const attempts = [0, 1, 2].flatMap((d) =>
      Array.from({ length: 10 }, () =>
        attempt({ answeredAt: NOW.getTime() - d * day }),
      ),
    );
    const earned = evaluate([], attempts);
    expect(earned.has('daily-3')).toBe(true);
    expect(earned.has('daily-7')).toBe(false);
  });
});

describe('evaluateAchievements — mastery', () => {
  it('needs both the attempt floor and 80% accuracy in that category', () => {
    const enough = Array.from({ length: MASTERY_MIN_ATTEMPTS }, (_, i) =>
      attempt({ subject: 'alpha', isCorrect: i % 10 !== 0 }), // 27/30 = 90%
    );
    expect(evaluate([], enough).has('mastery-alpha')).toBe(true);
    expect(evaluate([], enough).has('mastery-beta')).toBe(false);

    const short = enough.slice(0, MASTERY_MIN_ATTEMPTS - 1);
    expect(evaluate([], short).has('mastery-alpha')).toBe(false);

    const inaccurate = Array.from({ length: MASTERY_MIN_ATTEMPTS }, (_, i) =>
      attempt({ subject: 'alpha', isCorrect: i % 2 === 0 }), // 50%
    );
    expect(evaluate([], inaccurate).has('mastery-alpha')).toBe(false);
  });
});

describe('evaluateAchievements — milestones', () => {
  it('first-session needs a COMPLETED session', () => {
    expect(evaluate([session({ endedAt: null })], []).has('first-session')).toBe(false);
    expect(evaluate([session()], []).has('first-session')).toBe(true);
  });

  it('perfect-session needs a full-size 100% round', () => {
    const flawless = session({
      questionCount: PERFECT_SESSION_MIN_QUESTIONS,
      correctCount: PERFECT_SESSION_MIN_QUESTIONS,
    });
    expect(evaluate([flawless], []).has('perfect-session')).toBe(true);

    const small = session({ questionCount: 5, correctCount: 5 });
    expect(evaluate([small], []).has('perfect-session')).toBe(false);

    const imperfect = session({ questionCount: 10, correctCount: 9 });
    expect(evaluate([imperfect], []).has('perfect-session')).toBe(false);
  });

  it('comeback needs a completed review session', () => {
    expect(evaluate([session()], []).has('comeback')).toBe(false);
    const review = session({ mode: 'review', questionCount: 3, correctCount: 1 });
    expect(evaluate([review], []).has('comeback')).toBe(true);
  });
});

describe('newlyEarnedAchievements', () => {
  it('returns only the fresh ids, in definition order', () => {
    const attempts = Array.from({ length: 50 }, () => attempt({ isCorrect: true }));
    const fresh = newlyEarnedAchievements(
      [session()],
      attempts,
      new Set(['streak-5', 'first-session']),
      DEFS,
      NOW,
    );
    // streak-10/25/50 + volume-50 + mastery-alpha are new; already-earned
    // ids are excluded; order matches the DEFS array.
    expect(fresh).toEqual([
      'streak-10',
      'streak-25',
      'streak-50',
      'volume-50',
      'mastery-alpha',
    ]);
  });

  it('ignores stored ids that no longer exist in the definitions', () => {
    const fresh = newlyEarnedAchievements(
      [session()],
      [],
      new Set(['mastery-from-an-old-pack']),
      DEFS,
      NOW,
    );
    expect(fresh).toEqual(['first-session']);
  });
});

describe('achievementProgress', () => {
  it('tracks streak / volume / daily toward their thresholds', () => {
    const attempts = [
      attempt({ isCorrect: true }),
      attempt({ isCorrect: true }),
      attempt({ isCorrect: false }),
    ];
    const ctx = buildProgressContext([session()], attempts, NOW);

    expect(achievementProgress(byId('streak-5'), ctx)).toEqual({
      current: 2, // best run of 2 before the wrong answer
      target: 5,
      label: 'best streak',
    });
    expect(achievementProgress(byId('volume-50'), ctx)).toMatchObject({
      current: 3,
      target: 50,
      label: 'questions answered',
    });
    expect(achievementProgress(byId('daily-3'), ctx)).toMatchObject({
      current: 0, // only 3 questions answered today — under the 10/day goal
      target: 3,
    });
  });

  it('caps mastery progress at the attempt floor and reports accuracy', () => {
    const attempts = Array.from({ length: 40 }, (_, i) =>
      attempt({ subject: 'alpha', isCorrect: i % 2 === 0 }), // 50%
    );
    const p = achievementProgress(byId('mastery-alpha'), buildProgressContext([], attempts, NOW));
    expect(p).toMatchObject({
      current: MASTERY_MIN_ATTEMPTS, // capped, even though 40 attempted
      target: MASTERY_MIN_ATTEMPTS,
      label: 'questions practised',
    });
    expect(p?.detail).toContain('50% correct');
    expect(p?.detail).toContain('need 80%');
  });

  it('returns null for one-off milestones (no count to show)', () => {
    const ctx = buildProgressContext([], [], NOW);
    expect(achievementProgress(byId('first-session'), ctx)).toBeNull();
    expect(achievementProgress(byId('perfect-session'), ctx)).toBeNull();
  });
});
