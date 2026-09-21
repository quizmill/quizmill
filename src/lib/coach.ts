/**
 * Coach mode — the parent's side of the practice loop.
 *
 * A device-level opt-in (like the colour scheme, NOT a pack pref): the
 * parent switches it on in Settings on THEIR phone, or on the kid's, and
 * gets a "Coach" entry that replays any past session question by question
 * — what was picked, how long it took, the explanation — with the answer
 * hidden until revealed, so the two of them can go through it together.
 * Nothing done in coach mode is recorded: the learner's stats, stickers
 * and mistake queue only move when they practise on their own.
 *
 * Stored app-level (bare `quizmill.` prefix) so it survives pack swaps and
 * never mixes into a pack's synced data.
 */

export const COACH_KEY = 'quizmill.coach.v1';

/** Local event fired after saveCoachModeEnabled so mounted hooks re-read. */
export const COACH_EVENT = 'quizmill:coach';

export function loadCoachModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveCoachModeEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(COACH_KEY, '1');
    else window.localStorage.removeItem(COACH_KEY);
  } catch {
    // storage unavailable (private mode) — the in-page state still applies
  }
  window.dispatchEvent(new Event(COACH_EVENT));
}
