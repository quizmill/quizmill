/**
 * Leaderboard ranking — a pure sort over the safe summary rows, shared by
 * the friends board and the public share-code board.
 *
 * Default metric is weekly XP (effort this week), which RESETS every Monday.
 * A weekly reset is deliberate: it stops a runaway leader from permanently
 * burying everyone else, so the board stays motivating for a kid who's
 * behind on totals but practising hard right now. Ties fall back to streak,
 * then name, so the order is stable.
 */

export type LeaderboardMetric = 'weekXp' | 'totalXp' | 'streakDays';

export interface LeaderboardRow {
  displayName: string;
  avatar: string;
  weekXp: number;
  totalXp: number;
  streakDays: number;
  questionsWeek: number;
  accuracyPct: number;
  stickerCount: number;
}

export interface RankedRow extends LeaderboardRow {
  /** 1-based rank; tied rows share a rank ("1, 1, 3" style). */
  rank: number;
}

/**
 * Rank rows by `metric` (descending). Equal metric values share a rank and
 * the next rank skips accordingly. `meName` flags the viewer's own row for
 * highlighting (optional — the public anon view has no "me").
 */
export function rankLeaderboard(
  rows: readonly LeaderboardRow[],
  metric: LeaderboardMetric = 'weekXp',
): RankedRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b[metric] !== a[metric]) return b[metric] - a[metric];
    if (b.streakDays !== a.streakDays) return b.streakDays - a.streakDays;
    return a.displayName.localeCompare(b.displayName);
  });

  const ranked: RankedRow[] = [];
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach((row, i) => {
    const value = row[metric];
    const rank = value === lastValue ? lastRank : i + 1;
    ranked.push({ ...row, rank });
    lastValue = value;
    lastRank = rank;
  });
  return ranked;
}
