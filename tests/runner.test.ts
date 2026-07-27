import { describe, expect, it } from 'vitest';
import {
  buildAttempt,
  filterByLevel,
  formatKeyList,
  gradeSelection,
  nextSelection,
  type RunnerState,
} from '@/pack/runner';
import type { OptionKey, PackQuestion } from '@/pack/data';

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

/** A four-option question with a multi-answer key (A and C correct). */
function multiQ(): PackQuestion {
  return {
    id: 'multi',
    categoryKey: 'c',
    difficulty: 3,
    prompt: 'Which of these apply?',
    options: [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
      { key: 'C', text: 'c' },
      { key: 'D', text: 'd' },
    ],
    correctKeys: ['A', 'C'],
    explanation: 'x'.repeat(40),
    source: 'generated',
    reviewStatus: 'draft',
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

describe('gradeSelection', () => {
  it('grades a single-answer question by the one correct key', () => {
    const single = q('s');
    expect(gradeSelection(single, ['A'])).toBe(true);
    expect(gradeSelection(single, ['B'])).toBe(false);
    // An empty selection is never correct.
    expect(gradeSelection(single, [])).toBe(false);
  });

  it('is correct only when the multi-answer set matches exactly', () => {
    const m = multiQ();
    expect(gradeSelection(m, ['A', 'C'])).toBe(true);
    // Order does not matter.
    expect(gradeSelection(m, ['C', 'A'])).toBe(true);
  });

  it('is wrong when a correct key is missing (no partial credit)', () => {
    expect(gradeSelection(multiQ(), ['A'])).toBe(false);
  });

  it('is wrong when an incorrect key is also selected', () => {
    expect(gradeSelection(multiQ(), ['A', 'C', 'D'])).toBe(false);
  });
});

describe('nextSelection', () => {
  it('replaces the selection in single-answer mode', () => {
    expect(nextSelection([], 'A', false)).toEqual(['A']);
    expect(nextSelection(['A'], 'B', false)).toEqual(['B']);
  });

  it('adds keys in multi-answer mode', () => {
    expect(nextSelection([], 'A', true)).toEqual(['A']);
    expect(nextSelection(['A'], 'B', true)).toEqual(['A', 'B']);
  });

  it('toggles a key off when re-tapped in multi-answer mode', () => {
    expect(nextSelection(['A', 'B'], 'A', true)).toEqual(['B']);
  });
});

describe('formatKeyList', () => {
  it('renders one, two, and three keys naturally', () => {
    expect(formatKeyList(['A'])).toBe('A');
    expect(formatKeyList(['A', 'B'])).toBe('A and B');
    expect(formatKeyList(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('buildAttempt', () => {
  const state: RunnerState = {
    sessionId: 'sess',
    questions: [],
    currentIndex: 0,
    correctCount: 0,
    startedAt: 0,
  };
  function attemptFor(question: PackQuestion, selected: OptionKey[]) {
    return buildAttempt({
      state,
      question,
      selected,
      categoryKey: 'c',
      now: 123,
      attemptId: 'att',
    });
  }

  it('joins a multi-answer selection into a sorted, comma-separated string', () => {
    const a = attemptFor(multiQ(), ['C', 'A']);
    expect(a.selectedAnswer).toBe('A,C');
    expect(a.isCorrect).toBe(true);
  });

  it('keeps a single-answer selectedAnswer as the bare key', () => {
    const a = attemptFor(q('s'), ['A']);
    expect(a.selectedAnswer).toBe('A');
    expect(a.isCorrect).toBe(true);
  });

  it('marks an incomplete multi-answer selection incorrect', () => {
    expect(attemptFor(multiQ(), ['A']).isCorrect).toBe(false);
  });
});
