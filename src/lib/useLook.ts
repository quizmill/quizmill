'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyLook,
  loadLookPref,
  LOOK_EVENT,
  packDefaultLook,
  resolveLook,
  saveLookPref,
  type LookPref,
} from './look';

/**
 * Live look preference. Reads after mount (SSR/first paint stay stable —
 * the pre-paint bootstrap in layout.tsx already applied the attribute),
 * and keeps <html> in sync with the Settings toggle and other tabs.
 * Mirrors useTheme.
 */
export function useLook(): [LookPref, (pref: LookPref) => void] {
  const [pref, setPrefState] = useState<LookPref>('pack');

  useEffect(() => {
    const sync = () => {
      const stored = loadLookPref();
      setPrefState(stored);
      applyLook(resolveLook(stored, packDefaultLook()));
    };
    sync();

    window.addEventListener(LOOK_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LOOK_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setPref = useCallback((next: LookPref) => {
    setPrefState(next);
    saveLookPref(next);
  }, []);

  return [pref, setPref];
}
