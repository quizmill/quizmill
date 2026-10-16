/**
 * The device's say in the timed exam — a device-level opt-OUT.
 *
 * The PACK switches the timed sitting on (`exam.durationMinutes`); this
 * pref only lets a device hide its Home tile (Settings → Timed exam),
 * say for a nervous learner. Default is shown, so nothing is asked of
 * anyone happy with it. The /practice/exam route stays (every route
 * exists in every build) and readiness on Progress is unaffected.
 *
 * Stored app-level (bare `quizmill.` prefix) like the Levels & XP
 * switch it mirrors: about the device's audience, not any one pack.
 */
import { devicePref } from './devicePref';

export const EXAM_KEY = 'quizmill.examHidden.v1';

/** Local event fired after saveExamShown so mounted hooks re-read. */
export const EXAM_EVENT = 'quizmill:exam';

/** '1' = hidden; absent = shown (the documented default). */
export const examShownPref = devicePref<boolean>({
  key: EXAM_KEY,
  event: EXAM_EVENT,
  fallback: true,
  parse: (raw) => raw !== '1',
  serialise: (on) => (on ? null : '1'),
});

export const loadExamShown = examShownPref.load;
export const saveExamShown = examShownPref.save;
