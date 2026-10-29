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

/** Every `uses: actions/setup-node` step in a workflow, with its indented body. */
function setupNodeSteps(workflow: string): string[] {
  return workflow.match(/uses: actions\/setup-node@[^\n]*\n(?:[ \t]+[^\n]*\n)*/g) ?? [];
}

/** Whether a workflow's own `run:` steps call npm, npx or node (comments ignored). */
function runsNode(workflow: string): boolean {
  const live = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  return /\b(?:npm|npx|node)\b/.test(live.replace(/actions\/setup-node/g, ''));
}

/**
 * What a setup-node step pins: `'.nvmrc'` when it reads the file, the
 * major when it names one literally, `undefined` when neither — a step
 * whose version lines are commented out pins nothing, so comment lines
 * are dropped before matching rather than letting `# node-version: 26`
 * satisfy the guard.
 */
function setupNodePin(step: string): string | undefined {
  const live = step
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  if (/^\s+node-version-file:\s*['"]?\.nvmrc\b/m.test(live)) return '.nvmrc';
  return live.match(/^\s+node-version:\s*['"]?(\d+)/m)?.[1];
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

  it('every workflow that runs Node sets up the same major', () => {
    const files = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const workflow = read(path.join('.github', 'workflows', file));
      // A workflow made only of actions (stale.yml) runs no Node of ours, so it has nothing to pin.
      if (!runsNode(workflow)) continue;
      const steps = setupNodeSteps(workflow);
      expect(steps.length, `${file} runs Node but has no setup-node step`).toBeGreaterThan(0);
      for (const step of steps) {
        // Either read the pin from the file (engine checkouts) or repeat
        // the same major literally (reusable workflows run against the
        // CALLER's checkout, which has no .nvmrc to read).
        const pin = setupNodePin(step);
        expect(
          pin === '.nvmrc' || pin === nvmrc,
          `${file}: setup-node pins ${pin ?? '(nothing)'}, expected .nvmrc (${nvmrc})`,
        ).toBe(true);
      }
    }
  });

  describe('runsNode', () => {
    it('is true for a run step calling npm, npx or node', () => {
      expect(runsNode('    steps:\n      - run: npm ci\n')).toBe(true);
      expect(runsNode('    steps:\n      - run: npx quizmill validate .\n')).toBe(true);
      expect(runsNode('    steps:\n      - run: node scripts/x.mjs\n')).toBe(true);
    });

    it('is false for an actions-only workflow, a commented mention or setup-node alone', () => {
      expect(runsNode('    steps:\n      - uses: actions/stale@v9\n')).toBe(false);
      expect(runsNode('# runs npm nowhere\n    steps:\n      - uses: actions/stale@v9\n')).toBe(false);
      expect(runsNode('    steps:\n      - uses: actions/setup-node@v4\n')).toBe(false);
    });
  });

  describe('setupNodePin', () => {
    const step = (body: string) => `uses: actions/setup-node@v4\n${body}`;

    it('reads a live node-version-file or node-version', () => {
      expect(setupNodePin(step('        with:\n          node-version-file: .nvmrc\n'))).toBe('.nvmrc');
      expect(setupNodePin(step("        with:\n          node-version-file: '.nvmrc'\n"))).toBe('.nvmrc');
      expect(setupNodePin(step('        with:\n          node-version: 26\n'))).toBe('26');
      expect(setupNodePin(step("        with:\n          node-version: '26'\n"))).toBe('26');
    });

    it('ignores commented-out version properties', () => {
      expect(setupNodePin(step('        with:\n          # node-version-file: .nvmrc\n'))).toBeUndefined();
      expect(setupNodePin(step('        # with:\n        #   node-version: 26\n'))).toBeUndefined();
      expect(
        setupNodePin(step('        with:\n          # node-version: 22\n          node-version: 26\n')),
      ).toBe('26');
    });

    it('does not read a version out of a trailing comment or an unrelated key', () => {
      expect(setupNodePin(step('        with:\n          cache: npm # node-version: 26\n'))).toBeUndefined();
      expect(setupNodePin(step('        with:\n          cache: npm\n'))).toBeUndefined();
    });
  });
});
