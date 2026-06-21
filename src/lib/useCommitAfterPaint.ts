'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Run side-effecting work AFTER the browser has painted, so heavy
 * post-tap bookkeeping (walking the whole attempt history for
 * achievements, churning localStorage) can't block the tap that
 * triggered it. The visible response — selecting an answer, showing
 * feedback, advancing — commits first; the bookkeeping rides along a
 * frame later.
 *
 * Anything still pending is flushed synchronously on unmount, so
 * navigating away the instant after answering can never drop a write.
 *
 * Returns a stable `schedule` (queue a job) and `flush` (run queued
 * jobs now).
 */
export function useCommitAfterPaint(): {
  schedule: (job: () => void) => void;
  flush: () => void;
} {
  const pending = useRef<Array<() => void>>([]);
  const armed = useRef(false);

  const run = useCallback(() => {
    armed.current = false;
    const jobs = pending.current;
    pending.current = [];
    for (const job of jobs) job();
  }, []);

  const schedule = useCallback(
    (job: () => void) => {
      pending.current.push(job);
      if (armed.current) return;
      armed.current = true;
      // rAF clears the paint that the triggering render just committed,
      // then a macrotask runs the work once the browser is idle. Falls
      // back to a plain timeout where rAF isn't available (SSR/tests).
      const raf =
        typeof requestAnimationFrame !== 'undefined'
          ? requestAnimationFrame
          : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
      raf(() => setTimeout(run, 0));
    },
    [run],
  );

  // Flush on unmount — a queued job must not be lost to navigation.
  useEffect(() => () => run(), [run]);

  return { schedule, flush: run };
}
