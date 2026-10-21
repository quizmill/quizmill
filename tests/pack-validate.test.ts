import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { missingPackAssets, referencedImages } from '../tools/pack/validate';
import type { PackQuestion } from '../tools/pack/schema';

// `pack:validate <dir>` is the contract an authoring agent loops against,
// so it has to catch what the APP would trip over — including a question
// whose `image` names a file that isn't in `<dir>/assets/`. `validatePack`
// itself stays pure (it also runs in the browser on insert); the directory
// walk lives in the CLI and reports each missing file as a warning.

const ROOT = path.join(__dirname, '..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const VALIDATE = path.join(ROOT, 'tools', 'pack', 'validate.ts');
const DEMO = path.join(ROOT, 'content', 'pack-demo');

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-validate-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function question(over: Partial<PackQuestion> & { id: string }): PackQuestion {
  return {
    categoryKey: 'a',
    difficulty: 1,
    prompt: 'Which option is the first one?',
    options: [
      { key: 'A', text: 'A' },
      { key: 'B', text: 'B' },
    ],
    correctKey: 'A',
    explanation: 'A is the answer because the prompt says so, plainly.',
    source: 'original',
    reviewStatus: 'draft',
    ...over,
  } as PackQuestion;
}

/** A tiny valid v2 pack in a temp dir whose single question carries
 *  `images` (prompt first, then one per option); `present` names the ones
 *  actually written to assets/. */
function writeMiniPack(images: string[] = [], present: string[] = images): string {
  const dir = path.join(tmp, 'mini');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const write = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  write('pack.json', {
    schemaVersion: 2,
    id: 'mini',
    title: 'Mini Pack',
    description: 'A tiny pack used by the validator unit tests.',
    homeSubtitle: 'Tiny.',
    themeColor: '#123456',
    categories: [{ key: 'a', label: 'Basics' }],
  });
  const [prompt, ...optionImages] = images;
  write('questions.json', [
    question({
      id: 'mini-a-001',
      ...(prompt ? { image: prompt } : {}),
      options: [
        { key: 'A', text: 'A', ...(optionImages[0] ? { image: optionImages[0] } : {}) },
        { key: 'B', text: 'B', ...(optionImages[1] ? { image: optionImages[1] } : {}) },
      ],
    }),
  ]);
  for (const rel of present) {
    const file = path.join(dir, 'assets', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<svg/>');
  }
  return dir;
}

function validate(dir: string) {
  const r = spawnSync(process.execPath, [TSX, VALIDATE, dir], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('referencedImages', () => {
  it('lists prompt and option images once each, in first-seen order, skipping URLs', () => {
    const qs = [
      question({
        id: 'q1',
        image: 'fig-1.svg',
        options: [
          { key: 'A', text: 'A', image: 'a.svg' },
          { key: 'B', text: 'B', image: 'fig-1.svg' },
        ],
      }),
      question({ id: 'q2', image: 'https://example.com/remote.png' }),
      question({ id: 'q3', image: 'a.svg' }),
    ];
    expect(referencedImages(qs)).toEqual(['fig-1.svg', 'a.svg']);
  });
});

describe('missingPackAssets', () => {
  it('is empty when every referenced image is a file under assets/', () => {
    const dir = writeMiniPack(['fig.svg', 'figures/a.png', 'figures/b.png']);
    const questions = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
    expect(missingPackAssets(dir, questions)).toEqual([]);
  });

  it('names each referenced image that is not in assets/', () => {
    const dir = writeMiniPack(['fig.svg', 'a.svg', 'b.svg'], ['a.svg']);
    const questions = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
    expect(missingPackAssets(dir, questions)).toEqual(['fig.svg', 'b.svg']);
  });

  it('treats a directory at the referenced path as missing', () => {
    const dir = writeMiniPack(['fig.svg'], []);
    fs.mkdirSync(path.join(dir, 'assets', 'fig.svg'));
    const questions = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
    expect(missingPackAssets(dir, questions)).toEqual(['fig.svg']);
  });

  it('reports every image when the pack has no assets/ directory at all', () => {
    const dir = writeMiniPack(['fig.svg'], []);
    fs.rmSync(path.join(dir, 'assets'), { recursive: true });
    const questions = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
    expect(missingPackAssets(dir, questions)).toEqual(['fig.svg']);
  });
});

describe('pack:validate CLI', () => {
  it('passes the demo pack with no warnings', () => {
    const r = validate(DEMO);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('✓ valid pack');
  });

  it('passes the home app’s starter pack with no warnings', () => {
    const r = validate(path.join(ROOT, 'content', 'pack-start'));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('✓ valid pack');
  });

  // Warning, not error: packs that validated clean before keep exiting 0.
  it('warns, still exiting 0, about an image that is not in assets/', () => {
    const r = validate(writeMiniPack(['gone.svg', 'here.svg', 'here.svg'], ['here.svg']));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('⚠ assets/gone.svg');
    expect(r.stderr).not.toContain('here.svg');
    expect(r.stdout).toContain('(1 warning(s))');
  });

  it('stays an error when the pack is otherwise invalid', () => {
    const dir = writeMiniPack(['gone.svg'], []);
    fs.writeFileSync(path.join(dir, 'questions.json'), '[]');
    const r = validate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('✗');
  });
});
