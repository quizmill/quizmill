import { describe, expect, it } from 'vitest';
import { filterByLevel } from '@/pack/runner';
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
