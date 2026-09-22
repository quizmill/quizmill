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
 */

/** Counted days that must pass before another grace day can be spent. */
export const GRACE_DAY_INTERVAL = 7;

export function currentStreak(
  completedSessionDates: Date[],
  today: Date = new Date(),
): number {
  if (completedSessionDates.length === 0) return 0;

  const daySet = new Set(completedSessionDates.map(toDayKey));
  let streak = 0;
  // Streak length at the point the last grace day was spent; null while
  // none has been. A fresh grace unlocks every GRACE_DAY_INTERVAL days.
  let streakAtLastGrace: number | null = null;
  const cursor = startOfDay(today);

  // Today doesn't have to be present — if it isn't, we look back from
  // yesterday and accept that as the current streak. This avoids the
  // streak appearing as 0 before today's practice happens. (It is a
  // day still in progress, not a missed one, so no grace is spent.)
  if (!daySet.has(toDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  for (;;) {
    if (daySet.has(toDayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    // A gap. Bridge it with the grace day when it's a single missed day
    // (the day beyond it was practised) and a grace is available.
    const beyond = new Date(cursor);
    beyond.setDate(beyond.getDate() - 1);
    const graceAvailable =
      streakAtLastGrace === null ||
      streak - streakAtLastGrace >= GRACE_DAY_INTERVAL;
    if (daySet.has(toDayKey(beyond)) && graceAvailable) {
      streak += 1; // the bridged day counts like any other
      streakAtLastGrace = streak;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }
  return streak;
}

/**
 * The longest streak anywhere in history — the personal record that a
 * missed day can't erase. Same grace-day bridging as {@link currentStreak}.
 */
export function longestStreak(completedSessionDates: Date[]): number {
  if (completedSessionDates.length === 0) return 0;

  // Distinct local days as monotone integers (day numbers via UTC from
  // local components — immune to DST-length days).
  const days = [
    ...new Set(
      completedSessionDates.map((d) => {
        const x = startOfDay(d);
        return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000;
      }),
    ),
  ].sort((a, b) => a - b);

  let best = 0;
  let run = 0;
  let runAtLastGrace: number | null = null;
  let prev: number | null = null;
  for (const dayNo of days) {
    if (prev === null || dayNo === prev + 1) {
      run += 1;
    } else if (
      dayNo === prev + 2 &&
      (runAtLastGrace === null || run - runAtLastGrace >= GRACE_DAY_INTERVAL)
    ) {
      run += 2; // the bridged day + this one
      runAtLastGrace = run - 1;
    } else {
      run = 1;
      runAtLastGrace = null;
    }
    if (run > best) best = run;
    prev = dayNo;
  }
  return best;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function toDayKey(d: Date): string {
  const x = startOfDay(d);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
}
