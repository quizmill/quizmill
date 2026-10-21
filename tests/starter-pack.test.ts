import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validatePack, type PackManifest, type PackQuestion } from '../tools/pack/schema';
import { readPackDir } from '../tools/pack/validate';
import { STARTER_PACK_ID, isStarterPack } from '@/pack/starter';

// The home app (app.quizmill.dev) is built from the starter pack, not the
// solar-system demo: a fresh install should say what the app is and how a
// pack gets in, and still have something to practise — a few questions
// about using quizmill itself. The demo pack stays the schema-v2 showcase
// for tests, E2E and the website, so the starter is deliberately plain:
// no images, no games, no exam, no progression, no upgrade pitch.

const ROOT = path.join(__dirname, '..');
const START = path.join(ROOT, 'content', 'pack-start');
const DEMO = path.join(ROOT, 'content', 'pack-demo');

const start = readPackDir(START);
const manifest = start.manifest as PackManifest;
const questions = start.questions as PackQuestion[];

describe('the starter pack', () => {
  it('validates with no errors and no warnings', () => {
    expect(validatePack(start)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('is the pack the engine recognises as the starter; the demo is not', () => {
    expect(manifest.id).toBe(STARTER_PACK_ID);
    expect(isStarterPack(manifest.id)).toBe(true);
    const demo = readPackDir(DEMO).manifest as PackManifest;
    expect(isStarterPack(demo.id)).toBe(false);
  });

  it('names the app, not a subject', () => {
    expect(manifest.title).toBe('quizmill');
    expect(manifest.homeSubtitle).toMatch(/insert|unlock|registry/i);
  });

  it('is deliberately plain — no images, games, exam, progression or upgrade', () => {
    expect(manifest.games).toBeUndefined();
    expect(manifest.exam).toBeUndefined();
    expect(manifest.progression).toBeUndefined();
    expect(manifest.upgrade).toBeUndefined();
    expect(manifest.look).toBeUndefined();
    for (const q of questions) {
      expect(q.image, q.id).toBeUndefined();
      for (const o of q.options) expect(o.image, `${q.id} ${o.key}`).toBeUndefined();
    }
  });

  it('has a handful of questions about using the app, each explained', () => {
    expect(questions.length).toBeGreaterThanOrEqual(10);
    expect(questions.length).toBeLessThanOrEqual(15);
    for (const q of questions) {
      expect(q.id, q.id).toMatch(/^start-/);
      expect(q.explanation.length, q.id).toBeGreaterThanOrEqual(80);
      expect(q.reviewStatus, q.id).toBe('approved');
    }
    // The answer letter is spread, not always the same slot.
    const letters = new Set(questions.map((q) => q.correctKey));
    expect(letters.size).toBeGreaterThanOrEqual(3);
  });

  it('ships the mill-wheel mark as its app icon', () => {
    const icon = fs.readFileSync(path.join(START, 'assets', 'icon.svg'), 'utf8');
    expect(icon).toContain('<svg');
    // The golden paddle — the turn of the wheel — same mark as the footer.
    expect(icon).toContain('#b45309');
  });
});

describe('deploy-apps builds the home app from the starter pack', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-apps.yml'), 'utf8');
  const app = yml.match(/- name: app\n([\s\S]*?)(?:\n\s+- name:|\n\s+steps:)/)?.[1] ?? '';

  it('the app matrix entry points at content/pack-start and its output dir', () => {
    expect(app).toContain('pack: content/pack-start');
    expect(app).toContain(`app: ${STARTER_PACK_ID}-app`);
    expect(app).not.toContain('pack-demo');
  });
});
