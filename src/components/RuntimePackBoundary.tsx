'use client';

import { useLayoutEffect, useState, type ReactNode } from 'react';
import { isRuntimePack } from '@/pack/source';
import { RUNTIME_PACK_PENDING_ATTR } from '@/lib/runtimePackPending';

/**
 * Hydration guard for a pack swapped in at runtime.
 *
 * The static export prerenders every route from the BUILD-TIME pack, but the
 * inline bootstrap in layout.tsx can swap a different pack in before React
 * wakes up — a library pack made active on /packs, or a quizmill-cloud
 * handoff. The client's first render then disagrees with the server HTML
 * (another title, other counts, a different number of category cards) and
 * React reports it as a hydration error (#418) on every hard load of Home,
 * Progress, Stickers, Notes and Settings before regenerating the tree. The
 * page always ended up right; the console didn't (issue #113).
 *
 * So when a runtime pack is active, the first client render ADOPTS the
 * prerendered markup verbatim: an element hydrated with
 * `dangerouslySetInnerHTML` is taken as-is — React doesn't look inside it,
 * which is what lets any innerHTML hydrate at all — so server and client
 * agree by construction. A layout effect then swaps the live tree in before
 * the browser paints. The prerendered HTML is NOT on screen meanwhile: the
 * bootstrap marks <html> with RUNTIME_PACK_PENDING_ATTR and globals.css hides
 * this root until the hand-over clears it, so the build-time pack never
 * flashes past before the runtime one (a sample bank before the full bank a
 * licence key just unlocked, on a phone still loading the bundle). With no runtime
 * pack (every ordinary one-pack deploy) this is a transparent wrapper and the
 * prerendered pack hydrates in place exactly as it always has.
 */

/** The element the server markup is read back from. One per page. */
const ROOT_ID = 'qm-app';

export function RuntimePackBoundary({ children }: { children: ReactNode }) {
  // Read the server markup during the hydration render itself — the DOM is
  // still the prerendered HTML at that point. Development compares __html
  // against the DOM, so adopt the exact string; production doesn't look.
  const [adopted, setAdopted] = useState<string | null>(() =>
    isRuntimePack && typeof document !== 'undefined'
      ? (document.getElementById(ROOT_ID)?.innerHTML ?? '')
      : null,
  );
  useLayoutEffect(() => {
    // The hand-over itself: a state change in a layout effect is the one
    // way to swap the tree after hydration and before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the hand-over is the point, see above
    setAdopted(null);
    // The bootstrap kept the prerendered (other pack's) page hidden until
    // now; the live tree lands in this same frame, so un-hide it with it.
    document.documentElement.removeAttribute(RUNTIME_PACK_PENDING_ATTR);
  }, []);

  // `display: contents` keeps the wrapper out of the layout. The keys force
  // a fresh element for the live tree — React must not try to reconcile
  // children into a node it adopted without looking inside.
  if (adopted !== null) {
    return (
      <div
        id={ROOT_ID}
        key="adopted"
        className="contents"
        dangerouslySetInnerHTML={{ __html: adopted }}
      />
    );
  }
  return (
    <div id={ROOT_ID} key="live" className="contents">
      {children}
    </div>
  );
}
