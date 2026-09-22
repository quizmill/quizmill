/**
 * The parent lever for the XP/levels layer — a device-level opt-OUT.
 *
 * Packs opt IN via the manifest `progression` block; this pref lets a
 * parent hide the whole layer on a device (Settings → Levels & XP) if
 * the numbers ever start driving the practice rather than decorating
 * it. Default is ON for packs that opted in, so nothing is asked of
 * families who are happy with it.
 *
 * Stored app-level (bare `quizmill.` prefix) like the colour scheme —
 * it's about the device's audience, not any one pack, and it never
 * mixes into a pack's synced data. XP itself is derived from history,
 * so toggling this hides/reveals; it never resets anything.
 */

export const PROGRESSION_KEY = 'quizmill.progressionHidden.v1';

/** Local event fired after saveProgressionShown so mounted hooks re-read. */
export const PROGRESSION_EVENT = 'quizmill:progression';

export function loadProgressionShown(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PROGRESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

export function saveProgressionShown(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.removeItem(PROGRESSION_KEY);
    else window.localStorage.setItem(PROGRESSION_KEY, '1');
  } catch {
    // storage unavailable (private mode) — the in-page state still applies
  }
  window.dispatchEvent(new Event(PROGRESSION_EVENT));
}
