import { describe, expect, it } from 'vitest';
import { formatPackSpec, parsePackSpec } from '../scripts/remote-pack';

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

  it('rejects strings that cannot be owner/repo', () => {
    expect(parsePackSpec('just-a-name')).toBeNull();
    expect(parsePackSpec('a/b/c')).toBeNull();
    expect(parsePackSpec('owner/repo with space')).toBeNull();
    expect(parsePackSpec('')).toBeNull();
  });

  it('round-trips through formatPackSpec', () => {
    expect(formatPackSpec(parsePackSpec('o/r#main')!)).toBe('o/r#main');
    expect(formatPackSpec(parsePackSpec('o/r')!)).toBe('o/r');
  });
});
