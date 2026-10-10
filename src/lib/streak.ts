/**
 * Streak = consecutive days (counting backwards from today, local time)
 * on which at least one session was completed.
 *
 * Deliberately forgiving: one missed day is bridged by an automatic
 * "grace day" (at most one per 7 counted days), so a single swimming
 * lesson doesn't wipe out three weeks of practice. That softening is a
 * child-safety choice, not a growth hack — a hard reset-to-zero is the
 * loss-aversion mechanic behind streak anxiety in kids' apps, and we
 * don't want practice driven by fear of a number.
 *
 * One rule, one walk: {@link streakEndingOn} counts a run backwards from
 * a given day with the grace rule, and both public numbers are that walk
 * started somewhere — the live streak from today (or yesterday), the
 * record from every practised day. The two can't be read off one
 * partition of history into runs: when two single-day gaps fall within a
 * week of each other only one can be bridged, and which one depends on
 * where the walk starts. The live streak settles it from today, so the
 * record is defined as the biggest value the live streak ever showed.
 */

/** Counted days that must pass before another grace day can be spent. */
export const GRACE_DAY_INTERVAL = 7;

export function currentStreak(
  completedSessionDates: Date[],
  today: Date = new Date(),
): number {
  if (completedSessionDates.length === 0) return 0;

  const days = new Set(completedSessionDates.map(dayNumber));
  const todayNo = dayNumber(today);
  // Today doesn't have to be present — if it isn't, we look back from
  // yesterday and accept that as the current streak. This avoids the
  // streak appearing as 0 before today's practice happens. (It is a
  // day still in progress, not a missed one, so no grace is spent.)
  return streakEndingOn(days.has(todayNo) ? todayNo : todayNo - 1, days);
}

/**
 * The longest streak anywhere in history — the personal record that a
 * missed day can't erase. Exactly the largest value {@link currentStreak}
 * has taken on a practised day, so the record always agrees with a
 * number the learner once saw. A yesterday the live streak bridges
 * provisionally (before today's practice) is deliberately NOT counted
 * here: a grace day enters the permanent record only once practice
 * resumes after it, which is why `streakProgress` takes the max of the
 * two.
 */
export function longestStreak(completedSessionDates: Date[]): number {
  const days = new Set(completedSessionDates.map(dayNumber));
  let best = 0;
  for (const dayNo of days) {
    // A run can only grow by extending it to the next practised day, so
    // only the last day of each unbroken stretch needs walking.
    if (days.has(dayNo + 1)) continue;
    best = Math.max(best, streakEndingOn(dayNo, days));
  }
  return best;
}

/**
 * Length of the run ending on `end`, walking backwards through `days`.
 * Each practised day counts one; a single missed day whose far side was
 * practised is bridged by a grace day (counting one, like any other day)
 * when the previous grace is at least GRACE_DAY_INTERVAL counted days
 * back; anything else ends the run. `end` itself may be unpractised —
 * that's how a missed yesterday is bridged before today's practice.
 */
function streakEndingOn(end: number, days: ReadonlySet<number>): number {
  let streak = 0;
  // Streak length at the point the last grace day was spent; null while
  // none has been. A fresh grace unlocks every GRACE_DAY_INTERVAL days.
  let streakAtLastGrace: number | null = null;
  for (let cursor = end; ; cursor -= 1) {
    if (days.has(cursor)) {
      streak += 1;
      continue;
    }
    const graceAvailable =
      streakAtLastGrace === null ||
      streak - streakAtLastGrace >= GRACE_DAY_INTERVAL;
    if (days.has(cursor - 1) && graceAvailable) {
      streak += 1; // the bridged day counts like any other
      streakAtLastGrace = streak;
      continue;
    }
    return streak;
  }
}

/**
 * Local calendar day as a monotone integer (day numbers via UTC from the
 * local components — immune to DST-length days), so "the day before" is
 * plain subtraction.
 */
function dayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
