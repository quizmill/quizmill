/**
 * The device's say in the reward games — a device-level opt-OUT.
 *
 * The PACK switches games on (its `games` block); this pref lets a
 * device hide them wholesale (Settings → Games): the game a good round
 * earns on the results screen, the arcade behind the version-pill easter
 * egg, and the easter egg itself. For parents who'd rather the practice
 * app stayed a practice app. Default is shown, so nothing is asked of
 * anyone happy with the treat. The /games route stays (every route
 * exists in every build) and answers with a "hidden on this device"
 * card; practice is recorded exactly the same either way.
 *
 * Stored app-level (bare `quizmill.` prefix) like the Levels & XP and
 * Timed exam switches it mirrors: about the device's audience, not any
 * one pack, never synced, untouched by "Reset all local progress".
 */
import { devicePref } from './devicePref';

export const GAMES_KEY = 'quizmill.gamesHidden.v1';

/** Local event fired after saveGamesShown so mounted hooks re-read. */
export const GAMES_EVENT = 'quizmill:games';

/** '1' = hidden; absent = shown (the documented default). */
export const gamesShownPref = devicePref<boolean>({
  key: GAMES_KEY,
  event: GAMES_EVENT,
  fallback: true,
  parse: (raw) => raw !== '1',
  serialise: (on) => (on ? null : '1'),
});

export const loadGamesShown = gamesShownPref.load;
export const saveGamesShown = gamesShownPref.save;
