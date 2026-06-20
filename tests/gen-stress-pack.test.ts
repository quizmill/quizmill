import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validatePack } from '../tools/pack/schema';

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'content', 'pack-stress');

/**
 * The stress pack is only a review aid, but it still has to be a valid
 * pack — the PR-preview workflow activates it through `pack:use`, which
 * refuses anything `validatePack` rejects. Generate a small one and
 * assert it passes the same gate.
 */
describe('gen-stress-pack', () => {
  it('produces a schema-valid pack', () => {
    execFileSync('npx', ['tsx', 'scripts/gen-stress-pack.ts'], {
      cwd: ROOT,
      env: { ...process.env, STRESS_COUNT: '120' },
      stdio: 'ignore',
    });

    const read = (f: string) =>
      JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    const questions = read('questions.json');

    expect(questions.length).toBe(120);
    const result = validatePack({
      manifest: read('pack.json'),
      questions,
      scenarios: read('scenarios.json'),
      concepts: read('concepts.json'),
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is deterministic across runs', () => {
    const gen = () => {
      execFileSync('npx', ['tsx', 'scripts/gen-stress-pack.ts'], {
        cwd: ROOT,
        env: { ...process.env, STRESS_COUNT: '50' },
        stdio: 'ignore',
      });
      return fs.readFileSync(path.join(OUT, 'questions.json'), 'utf8');
    };
    expect(gen()).toBe(gen());
  });
});
