import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appVersion, gitShortSha, latestReleaseVersion } from '../scripts/app-version';

// One reader for the facts next.config.ts, finalise-build.ts and the pack
// bundler all stamp into their output — pinned here so the three callers
// can share it without any of them drifting.

const saved = process.env.NEXT_PUBLIC_APP_VERSION;
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
  else process.env.NEXT_PUBLIC_APP_VERSION = saved;
});

describe('app-version', () => {
  it('reads the latest vX.Y.Z tag and the short SHA from this checkout', () => {
    expect(latestReleaseVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(gitShortSha()).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('returns undefined for both outside a git checkout', () => {
    // A temp dir is never inside a repo (tmpfs / per-user tmp).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-nogit-'));
    try {
      expect(latestReleaseVersion(dir)).toBeUndefined();
      expect(gitShortSha(dir)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets NEXT_PUBLIC_APP_VERSION override the tag (the CLI stamps its own)', () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '9.9.9';
    expect(appVersion()).toBe('9.9.9');
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    expect(appVersion()).toBe(latestReleaseVersion());
  });
});
