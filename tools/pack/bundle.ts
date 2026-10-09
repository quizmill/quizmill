/**
 * Learning-pack bundler — one pack directory → ONE .json file.
 *
 *   npm run pack:bundle <pack-dir> [--out file]
 *   npx quizmill bundle <pack-dir> [--out file]
 *
 * A bundle is the hand-over format for a pack that isn't (or shouldn't
 * be) a git repo: a paid pack, a pack emailed to a parent, a pack
 * dropped into a chat. The /packs importer (`src/lib/packInsert.ts`)
 * already accepts any `{ manifest, questions, … }` JSON; this produces
 * one that also carries the pack's `assets/` images INSIDE the file as
 * data URLs, so a v2 pack renders offline with no origin to fetch from.
 *
 * The pack JSON rides inside verbatim — bundling never rewrites a
 * question — and the pack is validated first, so an invalid pack can't
 * be bundled (the same `validatePack` the importer re-runs on insert).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  validatePack,
  type PackManifest,
  type PackQuestion,
} from './schema';
import { readPackDir } from './validate';

export const BUNDLE_FORMAT = 'quizmill-pack-bundle';

/** The on-disk shape of a bundle. `manifest`/`questions`/`scenarios`/
 *  `concepts` are the pack files untouched; everything else is metadata
 *  the importer ignores (it rebuilds the pack from the four content
 *  keys + `assets`). */
export interface PackBundle {
  format: typeof BUNDLE_FORMAT;
  /** Bump when the bundle envelope itself changes shape. */
  bundleVersion: 1;
  /** Mirrors `manifest.schemaVersion`, lifted up so a reader can tell
   *  what it's holding without parsing the manifest. */
  schemaVersion: PackManifest['schemaVersion'];
  /** Mirrors `manifest.id`. */
  id: string;
  /** Best-effort pack revision: the last git commit touching the pack
   *  directory (plus `-dirty` when uncommitted edits exist). Absent
   *  outside a git checkout. */
  packVersion?: string;
  /** The engine release that produced the bundle, when known. */
  engineVersion?: string;
  /** ISO 8601 UTC. */
  bundledAt: string;
  manifest: unknown;
  questions: unknown;
  scenarios?: unknown;
  concepts?: unknown;
  /** Pack-relative image path (exactly as referenced by a question or
   *  option `image`) → `data:image/…;base64,…`. Omitted when the pack
   *  references no images. */
  assets?: Record<string, string>;
}

export type BundleResult =
  | { ok: true; bundle: PackBundle; warnings: string[] }
  | { ok: false; errors: string[] };

const MEDIA_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Browsers cap localStorage around 5 MiB per origin and the importer
 *  stores the bundle wholesale — warn well before a pack can't fit. */
const SIZE_WARN_BYTES = 4 * 1024 * 1024;

/** Every relative image path the bank references, deduped in first-seen
 *  order (absolute URLs — not valid in a pack anyway — are left alone). */
