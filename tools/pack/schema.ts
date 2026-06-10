import { z } from 'zod';

/**
 * Learning-pack format (schemaVersion 1).
 *
 * A pack is a directory of three JSON files that fully describes one
 * deployable practice app for the generic `pack` variant:
 *
 *   pack.json        manifest — identity, branding, categories
 *   questions.json   the MCQ bank
 *   scenarios.json   optional shared scenario stems (may be `[]` / absent)
 *
 * The shape is a generalised MCQ format proven by several hundred
 * imported/generated questions in the engine's ancestor project; categories
 * are declared in the manifest and cross-checked by `validatePack`,
 * not hard-coded.
 *
 * schemaVersion 2 relaxes the original v1 (exactly 4 options A–D) to
 * 2–6 options keyed A–F in order — true/false, 5-option exam papers, etc.
 * v1 packs (4 options A–D) remain valid unchanged; the validator stays
 * backward-readable.
 *
 * Packs are PRIVATE by default: the active pack lives at gitignored
 * `content/pack/`, authored packs under gitignored `packs/`. Only the
 * demo pack (`content/pack-demo/`) is committed.
 */

const slug = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A pack-relative image asset path (v2). Lives in the pack's `assets/`
 * directory and is served from `/pack-assets/` at build time. Must be a
 * plain relative path with an image extension — no leading slash, no URL,
 * no `..` traversal.
 */
export const packImagePathSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(svg|png|jpe?g|gif|webp)$/i,
    'must be a relative image path ending in .svg/.png/.jpg/.gif/.webp',
  )
  .refine((p) => !p.includes('..'), { message: 'must not contain ".."' });

export const packCategorySchema = z.object({
  /** Stable key — used in URLs, storage rows, and questions' categoryKey. */
  key: z.string().regex(slug).max(40),
  label: z.string().min(2).max(80),
  /** Chip-friendly short label; falls back to `label`. */
  shortLabel: z.string().min(1).max(24).optional(),
  /** Optional selection weight, e.g. an exam blueprint percentage. */
  weight: z.number().positive().max(1).optional(),
});

export const packLevelSchema = z.object({
  /** Stable key — referenced by a question's `level`. */
  key: z.string().regex(slug).max(40),
  label: z.string().min(1).max(40),
});

export const packSourceSchema = z.object({
  /** Short chip label shown in the legend, e.g. "GL", "MIT", "Original". */
  label: z.string().min(1).max(24),
  /** Display name, often with a count — e.g. "connectry-io (390)". */
  name: z.string().min(1).max(80).optional(),
  /** One-line description of where the questions came from. */
  blurb: z.string().max(300).optional(),
  /** Link to the source — repo, licence, or publisher. */
  url: z.string().url().optional(),
});

export const packManifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    /** Pack identifier (slug). Becomes part of file paths — keep stable. */
    id: z.string().regex(slug).max(40),
    /** App title (tab title / home H1). */
    title: z.string().min(3).max(60),
    /** One-line <meta description>. */
    description: z.string().min(10).max(200),
    /** Greeting under the H1 on the home page. */
    homeSubtitle: z.string().min(3).max(120),
    /** PWA theme colour, e.g. "#1e3a5f". */
    themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    categories: z.array(packCategorySchema).min(1).max(12),
    /** Optional ordered "level" bands (v2) — a coarse axis above difficulty
     *  you can filter practice by (Year groups, CEFR levels, …). Questions
     *  tag one via `level`; declare none and there's no filter, as today. */
    levels: z.array(packLevelSchema).min(1).max(8).optional(),
    /** What the pack calls its level dimension, shown as the filter's
     *  label (e.g. "Year", "Grade", "CEFR"). Defaults to "Level". The
     *  engine ships no domain terminology — the pack names its own axis. */
    levelsLabel: z.string().min(1).max(24).optional(),
    /** Optional "Question sources" legend, rendered in Settings (v2) —
     *  where the bank's questions come from: repos, licences, credits. */
    sources: z.array(packSourceSchema).max(12).optional(),
  })
  .superRefine((m, ctx) => {
    const keys = m.categories.map((c) => c.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'category keys must be unique' });
    }
    if (m.levels) {
      const levelKeys = m.levels.map((l) => l.key);
      if (new Set(levelKeys).size !== levelKeys.length) {
        ctx.addIssue({ code: 'custom', message: 'level keys must be unique' });
      }
    }
  });

export const packOptionKeySchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);

export const packOptionSchema = z.object({
  key: packOptionKeySchema,
  /** Visible label, or — for image-answer questions — the image's alt text. */
  text: z.string().min(1).max(800),
  /** Optional answer image (v2). When any option has one, all must (an
   *  image-answer question, e.g. Non-Verbal Reasoning) — see superRefine. */
  image: packImagePathSchema.optional(),
});

