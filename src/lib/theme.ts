/**
 * Colour-scheme preference: 'system' follows the OS, 'light'/'dark' pin it.
 *
 * The resolved theme is applied as a `dark` class on <html>; every palette
 * shade re-maps through the CSS variables in globals.css, so components
 * don't carry `dark:` variants. An inline script in layout.tsx applies the
 * stored preference before first paint (no flash); `useTheme` keeps it live
 * afterwards (Settings toggle, OS changes, other tabs).
 *
 * Stored under its own key (not PackPrefs) so "Reset all local progress"
 * leaves the device's appearance choice alone, and as a bare string so the
 * pre-paint bootstrap script doesn't need to parse JSON.
 */
import { APP_CONFIG } from '@/config';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = `quizmill.${APP_CONFIG.packId}.theme.v1`;

/** Local event fired after saveThemePref so all mounted hooks re-read. */
export const THEME_EVENT = 'quizmill:theme';

export function loadThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePref(pref: ThemePref): void {
  if (typeof window === 'undefined') return;
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    // storage may be unavailable (private mode); the in-page theme still applies
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemDark ? 'dark' : 'light';
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Toggle the `dark` class on <html> — the single switch the CSS keys off. */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
