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
 * never mixes into a pack's synced data. An untouched device follows the
 * pack's `modes.coach` default (src/lib/practiceModes.ts).
 */
import { modeEnabled, modePref } from './practiceModes';

export const COACH_KEY = 'quizmill.coach.v1';

/** Local event fired after saveCoachModeEnabled so mounted hooks re-read. */
export const COACH_EVENT = 'quizmill:coach';

/** '1' = on, '0' = off; absent = the pack's `modes.coach` default. */
export const coachModePref = modePref({ key: COACH_KEY, event: COACH_EVENT });

export const loadCoachModeEnabled = (): boolean => modeEnabled(coachModePref, 'coach');
export const saveCoachModeEnabled = (on: boolean): void => coachModePref.save(on);