export const packScenarioSchema = z.object({
  id: z.string().regex(slug),
  title: z.string().min(5).max(120),
  /** Shared narrative across the scenario's questions. Optional — see
   *  the CCA scenario schema for the rationale. */
  stem: z.string().min(50).optional(),
  tags: z.array(z.string()).optional(),
});

export const packConceptExampleSchema = z.object({
  question: z.string().min(1).max(400),
  steps: z.array(z.string().min(1)).optional(),
  answer: z.string().min(1).max(200),
});

/**
 * A short teaching card (v2), in optional `concepts.json`. A question
 * links one by `conceptId`; the feedback panel surfaces it after a wrong
 * answer. `body` renders as McqMarkdown (paragraphs, code, links).
 */
export const packConceptSchema = z.object({
  id: z.string().regex(slug),
  title: z.string().min(3).max(120),
  body: z.string().min(20),
  example: packConceptExampleSchema.optional(),
  commonMistakes: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string()).optional(),
});

export const packQuestionSchema = z
  .object({
    id: z.string().regex(slug),
    /** Must match a manifest category key — cross-checked in validatePack. */
    categoryKey: z.string().regex(slug),
    scenarioId: z.string().optional(),
    /** Optional teaching card shown after a wrong answer — cross-checked
     *  against concepts.json in validatePack. */
    conceptId: z.string().optional(),
    /** Optional level band (v2) — must reference a manifest level key. */
    level: z.string().optional(),
    difficulty: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    /** Floor of 10 keeps junk out while allowing legitimately terse
     *  prompts like arithmetic ("What is 7 × 8?"). */
    prompt: z.string().min(10),
    /** Optional prompt image (v2), shown above the options — e.g. an NVR
     *  figure or a diagram the question refers to. */
    image: packImagePathSchema.optional(),
    /** 2–6 options keyed A–F in order (v2). True/false → 2; GL papers → 5. */
    options: z.array(packOptionSchema).min(2).max(6),
    correctKey: packOptionKeySchema,
    /** Teaches WHY the answer is right (and ideally why distractors are
     *  wrong) — this is the pedagogical payload, don't skimp. */
    explanation: z.string().min(40),
    source: z.enum(['original', 'generated', 'curated']),
    sourceRef: z.string().optional(),
    reviewStatus: z.enum(['draft', 'reviewed', 'approved']),
    tags: z.array(z.string()).optional(),
  })
  .superRefine((q, ctx) => {
    const keys = q.options.map((o) => o.key);
    // Keys must be exactly the contiguous prefix A,B,C… for the option
    // count — one each, no gaps or dupes (order in the array is free).
    const expected = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, q.options.length);
    const keySet = new Set<string>(keys);
    if (keySet.size !== keys.length || !expected.every((k) => keySet.has(k))) {
      ctx.addIssue({
        code: 'custom',
        message: `options must be keyed exactly ${expected.join(',')} (one each)`,
      });
    }
    if (!keys.includes(q.correctKey)) {
      ctx.addIssue({ code: 'custom', message: 'correctKey must reference one of the options' });
    }
    // Image options are all-or-nothing: a mix of image and text answers
    // renders inconsistently, and usually signals an authoring slip.
    const withImage = q.options.filter((o) => o.image).length;
    if (withImage > 0 && withImage !== q.options.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'image options must be all-or-nothing (every option needs an image, or none)',
      });
    }
  });

export type PackCategory = z.infer<typeof packCategorySchema>;
export type PackLevel = z.infer<typeof packLevelSchema>;
export type PackSource = z.infer<typeof packSourceSchema>;
export type PackManifest = z.infer<typeof packManifestSchema>;
export type PackScenario = z.infer<typeof packScenarioSchema>;
export type PackConcept = z.infer<typeof packConceptSchema>;
export type PackQuestion = z.infer<typeof packQuestionSchema>;

export interface PackValidationResult {
  ok: boolean;
  errors: string[];
  /** Non-fatal issues worth fixing (e.g. a category with no questions). */
  warnings: string[];
}

/**
 * Whole-pack validation: per-file schemas plus the cross-file checks a
 * single Zod schema can't express (unique ids, category/scenario
 * references, weight sanity). Pure function over parsed JSON so it's
 * unit-testable and reusable by both the CLI and the use-pack script.
 */
