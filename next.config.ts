import type { NextConfig } from 'next';
import { appVersion, gitShortSha } from './scripts/app-version';

// Cloudflare Pages serves at the domain root, so the default base path is
// empty. (Set NEXT_PUBLIC_BASE_PATH to a sub-path only if hosting under one.)
const repoBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const isProd = process.env.NODE_ENV === 'production';
const effectiveBasePath = isProd ? repoBasePath : '';

/** Visible app version: the latest release tag (vX.Y.Z) — see
 *  scripts/app-version.ts for where it comes from and the fallbacks. */
const semver = appVersion();

/** Per-commit build tag. Changes every push so the user can tell at a
 *  glance whether the iPad has the freshest deploy. Falls back to a
 *  timestamp outside a git checkout. */
function buildTag(): string {
  return process.env.NEXT_PUBLIC_APP_BUILD || gitShortSha() || `t${Date.now()}`;
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
    // Optional explicit backend pick ('http' | 'supabase' | a custom kind)
    // for builds where several are configured.
    NEXT_PUBLIC_SYNC_BACKEND: process.env.NEXT_PUBLIC_SYNC_BACKEND ?? '',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    // Anonymous first-party funnel analytics (optional) — the endpoint a
    // hosted app beacons `{ event, packId, deviceId, appBuild, ts }` to
    // (the sync worker serves one at /v1/analytics), and the privacy page
    // the Settings note links to. Unset → dormant, nothing leaves the
    // device. See src/lib/analytics.ts.
    NEXT_PUBLIC_ANALYTICS_URL: process.env.NEXT_PUBLIC_ANALYTICS_URL ?? '',
    NEXT_PUBLIC_PRIVACY_URL: process.env.NEXT_PUBLIC_PRIVACY_URL ?? '',
  },
};

export default nextConfig;
