import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validatePack } from '../tools/pack/schema';

const DEMO = path.join(__dirname, '..', 'content', 'pack-demo');

function loadDemo(): { manifest: unknown; questions: unknown; scenarios: unknown } {
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(DEMO, 'pack.json'), 'utf8')),
    questions: JSON.parse(fs.readFileSync(path.join(DEMO, 'questions.json'), 'utf8')),
    scenarios: JSON.parse(fs.readFileSync(path.join(DEMO, 'scenarios.json'), 'utf8')),
  };
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
    });
    expect(result.ok).toBe(true);
  });
});
