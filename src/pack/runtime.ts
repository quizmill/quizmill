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

/** The injected pack, if any. `source.ts` reads this once at module load. */
export function getActivePackOverride(): ActivePack | undefined {
  return typeof globalThis !== 'undefined' ? globalThis.__QUIZMILL_PACK__ : undefined;
}
