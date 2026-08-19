// Runtime pack-injection seam.
//
// The engine normally binds ONE pack at build time: `content/pack/*.json`
// is inlined by Next and read by `src/pack/source.ts`. A host that needs to
// serve many packs from a single deployment (e.g. quizmill-cloud, where a
// pack is generated per request) can instead inject the active pack at boot.
//
// Contract: call `setActivePack(pack)` BEFORE the engine UI modules first
// evaluate — in practice, set it and then dynamically `import()` the app, so
// `source.ts` reads the override on its first (and only) evaluation. With no
// call, `__QUIZMILL_PACK__` is undefined and the engine falls back to the
// build-time pack, behaving exactly as before. This module intentionally has
// no heavy imports (no JSON, no derived state) so it is cheap and safe to
// import early, ahead of the rest of the engine.

import type { PackManifest, PackQuestion, PackScenario, PackConcept } from './data';
import {
  ACTIVE_PACK_ID_KEY,
  HANDOFF_PACK_KEY,
  insertedPackKey,
} from '@/lib/packKeys';

export type ActivePack = {
  manifest: PackManifest;
  questions: PackQuestion[];
  /** Optional shared scenario stems; defaults to none when omitted. */
  scenarios?: PackScenario[];
  /** Optional concept cards; defaults to none when omitted. */
  concepts?: PackConcept[];
};

declare global {
  var __QUIZMILL_PACK__: ActivePack | undefined;
}

/** Inject the pack the engine should render. Must run before the engine UI
 *  modules evaluate — see the contract note above. */
export function setActivePack(pack: ActivePack): void {
  globalThis.__QUIZMILL_PACK__ = pack;
}

/**
 * The handed-off pack read straight from the browser, for when the layout's
 * inline bootstrap hasn't run yet. Next loads the engine chunks as async
 * scripts, and async scripts don't respect document order — when the service
 * worker serves them from cache they can execute BEFORE the inline bootstrap
 * at the end of <head>, so relying on the global alone made an injected pack
 * lose the race and render the build-time one. Mirrors the bootstrap's
 * sources and precedence: `#pack=<base64-json>` hash, then the external
 * handoff blob (HANDOFF_PACK_KEY), then the pack-library pointer
 * (ACTIVE_PACK_ID_KEY → the inserted pack it names).
 */
function readHandedOffPack(): ActivePack | undefined {
  if (typeof window === 'undefined') return undefined; // SSG build
  try {
    let raw: string | null = null;
    const m = window.location.hash.match(/[#&]pack=([^&]+)/);
    if (m) {
      // Inverse of the encoder: URI-component → base64 → UTF-8 JSON.
      raw = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
    } else if (window.localStorage) {
      raw = window.localStorage.getItem(HANDOFF_PACK_KEY);
      if (!raw) {
        const id = window.localStorage.getItem(ACTIVE_PACK_ID_KEY);
        if (id) raw = window.localStorage.getItem(insertedPackKey(id));
      }
    }
    if (!raw) return undefined;
    const pack = JSON.parse(raw) as ActivePack;
    // Cache on the global so bootstrap and engine agree on one object.
    globalThis.__QUIZMILL_PACK__ = pack;
    return pack;
  } catch {
    return undefined; // junk hash/storage → build-time pack
  }
}

/** The injected pack, if any. `source.ts` reads this once at module load. */
export function getActivePackOverride(): ActivePack | undefined {
  if (typeof globalThis !== 'undefined' && globalThis.__QUIZMILL_PACK__) {
    return globalThis.__QUIZMILL_PACK__;
  }
  return readHandedOffPack();
}
