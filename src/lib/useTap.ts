import { useRef, type PointerEvent } from 'react';
import { TapRecognizer } from './tap';

/**
 * Handlers to spread onto a control inside a scroll region so it responds
 * to the FIRST tap even while an iOS momentum scroll is decelerating
 * (which otherwise swallows the click — see tap.ts). Fires `onTap` on
 * pointerup for a tap, and falls back to click for keyboard/mouse, never
 * double-firing. Movement past the tolerance is treated as a scroll, so
 * dragging to scroll still works.
 *
 * Usage: `<button {...useTap(() => onSelect(key))}>`. Call once per
 * component instance (not in a loop — it's a hook).
 */
export function useTap(onTap: () => void): {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: () => void;
  onClick: () => void;
} {
  const r = useRef<TapRecognizer | null>(null);
  if (!r.current) r.current = new TapRecognizer();
  const rec = r.current;

  return {
    onPointerDown: (e) => rec.down(e.clientX, e.clientY, e.pointerId),
    onPointerMove: (e) => rec.move(e.clientX, e.clientY, e.pointerId),
    onPointerUp: (e) => {
      if (rec.up(e.pointerId)) onTap();
    },
    onPointerCancel: () => rec.cancel(),
    onClick: () => {
      if (rec.click()) onTap();
    },
  };
}
