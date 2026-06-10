import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';
import pkg from './package.json';

// Cloudflare Pages serves at the domain root, so the default base path is
// empty. (Set NEXT_PUBLIC_BASE_PATH to a sub-path only if hosting under one.)
const repoBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const isProd = process.env.NODE_ENV === 'production';
const effectiveBasePath = isProd ? repoBasePath : '';

/** Visible app version: package.json verbatim. Bumped by the release
 *  workflow on PR merge — label release:major/release:minor for the
 *  bigger bumps, unlabeled merges are patches (see release.yml). */
const semver = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version;

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
    // Cloud sync (optional). Empty when no Supabase project is configured —
    // the sync layer stays dormant and the app runs pure-local.
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  },
};

export default nextConfig;
