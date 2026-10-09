import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUNDLE_FORMAT, buildPackBundle } from '../tools/pack/bundle';
import { readPackDir } from '../tools/pack/validate';
import { parsePackFiles } from '@/lib/packInsert';
import { getInsertedPack, insertPack } from '@/lib/packLibrary';

// `quizmill bundle <dir>` turns a pack directory into ONE .json file the
// /packs importer accepts unchanged — the hand-over format for a pack
// that isn't a git repo (a paid pack, a pack emailed to a parent). The
// pack JSON rides inside verbatim; v2 images are embedded as data URLs so
// the pack renders offline with no assets/ dir to fetch from.

const DEMO = path.join(__dirname, '..', 'content', 'pack-demo');

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-bundle-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/** A tiny valid v2 pack in a temp dir; `image` adds one option image. */
function writeMiniPack(over: { image?: string; assetBytes?: string | null } = {}): string {
  const dir = path.join(tmp, 'mini');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const write = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  write('pack.json', {
    schemaVersion: 2,
    id: 'mini',
    title: 'Mini Pack',
    description: 'A tiny pack used by the bundle unit tests.',
    homeSubtitle: 'Tiny.',
    themeColor: '#123456',
    categories: [{ key: 'a', label: 'Basics' }],
  });
  write('questions.json', [
    {
      id: 'mini-a-001',
      categoryKey: 'a',
      difficulty: 1,
      prompt: 'Which option is the first one?',
      options: [
        { key: 'A', text: 'A', ...(over.image ? { image: over.image } : {}) },
        { key: 'B', text: 'B', ...(over.image ? { image: over.image } : {}) },
      ],
      correctKey: 'A',
      explanation: 'A is the answer because the prompt says so, plainly.',
      source: 'original',
      reviewStatus: 'draft',
    },
  ]);
  if (over.image && over.assetBytes !== null) {
    fs.writeFileSync(path.join(dir, 'assets', over.image), over.assetBytes ?? '<svg/>');
  }
  return dir;
}

describe('buildPackBundle', () => {
  it('carries the demo pack verbatim with its id, schemaVersion and a bundledAt stamp', () => {
    const now = new Date('2026-10-09T01:02:03.000Z');
    const out = buildPackBundle(DEMO, { now });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const demo = readPackDir(DEMO);
    const manifest = demo.manifest as { id: string; schemaVersion: number };
    expect(out.bundle.format).toBe(BUNDLE_FORMAT);
    expect(out.bundle.id).toBe(manifest.id);
    expect(out.bundle.schemaVersion).toBe(manifest.schemaVersion);
    expect(out.bundle.bundledAt).toBe('2026-10-09T01:02:03.000Z');
    expect(out.bundle.manifest).toEqual(demo.manifest);
    expect(out.bundle.questions).toEqual(demo.questions);
    expect(out.bundle.scenarios).toEqual(demo.scenarios);
    expect(out.bundle.concepts).toEqual(demo.concepts);
  });

  it('embeds every referenced image from assets/ as a data URL', () => {
    const out = buildPackBundle(DEMO);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const assets = out.bundle.assets ?? {};
    expect(Object.keys(assets).sort()).toEqual(
      ['jupiter.svg', 'mars.svg', 'neptune.svg', 'saturn.svg'],
    );
    const saturn = assets['saturn.svg'];
    expect(saturn.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const decoded = Buffer.from(saturn.split(',')[1], 'base64');
    expect(decoded.equals(fs.readFileSync(path.join(DEMO, 'assets', 'saturn.svg')))).toBe(true);
  });

  it('omits assets entirely for a pack without images', () => {
    const out = buildPackBundle(writeMiniPack());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.bundle.assets).toBeUndefined();
  });

  it('picks the media type from the file extension', () => {
    const out = buildPackBundle(writeMiniPack({ image: 'pic.PNG', assetBytes: 'x' }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.bundle.assets?.['pic.PNG']).toBe('data:image/png;base64,eA==');
  });

  it('refuses a pack that references an image missing from assets/', () => {
    const out = buildPackBundle(writeMiniPack({ image: 'gone.svg', assetBytes: null }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join('\n')).toContain('assets/gone.svg');
  });

  // A bundle is shared, so what it embeds must come from the pack itself:
  // a symlink in assets/ pointing elsewhere (a stray ~/.ssh/id_ed25519,
  // a file on another drive) would otherwise ride along as "an image".
  it('refuses an asset that is a symlink to a file outside assets/', () => {
    const secret = path.join(tmp, 'secret.svg');
    fs.writeFileSync(secret, '<svg>not yours</svg>');
    const dir = writeMiniPack({ image: 'link.svg', assetBytes: null });
    fs.symlinkSync(secret, path.join(dir, 'assets', 'link.svg'));
    const out = buildPackBundle(dir);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.errors.join('\n')).toContain('assets/link.svg');
      expect(out.errors.join('\n')).toContain('outside');
    }
  });

  it('still embeds a symlink that stays inside assets/', () => {
    const dir = writeMiniPack({ image: 'alias.svg', assetBytes: null });
    fs.writeFileSync(path.join(dir, 'assets', 'real.svg'), '<svg/>');
    fs.symlinkSync('real.svg', path.join(dir, 'assets', 'alias.svg'));
    const out = buildPackBundle(dir);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.bundle.assets?.['alias.svg']).toBe(
        `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      );
    }
  });

  it('refuses an invalid pack with the validator’s own errors', () => {
    const dir = writeMiniPack();
    fs.writeFileSync(path.join(dir, 'questions.json'), '[]');
    const out = buildPackBundle(dir);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.some((e) => e.includes('no questions'))).toBe(true);
  });

  it('reports a missing directory or file instead of throwing', () => {
    const out = buildPackBundle(path.join(tmp, 'nope'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toContain('pack.json');
  });
});

describe('bundle → /packs importer round trip', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: () => true,
    });
  });

  it('inserts the bundled demo pack unchanged, images included', () => {
    const built = buildPackBundle(DEMO);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const text = JSON.stringify(built.bundle);

    const parsed = parsePackFiles([{ name: `${built.bundle.id}.bundle.json`, text }]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const inserted = insertPack(parsed.candidate, {
      origin: 'unit-test',
      buildPackId: 'some-other-pack',
    });
    expect(inserted.ok).toBe(true);

    const demo = readPackDir(DEMO);
    const stored = getInsertedPack(built.bundle.id);
    expect(stored).not.toBeNull();
    expect(stored?.manifest).toEqual(demo.manifest);
    expect(stored?.questions).toEqual(demo.questions);
    expect(stored?.scenarios).toEqual(demo.scenarios);
    expect(stored?.concepts).toEqual(demo.concepts);
    expect(stored?.assets).toEqual(built.bundle.assets);
    // No origin to fetch images from — they're all inside.
    expect(stored?.assetsBase).toBeUndefined();
  });
});
