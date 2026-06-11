// Typed access to the ACTIVE learning pack's content.
// Source of truth: content/pack/{pack,questions,scenarios}.json —
// gitignored; seeded from content/pack-demo/ by scripts/ensure-pack.ts
// and replaced by `npm run pack:use <dir>`. Validated against
// tools/pack/schema.ts before activation.

import manifestJson from '../../content/pack/pack.json';
import questionsJson from '../../content/pack/questions.json';
import scenariosJson from '../../content/pack/scenarios.json';
import conceptsJson from '../../content/pack/concepts.json';

export type PackCategory = {
  key: string;
  label: string;
  shortLabel?: string;
  weight?: number;
};

/** An optional pack-defined level band (Year, CEFR, …) — the engine
 *  carries no domain terminology; the pack supplies key + label. */
export type PackLevel = {
  key: string;
  label: string;
};

/** A "Question sources" legend entry, shown in Settings. */
export type PackSource = { label: string; name?: string; blurb?: string; url?: string };

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
  levels?: PackLevel[];
  levelsLabel?: string;
  sources?: PackSource[];
};

export type PackScenario = {
  id: string;
  title: string;
  stem?: string;
  tags?: string[];
};

export type PackConceptExample = {
  question: string;
  steps?: string[];
  answer: string;
};

/** A short teaching card, surfaced after a wrong answer (linked by a
 *  question's conceptId). Body is rendered as McqMarkdown. */
export type PackConcept = {
  id: string;
  title: string;
  body: string;
  example?: PackConceptExample;
  commonMistakes?: string[];
  tags?: string[];
};

export type PackOption = { key: OptionKey; text: string; image?: string };

export type PackQuestion = {
  id: string;
  categoryKey: string;
  scenarioId?: string;
  conceptId?: string;
  level?: string;
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
export const packLevels = packManifest.levels ?? [];
export const packSources = packManifest.sources ?? [];
export const packQuestions = questionsJson as PackQuestion[];

/** Level key → label, for the per-question metadata chips. */
export const PACK_LEVEL_LABEL: Record<string, string> = Object.fromEntries(
  packLevels.map((l) => [l.key, l.label]),
);

/** Level key → chip tone, assigned by declaration order (e.g. y4→green … exam→slate). */
const LEVEL_TONES = [
  'bg-success-100 text-success-700 ring-success-500/30',
  'bg-brand-100 text-brand-800 ring-brand-500/30',
  'bg-warn-100 text-warn-700 ring-warn-500/30',
  'bg-ink-200 text-ink-700 ring-ink-400/30',
];
export const PACK_LEVEL_TONE: Record<string, string> = Object.fromEntries(
  packLevels.map((l, i) => [l.key, LEVEL_TONES[i % LEVEL_TONES.length]]),
);
export const packScenarios = scenariosJson as PackScenario[];
export const packConcepts = conceptsJson as PackConcept[];

/** Concept lookup by id, for the post-answer "Learn" card. */
export const PACK_CONCEPT_BY_ID: Record<string, PackConcept> = Object.fromEntries(
  packConcepts.map((c) => [c.id, c]),
);

/** Chip-friendly label per category key. */
export const PACK_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  packManifest.categories.map((c) => [c.key, c.shortLabel ?? c.label]),
);

/**
 * Per-category colour, so the home screen reads as more than a grey list.
 * Assigned by declaration order from a calm cycle (blue → green → amber →
 * slate), the same auto-by-order scheme as the level tones — fully generic,
 * no manifest field. `card` tints the category card, `badge`/`arrow` keep
 * the accents on-tone.
 */
export type CategoryTone = { card: string; badge: string; arrow: string };
const CATEGORY_TONES: CategoryTone[] = [
  {
    card: 'border-brand-500/20 bg-brand-50 hover:border-brand-500/40',
    badge: 'bg-brand-100 text-brand-700',
    arrow: 'text-brand-400 group-hover:text-brand-600',
  },
  {
    card: 'border-success-500/20 bg-success-50 hover:border-success-500/40',
    badge: 'bg-success-100 text-success-700',
    arrow: 'text-success-500 group-hover:text-success-700',
  },
  {
    card: 'border-warn-500/20 bg-warn-50 hover:border-warn-500/40',
    badge: 'bg-warn-100 text-warn-700',
    arrow: 'text-warn-500 group-hover:text-warn-700',
  },
  {
    card: 'border-ink-400/25 bg-ink-50 hover:border-ink-400/50',
    badge: 'bg-ink-200 text-ink-700',
    arrow: 'text-ink-400 group-hover:text-ink-600',
  },
];
export const PACK_CATEGORY_TONE: Record<string, CategoryTone> = Object.fromEntries(
  packManifest.categories.map((c, i) => [c.key, CATEGORY_TONES[i % CATEGORY_TONES.length]]),
);
