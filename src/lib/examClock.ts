/**
 * The timed-exam countdown as a pure value: a start stamp, the total
 * time already spent paused, and the moment of the current pause (if
 * any). Elapsed time is wall-clock minus pauses, so a backgrounded tab
 * keeps counting down — an exam clock doesn't stop because the phone
 * went to sleep — while an explicit pause does freeze it. Nothing here
 * ticks; the UI re-reads with `Date.now()` on its own interval.
 */
export interface ExamClock {
  startedAt: number;
  /** When the current pause began; null while running. */
  pausedAt: number | null;
  /** Total milliseconds spent in COMPLETED pauses. */
  pausedMs: number;
}

export function startClock(now: number): ExamClock {
  return { startedAt: now, pausedAt: null, pausedMs: 0 };
}

export function isPaused(clock: ExamClock): boolean {
  return clock.pausedAt !== null;
}

/** Freeze the clock. Pausing an already-paused clock is a no-op. */
export function pauseClock(clock: ExamClock, now: number): ExamClock {
  if (clock.pausedAt !== null) return clock;
  return { ...clock, pausedAt: now };
}

/** Resume a paused clock, banking the pause. Resuming a running clock
 *  is a no-op. */
export function resumeClock(clock: ExamClock, now: number): ExamClock {
  if (clock.pausedAt === null) return clock;
  return {
    ...clock,
    pausedAt: null,
    pausedMs: clock.pausedMs + Math.max(0, now - clock.pausedAt),
  };
}

/** Milliseconds of exam time used — pauses excluded, never negative. */
export function elapsedMs(clock: ExamClock, now: number): number {
  const end = clock.pausedAt ?? now;
  return Math.max(0, end - clock.startedAt - clock.pausedMs);
}

/** Whole seconds of exam time used. */
export function elapsedSeconds(clock: ExamClock, now: number): number {
  return Math.floor(elapsedMs(clock, now) / 1000);
}

/** Whole seconds left before the sitting ends; 0 once time is up. */
export function remainingSeconds(
  clock: ExamClock,
  durationSeconds: number,
  now: number,
): number {
  return Math.max(0, Math.ceil((durationSeconds * 1000 - elapsedMs(clock, now)) / 1000));
}

/** True once the sitting's time has fully run out. */
export function isTimeUp(clock: ExamClock, durationSeconds: number, now: number): boolean {
  return elapsedMs(clock, now) >= durationSeconds * 1000;
}

/**
 * Clock-face spelling for the countdown: `m:ss` under an hour, `h:mm:ss`
 * from there. Distinct from `formatSpan` on purpose — a countdown reads
 * as a clock, a summary as a quantity ("2 min").
 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
