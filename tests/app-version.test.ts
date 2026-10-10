import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pkg from '../package.json';
import { appVersion, gitShortSha, latestReleaseVersion } from '../scripts/app-version';

// One reader for the facts next.config.ts, finalise-build.ts and the pack
// bundler all stamp into their output — pinned here so the three callers
// can share it without any of them drifting.
//
// Hermetic on purpose: CI checks out depth 1, so no release tag is reachable
// from a PR head there and this repo's own tags can't be relied on. Each
// case builds the git state it needs in a temp repo instead.

const tmpDirs: string[] = [];
function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
  )
    .toString()
    .trim();
}

function commit(cwd: string, msg: string): void {
  git(cwd, 'commit', '-q', '--allow-empty', '-m', msg);
}

let tagged: string; // v1.2.3 then one more commit (a typical main)
let untagged: string; // commits but no release tag (a fresh fork, a shallow CI clone)
let noGit: string; // not a repo at all (an npm tarball)

beforeAll(() => {
  tagged = tmpDir('qm-tagged-');
  git(tagged, 'init', '-q');
  commit(tagged, 'first');
  git(tagged, 'tag', 'v1.2.3');
  git(tagged, 'tag', 'not-a-release'); // must be skipped: only vX.Y.Z counts
  commit(tagged, 'after the release');

  untagged = tmpDir('qm-untagged-');
  git(untagged, 'init', '-q');
  commit(untagged, 'first');

  noGit = tmpDir('qm-nogit-');
});

const saved = process.env.NEXT_PUBLIC_APP_VERSION;
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
  else process.env.NEXT_PUBLIC_APP_VERSION = saved;
});
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('app-version', () => {
  it('reads the latest vX.Y.Z tag reachable from HEAD, without the v', () => {
    expect(latestReleaseVersion(tagged)).toBe('1.2.3');
  });

  it('reads the short SHA of HEAD', () => {
    const head = git(tagged, 'rev-parse', 'HEAD');
    const short = gitShortSha(tagged);
    expect(short).toMatch(/^[0-9a-f]{7,}$/);
    expect(head.startsWith(short!)).toBe(true);
  });

  it('has no release version before any vX.Y.Z tag, but still a SHA', () => {
    expect(latestReleaseVersion(untagged)).toBeUndefined();
    expect(gitShortSha(untagged)).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('returns undefined for both outside a git checkout', () => {
    expect(latestReleaseVersion(noGit)).toBeUndefined();
    expect(gitShortSha(noGit)).toBeUndefined();
  });

  it('appVersion: NEXT_PUBLIC_APP_VERSION, else the tag, else the package.json sentinel', () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '9.9.9';
    expect(appVersion(tagged)).toBe('9.9.9');
    expect(appVersion(untagged)).toBe('9.9.9');

    delete process.env.NEXT_PUBLIC_APP_VERSION;
    expect(appVersion(tagged)).toBe('1.2.3');
    expect(appVersion(untagged)).toBe(pkg.version);
    expect(appVersion(noGit)).toBe(pkg.version);
  });
});
