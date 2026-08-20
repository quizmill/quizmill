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
import { assetsBaseForUrl } from '@/lib/packInsert';
import {
  ACTIVE_PACK_ID_KEY,
  HANDOFF_PACK_KEY,
  LIBRARY_INDEX_KEY,
  insertedPackKey,
} from '@/lib/packKeys';

export type ActivePack = {
  manifest: PackManifest;
  questions: PackQuestion[];
  /** Optional shared scenario stems; defaults to none when omitted. */
  scenarios?: PackScenario[];
  /** Optional concept cards; defaults to none when omitted. */
  concepts?: PackConcept[];
  /**
   * Absolute http(s) base URL of the pack's `assets/` directory, for
   * packs injected at runtime. A runtime pack's image files are not part
   * of this deployment's static export, so relative question/option
   * `image` paths resolve against this instead of the app's own
   * `/pack-assets/` (see PackImage). Recorded at insert time from the
   * URL the pack was fetched from; absent for the build-time pack and
   * for packs whose source had no reachable URL (e.g. picked files).
   */
  assetsBase?: string;
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
    const pack = backfillAssetsBase(JSON.parse(raw) as ActivePack);
    // Cache on the global so bootstrap and engine agree on one object.
    globalThis.__QUIZMILL_PACK__ = pack;
    return pack;
  } catch {
    return undefined; // junk hash/storage → build-time pack
  }
}

/**
 * Backfill for packs inserted before `assetsBase` existed (pre-v0.3.22):
 * their stored JSON lacks it, so every image 404s — even online. The
 * library index recorded each insert's origin (the pasted/registry URL),
 * so derive the assets location from it once, persist it back, and warm
 * the offline image cache the insert-time prefetch never ran for.
 * Attempted at most once per page load; a pack with no usable origin
 * (picked files) is left untouched.
 */
let backfillTried = false;
function backfillAssetsBase(pack: ActivePack): ActivePack {
  if (pack.assetsBase || backfillTried || typeof window === 'undefined') return pack;
  backfillTried = true;
  try {
    const rawIndex = window.localStorage.getItem(LIBRARY_INDEX_KEY);
    if (!rawIndex) return pack;
    const entries = JSON.parse(rawIndex) as { id?: string; origin?: string }[];
    const origin = Array.isArray(entries)
      ? entries.find((e) => e && e.id === pack.manifest?.id)?.origin
      : undefined;
    if (typeof origin !== 'string') return pack;
    const base = assetsBaseForUrl(origin);
    if (!base) return pack;
    pack.assetsBase = base;
    const key = insertedPackKey(pack.manifest.id);
    if (window.localStorage.getItem(key)) {
      window.localStorage.setItem(key, JSON.stringify(pack));
    }
    // Dynamic import keeps this bootstrap-adjacent module feather-light.
    void import('@/lib/packAssets')
      .then((m) => m.cachePackAssets(pack))
      .catch(() => undefined);
  } catch {
    // junk index — leave the pack as it was
  }
  return pack;
}

/** The injected pack, if any. `source.ts` reads this once at module load. */
export function getActivePackOverride(): ActivePack | undefined {
  if (typeof globalThis !== 'undefined' && globalThis.__QUIZMILL_PACK__) {
    return backfillAssetsBase(globalThis.__QUIZMILL_PACK__);
  }
  return readHandedOffPack();
}
