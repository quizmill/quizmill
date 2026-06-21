import type { ReactNode } from 'react';

/**
 * Pins the quiz's primary action (Check answer / Next question) to the
 * bottom of the viewport so it's always one tap away. The feedback panel
 * — explanation, concept card, source, vote row — is often long enough to
 * push a bottom-of-flow button below the fold, which made a quick tap at
 * the usual action spot miss and feel like it needed a second press.
 *
 * The translucent backdrop keeps content readable as it scrolls under,
 * and the safe-area padding clears the iOS home indicator.
 */
export function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-1 border-t border-ink-200/70 bg-ink-50/85 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
      {children}
    </div>
  );
}
