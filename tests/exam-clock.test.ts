import { describe, expect, it } from 'vitest';
import {
  elapsedSeconds,
  formatClock,
  isPaused,
  isTimeUp,
  pauseClock,
  remainingSeconds,
  resumeClock,
  startClock,
} from '@/lib/examClock';

describe('exam clock', () => {
  it('counts wall-clock time while running', () => {
    const c = startClock(1_000);
    expect(elapsedSeconds(c, 1_000)).toBe(0);
    expect(elapsedSeconds(c, 61_500)).toBe(60);
    expect(remainingSeconds(c, 600, 61_500)).toBe(540);
    expect(isPaused(c)).toBe(false);
  });

  it('freezes while paused and banks the pause on resume', () => {
    let c = startClock(0);
    c = pauseClock(c, 10_000);
    expect(isPaused(c)).toBe(true);
    // Time passes, the clock does not.
    expect(elapsedSeconds(c, 50_000)).toBe(10);
    expect(remainingSeconds(c, 60, 50_000)).toBe(50);
    c = resumeClock(c, 50_000);
    expect(isPaused(c)).toBe(false);
    expect(elapsedSeconds(c, 55_000)).toBe(15);
    // A second pause stacks on the first.
    c = pauseClock(c, 55_000);
    c = resumeClock(c, 65_000);
    expect(elapsedSeconds(c, 70_000)).toBe(20);
  });

  it('ignores a double pause or a resume while running', () => {
    const running = startClock(0);
    expect(resumeClock(running, 5_000)).toBe(running);
    const paused = pauseClock(running, 5_000);
    expect(pauseClock(paused, 9_000)).toBe(paused);
  });

  it('bottoms out at zero and reports time up', () => {
    const c = startClock(0);
    expect(remainingSeconds(c, 30, 29_001)).toBe(1);
    expect(isTimeUp(c, 30, 29_999)).toBe(false);
    expect(isTimeUp(c, 30, 30_000)).toBe(true);
    expect(remainingSeconds(c, 30, 99_000)).toBe(0);
  });

  it('spells the countdown as a clock face', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3599)).toBe('59:59');
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(10_800 - 1)).toBe('2:59:59');
    expect(formatClock(-3)).toBe('0:00');
  });
});
