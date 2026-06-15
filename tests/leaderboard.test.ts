import { describe, it, expect } from 'vitest';
import { rankLeaderboard, type LeaderboardRow } from '@/lib/leaderboard';

function row(displayName: string, weekXp: number, streakDays = 0): LeaderboardRow {
  return {
    displayName,
    avatar: 'fox',
    weekXp,
    totalXp: weekXp * 2,
    streakDays,
    questionsWeek: 0,
    accuracyPct: 0,
    stickerCount: 0,
  };
}

describe('rankLeaderboard', () => {
  it('ranks by weekly XP descending by default', () => {
    const ranked = rankLeaderboard([row('Ann', 30), row('Bo', 90), row('Cy', 60)]);
    expect(ranked.map((r) => r.displayName)).toEqual(['Bo', 'Cy', 'Ann']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('shares a rank on ties and skips the next ("1,1,3")', () => {
    const ranked = rankLeaderboard([row('Ann', 50), row('Bo', 50), row('Cy', 10)]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('breaks XP ties by streak, then name', () => {
    const ranked = rankLeaderboard([
      row('Zoe', 50, 1),
      row('Ann', 50, 5),
      row('Mae', 50, 5),
    ]);
    // Ann & Mae have the higher streak (tie → alphabetical), Zoe last.
    expect(ranked.map((r) => r.displayName)).toEqual(['Ann', 'Mae', 'Zoe']);
  });

  it('can rank by an alternate metric', () => {
    const ranked = rankLeaderboard([row('Ann', 10, 9), row('Bo', 90, 1)], 'streakDays');
    expect(ranked[0].displayName).toBe('Ann');
  });
});
