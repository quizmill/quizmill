import { describe, expect, it } from 'vitest';
import {
  attemptHistory,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  feedbackSecondsSince,
  filterByLevel,
  formatKeyList,
  gradeSelection,
  isBankFullySeen,
  moveToNext,
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
    questionShownAt: 0,
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

describe('buildAttempt analytics fields', () => {
  const state: RunnerState = {
    sessionId: 'sess',
    questions: [],
    currentIndex: 2,
    correctCount: 0,
    startedAt: 0,
    questionShownAt: 10_000,
  };

  it('measures timeTakenSeconds from when the question appeared', () => {
    const a = buildAttempt({
      state,
      question: q('t'),
      selected: ['A'],
      categoryKey: 'c',
      now: 17_400, // 7.4s later
      attemptId: 'att',
    });
    expect(a.timeTakenSeconds).toBe(7);
  });

  it('clamps the measurement to [0, 3600] (clock skew / parked tab)', () => {
    const at = (now: number) =>
      buildAttempt({ state, question: q('t'), selected: ['A'], categoryKey: 'c', now, attemptId: 'x' })
        .timeTakenSeconds;
    expect(at(9_000)).toBe(0); // now before shownAt → 0, never negative
    expect(at(10_000 + 100_000_000)).toBe(3600);
  });

  it('lets an explicit timeTakenSeconds override the measurement (drive mode)', () => {
    const a = buildAttempt({
      state,
      question: q('t'),
      selected: ['A'],
      categoryKey: 'c',
      now: 17_400,
      attemptId: 'att',
      timeTakenSeconds: 42,
    });
    expect(a.timeTakenSeconds).toBe(42);
  });

  it('records position (1-based), mode and firstSelected when given', () => {
    const a = buildAttempt({
      state,
      question: q('t'),
      selected: ['A'],
      categoryKey: 'c',
      now: 11_000,
      attemptId: 'att',
      mode: 'review',
      firstSelected: 'B',
    });
    expect(a.position).toBe(3);
    expect(a.mode).toBe('review');
    expect(a.firstSelected).toBe('B');
  });

  it('omits the optional fields when not provided — same shape legacy consumers read', () => {
    const a = buildAttempt({
      state,
      question: q('t'),
      selected: ['A'],
      categoryKey: 'c',
      now: 11_000,
      attemptId: 'att',
    });
    expect('firstSelected' in a).toBe(false);
    expect('mode' in a).toBe(false);
    expect('scenarioId' in a).toBe(false);
    expect('appBuild' in a).toBe(false); // NEXT_PUBLIC_APP_BUILD unset in tests
  });

  it('carries the scenarioId when the question sat under a scenario', () => {
    const a = buildAttempt({
      state,
      question: { ...q('t'), scenarioId: 'sc1' },
      selected: ['A'],
      categoryKey: 'c',
      now: 11_000,
      attemptId: 'att',
    });
    expect(a.scenarioId).toBe('sc1');
  });
});

describe('question timing helpers', () => {
  it('moveToNext advances the index AND restamps questionShownAt', () => {
    const s0: RunnerState = {
      sessionId: 's',
      questions: [q('a'), q('b')],
      currentIndex: 0,
      correctCount: 0,
      startedAt: 0,
      questionShownAt: 0,
    };
    const s1 = moveToNext(s0, 5_000);
    expect(s1.currentIndex).toBe(1);
    expect(s1.questionShownAt).toBe(5_000);
  });

  it('feedbackSecondsSince rounds and clamps like the answer timer', () => {
    expect(feedbackSecondsSince(1_000, 4_400)).toBe(3);
    expect(feedbackSecondsSince(1_000, 500)).toBe(0);
    expect(feedbackSecondsSince(0, 100_000_000)).toBe(3600);
  });
});

describe('session modes', () => {
  const state: RunnerState = {
    sessionId: 's',
    questions: [q('a')],
    currentIndex: 0,
    correctCount: 1,
    startedAt: 100,
    questionShownAt: 100,
  };

  it('accepts the newer drive/notes modes on start and end records', () => {
    expect(buildSessionStart(state, 'drive', 'drive').mode).toBe('drive');
    expect(buildSessionEnd(state, 'c', 200, 'notes').mode).toBe('notes');
  });

  it('defaults to practice and omits appBuild/device fields outside a build/browser', () => {
    const start = buildSessionStart(state, 'c');
    expect(start.mode).toBe('practice');
    expect('appBuild' in start).toBe(false);
    expect('display' in start).toBe(false);
    expect('platform' in start).toBe(false);
  });
});

describe('attemptHistory', () => {
  const attempts = [
    { questionId: 'a', subject: 'c', answeredAt: 100, isCorrect: false },
    { questionId: 'a', subject: 'c', answeredAt: 200, isCorrect: true },
    { questionId: 'b', subject: 'other', answeredAt: 150, isCorrect: false },
  ];

  it('keeps only the latest attempt per question', () => {
    const history = attemptHistory(attempts);
    expect(history.get('a')).toEqual({ lastAnsweredAt: 200, lastCorrect: true });
    expect(history.get('b')).toEqual({ lastAnsweredAt: 150, lastCorrect: false });
  });

  it('filters to one category when a key is given', () => {
    const history = attemptHistory(attempts, 'c');
    expect(history.has('a')).toBe(true);
    expect(history.has('b')).toBe(false);
  });
});

describe('isBankFullySeen', () => {
  const bank = [q('a'), q('b')];

  it('is true only when every bank question has been attempted', () => {
    const full = attemptHistory([
      { questionId: 'a', subject: 'c', answeredAt: 1, isCorrect: true },
      { questionId: 'b', subject: 'c', answeredAt: 2, isCorrect: false },
    ]);
    const partial = attemptHistory([
      { questionId: 'a', subject: 'c', answeredAt: 1, isCorrect: true },
    ]);
    expect(isBankFullySeen(bank, full)).toBe(true);
    expect(isBankFullySeen(bank, partial)).toBe(false);
  });

  it('is false for an empty bank', () => {
    expect(isBankFullySeen([], new Map())).toBe(false);
  });
});
