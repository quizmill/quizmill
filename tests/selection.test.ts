import { describe, it, expect } from 'vitest';
import {
  pickSessionQuestions,
  pickNextQuestion,
  seededRng,
  shuffle,
} from '../src/lib/selection';

const bank = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  topic: 'misc',
  difficulty: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
}));

describe('pickSessionQuestions', () => {
  it('returns up to `count` distinct questions', () => {
    const picked = pickSessionQuestions(bank, {
      count: 10,
      historicalAttemptedIds: new Set(),
      currentSessionIds: new Set(),
      rng: seededRng(42),
    });
    expect(picked).toHaveLength(10);
    const ids = picked.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prefers unseen questions over previously attempted ones', () => {
    // Mark IDs 1-15 as historically seen. Only 5 unseen remain.
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const picked = pickSessionQuestions(bank, {
      count: 5,
      historicalAttemptedIds: seen,
      currentSessionIds: new Set(),
      rng: seededRng(42),
    });
    expect(picked).toHaveLength(5);
    for (const q of picked) {
      expect(seen.has(q.id)).toBe(false);
    }
  });

  it('falls back to seen questions when unseen are exhausted', () => {
    const seen = new Set(bank.map((q) => q.id));
    const picked = pickSessionQuestions(bank, {
      count: 5,
      historicalAttemptedIds: seen,
      currentSessionIds: new Set(),
      rng: seededRng(7),
    });
    expect(picked).toHaveLength(5);
  });

  it('never repeats within the same session', () => {
    const picked = pickSessionQuestions(bank, {
      count: 10,
      historicalAttemptedIds: new Set(),
      currentSessionIds: new Set([1, 2, 3, 4, 5]),
      rng: seededRng(1),
    });
    for (const q of picked) {
      expect([1, 2, 3, 4, 5]).not.toContain(q.id);
    }
  });

  it('returns fewer items if the bank is small', () => {
    const small = bank.slice(0, 3);
    const picked = pickSessionQuestions(small, {
      count: 10,
      historicalAttemptedIds: new Set(),
      currentSessionIds: new Set(),
      rng: seededRng(1),
    });
    expect(picked).toHaveLength(3);
  });

  it('is deterministic with the same seed', () => {
    const a = pickSessionQuestions(bank, {
      count: 5,
      historicalAttemptedIds: new Set(),
      currentSessionIds: new Set(),
      rng: seededRng(123),
    });
    const b = pickSessionQuestions(bank, {
      count: 5,
      historicalAttemptedIds: new Set(),
      currentSessionIds: new Set(),
      rng: seededRng(123),
    });
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });
});

describe('pickNextQuestion', () => {
  it('returns null when nothing is available', () => {
    const next = pickNextQuestion([], {
      historicalAttemptedIds: new Set(),
      currentSessionIds: new Set(),
    });
    expect(next).toBeNull();
  });

  it('returns null when every question is in the current session', () => {
    const small = bank.slice(0, 3);
    const next = pickNextQuestion(small, {
      historicalAttemptedIds: new Set(),
      currentSessionIds: new Set([1, 2, 3]),
    });
    expect(next).toBeNull();
  });
});

describe('shuffle', () => {
  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = input.slice();
    shuffle(input, seededRng(1));
    expect(input).toEqual(copy);
  });
  it('preserves the multiset of elements', () => {
    const result = shuffle([1, 2, 3, 4, 5], seededRng(1));
    expect(result.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
