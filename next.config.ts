import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';
import pkg from './package.json';

// Cloudflare Pages serves at the domain root, so the default base path is
// empty. (Set NEXT_PUBLIC_BASE_PATH to a sub-path only if hosting under one.)
const repoBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const isProd = process.env.NODE_ENV === 'production';
const effectiveBasePath = isProd ? repoBasePath : '';

/** Visible app version: the latest release tag (vX.Y.Z). Versions live
 *  in git tags, not package.json — releases are tag-only so main's
 *  history stays free of bump commits (see release.yml). Falls back to
 *  the package.json sentinel outside a git checkout / before any tag. */
function releasedVersion(): string {
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

const semver = releasedVersion();

/** Per-commit build tag. Changes every push so the user can tell at a
 *  glance whether the iPad has the freshest deploy. Falls back to a
 *  timestamp outside a git checkout. */
function buildTag(): string {
  if (process.env.NEXT_PUBLIC_APP_BUILD) return process.env.NEXT_PUBLIC_APP_BUILD;
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

const nextConfig: NextConfig = {
  output: 'export',
  basePath: effectiveBasePath,
  assetPrefix: effectiveBasePath,
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: effectiveBasePath,
    NEXT_PUBLIC_APP_VERSION: semver,
    NEXT_PUBLIC_APP_BUILD: buildTag(),
    // '1' when this build serves runtime-injected packs (quizmill-cloud's
    // engine) rather than one baked-in pack — defers Home's first paint to
    // the client so the injected pack doesn't clash with the prerender.
    NEXT_PUBLIC_RUNTIME_PACK: process.env.NEXT_PUBLIC_RUNTIME_PACK ?? '',
    // Cloud sync (optional). Two backends — the Cloudflare Worker URL wins
    // when both are set; with neither, the sync layer stays dormant and the
    // app runs pure-local. See src/lib/syncBackend.ts + cloudflare/README.md.
    NEXT_PUBLIC_SYNC_URL: process.env.NEXT_PUBLIC_SYNC_URL ?? '',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  },
};

export default nextConfig;
