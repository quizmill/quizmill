/**
 * Visual "look" preference: the calm classic UI, or the Poster look — the
 * loud quizmill.dev campaign style (warm paper, hard ink borders, offset
 * shadows, the vivid sail palette) brought into the app. Kids' packs love
 * it; the eleven-plus pack is the reason it exists.
 *
 * Mirrors src/lib/theme.ts exactly, because it is the same kind of thing:
 * the resolved look is applied as a `data-look="poster"` attribute on
 * <html>; the palette re-maps through the CSS variables in globals.css
 * (a third remap alongside light and dark, and it composes with both).
 * An inline script in layout.tsx applies it before first paint; `useLook`
 * keeps it live afterwards.
 *
 * 'pack' follows the pack's own default (`look` in pack.json — a kids'
 * pack can ship Poster out of the box), while 'classic'/'poster' pin the
 * device's choice regardless of pack. Stored app-level, like the colour
 * scheme: appearance belongs to the device and survives pack swaps.
 */
import { APP_CONFIG } from '@/config';
import { devicePref } from './devicePref';

export type LookPref = 'pack' | 'classic' | 'poster';
export type ResolvedLook = 'classic' | 'poster';

export const LOOK_KEY = 'quizmill.look.v1';

/** Local event fired after saveLookPref so all mounted hooks re-read. */
export const LOOK_EVENT = 'quizmill:look';

/** The active pack's default look, from its manifest (pack.json `look`). */
export function packDefaultLook(): ResolvedLook {
  return APP_CONFIG.look === 'poster' ? 'poster' : 'classic';
}

export const lookPref = devicePref<LookPref>({
  key: LOOK_KEY,
  event: LOOK_EVENT,
  fallback: 'pack',
  parse: (raw) => (raw === 'classic' || raw === 'poster' ? raw : undefined),
  // 'pack' removes the key: the bootstrap then falls back to the manifest.
  serialise: (pref) => (pref === 'pack' ? null : pref),
});

export const loadLookPref = lookPref.load;
export const saveLookPref = lookPref.save;

export function resolveLook(pref: LookPref, packDefault: ResolvedLook): ResolvedLook {
  return pref === 'pack' ? packDefault : pref;
}

export function applyLook(look: ResolvedLook): void {
  if (typeof document === 'undefined') return;
  if (look === 'poster') document.documentElement.setAttribute('data-look', 'poster');
  else document.documentElement.removeAttribute('data-look');
}
