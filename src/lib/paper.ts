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
 * and never mixes into a pack's synced data. An untouched device follows
 * the pack's `modes.paper` default (src/lib/practiceModes.ts).
 */
import { modeEnabled, modePref } from './practiceModes';

export const PAPER_KEY = 'quizmill.paper.v1';

/** Local event fired after savePaperModeEnabled so mounted hooks re-read. */
export const PAPER_EVENT = 'quizmill:paper';

/** '1' = on, '0' = off; absent = the pack's `modes.paper` default. */
export const paperModePref = modePref({ key: PAPER_KEY, event: PAPER_EVENT });

export const loadPaperModeEnabled = (): boolean => modeEnabled(paperModePref, 'paper');
export const savePaperModeEnabled = (on: boolean): void => paperModePref.save(on);
