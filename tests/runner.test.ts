import { describe, expect, it } from 'vitest';
import { filterByLevel, relatedTopicBank } from '@/pack/runner';
import type { PackQuestion } from '@/pack/data';

function q(id: string, level?: string): PackQuestion {
  return {
    id,
    categoryKey: 'c',
    difficulty: 1,
    prompt: 'a prompt long enough',
    options: [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
    ],
    correctKey: 'A',
    explanation: 'x'.repeat(40),
    source: 'generated',
    reviewStatus: 'draft',
    level,
  };
}

/** Question with explicit topic dimensions, for the related-bank tests. */
function topical(
  id: string,
  opts: { categoryKey?: string; conceptId?: string; tags?: string[] } = {},
): PackQuestion {
  return {
    ...q(id),
    categoryKey: opts.categoryKey ?? 'c',
    conceptId: opts.conceptId,
    tags: opts.tags,
  };
}

describe('filterByLevel', () => {
  const bank = [q('a', 'y4'), q('b', 'y6'), q('c')];

  it('returns the bank unchanged when no level is set (All)', () => {
    expect(filterByLevel(bank, null)).toHaveLength(3);
    expect(filterByLevel(bank, undefined)).toHaveLength(3);
  });

  it('keeps only questions in the chosen level', () => {
    expect(filterByLevel(bank, 'y4').map((x) => x.id)).toEqual(['a']);
  });

  it('is empty when no question is in the level', () => {
    expect(filterByLevel(bank, 'exam')).toEqual([]);
  });
});

describe('relatedTopicBank', () => {
  it('returns nothing when no questions are starred', () => {
    expect(relatedTopicBank([topical('a')], new Set())).toEqual([]);
  });

  it('includes the starred questions themselves', () => {
    const bank = [topical('a', { categoryKey: 'x' }), topical('b', { categoryKey: 'y' })];
    const out = relatedTopicBank(bank, new Set(['a']));
    expect(out.map((x) => x.id)).toContain('a');
  });

  it('pulls in questions sharing the starred category', () => {
    const bank = [
      topical('a', { categoryKey: 'planets' }),
      topical('b', { categoryKey: 'planets' }),
      topical('c', { categoryKey: 'moons' }),
    ];
    const out = relatedTopicBank(bank, new Set(['a']));
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('pulls in questions sharing a concept across categories', () => {
    const bank = [
      topical('a', { categoryKey: 'x', conceptId: 'orbits' }),
      topical('b', { categoryKey: 'y', conceptId: 'orbits' }),
      topical('c', { categoryKey: 'z', conceptId: 'tides' }),
    ];
    const out = relatedTopicBank(bank, new Set(['a']));
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('pulls in questions sharing a tag', () => {
    const bank = [
      topical('a', { categoryKey: 'x', tags: ['gravity'] }),
      topical('b', { categoryKey: 'y', tags: ['gravity', 'mass'] }),
      topical('c', { categoryKey: 'z', tags: ['light'] }),
    ];
    const out = relatedTopicBank(bank, new Set(['a']));
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('preserves source-bank order', () => {
    const bank = [topical('a'), topical('b'), topical('c')];
    expect(relatedTopicBank(bank, new Set(['b'])).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
