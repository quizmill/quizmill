import { describe, expect, it } from 'vitest';
import type { Attempt } from '@/data/types';
import {
  LEVELS,
  XP_DAILY_GOAL,
  XP_EFFORT,
  XP_FIRST_CORRECT,
  XP_RESCUE_BONUS,
  levelForXp,
  levelProgress,
  totalXp,
} from '@/lib/xp';

const NOON = new Date('2026-06-10T12:00:00').getTime();
const DAY = 24 * 3600_000;

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

describe('totalXp', () => {
  it('is 0 with no attempts', () => {
    expect(totalXp([])).toBe(0);
  });

  it('rewards a first correct answer on top of the effort point', () => {
    expect(totalXp([attempt({ isCorrect: true })])).toBe(
      XP_EFFORT + XP_FIRST_CORRECT,
    );
  });

  it('gives a wrong answer the effort point only', () => {
    expect(totalXp([attempt({ isCorrect: false })])).toBe(XP_EFFORT);
  });

  it('pays only token effort for re-answering an already-mastered question', () => {
    // Grinding the same known question must not farm XP: the second and
    // third correct answers earn just the effort point each.
    const a = [
      attempt({ questionId: 'q', isCorrect: true }),
      attempt({ questionId: 'q', isCorrect: true }),
      attempt({ questionId: 'q', isCorrect: true }),
    ];
    expect(totalXp(a)).toBe(3 * XP_EFFORT + XP_FIRST_CORRECT);
  });

  it('adds the rescue bonus when the first correct heals an earlier mistake', () => {
    const a = [
      attempt({ questionId: 'q', isCorrect: false, answeredAt: NOON }),
      attempt({ questionId: 'q', isCorrect: true, answeredAt: NOON + 1000 }),
    ];
    expect(totalXp(a)).toBe(
      2 * XP_EFFORT + XP_FIRST_CORRECT + XP_RESCUE_BONUS,
    );
  });

  it('evaluates rescue by answer time, not array order', () => {
    const a = [
      attempt({ questionId: 'q', isCorrect: true, answeredAt: NOON + 1000 }),
      attempt({ questionId: 'q', isCorrect: false, answeredAt: NOON }),
    ];
    expect(totalXp(a)).toBe(
      2 * XP_EFFORT + XP_FIRST_CORRECT + XP_RESCUE_BONUS,
    );
  });

  it('pays the daily bonus once per day that meets the practice goal', () => {
    // 10 answers yesterday (goal met) + 1 today (goal not met).
    const yesterday = Array.from({ length: 10 }, (_, i) =>
      attempt({ questionId: `y${i}`, isCorrect: false, answeredAt: NOON - DAY }),
    );
    const today = [attempt({ isCorrect: false, answeredAt: NOON })];
    expect(totalXp([...yesterday, ...today])).toBe(
      11 * XP_EFFORT + XP_DAILY_GOAL,
    );
  });
});

describe('levels ladder', () => {
  it('starts at level 1 with 0 XP and rises monotonically', () => {
    expect(LEVELS[0]).toMatchObject({ level: 1, xp: 0 });
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].xp).toBeGreaterThan(LEVELS[i - 1].xp);
      expect(LEVELS[i].level).toBe(LEVELS[i - 1].level + 1);
    }
  });

  it('maps XP to the highest reached level', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(LEVELS[1].xp).level).toBe(2);
    expect(levelForXp(LEVELS[1].xp - 1).level).toBe(1);
    expect(levelForXp(1_000_000).level).toBe(LEVELS[LEVELS.length - 1].level);
  });
});

describe('levelProgress', () => {
  it('reports progress toward the next level', () => {
    const p = levelProgress(LEVELS[1].xp + 10);
    expect(p.level.level).toBe(2);
    expect(p.next?.level).toBe(3);
    expect(p.intoLevel).toBe(10);
    expect(p.toNext).toBe(LEVELS[2].xp - LEVELS[1].xp - 10);
    expect(p.pct).toBeGreaterThan(0);
    expect(p.pct).toBeLessThan(100);
  });

  it('caps at the top level with no next', () => {
    const top = LEVELS[LEVELS.length - 1];
    const p = levelProgress(top.xp + 500);
    expect(p.level.level).toBe(top.level);
    expect(p.next).toBeNull();
    expect(p.pct).toBe(100);
  });
});
