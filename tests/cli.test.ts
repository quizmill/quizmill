import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePack } from '../tools/pack/schema';

// The npm `quizmill` CLI (cli/bin/quizmill.js) is a zero-dependency
// wrapper; the commands pinned here are the ones that run WITHOUT an
// engine checkout (no git clone, no network): `new`, `--version`, `help`
// and the unknown-command path.

const CLI = path.join(__dirname, '..', 'cli', 'bin', 'quizmill.js');

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-cli-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: tmp, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('quizmill new', () => {
  it('scaffolds a pack whose id is the directory name and that validates clean', () => {
    const r = cli('new', 'My Topic');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('✓ scaffolded My Topic/');

    const dir = path.join(tmp, 'My Topic');
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const manifest = read('pack.json');
    const questions = read('questions.json');
    expect(manifest.id).toBe('my-topic');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.categories).toEqual([{ key: 'basics', label: 'Basics' }]);
    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe('my-topic-basics-001');
    expect(read('scenarios.json')).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toContain(
      'npx quizmill validate my-topic',
    );

    const result = validatePack({ manifest, questions, scenarios: read('scenarios.json') });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('defaults the directory to my-pack', () => {
    expect(cli('new').status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'my-pack', 'pack.json'), 'utf8')).id).toBe(
      'my-pack',
    );
  });

  it('refuses to overwrite an existing directory', () => {
    fs.mkdirSync(path.join(tmp, 'taken'));
    const r = cli('new', 'taken');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('already exists');
  });
});

describe('quizmill (no engine needed)', () => {
  it('prints the CLI version (the dev sentinel in this checkout)', () => {
    const r = cli('--version');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0.0.0-dev');
  });

  it('prints help with no command', () => {
    const r = cli();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('quizmill new [dir]');
  });

  it('exits 1 on an unknown command', () => {
    const r = cli('frobnicate');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown command "frobnicate"');
  });
});
