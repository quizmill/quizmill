'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DevicePref } from './devicePref';

/**
 * Live view of a device preference for React. Starts at the fallback so
 * SSR and first paint stay stable (the pre-paint bootstrap in layout.tsx
 * has already applied the stored theme/look to <html>), reads storage
 * after mount, and re-reads on the pref's own event (a save anywhere on
 * this page) and on `storage` (an edit from another tab).
 *
 * `apply` — optional, must be referentially stable (a module-level
 * function) — is the side effect that mirrors the value onto the page,
 * e.g. the `dark` class or `data-look` attribute on <html>. It runs on
 * every read and on set, so the page never shows one thing while the
 * hook holds another.
 */
export function useDevicePref<T>(
  pref: DevicePref<T>,
  apply?: (value: T) => void,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(pref.fallback);

  useEffect(() => {
    const sync = () => {
      const stored = pref.load();
      setValue(stored);
      apply?.(stored);
    };
    sync();

    window.addEventListener(pref.event, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(pref.event, sync);
      window.removeEventListener('storage', sync);
    };
  }, [pref, apply]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      apply?.(next);
      pref.save(next); // fires pref.event → every other mounted hook re-syncs
    },
    [pref, apply],
  );

  return [value, set];
}
