/**
 * localStorage keys for the multi-pack machinery — a leaf module with no
 * imports so BOTH sides can share it: the pack library (src/lib/
 * packLibrary.ts, heavy — zod validation) and the runtime bootstrap
 * (src/pack/runtime.ts + the inline script in layout.tsx, which must stay
 * feather-light and evaluate before the engine bundle).
 *
 * These keys are deliberately APP-level (bare `quizmill.` prefix, no pack
 * id): the library is a property of the installed app, not of any one pack.
 */

/**
 * Full ActivePack JSON handed off by an external host (e.g. quizmill-cloud
 * writes it before redirecting into the engine). Pre-dates the library and
 * stays supported: when present it wins over the library pointer.
 */
export const HANDOFF_PACK_KEY = 'quizmill.activePack';

/**
 * Pointer to the inserted pack the app should render — a pack id whose
 * content lives under `insertedPackKey(id)`. Absent → the build-time pack.
 */
export const ACTIVE_PACK_ID_KEY = 'quizmill.activePackId';

/** Index of inserted packs: JSON array of PackLibraryEntry metadata. */
export const LIBRARY_INDEX_KEY = 'quizmill.packLibrary.index.v1';

const INSERTED_PACK_PREFIX = 'quizmill.packLibrary.pack.';

/**
 * Where the ACTIVE inserted pack's full ActivePack JSON is mirrored for the
 * synchronous boot. Every inserted pack lives in IndexedDB
 * (src/lib/packStore.ts); only the one the pointer names is copied here,
 * because localStorage is small (~5 MB per origin, counted in UTF-16, so a
 * pack costs about twice its JSON size) and shared with all progress.
 * Without IndexedDB every inserted pack falls back to living here.
 */
export function insertedPackKey(id: string): string {
  return `${INSERTED_PACK_PREFIX}${id}.v1`;
}
