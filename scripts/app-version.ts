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
