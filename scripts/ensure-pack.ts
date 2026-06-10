/**
 * Make sure `content/pack/` exists before any build / dev / test run.
 *
 * The active pack directory is gitignored (packs are private), but the
 * `pack` variant — and therefore `src/config/index.ts`, which every
 * variant imports — statically imports its JSON files. A fresh clone
 * would fail to compile without them, so this script seeds the
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

function main(): void {
  if (fs.existsSync(path.join(TARGET, 'pack.json'))) {
    // Active pack present. Backfill scenarios.json if a hand-rolled
    // pack omitted it (static import needs the file to exist), and
    // regenerate the PWA assets in case they were cleaned.
    const scenarios = path.join(TARGET, 'scenarios.json');
    if (!fs.existsSync(scenarios)) fs.writeFileSync(scenarios, '[]\n');
    ensurePwaAssets();
    return;
  }

  fs.mkdirSync(TARGET, { recursive: true });
  for (const name of ['pack.json', 'questions.json', 'scenarios.json']) {
    const src = path.join(DEMO, name);
    const dst = path.join(TARGET, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    else if (name === 'scenarios.json') fs.writeFileSync(dst, '[]\n');
  }
  const demoAssets = path.join(DEMO, 'assets');
  if (fs.existsSync(demoAssets)) {
    fs.cpSync(demoAssets, path.join(TARGET, 'assets'), { recursive: true });
  }
  ensurePwaAssets();
  console.log('[ensure-pack] seeded content/pack/ from the demo pack');
}

main();
