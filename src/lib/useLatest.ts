'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * A ref that always holds `value` as of the latest COMMITTED render — for
 * handlers that outlive the render they were created in (a listener
 * registered once, a speech loop, pointer handlers mid-stroke) and would
 * otherwise close over stale state.
 *
 * Written in a layout effect — synchronously after commit, before the
 * browser can deliver another event — rather than during render, so a
 * render React throws away (Strict Mode's double render, an interrupted
 * one) never leaks into it. Writes from event handlers remain fine; only
 * render must not touch `.current`.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
