import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The supported Node major is declared ONCE, in .nvmrc, and everything
// else must agree with it: the engines fields (so npm warns on a stray
// local runtime) and every workflow's setup-node step (so CI builds on
// the same major a contributor's version manager picks up). This guard
// exists because the two once drifted silently — CI stayed green on a
// hard-coded 22 while `npm test` on a clean clone failed on anything
// newer — and nothing in the repo said which was right.

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function enginesNode(rel: string): string | undefined {
  const pkg = JSON.parse(read(rel)) as { engines?: { node?: string } };
  return pkg.engines?.node;
}

const nvmrc = read('.nvmrc').trim();

describe('Node version pin', () => {
  it('.nvmrc names a bare major (version managers and setup-node both read it)', () => {
    expect(nvmrc).toMatch(/^\d+$/);
  });

  it('the engine and the CLI require at least that major', () => {
    expect(enginesNode('package.json')).toBe(`>=${nvmrc}`);
    expect(enginesNode('cli/package.json')).toBe(`>=${nvmrc}`);
  });

  it('every workflow sets up the same major', () => {
    const files = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = read(path.join('.github', 'workflows', file));
      const steps = text.match(/uses: actions\/setup-node@[^\n]*\n(?:[ \t]+[^\n]*\n)*/g) ?? [];
      expect(steps.length, `${file} has no setup-node step`).toBeGreaterThan(0);
      for (const step of steps) {
        // Either read the pin from the file (engine checkouts) or repeat
        // the same major literally (reusable workflows run against the
        // CALLER's checkout, which has no .nvmrc to read).
        const fromFile = /node-version-file:\s*\.nvmrc\b/.test(step);
        const literal = step.match(/node-version:\s*['"]?(\d+)/)?.[1];
        expect(
          fromFile || literal === nvmrc,
          `${file}: setup-node pins ${literal ?? '(nothing)'}, expected .nvmrc (${nvmrc})`,
        ).toBe(true);
      }
    }
  });
});
