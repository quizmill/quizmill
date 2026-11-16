/**
 * The two git facts every build stamp needs — the latest release tag and
 * the HEAD commit — read in ONE place for next.config.ts (the visible
 * version + build tag), finalise-build.ts (the SW cache key) and the pack
 * bundler (the `engineVersion` a bundle records).
 *
 * Versions live in git tags (vX.Y.Z), not package.json — releases are
 * tag-only (see release.yml) — so the package.json `0.0.0-dev` sentinel is
 * the last-ditch fallback, outside a git checkout or before any tag.
 */
import { execFileSync } from 'node:child_process';
import pkg from '../package.json';

function git(args: string[], cwd?: string): string | undefined {
  try {
    const out = execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/** `X.Y.Z` from the latest vX.Y.Z tag reachable from HEAD; undefined
 *  outside a git checkout or before any release tag. */
export function latestReleaseVersion(cwd?: string): string | undefined {
  return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], cwd)?.replace(/^v/, '');
}

/** Short SHA of HEAD; undefined outside a git checkout. */
export function gitShortSha(cwd?: string): string | undefined {
  return git(['rev-parse', '--short', 'HEAD'], cwd);
}

/** The visible app version: NEXT_PUBLIC_APP_VERSION when the caller set
 *  it (the CLI stamps its own version), else the latest release tag, else
 *  the package.json sentinel. */
export function appVersion(cwd?: string): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || latestReleaseVersion(cwd) || pkg.version;
}

/** A Next.js build id that is the same for the same engine commit and the
 *  same pack build (NEXT_PUBLIC_APP_BUILD), instead of Next's random one.
 *  The id names a directory under `_next/static/` that every page and the
 *  service worker's precache list refer to, so a random id made each
 *  rebuild of unchanged sources a different app: a new `sw.js`, and an
 *  update banner for nothing on every daily pack rebuild. Null outside a
 *  git checkout, where nothing identifies the sources: Next then falls
 *  back to its random id. */
export function stableBuildId(cwd?: string): string | null {
  const sha = gitShortSha(cwd);
  if (!sha) return null;
  return [appVersion(cwd), sha, process.env.NEXT_PUBLIC_APP_BUILD]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9._-]/g, '_');
}

/** When this build was made, as an ISO timestamp — the "last updated" a
 *  learner reads next to the version in Settings. The moment of the build
 *  (not a commit date: a pack repo's deploy builds a months-old engine
 *  with fresh content, and it's the deploy the learner cares about), so
 *  it works outside a git checkout too. NEXT_PUBLIC_APP_BUILD_DATE pins
 *  it; so does SOURCE_DATE_EPOCH, the reproducible-builds convention.
 *  deploy-pack.yml pins it to when the pack or the engine last changed, so
 *  a rebuild of unchanged sources is byte-identical and a learner's "last
 *  updated" does not move on a rebuild that changed nothing.
 *  An unparseable override is ignored rather than stamped. */
export function buildDate(): string {
  const pinned = process.env.NEXT_PUBLIC_APP_BUILD_DATE;
  if (pinned && !Number.isNaN(Date.parse(pinned))) return new Date(pinned).toISOString();
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  if (process.env.SOURCE_DATE_EPOCH && Number.isFinite(epoch)) {
    return new Date(epoch * 1000).toISOString();
  }
  return new Date().toISOString();
}
