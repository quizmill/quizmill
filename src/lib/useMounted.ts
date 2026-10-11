'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

/**
 * The browser-only render, as hooks.
 *
 * Every page is prerendered from the pack at build time, so the server
 * render and the hydration pass must produce the same tree — neither may
 * look at localStorage, navigator, the URL hash or anything else that only
 * exists on the device. The app used to express that as a `mounted` flag
 * flipped in an effect (`useEffect(() => setMounted(true), [])`), which
 * the React Compiler's lint rightly reports as a setState inside an effect.
 * These two hooks say the same thing without one.
 */

const subscribeToNothing = () => () => {};
const onTheClient = () => true;
const onTheServer = () => false;

/**
 * False for the server render and the hydration pass, true from the first
 * client-only render on — the same two renders the old mounted flag gave,
 * since React hydrates with the server snapshot and re-renders once it
 * disagrees with the client one. In a plain client render (tests, a tree
 * mounted after hydration) it is true from the first render.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribeToNothing, onTheClient, onTheServer);
}

/**
 * `useState` whose starting value lives in the browser — a stored pref, a
 * navigator capability, the URL hash — and so can't be read during the
 * server render or the hydration pass. Those two renders see `fallback`;
 * the first client-only render starts from `load()`, and the setter takes
 * over from there. Nothing is stored on a set: callers persist themselves,
 * as they did with the mounted flag.
 *
 * `load` and `fallback` must be referentially stable (a module-level
 * function and a constant or primitive): a fresh closure each render
 * would re-read storage each render. Wrap a prop-dependent loader in
 * `useCallback`.
 */
export function useClientState<T>(load: () => T, fallback: T): [T, (next: T) => void] {
  const mounted = useMounted();
  const loaded = useMemo(() => (mounted ? load() : fallback), [mounted, load, fallback]);
  const [override, setOverride] = useState<{ value: T } | null>(null);
  const set = useCallback((next: T) => setOverride({ value: next }), []);
  return [override ? override.value : loaded, set];
}