export function validatePack(input: {
  manifest: unknown;
  questions: unknown;
  scenarios?: unknown;
  concepts?: unknown;
}): PackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const manifest = packManifestSchema.safeParse(input.manifest);
  if (!manifest.success) {
    for (const issue of manifest.error.issues) {
      errors.push(`pack.json: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }

  if (!Array.isArray(input.questions)) {
    errors.push('questions.json: must be a JSON array');
  }
  const questions: PackQuestion[] = [];
  if (Array.isArray(input.questions)) {
    input.questions.forEach((raw, i) => {
      const q = packQuestionSchema.safeParse(raw);
      if (q.success) {
        questions.push(q.data);
      } else {
        const id =
          typeof raw === 'object' && raw !== null && 'id' in raw
            ? String((raw as { id: unknown }).id)
            : `#${i}`;
        for (const issue of q.error.issues) {
          errors.push(
            `questions.json[${id}]: ${issue.path.join('.') || '(root)'}: ${issue.message}`,
          );
        }
      }
    });
    if (input.questions.length === 0) {
      errors.push('questions.json: pack has no questions');
    }
  }

  const scenarios: PackScenario[] = [];
  if (input.scenarios !== undefined) {
    if (!Array.isArray(input.scenarios)) {
      errors.push('scenarios.json: must be a JSON array');
    } else {
      input.scenarios.forEach((raw, i) => {
        const s = packScenarioSchema.safeParse(raw);
        if (s.success) {
          scenarios.push(s.data);
        } else {
          for (const issue of s.error.issues) {
            errors.push(
              `scenarios.json[#${i}]: ${issue.path.join('.') || '(root)'}: ${issue.message}`,
            );
          }
        }
      });
    }
  }

  const concepts: PackConcept[] = [];
  if (input.concepts !== undefined) {
    if (!Array.isArray(input.concepts)) {
      errors.push('concepts.json: must be a JSON array');
    } else {
      input.concepts.forEach((raw, i) => {
        const c = packConceptSchema.safeParse(raw);
        if (c.success) {
          concepts.push(c.data);
        } else {
          const id =
            typeof raw === 'object' && raw !== null && 'id' in raw
              ? String((raw as { id: unknown }).id)
              : `#${i}`;
          for (const issue of c.error.issues) {
            errors.push(
              `concepts.json[${id}]: ${issue.path.join('.') || '(root)'}: ${issue.message}`,
            );
          }
        }
      });
    }
  }

  // Cross-file checks only make sense once per-file parses succeeded.
  if (manifest.success && questions.length > 0) {
    const seen = new Set<string>();
    for (const q of questions) {
      if (seen.has(q.id)) errors.push(`questions.json[${q.id}]: duplicate question id`);
      seen.add(q.id);
    }

    const categoryKeys = new Set(manifest.data.categories.map((c) => c.key));
    for (const q of questions) {
      if (!categoryKeys.has(q.categoryKey)) {
        errors.push(
          `questions.json[${q.id}]: categoryKey "${q.categoryKey}" not declared in pack.json categories`,
        );
      }
    }

    const scenarioIds = new Set(scenarios.map((s) => s.id));
    for (const q of questions) {
      if (q.scenarioId && !scenarioIds.has(q.scenarioId)) {
        errors.push(
          `questions.json[${q.id}]: scenarioId "${q.scenarioId}" not found in scenarios.json`,
        );
      }
    }

    const seenConcepts = new Set<string>();
    for (const c of concepts) {
      if (seenConcepts.has(c.id)) errors.push(`concepts.json[${c.id}]: duplicate concept id`);
      seenConcepts.add(c.id);
    }
    const conceptIds = new Set(concepts.map((c) => c.id));
    for (const q of questions) {
      if (q.conceptId && !conceptIds.has(q.conceptId)) {
        errors.push(
          `questions.json[${q.id}]: conceptId "${q.conceptId}" not found in concepts.json`,
        );
      }
    }

    const levelKeys = new Set((manifest.data.levels ?? []).map((l) => l.key));
    for (const q of questions) {
      if (q.level && !levelKeys.has(q.level)) {
        errors.push(
          `questions.json[${q.id}]: level "${q.level}" not declared in pack.json levels`,
        );
      }
    }

    for (const c of manifest.data.categories) {
      if (!questions.some((q) => q.categoryKey === c.key)) {
        warnings.push(
          `pack.json: category "${c.key}" has no questions — its home card will be an empty state`,
        );
      }
    }

    const weights = manifest.data.categories
      .map((c) => c.weight)
      .filter((w): w is number => w !== undefined);
    if (weights.length > 0) {
      const sum = weights.reduce((a, b) => a + b, 0);
      if (weights.length !== manifest.data.categories.length) {
        warnings.push('pack.json: some categories have weights and some do not');
      } else if (Math.abs(sum - 1) > 0.01) {
        warnings.push(`pack.json: category weights sum to ${sum.toFixed(2)}, expected ~1.0`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