export function referencedImages(questions: PackQuestion[]): string[] {
  const seen = new Set<string>();
  const add = (src: string | undefined) => {
    if (src && !/^https?:\/\//i.test(src)) seen.add(src);
  };
  for (const q of questions) {
    add(q.image);
    for (const o of q.options) add(o.image);
  }
  return [...seen];
}

function dataUrl(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = MEDIA_TYPES[ext] ?? 'application/octet-stream';
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** `<short sha>[-dirty]` of the pack directory's last change, or
 *  undefined when it isn't inside a git checkout. */
function packRevision(dir: string): string | undefined {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  try {
    const sha = git(['log', '-1', '--format=%h', '--', '.']);
    if (!sha) return undefined;
    const dirty = git(['status', '--porcelain', '--', '.']) !== '';
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return undefined;
  }
}

/** The engine release, as the CLI stamps it into builds (it sets
 *  NEXT_PUBLIC_APP_VERSION to its own version); otherwise the latest
 *  release tag of this checkout; otherwise unknown. */
function engineVersion(): string | undefined {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;
  try {
    const tag = execFileSync(
      'git',
      ['-C', __dirname, 'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim();
    return tag ? tag.replace(/^v/, '') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read, validate and bundle the pack at `dir`. Pure apart from reading
 * the directory (and asking git for the revision) — the caller writes
 * the file. `now` is injectable so the stamp is testable.
 */
export function buildPackBundle(
  dir: string,
  opts: { now?: Date } = {},
): BundleResult {
  let input: ReturnType<typeof readPackDir>;
  try {
    input = readPackDir(dir);
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }

  const result = validatePack(input);
  if (!result.ok) return { ok: false, errors: result.errors };
  const warnings = [...result.warnings];

  // Validation passed, so the content is well-typed from here on.
  const manifest = input.manifest as PackManifest;
  const questions = input.questions as PackQuestion[];

  const assets: Record<string, string> = {};
  const missing: string[] = [];
  for (const rel of referencedImages(questions)) {
    const file = path.join(dir, 'assets', rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      missing.push(`assets/${rel}`);
      continue;
    }
    assets[rel] = dataUrl(file);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((m) => `${m}: referenced by a question but not found in ${dir}`),
    };
  }

  const bundle: PackBundle = {
    format: BUNDLE_FORMAT,
    bundleVersion: 1,
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    ...(packRevision(dir) ? { packVersion: packRevision(dir) } : {}),
    ...(engineVersion() ? { engineVersion: engineVersion() } : {}),
    bundledAt: (opts.now ?? new Date()).toISOString(),
    manifest: input.manifest,
    questions: input.questions,
    ...(input.scenarios !== undefined ? { scenarios: input.scenarios } : {}),
    ...(input.concepts !== undefined ? { concepts: input.concepts } : {}),
    ...(Object.keys(assets).length > 0 ? { assets } : {}),
  };

  const bytes = Buffer.byteLength(JSON.stringify(bundle));
  if (bytes > SIZE_WARN_BYTES) {
    warnings.push(
      `bundle is ${(bytes / 1024 / 1024).toFixed(1)} MiB — browsers cap a pack at roughly 5 MiB of storage; shrink the images in assets/ if the app refuses it`,
    );
  }
  return { ok: true, bundle, warnings };
}

function parseArgs(argv: string[]): { dir?: string; out?: string; error?: string } {
  let dir: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') {
      out = argv[++i];
      if (!out) return { error: '--out needs a file path' };
    } else if (a.startsWith('--out=')) {
      out = a.slice('--out='.length);
    } else if (a.startsWith('-')) {
      return { error: `unknown option ${a}` };
    } else if (dir === undefined) {
      dir = a;
    } else {
      return { error: `unexpected argument ${a}` };
    }
  }
  return { dir, out };
}

function main(): void {
  const { dir, out, error } = parseArgs(process.argv.slice(2));
  if (error || !dir) {
    if (error) console.error(`✗ ${error}`);
    console.error('Usage: npm run pack:bundle <pack-dir> [--out file]');
    process.exit(1);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(1);
  }

  const result = buildPackBundle(dir);
  if (!result.ok) {
    for (const e of result.errors) console.error(`✗ ${e}`);
    console.error(`\n${result.errors.length} error(s) in ${dir} — nothing written`);
    process.exit(1);
  }
  for (const w of result.warnings) console.warn(`⚠ ${w}`);

  const { bundle } = result;
  // npm sets INIT_CWD to where `npm run` was typed, so a relative --out
  // (or the default) lands next to the user, not inside the engine.
  const base = process.env.INIT_CWD || process.cwd();
  const target = path.resolve(base, out ?? `${bundle.id}.bundle.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const text = JSON.stringify(bundle) + '\n';
  fs.writeFileSync(target, text);

  const questions = bundle.questions as unknown[];
  const images = Object.keys(bundle.assets ?? {}).length;
  const kib = Math.round(Buffer.byteLength(text) / 1024);
  console.log(
    `✓ bundled "${(bundle.manifest as PackManifest).title}" → ${target}` +
      ` (${questions.length} questions, ${images} image${images === 1 ? '' : 's'}, ${kib} KiB)`,
  );
  console.log('  Insert it in any quizmill app at /packs, or share the file as-is.');
}

// Tests import buildPackBundle — only behave as a CLI when invoked directly.
if (require.main === module) main();
