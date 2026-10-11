/**
 * Make sure `content/pack/` exists before any build / dev / test run.
 *
 * The active pack directory is gitignored (packs are private), but the
 * app statically imports its JSON files (`src/pack/source.ts`). A fresh
 * clone would fail to compile without them, so this script seeds the
 * committed demo pack (`content/pack-demo/`) into place when nothing
 * is active yet. Idempotent: an already-activated pack is left alone.
 *
 * Wired into the `predev` / `prebuild` / `pretest` npm hooks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writePackAssets, syncPackAssets } from './pack-assets';

const ROOT = path.join(__dirname, '..');
const DEMO = path.join(ROOT, 'content', 'pack-demo');
const TARGET = path.join(ROOT, 'content', 'pack');

function ensurePwaAssets(): void {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(TARGET, 'pack.json'), 'utf8'),
  );
  writePackAssets(manifest);
  // Re-mirror the active pack's images on every dev/build run, so a
  // cleaned public/ or a freshly-seeded pack still serves /pack-assets/.
  syncPackAssets(TARGET);
}

/** The pack files the app may do without — but imports statically, so
 *  an empty one is written whenever a pack (demo or hand-rolled) omits it. */
const OPTIONAL_FILES = ['scenarios.json', 'concepts.json'];

function seedDemo(): void {
  fs.mkdirSync(TARGET, { recursive: true });
  for (const name of ['pack.json', 'questions.json', ...OPTIONAL_FILES]) {
    const src = path.join(DEMO, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TARGET, name));
  }
  const demoAssets = path.join(DEMO, 'assets');
  if (fs.existsSync(demoAssets)) {
    fs.cpSync(demoAssets, path.join(TARGET, 'assets'), { recursive: true });
  }
  console.log('[ensure-pack] seeded content/pack/ from the demo pack');
}

function main(): void {
  if (!fs.existsSync(path.join(TARGET, 'pack.json'))) seedDemo();
  for (const name of OPTIONAL_FILES) {
    const p = path.join(TARGET, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, '[]\n');
  }
  // Regenerated on every run, in case public/ was cleaned.
  ensurePwaAssets();
}

main();
