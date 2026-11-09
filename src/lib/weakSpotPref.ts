/**
 * How many right answers in a row clear a question from the weak-spot
 * list (Settings → Weak spots). One lucky guess shouldn't be enough, so
 * the default is two.
 *
 * Stored app-level (bare `quizmill.` prefix) like the other device
 * switches. The list is derived from history (src/lib/mistakes.ts), so
 * changing this only changes what it shows; nothing is reset or synced.
 */
import { devicePref } from './devicePref';

export const WEAK_SPOT_CLEAR_CHOICES = [1, 2, 3] as const;
export type WeakSpotClearAfter = (typeof WEAK_SPOT_CLEAR_CHOICES)[number];

export const WEAK_SPOT_DEFAULT: WeakSpotClearAfter = 2;

export const weakSpotClearAfterPref = devicePref<WeakSpotClearAfter>({
  key: 'quizmill.weakSpotClearAfter.v1',
  event: 'quizmill:weakSpotClearAfter',
  fallback: WEAK_SPOT_DEFAULT,
  parse: (raw) =>
    WEAK_SPOT_CLEAR_CHOICES.find((n) => String(n) === raw),
  serialise: (n) => (n === WEAK_SPOT_DEFAULT ? null : String(n)),
});
