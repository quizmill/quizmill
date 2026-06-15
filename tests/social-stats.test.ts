import { describe, it, expect } from 'vitest';
import {
  computeProfileStats,
  currentStreak,
  weekStartEpoch,
  XP_PER_ATTEMPT,
  XP_PER_CORRECT,
} from '@/lib/social-stats';
import type { Attempt } from '@/data/types';

let seq = 0;
function attempt(answeredAt: number, isCorrect: boolean): Attempt {
  return {
    id: `a${seq++}`,
    sessionId: 's',
    questionId: `q${seq}`,
    answeredAt,
    selectedAnswer: 'A',
    isCorrect,
    timeTakenSeconds: 5,
    subject: 'cat',
    topic: 'q',
    difficulty: 1,
  };
}

const DAY = 86_400_000;

describe('weekStartEpoch', () => {
  it('returns local Monday midnight', () => {
    // Wed 2026-06-17 14:30 local → Monday 2026-06-15 00:00 local.
    const wed = new Date(2026, 5, 17, 14, 30);
    const monday = new Date(weekStartEpoch(wed));
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.getHours()).toBe(0);
    expect(monday.getDate()).toBe(15);
  });
});

describe('currentStreak', () => {
  const now = new Date(2026, 5, 15, 9, 0); // Monday morning

  it('is zero with no attempts', () => {
    expect(currentStreak([], now)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const base = now.getTime();
    const a = [attempt(base, true), attempt(base - DAY, false), attempt(base - 2 * DAY, true)];
    expect(currentStreak(a, now)).toBe(3);
  });

  it('still counts when today is empty but yesterday was active', () => {
    const base = now.getTime();
    const a = [attempt(base - DAY, true), attempt(base - 2 * DAY, true)];
    expect(currentStreak(a, now)).toBe(2);
  });

  it('breaks on a missing day', () => {
    const base = now.getTime();
    const a = [attempt(base, true), attempt(base - 2 * DAY, true)]; // gap yesterday
    expect(currentStreak(a, now)).toBe(1);
  });
});

describe('computeProfileStats', () => {
  const now = new Date(2026, 5, 17, 12, 0); // Wednesday

  it('weights effort: attempt + correctness bonus', () => {
    const base = now.getTime();
    const stats = computeProfileStats([attempt(base, true), attempt(base, false)], 0, now);
    // 2 attempts this week, 1 correct.
    expect(stats.totalXp).toBe(2 * XP_PER_ATTEMPT + 1 * XP_PER_CORRECT);
    expect(stats.weekXp).toBe(stats.totalXp);
    expect(stats.questionsWeek).toBe(2);
    expect(stats.accuracyPct).toBe(50);
  });

  it('excludes last week from the weekly counters but not totals', () => {
    const base = now.getTime();
    const lastWeek = weekStartEpoch(now) - DAY; // previous Sunday
    const stats = computeProfileStats([attempt(base, true), attempt(lastWeek, true)], 3, now);
    expect(stats.questionsWeek).toBe(1);
    expect(stats.weekXp).toBe(XP_PER_ATTEMPT + XP_PER_CORRECT);
    expect(stats.totalXp).toBe(2 * (XP_PER_ATTEMPT + XP_PER_CORRECT));
    expect(stats.stickerCount).toBe(3);
  });

  it('is all-zero for an empty history', () => {
    const stats = computeProfileStats([], 0, now);
    expect(stats).toMatchObject({ weekXp: 0, totalXp: 0, streakDays: 0, accuracyPct: 0 });
  });

  it('still earns attempt XP in a week with no correct answers', () => {
    const base = now.getTime();
    const stats = computeProfileStats([attempt(base, false), attempt(base, false)], 0, now);
    expect(stats.weekXp).toBe(2 * XP_PER_ATTEMPT); // effort counts even when wrong
    expect(stats.accuracyPct).toBe(0);
  });
});
