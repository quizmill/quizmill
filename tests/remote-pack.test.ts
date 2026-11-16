import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatPackSpec, locatePackDir, parsePackSpec } from '../scripts/remote-pack';

describe('parsePackSpec', () => {
  it('parses owner/repo shorthand', () => {
    expect(parsePackSpec('quizmill/pack-claude-cert')).toEqual({
      owner: 'quizmill',
      repo: 'pack-claude-cert',
      ref: undefined,
    });
  });

  it('parses an explicit ref after #', () => {
    expect(parsePackSpec('quizmill/pack-claude-cert#v2')).toEqual({
      owner: 'quizmill',
      repo: 'pack-claude-cert',
      ref: 'v2',
    });
  });

  it('parses github: prefix', () => {
    expect(parsePackSpec('github:owner/repo')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses https URLs, with and without .git', () => {
    expect(parsePackSpec('https://github.com/owner/repo')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parsePackSpec('https://github.com/owner/repo.git')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parsePackSpec('https://github.com/owner/repo/')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses /tree/<branch> URLs into a ref', () => {
    expect(
      parsePackSpec('https://github.com/owner/repo/tree/feature/x'),
    ).toEqual({ owner: 'owner', repo: 'repo', ref: 'feature/x' });
  });

  it('parses ssh remotes', () => {
    expect(parsePackSpec('git@github.com:owner/repo.git')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('rejects path-like strings so local dirs win', () => {
    expect(parsePackSpec('./packs/my-topic')).toBeNull();
    expect(parsePackSpec('../elsewhere/pack')).toBeNull();
    expect(parsePackSpec('/abs/path')).toBeNull();
    expect(parsePackSpec('~/packs/x')).toBeNull();
  });

  it('parses a directory inside the repo — for repos that hold several packs', () => {
    expect(parsePackSpec('quizmill/packs-aws/aws-clf')).toEqual({
      owner: 'quizmill',
      repo: 'packs-aws',
      ref: undefined,
      path: 'aws-clf',
    });
    expect(parsePackSpec('github:o/r/packs/deep/one#v2')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'v2',
      path: 'packs/deep/one',
    });
    expect(parsePackSpec('https://github.com/o/r/aws-clf/')).toMatchObject({
      owner: 'o',
      repo: 'r',
      path: 'aws-clf',
    });
  });

  it('parses the /tree/HEAD/<path> URL the registry links to', () => {
    expect(
      parsePackSpec('https://github.com/quizmill/packs-aws/tree/HEAD/aws-clf'),
    ).toEqual({ owner: 'quizmill', repo: 'packs-aws', ref: undefined, path: 'aws-clf' });
    expect(parsePackSpec('https://github.com/o/r/tree/HEAD')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: undefined,
    });
  });

  it('rejects strings that cannot be owner/repo', () => {
    expect(parsePackSpec('just-a-name')).toBeNull();
    expect(parsePackSpec('owner/repo with space')).toBeNull();
    expect(parsePackSpec('')).toBeNull();
  });

  it('rejects a path that could climb out of the download', () => {
    expect(parsePackSpec('o/r/../../etc')).toBeNull();
    expect(parsePackSpec('o/r/a/./b')).toBeNull();
    expect(parsePackSpec('o/r/a//b')).toBeNull();
    expect(parsePackSpec('o/r/has space')).toBeNull();
  });

  it('round-trips through formatPackSpec', () => {
    expect(formatPackSpec(parsePackSpec('o/r#main')!)).toBe('o/r#main');
    expect(formatPackSpec(parsePackSpec('o/r')!)).toBe('o/r');
    expect(formatPackSpec(parsePackSpec('o/r/a/b#main')!)).toBe('o/r/a/b#main');
  });
});

describe('locatePackDir', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A fake download: `packs` are the directories (relative to the repo
   *  root, '' for the root itself) that hold a pack.json. */
  function download(packs: string[]): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-remote-test-'));
    made.push(tmp);
    for (const rel of packs) {
      const dir = path.join(tmp, 'repo-abc123', rel);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pack.json'), '{}');
    }
    return tmp;
  }

  it('finds the pack at the repo root', () => {
    const tmp = download(['']);
    expect(locatePackDir(tmp, { owner: 'o', repo: 'r' })).toBe(path.join(tmp, 'repo-abc123'));
  });

  it('finds the only pack in a subdirectory when no path is given', () => {
    const tmp = download(['pack']);
    expect(locatePackDir(tmp, { owner: 'o', repo: 'r' })).toBe(
      path.join(tmp, 'repo-abc123', 'pack'),
    );
  });

  it('uses the path from the spec, not the first directory', () => {
    const tmp = download(['aws-aif', 'aws-clf', 'aws-saa']);
    expect(locatePackDir(tmp, { owner: 'o', repo: 'r', path: 'aws-clf' })).toBe(
      path.join(tmp, 'repo-abc123', 'aws-clf'),
    );
  });

  it('names the missing directory when the path holds no pack', () => {
    const tmp = download(['aws-aif', 'aws-clf']);
    expect(() => locatePackDir(tmp, { owner: 'o', repo: 'r', path: 'aws-nope' })).toThrow(
      /no pack\.json in aws-nope.*o\/r\/aws-aif.*o\/r\/aws-clf/s,
    );
  });

  it('asks which pack when a repo holds several and no path is given', () => {
    const tmp = download(['aws-aif', 'aws-clf']);
    expect(() => locatePackDir(tmp, { owner: 'o', repo: 'r', ref: 'v2' })).toThrow(
      /holds several packs.*o\/r\/aws-aif#v2.*o\/r\/aws-clf#v2/s,
    );
  });

  it('says so when the download holds no pack at all', () => {
    const tmp = download([]);
    fs.mkdirSync(path.join(tmp, 'repo-abc123'));
    expect(() => locatePackDir(tmp, { owner: 'o', repo: 'r' })).toThrow(/no pack\.json found/);
  });
});
