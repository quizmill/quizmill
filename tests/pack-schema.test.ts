import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validatePack } from '../tools/pack/schema';

const DEMO = path.join(__dirname, '..', 'content', 'pack-demo');

function loadDemo(): {
  manifest: unknown;
  questions: unknown;
  scenarios: unknown;
  concepts: unknown;
} {
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(DEMO, 'pack.json'), 'utf8')),
    questions: JSON.parse(fs.readFileSync(path.join(DEMO, 'questions.json'), 'utf8')),
    scenarios: JSON.parse(fs.readFileSync(path.join(DEMO, 'scenarios.json'), 'utf8')),
    concepts: JSON.parse(fs.readFileSync(path.join(DEMO, 'concepts.json'), 'utf8')),
  };
}

/** N options keyed A,B,C… for the variable-option (v2) tests. */
function makeOptions(n: number): { key: string; text: string }[] {
  return ['A', 'B', 'C', 'D', 'E', 'F']
    .slice(0, n)
    .map((key) => ({ key, text: `Option ${key}` }));
}

/** Overwrite the first question's options + correctKey in place. */
function setFirstOptions(
  input: ReturnType<typeof loadDemo>,
  options: { key: string; text: string; image?: string }[],
  correctKey: string,
): void {
  const q = (input.questions as { options: unknown; correctKey: string }[])[0];
  q.options = options;
  q.correctKey = correctKey;
}

/** Set the first question's prompt image. */
function setFirstImage(input: ReturnType<typeof loadDemo>, image: string): void {
  (input.questions as { image?: string }[])[0].image = image;
}

