// Public entry for hosts that embed the quizmill engine (e.g. quizmill-cloud).
//
// A host injects the pack to render with `setActivePack(pack)` — call it
// before the engine UI modules evaluate (set it, then dynamically import the
// app) — and then mounts the engine's route tree as usual. With no call the
// engine renders the build-time pack and nothing here changes its behaviour.
//
// The pack content types below are the shape `setActivePack` expects; they
// match the Zod schema in `tools/pack/schema.ts`, which a generator should
// validate against before injecting.

export { setActivePack, getActivePackOverride } from './pack/runtime';
export type { ActivePack } from './pack/runtime';
export type {
  PackManifest,
  PackQuestion,
  PackOption,
  PackScenario,
  PackConcept,
  PackConceptExample,
  PackCategory,
  PackLevel,
  PackSource,
  PackExam,
  PackGames,
  OptionKey,
} from './pack/data';
