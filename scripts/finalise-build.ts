/**
 * Post-build step: replace `__BUILD_VERSION__` in out/sw.js with the
 * combined SW cache key `<semver>-<git-sha>`.
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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

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

/** Match next.config.ts: package.json version verbatim (bumped by the
 *  release workflow). The SHA suffix below keeps per-commit busting. */
function appVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || pkg.version;
}

const swPath = 'out/sw.js';
if (!existsSync(swPath)) {
  console.warn(`[finalise-build] ${swPath} not found — skipping`);
  process.exit(0);
}

const semver = appVersion();
const sha = gitSha();
const cacheKey = `${semver}-${sha}`;

const sw = readFileSync(swPath, 'utf8');
const stamped = sw.replaceAll('__BUILD_VERSION__', cacheKey);
if (stamped === sw) {
  console.warn(
    "[finalise-build] no '__BUILD_VERSION__' placeholder in out/sw.js — was the SW updated?",
  );
}
writeFileSync(swPath, stamped);
console.log(`[finalise-build] stamped SW with cache key ${cacheKey} (semver ${semver})`);
