/**
 * Social stats — the safe, shareable summary of a learner's progress.
 *
 * Pure aggregations (like `stats.ts`) so they unit-test without any storage
 * or network. The result is what gets mirrored to `profile_stats` and shown
 * on friend cards / leaderboards. Crucially it is AGGREGATE only — no
 * per-question data — so sharing it never reveals which questions someone
 * got wrong.
 *
 * Scoring is EFFORT-weighted on purpose: you earn XP for *practising*, with
 * a bonus for getting it right. That keeps a diligent-but-still-learning kid
 * competitive with a naturally-strong one, which matters for motivation.
 */
import type { Attempt } from '@/data/types';

/** XP for answering at all — rewards showing up. */
export const XP_PER_ATTEMPT = 10;
/** Extra XP for a correct answer — rewards getting there. */
export const XP_PER_CORRECT = 5;

export interface ProfileStats {
  /** Monday (local) of the week these weekly numbers cover, as YYYY-MM-DD. */
  weekStart: string;
  /** Effort points earned this week. */
  weekXp: number;
  /** Effort points earned all-time. */
  totalXp: number;
  /** Consecutive days (ending today or yesterday) with at least one attempt. */
  streakDays: number;
  /** Questions answered this week. */
  questionsWeek: number;
  /** All-time accuracy, whole percent. */
  accuracyPct: number;
  /** Stickers earned. */
  stickerCount: number;
}

function xp(attempts: readonly Attempt[]): number {
  let total = 0;
  for (const a of attempts) {
    total += XP_PER_ATTEMPT;
    if (a.isCorrect) total += XP_PER_CORRECT;
  }
  return total;
}

/** Local YYYY-MM-DD key for an epoch-ms timestamp or Date. */
function dayKey(when: number | Date): string {
  const d = new Date(when);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Local midnight at the start of the Monday on or before `now`. */
export function weekStartEpoch(now: number | Date = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/**
 * Current daily streak: consecutive calendar days, counting back from today,
 * on which at least one attempt was answered. A gap of a full day ends it;
 * having answered yesterday-but-not-yet-today still counts (so the streak
 * doesn't read as broken first thing in the morning).
 */
export function currentStreak(
  attempts: readonly Attempt[],
  now: number | Date = Date.now(),
): number {
  if (attempts.length === 0) return 0;
  const days = new Set(attempts.map((a) => dayKey(a.answeredAt)));

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  // Allow the streak to "hang" overnight: if nothing today, start from
  // yesterday so an unbroken run shown the evening before still holds.
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Build the shareable summary from local history. `stickerCount` is passed
 * in (the engine stores earned achievements separately) to keep this pure.
 */
export function computeProfileStats(
  attempts: readonly Attempt[],
  stickerCount: number,
  now: number | Date = Date.now(),
): ProfileStats {
  const weekFrom = weekStartEpoch(now);
  const thisWeek = attempts.filter((a) => a.answeredAt >= weekFrom);
  const correct = attempts.reduce((n, a) => n + (a.isCorrect ? 1 : 0), 0);

  return {
    weekStart: dayKey(weekFrom),
    weekXp: xp(thisWeek),
    totalXp: xp(attempts),
    streakDays: currentStreak(attempts, now),
    questionsWeek: thisWeek.length,
    accuracyPct: attempts.length === 0 ? 0 : Math.round((correct / attempts.length) * 100),
    stickerCount,
  };
}
