import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tagNamesLevel, validatePack } from '../tools/pack/schema';

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
  options: { key: string; text: string; image?: string; explanation?: string }[],
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

  // ——— multi-answer questions (correctKeys) ———

  it('accepts a question with correctKeys and no correctKey', () => {
    const input = loadDemo();
    const q = (input.questions as Record<string, unknown>[])[0];
    q.options = makeOptions(4);
    delete q.correctKey;
    q.correctKeys = ['A', 'C'];
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a question with both correctKey and correctKeys', () => {
    const input = loadDemo();
    const q = (input.questions as Record<string, unknown>[])[0];
    q.options = makeOptions(4);
    q.correctKey = 'A';
    q.correctKeys = ['A', 'C'];
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('correctKey'))).toBe(true);
  });

  it('rejects a question with neither correctKey nor correctKeys', () => {
    const input = loadDemo();
    const q = (input.questions as Record<string, unknown>[])[0];
    q.options = makeOptions(4);
    delete q.correctKey;
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('correctKey'))).toBe(true);
  });

  it('rejects correctKeys that reference an option not present', () => {
    const input = loadDemo();
    const q = (input.questions as Record<string, unknown>[])[0];
    q.options = makeOptions(3); // A,B,C
    delete q.correctKey;
    q.correctKeys = ['A', 'D']; // D is not an option
    const result = validatePack(input);
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate key in correctKeys', () => {
    const input = loadDemo();
    const q = (input.questions as Record<string, unknown>[])[0];
    q.options = makeOptions(4);
    delete q.correctKey;
    q.correctKeys = ['A', 'A'];
    const result = validatePack(input);
    expect(result.ok).toBe(false);
  });

  it('rejects correctKeys with fewer than 2 entries (use correctKey instead)', () => {
    const input = loadDemo();
    const q = (input.questions as Record<string, unknown>[])[0];
    q.options = makeOptions(4);
    delete q.correctKey;
    q.correctKeys = ['A'];
    const result = validatePack(input);
    expect(result.ok).toBe(false);
  });

  it('accepts schemaVersion 2 in the manifest', () => {
    const input = loadDemo();
    (input.manifest as { schemaVersion: number }).schemaVersion = 2;
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // The format is v2 only: a manifest that still says 1 is an authoring
  // slip to fix (set it to 2), not a compatibility mode. Nothing else
  // about the pack has to change — a 4-option A–D bank is v2 too.
  it('rejects schemaVersion 1 and points at 2', () => {
    const input = loadDemo();
    (input.manifest as { schemaVersion: number }).schemaVersion = 1;
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    const issue = result.errors.find((e) => e.startsWith('pack.json: schemaVersion:'));
    expect(issue).toBeDefined();
    expect(issue).toContain('2');
  });

  it('rejects a manifest with no schemaVersion', () => {
    const input = loadDemo();
    delete (input.manifest as { schemaVersion?: number }).schemaVersion;
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('pack.json: schemaVersion:'))).toBe(true);
  });

  it('rejects any other schemaVersion (3, a string)', () => {
    for (const bad of [3, '2']) {
      const input = loadDemo();
      (input.manifest as { schemaVersion: unknown }).schemaVersion = bad;
      const result = validatePack(input);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.startsWith('pack.json: schemaVersion:'))).toBe(true);
    }
  });

  // ——— optional modes block (pack defaults for Drive/Coach/Paper) ———

  it('the demo pack switches every opt-in mode on by default', () => {
    const { manifest } = loadDemo();
    expect((manifest as { modes?: unknown }).modes).toEqual({
      drive: true,
      coach: true,
      paper: true,
    });
  });

  it('rejects a non-boolean mode default', () => {
    const input = loadDemo();
    (input.manifest as { modes: unknown }).modes = { coach: 'yes' };
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('pack.json: modes.coach'))).toBe(true);
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

  // ——— per-option explanations (optional, additive) ———

  it('accepts an optional explanation on individual options', () => {
    const input = loadDemo();
    setFirstOptions(input, [
      { key: 'A', text: 'Venus', explanation: 'Second from the Sun, not first.' },
      { key: 'B', text: 'Mercury', explanation: 'The innermost planet.' },
      { key: 'C', text: 'Mars' },
      { key: 'D', text: 'Earth' },
    ], 'B');
    const result = validatePack(input);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty or over-long option explanation', () => {
    const empty = loadDemo();
    setFirstOptions(empty, [
      { key: 'A', text: 'Venus', explanation: '' },
      { key: 'B', text: 'Mercury' },
      { key: 'C', text: 'Mars' },
      { key: 'D', text: 'Earth' },
    ], 'B');
    expect(validatePack(empty).ok).toBe(false);

    const long = loadDemo();
    setFirstOptions(long, [
      { key: 'A', text: 'Venus', explanation: 'x'.repeat(301) },
      { key: 'B', text: 'Mercury' },
      { key: 'C', text: 'Mars' },
      { key: 'D', text: 'Earth' },
    ], 'B');
    expect(validatePack(long).ok).toBe(false);
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

  // ——— schema v2: papers (named, unordered sets — #194) ———

  /** The demo's committed papers, replaced by `papers` for the test. */
  function setPapers(input: ReturnType<typeof loadDemo>, papers: unknown): void {
    (input.manifest as { papers?: unknown }).papers = papers;
    for (const q of input.questions as { paperId?: string }[]) delete q.paperId;
  }

  function setPaper(input: ReturnType<typeof loadDemo>, index: number, paperId: string): void {
    (input.questions as { paperId?: string }[])[index].paperId = paperId;
  }

  it('the demo pack declares papers and tags questions with them (the showcase)', () => {
    const input = loadDemo();
    const manifest = input.manifest as { papers?: { key: string }[] };
    expect(manifest.papers?.length).toBeGreaterThan(0);
    const tagged = (input.questions as { paperId?: string }[]).filter((q) => q.paperId);
    expect(tagged.length).toBeGreaterThan(0);
  });

  it('accepts manifest papers and questions that belong to one', () => {
    const input = loadDemo();
    setPapers(input, [
      { key: 'series-a-paper-1', label: 'Series A · Paper 1', series: 'Series A', categoryKey: 'planets' },
      { key: 'mock-1', label: 'Practice exam 1' },
    ]);
    setPaper(input, 0, 'series-a-paper-1');
    setPaper(input, 1, 'series-a-paper-1');
    // A paper with no categoryKey may span categories (an exam mock) —
    // move an exploration question next to a planets one to prove it.
    const questions = input.questions as { categoryKey: string }[];
    const [explore] = questions.splice(11, 1); // demo-explore-001
    questions.splice(3, 0, explore);
    setPaper(input, 2, 'mock-1');
    setPaper(input, 3, 'mock-1');
    const result = validatePack(input);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects a paperId not declared in the manifest', () => {
    const input = loadDemo();
    setPapers(input, [{ key: 'p1', label: 'Paper 1' }]);
    setPaper(input, 0, 'ghost-paper');
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ghost-paper'))).toBe(true);
  });

  it('rejects a paperId when the manifest declares no papers at all', () => {
    const input = loadDemo();
    setPapers(input, undefined);
    setPaper(input, 0, 'p1');
    expect(validatePack(input).ok).toBe(false);
  });

  it('rejects duplicate paper keys in the manifest', () => {
    const input = loadDemo();
    setPapers(input, [
      { key: 'dup', label: 'One' },
      { key: 'dup', label: 'Two' },
    ]);
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('paper keys must be unique'))).toBe(true);
  });

  it('rejects a paper categoryKey that is not a manifest category', () => {
    const input = loadDemo();
    setPapers(input, [{ key: 'p1', label: 'Paper 1', categoryKey: 'not-a-category' }]);
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not-a-category'))).toBe(true);
  });

  it("rejects a question in a paper whose categoryKey differs from the paper's", () => {
    const input = loadDemo();
    setPapers(input, [{ key: 'p1', label: 'Paper 1', categoryKey: 'planets' }]);
    setPaper(input, 11, 'p1'); // demo-explore-001 is space-exploration
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes('demo-explore-001') && e.includes('planets')),
    ).toBe(true);
  });

  it('warns (not errors) on a paper with no questions', () => {
    const input = loadDemo();
    setPapers(input, [{ key: 'empty-paper', label: 'Paper 9' }]);
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('empty-paper'))).toBe(true);
  });

  it("warns when a paper's questions are not contiguous in bank order", () => {
    // The in-order print sheet and numbering follow bank order, so a paper
    // scattered through questions.json prints in a different order than
    // the original booklet.
    const input = loadDemo();
    setPapers(input, [{ key: 'p1', label: 'Paper 1' }]);
    setPaper(input, 0, 'p1');
    setPaper(input, 2, 'p1');
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('p1') && w.includes('contiguous'))).toBe(true);
  });

  it('rejects a malformed paper (bad key, empty label) and an over-long papers list', () => {
    const badKey = loadDemo();
    setPapers(badKey, [{ key: 'Not A Slug', label: 'Paper 1' }]);
    expect(validatePack(badKey).ok).toBe(false);

    const noLabel = loadDemo();
    setPapers(noLabel, [{ key: 'p1', label: '' }]);
    expect(validatePack(noLabel).ok).toBe(false);

    const tooMany = loadDemo();
    setPapers(
      tooMany,
      Array.from({ length: 101 }, (_, i) => ({ key: `p${i}`, label: `Paper ${i}` })),
    );
    expect(validatePack(tooMany).ok).toBe(false);
  });

  it('accepts a papersLabel naming the axis', () => {
    const input = loadDemo();
    (input.manifest as { papersLabel?: string }).papersLabel = 'Practice exams';
    expect(validatePack(input).ok).toBe(true);
  });

  it('keeps levels capped at 8 — papers are the axis for many named sets', () => {
    const input = loadDemo();
    (input.manifest as { levels?: unknown }).levels = Array.from({ length: 9 }, (_, i) => ({
      key: `l${i}`,
      label: `Level ${i}`,
    }));
    expect(validatePack(input).ok).toBe(false);
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

  // ——— XP/levels progression (opt-in) ———

  it('accepts an empty progression block (presence enables)', () => {
    const input = loadDemo();
    (input.manifest as { progression?: unknown }).progression = {};
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a manifest without progression (opt-in, absent is fine)', () => {
    const input = loadDemo();
    delete (input.manifest as { progression?: unknown }).progression;
    expect(validatePack(input).ok).toBe(true);
  });

  it('rejects a non-object progression block', () => {
    const input = loadDemo();
    (input.manifest as { progression?: unknown }).progression = true;
    expect(validatePack(input).ok).toBe(false);
  });

  // ——— upgrade card (opt-in, pack-generic) ———

  it('accepts a full upgrade block', () => {
    const input = loadDemo();
    (input.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
      price: '£15',
      blurb: '600 more questions, every exam domain, and mock papers.',
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a minimal upgrade block (title + url)', () => {
    const input = loadDemo();
    (input.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an upgrade url that is not https', () => {
    const http = loadDemo();
    (http.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'http://example.com/course',
    };
    const result = validatePack(http);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('upgrade.url') && e.includes('https'))).toBe(true);

    const junk = loadDemo();
    (junk.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'javascript:alert(1)',
    };
    expect(validatePack(junk).ok).toBe(false);
  });

  it('rejects an upgrade block missing its title or url', () => {
    const noTitle = loadDemo();
    (noTitle.manifest as { upgrade?: unknown }).upgrade = { url: 'https://example.com' };
    expect(validatePack(noTitle).ok).toBe(false);

    const noUrl = loadDemo();
    (noUrl.manifest as { upgrade?: unknown }).upgrade = { title: 'Get the full course' };
    expect(validatePack(noUrl).ok).toBe(false);
  });

  // ——— licence unlock (upgrade.packId + upgrade.unlockUrl) ———

  it('accepts an upgrade block naming the pack a licence key unlocks and its endpoint', () => {
    const input = loadDemo();
    (input.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
      packId: 'solar-system-full',
      unlockUrl: 'https://unlock.example.com',
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an unlockUrl that is not https', () => {
    const input = loadDemo();
    (input.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
      packId: 'solar-system-full',
      unlockUrl: 'http://unlock.example.com',
    };
    const result = validatePack(input);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes('upgrade.unlockUrl') && e.includes('https')),
    ).toBe(true);
  });

  it('accepts an unlockUrl on its own, and a packId on its own — each is an independent hint', () => {
    const urlOnly = loadDemo();
    (urlOnly.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
      unlockUrl: 'https://unlock.example.com',
    };
    expect(validatePack(urlOnly).ok).toBe(true);

    const idOnly = loadDemo();
    (idOnly.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
      packId: 'solar-system-full',
    };
    expect(validatePack(idOnly).ok).toBe(true);
  });

  it('rejects an upgrade packId that is not a slug or is the pack itself', () => {
    const notSlug = loadDemo();
    (notSlug.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
      packId: 'Not A Slug',
    };
    expect(validatePack(notSlug).ok).toBe(false);

    const self = loadDemo();
    (self.manifest as { upgrade?: unknown }).upgrade = {
      title: 'Get the full course',
      url: 'https://example.com/course',
      packId: (self.manifest as { id: string }).id,
    };
    const result = validatePack(self);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('upgrade.packId'))).toBe(true);
  });

  // ——— timed exam (exam.durationMinutes, opt-in) ———

  it('accepts exam.durationMinutes alongside questionCount', () => {
    const input = loadDemo();
    (input.manifest as { exam: Record<string, unknown> }).exam = {
      passPct: 70,
      questionCount: 20,
      durationMinutes: 30,
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects a zero, negative or fractional durationMinutes', () => {
    for (const bad of [0, -5, 12.5, '30']) {
      const input = loadDemo();
      (input.manifest as { exam: Record<string, unknown> }).exam = {
        passPct: 70,
        questionCount: 20,
        durationMinutes: bad,
      };
      const result = validatePack(input);
      expect(result.ok, `durationMinutes ${String(bad)}`).toBe(false);
      expect(result.errors.some((e) => e.includes('durationMinutes'))).toBe(true);
    }
  });

  it('warns when durationMinutes is set without questionCount', () => {
    const input = loadDemo();
    (input.manifest as { exam: Record<string, unknown> }).exam = {
      passPct: 70,
      durationMinutes: 30,
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('questionCount'))).toBe(true);
  });

  it('warns when the hardest level (the timed sitting source) has no questions', () => {
    const input = loadDemo();
    (input.manifest as { levels: { key: string; label: string }[] }).levels.push({
      key: 'expert',
      label: 'Expert',
    });
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('"expert"') && w.includes('timed'))).toBe(
      true,
    );
  });

  it('uses exam.scope.level, not the last level, as the sitting source', () => {
    const input = loadDemo();
    (input.manifest as { levels: { key: string; label: string }[] }).levels.push({
      key: 'expert',
      label: 'Expert',
    });
    (input.manifest as { exam: Record<string, unknown> }).exam = {
      passPct: 70,
      questionCount: 20,
      durationMinutes: 30,
      scope: { level: 'advanced' },
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('timed'))).toBe(false);
  });

  it('keeps the demo pack free of an upgrade block', () => {
    const input = loadDemo();
    expect((input.manifest as { upgrade?: unknown }).upgrade).toBeUndefined();
  });

  // The demo pack itself carries generatedFrom examples (demo-planets-012/013),
  // so the "accepts the committed demo pack" test covers the happy path.
  it('accepts a dangling generatedFrom reference (soft — original may be culled)', () => {
    const input = loadDemo();
    (input.questions as { generatedFrom?: unknown }[])[0].generatedFrom = {
      questionId: 'question-that-left-the-pack',
      note: 'more like this please',
    };
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a malformed generatedFrom (empty note / missing questionId)', () => {
    const empty = loadDemo();
    (empty.questions as { generatedFrom?: unknown }[])[0].generatedFrom = {
      questionId: 'demo-planets-001',
      note: '',
    };
    expect(validatePack(empty).ok).toBe(false);

    const missing = loadDemo();
    (missing.questions as { generatedFrom?: unknown }[])[0].generatedFrom = {
      note: 'no origin id',
    };
    expect(validatePack(missing).ok).toBe(false);
  });
});

