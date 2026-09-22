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

export const PAPER_KEY = 'quizmill.paper.v1';

/** Local event fired after savePaperModeEnabled so mounted hooks re-read. */
export const PAPER_EVENT = 'quizmill:paper';

export function loadPaperModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PAPER_KEY) === '1';
  } catch {
    return false;
  }
}

export function savePaperModeEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(PAPER_KEY, '1');
    else window.localStorage.removeItem(PAPER_KEY);
  } catch {
    // storage unavailable (private mode) — the in-page state still applies
  }
  window.dispatchEvent(new Event(PAPER_EVENT));
}
