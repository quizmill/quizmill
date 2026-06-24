/**
 * Tap recognition for controls that live inside a scrollable region.
 *
 * On iOS the first tap that lands while a scroll view is still gliding
 * from a flick is consumed to STOP the momentum — the synthesized
 * `click` is never dispatched, so a control bound to `onClick` (our MCQ
 * answer buttons) appears to need a second tap. Raw pointer events do
 * still fire, so we recognise a tap (pointerdown -> pointerup with little
 * movement) and act on `pointerup`, then swallow the ghost `click` that
 * may follow. A pointer that moves past the tolerance is a scroll/drag,
 * not a tap, and is ignored — so flinging the list still scrolls.
 *
 * This is the pure state machine (no DOM/React) so it can be unit-tested
 * in the node test env; `useTap` wires it to pointer/click events.
 */

/** Movement (px) past which a gesture is a scroll/drag, not a tap. */
export const TAP_MOVE_TOLERANCE = 10;

export class TapRecognizer {
  private start: { x: number; y: number; id: number } | null = null;
  private moved = false;
  // A pointer tap just fired onTap; the matching click must be swallowed.
  private tapped = false;

  /** pointerdown — begin tracking a possible tap. */
  down(x: number, y: number, id: number): void {
    this.start = { x, y, id };
    this.moved = false;
    this.tapped = false;
  }

  /** pointermove — past the tolerance disqualifies the tap (it's a scroll). */
  move(x: number, y: number, id: number, tolerance = TAP_MOVE_TOLERANCE): void {
    const s = this.start;
    if (!s || s.id !== id) return;
    if (Math.abs(x - s.x) > tolerance || Math.abs(y - s.y) > tolerance) {
      this.moved = true;
    }
  }

  /** pointerup — true if this completed a tap and the caller should act. */
  up(id: number): boolean {
    const s = this.start;
    this.start = null;
    if (!s || s.id !== id || this.moved) return false;
    this.tapped = true;
    return true;
  }

  /** pointercancel — the browser took the gesture over for scrolling. */
  cancel(): void {
    this.start = null;
    this.moved = true;
  }

  /**
   * click — true if the caller should act (keyboard/mouse, no preceding
   * pointer tap), false for the ghost click after a pointer tap (swallow).
   */
  click(): boolean {
    if (this.tapped) {
      this.tapped = false;
      return false;
    }
    return true;
  }
}
