/**
 * Streak = consecutive days (counting backwards from today, local time)
 * on which at least one session was completed.
 */

export function currentStreak(
  completedSessionDates: Date[],
  today: Date = new Date(),
): number {
  if (completedSessionDates.length === 0) return 0;

  const daySet = new Set(completedSessionDates.map(toDayKey));
  let streak = 0;
  const cursor = startOfDay(today);

  // Today doesn't have to be present — if it isn't, we look back from
  // yesterday and accept that as the current streak. This avoids the
  // streak appearing as 0 before today's practice happens.
  if (!daySet.has(toDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (daySet.has(toDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDayKey(d: Date): string {
  const x = startOfDay(d);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
}
