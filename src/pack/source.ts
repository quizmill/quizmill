// The ACTIVE pack's raw content, resolved once at module load.
//
// Default source is the build-time pack inlined from `content/pack/*.json`
// (gitignored; seeded by `scripts/ensure-pack.ts`, swapped by `pack:use`).
// A host may instead inject a pack at runtime via `setActivePack()` in
// `runtime.ts` — when present, that override wins wholesale (a runtime pack
// brings its own scenarios/concepts, so missing ones default to empty rather
// than leaking the build-time pack's). Everything downstream (`config`,
// `data`) derives from these four exports, so neither the build-time path nor
// the runtime path needs to know which source won.

import buildManifest from '../../content/pack/pack.json';
import buildQuestions from '../../content/pack/questions.json';
import buildScenarios from '../../content/pack/scenarios.json';
import buildConcepts from '../../content/pack/concepts.json';
import { getActivePackOverride } from './runtime';
import type { PackManifest, PackQuestion, PackScenario, PackConcept } from './data';

const override = getActivePackOverride();

/** The manifest COMPILED INTO this deployment, regardless of any runtime
 *  override — the pack library UI lists it as the built-in pack. */
export const buildTimeManifest = buildManifest as PackManifest;

/** Question count of the compiled-in pack, for the library listing. */
export const buildTimeQuestionCount = (buildQuestions as PackQuestion[]).length;

export const activeManifest = (
  override ? override.manifest : buildManifest
) as PackManifest;

export const activeQuestions = (
  override ? override.questions : buildQuestions
) as PackQuestion[];

export const activeScenarios = (
  override ? override.scenarios ?? [] : buildScenarios
) as PackScenario[];

export const activeConcepts = (
  override ? override.concepts ?? [] : buildConcepts
) as PackConcept[];
