'use client';

import { applyLook, lookPref, packDefaultLook, resolveLook, type LookPref } from './look';
import { useDevicePref } from './useDevicePref';

/** Mirror a preference onto <html>, falling back to the pack's default. */
function applyLookPref(pref: LookPref): void {
  applyLook(resolveLook(pref, packDefaultLook()));
}

/**
 * Live look preference. Reads after mount (SSR/first paint stay stable —
 * the pre-paint bootstrap in layout.tsx already applied the attribute),
 * and keeps <html> in sync with the Settings toggle and other tabs.
 * Mirrors useTheme.
 */
export function useLook(): [LookPref, (pref: LookPref) => void] {
  return useDevicePref(lookPref, applyLookPref);
}
