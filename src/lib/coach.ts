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
import { devicePref } from './devicePref';

export const COACH_KEY = 'quizmill.coach.v1';

/** Local event fired after saveCoachModeEnabled so mounted hooks re-read. */
export const COACH_EVENT = 'quizmill:coach';

/** '1' = on; absent = off. */
export const coachModePref = devicePref<boolean>({
  key: COACH_KEY,
  event: COACH_EVENT,
  fallback: false,
  parse: (raw) => raw === '1',
  serialise: (on) => (on ? '1' : null),
});

export const loadCoachModeEnabled = coachModePref.load;
export const saveCoachModeEnabled = coachModePref.save;
