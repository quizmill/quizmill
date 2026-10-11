/**
 * Whether this device has found the games easter egg.
 *
 * Games are a treat you discover — seven taps on the version pill in
 * Settings, nothing on Home — and that stays the only way in. But a find
 * used to last one visit: the tap count was page state, so the arcade
 * card was gone on the next trip to Settings and had to be re-found,
 * which made games look like they came and went. Remember the find on
 * the device instead; the card offers a way to tuck it away again.
 *
 * Stored app-level (bare `quizmill.` prefix) like the other device
 * switches: it is about the device, not any one pack, never synced, and
 * untouched by "Reset all local progress". Whether the ACTIVE pack has
 * games at all is a separate question (`gamesEnabled` in pack data).
 */
import { devicePref } from './devicePref';

export const GAMES_REVEALED_KEY = 'quizmill.gamesRevealed.v1';

/** Local event fired after a save so mounted hooks re-read. */
export const GAMES_REVEALED_EVENT = 'quizmill:gamesRevealed';

/** '1' = found; absent = still hidden. */
export const gamesRevealedPref = devicePref<boolean>({
  key: GAMES_REVEALED_KEY,
  event: GAMES_REVEALED_EVENT,
  fallback: false,
  parse: (raw) => raw === '1',
  serialise: (on) => (on ? '1' : null),
});
