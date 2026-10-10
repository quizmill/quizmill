/**
 * Paper practice — the printed side of the practice loop.
 *
 * A device-level opt-in (like Coach mode, NOT a pack pref): the parent
 * switches it on in Settings and gets a "Paper" entry that prints a
 * worksheet of questions and, once the learner has filled it in, marks
 * the answers back into normal progress (streak, mistakes queue,
 * readiness, stickers) as a `mode: 'paper'` session.
 *
 * Stored app-level (bare `quizmill.` prefix) so it survives pack swaps
 * and never mixes into a pack's synced data.
 */
import { devicePref } from './devicePref';

export const PAPER_KEY = 'quizmill.paper.v1';

/** Local event fired after savePaperModeEnabled so mounted hooks re-read. */
export const PAPER_EVENT = 'quizmill:paper';

/** '1' = on; absent = off. */
export const paperModePref = devicePref<boolean>({
  key: PAPER_KEY,
  event: PAPER_EVENT,
  fallback: false,
  parse: (raw) => raw === '1',
  serialise: (on) => (on ? '1' : null),
});

export const loadPaperModeEnabled = paperModePref.load;
export const savePaperModeEnabled = paperModePref.save;