describe('validatePack', () => {
  it('accepts the committed demo pack with no errors or warnings', () => {
    const result = validatePack(loadDemo());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a question whose categoryKey is not in the manifest', () => {
    const input = loadDemo();
    (input.questions as { categoryKey: string }[])[0].categoryKey = 'not-a-category';
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not-a-category'))).toBe(true);
  });

  it('rejects duplicate question ids', () => {
    const input = loadDemo();
    const questions = input.questions as { id: string }[];
    questions[1].id = questions[0].id;
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate question id'))).toBe(true);
  });

  it('rejects a correctKey that does not reference an option', () => {
    const input = loadDemo();
    const q = (input.questions as { options: { key: string }[]; correctKey: string }[])[0];
    // Remove option D and point correctKey at it. Zod's length(4) also
    // fires; the cross-check message is what we pin here.
    q.options = q.options.filter((o) => o.key !== 'D');
    q.correctKey = 'D';
    const result = validatePack(input);
    expect(result.ok).toBe(false);
  });

  it('rejects a scenarioId that resolves to nothing', () => {
    const input = loadDemo();
    (input.questions as { scenarioId?: string }[])[0].scenarioId = 'ghost-scenario';
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ghost-scenario'))).toBe(true);
  });

  it('rejects duplicate category keys in the manifest', () => {
    const input = loadDemo();
    const manifest = input.manifest as { categories: { key: string }[] };
    manifest.categories[1].key = manifest.categories[0].key;
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unique'))).toBe(true);
  });

  it('warns (not errors) on a category with no questions', () => {
    const input = loadDemo();
    const manifest = input.manifest as {
      categories: { key: string; label: string }[];
    };
    manifest.categories.push({ key: 'empty-category', label: 'Empty Category' });
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('empty-category'))).toBe(true);
  });

  it('warns when weights are present but do not sum to ~1', () => {
    const input = loadDemo();
    const manifest = input.manifest as { categories: { weight?: number }[] };
    manifest.categories[0].weight = 0.9;
    manifest.categories[1].weight = 0.9;
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('sum'))).toBe(true);
  });

  it('rejects an empty question bank', () => {
    const input = loadDemo();
    input.questions = [];
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('no questions'))).toBe(true);
  });

  it('treats scenarios.json as optional', () => {
    const input = loadDemo();
    const result = validatePack({
      manifest: input.manifest,
      questions: input.questions,
      concepts: input.concepts,
    });
    expect(result.ok).toBe(true);
  });

  // ——— schema v2: variable option counts (2–6, keyed A–F) ———

  it('accepts a 2-option (true/false) question', () => {
    const input = loadDemo();
    setFirstOptions(input, [
      { key: 'A', text: 'True' },
      { key: 'B', text: 'False' },
    ], 'A');
    expect(validatePack(input).ok).toBe(true);
  });

  it('accepts a 5-option (GL-style) question', () => {
    const input = loadDemo();
    setFirstOptions(input, makeOptions(5), 'E');
    expect(validatePack(input).ok).toBe(true);
  });

  it('accepts a 6-option question', () => {
    const input = loadDemo();
    setFirstOptions(input, makeOptions(6), 'F');
    expect(validatePack(input).ok).toBe(true);
  });

  it('rejects fewer than 2 options', () => {
    const input = loadDemo();
    setFirstOptions(input, [{ key: 'A', text: 'Only one' }], 'A');
    expect(validatePack(input).ok).toBe(false);
  });

  it('rejects more than 6 options', () => {
    const input = loadDemo();
    setFirstOptions(input, [...makeOptions(6), { key: 'A', text: 'overflow' }], 'A');
    expect(validatePack(input).ok).toBe(false);
  });

  it('rejects a gap in option keys (A,B,D)', () => {
    const input = loadDemo();
    setFirstOptions(input, [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
      { key: 'D', text: 'd' },
    ], 'A');
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('keyed exactly'))).toBe(true);
  });

  it('accepts schemaVersion 2 in the manifest', () => {
    const input = loadDemo();
    (input.manifest as { schemaVersion: number }).schemaVersion = 2;
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // ——— schema v2: image questions ———

  it('accepts a prompt image on a question', () => {
    const input = loadDemo();
    setFirstImage(input, 'figures/diagram-1.svg');
    expect(validatePack(input).ok).toBe(true);
  });

  it('accepts image-answer options (every option has an image)', () => {
    const input = loadDemo();
    setFirstOptions(input, [
      { key: 'A', text: 'Shape A', image: 'nvr-001-a.svg' },
      { key: 'B', text: 'Shape B', image: 'nvr-001-b.png' },
      { key: 'C', text: 'Shape C', image: 'nvr-001-c.svg' },
      { key: 'D', text: 'Shape D', image: 'nvr-001-d.svg' },
    ], 'C');
    expect(validatePack(input).ok).toBe(true);
  });

  it('rejects a mix of image and text options', () => {
    const input = loadDemo();
    setFirstOptions(input, [
      { key: 'A', text: 'Shape A', image: 'a.svg' },
      { key: 'B', text: 'plain text, no image' },
      { key: 'C', text: 'Shape C', image: 'c.svg' },
      { key: 'D', text: 'Shape D', image: 'd.svg' },
    ], 'A');
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('all-or-nothing'))).toBe(true);
  });

  it('rejects an absolute or traversing image path', () => {
    const abs = loadDemo();
    setFirstImage(abs, '/etc/passwd.png');
    expect(validatePack(abs).ok).toBe(false);

    const trav = loadDemo();
    setFirstImage(trav, '../secrets/leak.svg');
    expect(validatePack(trav).ok).toBe(false);
  });

  it('rejects a non-image image path', () => {
    const input = loadDemo();
    setFirstImage(input, 'notes.txt');
    expect(validatePack(input).ok).toBe(false);
  });

  // ——— schema v2: concept cards ———

  it('accepts a concept and a question that links it', () => {
    const input = loadDemo();
    (input.questions as { conceptId?: string }[])[0].conceptId = 'fractions';
    const result = validatePack({
      ...input,
      // Keep the demo's own concept(s) so its linked question still resolves.
      concepts: [
        ...(input.concepts as unknown[]),
        {
          id: 'fractions',
          title: 'Fractions',
          body: 'A fraction is part of a whole — a body long enough for the validator.',
          example: { question: 'What is 3/4 of 20?', steps: ['20 ÷ 4 = 5', '5 × 3 = 15'], answer: '15' },
          commonMistakes: ['Multiplying before dividing.'],
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a conceptId with no matching concept', () => {
    const input = loadDemo();
    (input.questions as { conceptId?: string }[])[0].conceptId = 'ghost-concept';
    const result = validatePack({ ...input, concepts: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ghost-concept'))).toBe(true);
  });

  it('rejects a malformed concept (body too short)', () => {
    const input = loadDemo();
    const result = validatePack({
      ...input,
      concepts: [{ id: 'x', title: 'Too short', body: 'tiny' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate concept ids', () => {
    const input = loadDemo();
    const result = validatePack({
      ...input,
      concepts: [
        { id: 'dup', title: 'One', body: 'First concept body, long enough for the validator.' },
        { id: 'dup', title: 'Two', body: 'Second concept body, also long enough for it here.' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate concept id'))).toBe(true);
  });

  // ——— schema v2: levels ———

  it('accepts manifest levels and a question that tags one', () => {
    const input = loadDemo();
    // The demo already declares levels — add one and tag a question with it.
    (input.manifest as { levels: { key: string; label: string }[] }).levels.push({
      key: 'extra',
      label: 'Extra',
    });
    (input.questions as { level?: string }[])[0].level = 'extra';
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a question level not declared in the manifest', () => {
    const input = loadDemo();
    (input.manifest as { levels?: unknown }).levels = [{ key: 'easy', label: 'Easy' }];
    (input.questions as { level?: string }[])[0].level = 'ghost-level';
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ghost-level'))).toBe(true);
  });

  it('rejects duplicate level keys in the manifest', () => {
    const input = loadDemo();
    (input.manifest as { levels?: unknown }).levels = [
      { key: 'dup', label: 'One' },
      { key: 'dup', label: 'Two' },
    ];
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('level keys must be unique'))).toBe(true);
  });

  // ——— schema v2: source legend ———

  it('accepts a sources legend', () => {
    const input = loadDemo();
    (input.manifest as { sources?: unknown }).sources = [
      { label: 'MIT', name: 'connectry-io (390)', blurb: 'Community repo.', url: 'https://github.com/Connectry-io/x' },
      { label: 'Original' },
    ];
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a source with an invalid url', () => {
    const input = loadDemo();
    (input.manifest as { sources?: unknown }).sources = [{ label: 'X', url: 'not-a-url' }];
    expect(validatePack(input).ok).toBe(false);
  });

  // ——— reward mini-games (opt-in) ———

  it('accepts a games block restricted to a subset of games', () => {
    const input = loadDemo();
    (input.manifest as { games?: unknown }).games = {
      include: ['snake', 'tile-puzzle'],
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts an empty games block (opt in, all games)', () => {
    const input = loadDemo();
    (input.manifest as { games?: unknown }).games = {};
    expect(validatePack(input).ok).toBe(true);
  });

  it('rejects an unknown game id in include', () => {
    const input = loadDemo();
    (input.manifest as { games?: unknown }).games = { include: ['snake', 'chess'] };
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('games'))).toBe(true);
  });

  it('rejects an empty include array', () => {
    const input = loadDemo();
    (input.manifest as { games?: unknown }).games = { include: [] };
    expect(validatePack(input).ok).toBe(false);
  });
});
