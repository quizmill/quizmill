'use client';

import { useEffect } from 'react';
import {
  applyTheme,
  loadThemePref,
  resolveTheme,
  systemPrefersDark,
  themePref,
  type ThemePref,
} from './theme';
import { useDevicePref } from './useDevicePref';

/** Mirror a preference onto <html> against the OS scheme of the moment. */
function applyThemePref(pref: ThemePref): void {
  applyTheme(resolveTheme(pref, systemPrefersDark()));
}

/**
 * Live theme preference. Reads after mount (SSR/first paint stay stable —
 * the pre-paint bootstrap in layout.tsx already applied the right class),
 * and keeps <html> in sync with the Settings toggle, OS scheme changes
 * while in 'system' mode, and edits from other tabs.
 */
export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPref] = useDevicePref(themePref, applyThemePref);

  // The OS scheme flipping doesn't change the stored pref, only what
  // 'system' resolves to — re-apply, no re-read needed.
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => applyThemePref(loadThemePref());
    media?.addEventListener?.('change', onChange);
    return () => media?.removeEventListener?.('change', onChange);
  }, []);

  return [pref, setPref];
}
