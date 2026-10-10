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
import { devicePref } from './devicePref';

export const PROGRESSION_KEY = 'quizmill.progressionHidden.v1';

/** Local event fired after saveProgressionShown so mounted hooks re-read. */
export const PROGRESSION_EVENT = 'quizmill:progression';

/** '1' = hidden; absent = shown (the documented default). */
export const progressionShownPref = devicePref<boolean>({
  key: PROGRESSION_KEY,
  event: PROGRESSION_EVENT,
  fallback: true,
  parse: (raw) => raw !== '1',
  serialise: (on) => (on ? null : '1'),
});

export const loadProgressionShown = progressionShownPref.load;
export const saveProgressionShown = progressionShownPref.save;
