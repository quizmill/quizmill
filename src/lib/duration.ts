/**
 * The one human-friendly duration spelling for the app: 12 s, 2 min,
 * 1 h 05 min. Rounded to the minute once past a minute — a learner (or a
 * parent reading Coach next to Progress) sees the same quantity spelt the
 * same way everywhere.
 */
export function formatSpan(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}