describe('tags that repeat the level (#238)', () => {
  const veryHard = { key: 'veryhard', label: 'Very hard' };

  it('matches a tag on the level key or label, normalised', () => {
    for (const tag of ['veryhard', 'very-hard', 'Very hard', 'VERY_HARD']) {
      expect(tagNamesLevel(tag, veryHard)).toBe(true);
    }
    expect(tagNamesLevel('hard', veryHard)).toBe(false);
    expect(tagNamesLevel('domain-3', veryHard)).toBe(false);
    expect(tagNamesLevel('Exam prep', { key: 'exam', label: 'Exam prep' })).toBe(true);
  });

  it('warns (not errors) with the count and the first few ids', () => {
    const input = loadDemo();
    const questions = input.questions as { id: string; level?: string; tags?: string[] }[];
    const leveled = questions.filter((q) => q.level);
    for (const q of leveled.slice(0, 5)) q.tags = [...(q.tags ?? []), q.level!.toUpperCase()];
    const result = validatePack(input);
    expect(result.ok).toBe(true);
    const warning = result.warnings.filter((w) => w.includes('repeat their level'));
    expect(warning).toHaveLength(1);
    expect(warning[0]).toContain('5 questions');
    expect(warning[0]).toContain(leveled[0].id);
    expect(warning[0]).not.toContain(leveled[4].id);
  });

  it('leaves a tag naming some other level alone', () => {
    const input = loadDemo();
    const questions = input.questions as { level?: string; tags?: string[] }[];
    questions.find((q) => q.level === 'basics')!.tags = ['advanced'];
    expect(validatePack(input).warnings).toEqual([]);
  });
});
