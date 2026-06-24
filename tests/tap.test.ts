import { describe, it, expect } from 'vitest';
import { TapRecognizer, TAP_MOVE_TOLERANCE } from '@/lib/tap';

describe('TapRecognizer', () => {
  it('fires on pointerup for a still tap and swallows the ghost click', () => {
    const r = new TapRecognizer();
    r.down(100, 100, 1);
    expect(r.up(1)).toBe(true); // pointerup completes the tap -> act
    expect(r.click()).toBe(false); // the following click is the ghost -> ignore
  });

  it('treats movement past the tolerance as a scroll, not a tap', () => {
    const r = new TapRecognizer();
    r.down(100, 100, 1);
    r.move(100, 100 + TAP_MOVE_TOLERANCE + 1, 1);
    expect(r.up(1)).toBe(false); // scrolled -> do not select
    // No pointer tap fired, so a click (if any) should act normally.
    expect(r.click()).toBe(true);
  });

  it('allows small jitter within the tolerance', () => {
    const r = new TapRecognizer();
    r.down(100, 100, 1);
    r.move(100 + TAP_MOVE_TOLERANCE, 100, 1);
    expect(r.up(1)).toBe(true);
  });

  it('acts on a bare click (keyboard / mouse, no preceding pointer tap)', () => {
    const r = new TapRecognizer();
    expect(r.click()).toBe(true);
  });

  it('ignores pointerup from a different pointer id', () => {
    const r = new TapRecognizer();
    r.down(100, 100, 1);
    expect(r.up(2)).toBe(false);
  });

  it('does not fire after a pointercancel (gesture became a scroll)', () => {
    const r = new TapRecognizer();
    r.down(100, 100, 1);
    r.cancel();
    expect(r.up(1)).toBe(false);
  });

  it('fires only once per tap — click after a real pointer tap is swallowed exactly once', () => {
    const r = new TapRecognizer();
    r.down(0, 0, 1);
    expect(r.up(1)).toBe(true);
    expect(r.click()).toBe(false); // ghost click swallowed
    expect(r.click()).toBe(true); // a later, unrelated click acts again
  });

  it('resets cleanly between gestures', () => {
    const r = new TapRecognizer();
    r.down(0, 0, 1);
    r.move(50, 50, 1); // scroll
    expect(r.up(1)).toBe(false);
    // Next gesture is a clean tap.
    r.down(0, 0, 2);
    expect(r.up(2)).toBe(true);
  });
});
