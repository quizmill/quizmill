// Typed access to the ACTIVE learning pack's content.
// Source of truth: content/pack/{pack,questions,scenarios}.json —
// gitignored; seeded from content/pack-demo/ by scripts/ensure-pack.ts
// and replaced by `npm run pack:use <dir>`. Validated against
// tools/pack/schema.ts before activation.

import manifestJson from '../../content/pack/pack.json';
import questionsJson from '../../content/pack/questions.json';
import scenariosJson from '../../content/pack/scenarios.json';

export type PackCategory = {
  key: string;
  label: string;
  shortLabel?: string;
  weight?: number;
};

/** Option keys, A–F (v2 allows 2–6 options; v1 packs use A–D). */
export type OptionKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type PackManifest = {
  schemaVersion: 1 | 2;
  id: string;
  title: string;
  description: string;
  homeSubtitle: string;
  themeColor: string;
  categories: PackCategory[];
};

export type PackScenario = {
  id: string;
  title: string;
  stem?: string;
  tags?: string[];
};

export type PackOption = { key: OptionKey; text: string; image?: string };

export type PackQuestion = {
  id: string;
  categoryKey: string;
  scenarioId?: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  prompt: string;
  image?: string;
  options: PackOption[];
  correctKey: OptionKey;
  explanation: string;
  source: 'original' | 'generated' | 'curated';
  sourceRef?: string;
  reviewStatus: 'draft' | 'reviewed' | 'approved';
  tags?: string[];
};

export const packManifest = manifestJson as PackManifest;
export const packQuestions = questionsJson as PackQuestion[];
export const packScenarios = scenariosJson as PackScenario[];

/** Chip-friendly label per category key. */
export const PACK_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  packManifest.categories.map((c) => [c.key, c.shortLabel ?? c.label]),
);
