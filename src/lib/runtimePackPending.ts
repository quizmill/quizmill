/**
 * Set on <html> by the inline pack bootstrap (layout.tsx) when it swaps a
 * runtime pack in, and removed by RuntimePackBoundary once the live tree is
 * up. While it's there, globals.css keeps the prerendered page — the
 * BUILD-TIME pack's — off screen, so a learner never sees another pack's
 * title and categories flash past before their own.
 */
export const RUNTIME_PACK_PENDING_ATTR = 'data-runtime-pack-pending';
