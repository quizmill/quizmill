/**
 * Post-build step: stamp out/sw.js —
 *  - `__BUILD_VERSION__` becomes the combined SW cache key
 *    `<semver>-<git-sha>` (plus `-<pack-sha>` when a pack repo's deploy
 *    sets NEXT_PUBLIC_APP_BUILD);
 *  - `__PRECACHE_MANIFEST__` becomes the full file list of the export,
 *    so the SW can precache every route at install (offline navigation
 *    must work for routes never visited online).
 *
 * Why both pieces:
 *  - Semver is the user-visible version (shown in Settings, bumped via
 *    `npm version`).
 *  - The git SHA suffix guarantees the SW cache name changes on EVERY
 *    commit, so a new SW is picked up and the in-app "new version ready"
 *    banner can fire even between explicit version bumps.
 *
 * Runs automatically after `npm run build` via the `postbuild` hook.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

import pkg from '../package.json' with { type: 'json' };

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return `t${Date.now()}`;
  }
}

/** Match next.config.ts: latest release tag (versions live in git
 *  tags, not package.json — releases are tag-only). The SHA suffix
 *  below keeps per-commit busting either way. */
function appVersion(): string {
  if (process.env.NEXT_PUBLIC_APP_VERSION) {
    return process.env.NEXT_PUBLIC_APP_VERSION;
  }
  try {
    const tag = execSync("git describe --tags --abbrev=0 --match 'v[0-9]*'", {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (tag) return tag.replace(/^v/, '');
  } catch {
    // not a git checkout, or no release tag yet
  }
  return pkg.version;
}

/**
 * Every file in the export as a URL relative to the SW (which sits at the
 * export root), so the manifest is valid under any base path. `x/index.html`
 * is listed as the directory URL `./x/` — the form navigations actually
 * request; the root becomes `./`.
 */
function precacheManifest(dir: string): string[] {
  const urls: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(relPath);
      } else if (relPath === 'sw.js') {
        continue; // the browser manages the SW script itself
      } else if (relPath === 'index.html') {
        urls.push('./');
      } else if (relPath.endsWith('/index.html')) {
        urls.push(`./${relPath.slice(0, -'index.html'.length)}`);
      } else {
        urls.push(`./${relPath}`);
      }
    }
  };
  walk('');
  return urls.sort();
}

const swPath = 'out/sw.js';
if (!existsSync(swPath)) {
  console.warn(`[finalise-build] ${swPath} not found — skipping`);
  process.exit(0);
}

const semver = appVersion();
const sha = gitSha();
// A pack repo's deploy sets NEXT_PUBLIC_APP_BUILD to its own commit (the
// visible "Build" tag). Fold it into the cache key so a content-only push
// (engine unchanged → same semver + engine SHA) still changes the SW cache
// name and fires the update banner. Unset for the engine's own builds.
const build = process.env.NEXT_PUBLIC_APP_BUILD;
const cacheKey = build ? `${semver}-${sha}-${build}` : `${semver}-${sha}`;

const sw = readFileSync(swPath, 'utf8');
const manifest = precacheManifest('out');
let stamped = sw.replaceAll('__BUILD_VERSION__', cacheKey);
if (stamped === sw) {
  console.warn(
    "[finalise-build] no '__BUILD_VERSION__' placeholder in out/sw.js — was the SW updated?",
  );
}
// The SW holds the placeholder as a single-quoted string inside
// JSON.parse(...); swap the whole literal for a JS string literal of the
// manifest JSON (double stringify: inner = the JSON, outer = quote it).
const manifestPlaceholder = "'__PRECACHE_MANIFEST__'";
if (!stamped.includes(manifestPlaceholder)) {
  console.warn(
    "[finalise-build] no '__PRECACHE_MANIFEST__' placeholder in out/sw.js — was the SW updated?",
  );
} else {
  stamped = stamped.replace(
    manifestPlaceholder,
    JSON.stringify(JSON.stringify(manifest)),
  );
}
writeFileSync(swPath, stamped);
console.log(
  `[finalise-build] stamped SW with cache key ${cacheKey} (semver ${semver}), ${manifest.length} precached files`,
);
