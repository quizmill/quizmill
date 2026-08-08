'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  loadThemePref,
  resolveTheme,
  saveThemePref,
  systemPrefersDark,
  THEME_EVENT,
  type ThemePref,
} from './theme';

/**
 * Live theme preference. Reads after mount (SSR/first paint stay stable —
 * the pre-paint bootstrap in layout.tsx already applied the right class),
 * and keeps <html> in sync with the Settings toggle, OS scheme changes
 * while in 'system' mode, and edits from other tabs.
 */
export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPrefState] = useState<ThemePref>('system');

  useEffect(() => {
    const sync = () => {
      const stored = loadThemePref();
      setPrefState(stored);
      applyTheme(resolveTheme(stored, systemPrefersDark()));
    };
    sync();

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', sync);
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      media?.removeEventListener?.('change', sync);
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    applyTheme(resolveTheme(next, systemPrefersDark()));
    saveThemePref(next); // fires THEME_EVENT → other hooks re-sync
  }, []);

  return [pref, setPref];
}
