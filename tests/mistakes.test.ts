import { describe, expect, it } from 'vitest';
import {
  pickSimilarQuestion,
  unresolvedMistakeIds,
  unresolvedMistakes,
} from '../src/lib/mistakes';
import type { Attempt } from '../src/data/types';

function att(
  questionId: string,
  isCorrect: boolean,
  answeredAt: number,
  over: Partial<Attempt> = {},
): Attempt {
  return {
    id: `a-${questionId}-${answeredAt}`,
    sessionId: 's',
    questionId,
    answeredAt,
    selectedAnswer: '',
    isCorrect,
    timeTakenSeconds: 2,
    subject: 'maths',
    topic: 'fractions',
    difficulty: 2,
    ...over,
  };
}

describe('unresolvedMistakeIds (topic-based rescue)', () => {
  it('returns nothing for an empty log', () => {
    expect(unresolvedMistakeIds([])).toEqual([]);
  });

  it('returns nothing when every attempt was correct', () => {
    expect(
      unresolvedMistakeIds([att('q1', true, 100), att('q2', true, 200)]),
    ).toEqual([]);
  });

  it('returns a question whose only attempt was wrong', () => {
    expect(unresolvedMistakeIds([att('q1', false, 100)])).toEqual(['q1']);
  });

  it('rescues a question when the same question is later answered correctly', () => {
    expect(
      unresolvedMistakeIds([att('q1', false, 100), att('q1', true, 200)]),
    ).toEqual([]);
  });

  it('rescues a question when a DIFFERENT same-topic question is answered correctly', () => {
    // q1 (maths:fractions) wrong → q2 (maths:fractions, different question) right.
    // Topic-based rescue: getting the concept right rescues the original.
    expect(
      unresolvedMistakeIds([
        att('q1', false, 100),
        att('q2', true, 200),
      ]),
    ).toEqual([]);
  });

  it('does NOT rescue across different topics', () => {
    // q1 (maths:fractions) wrong → q2 (maths:percentages) right. Different
    // topic, so q1 remains unresolved.
    expect(
      unresolvedMistakeIds([
        att('q1', false, 100, { topic: 'fractions' }),
        att('q2', true, 200, { topic: 'percentages' }),
      ]),
    ).toEqual(['q1']);
  });

  it('does NOT rescue across different subjects (same topic name)', () => {
    // Different subjects with coincidentally same topic name should NOT
    // rescue each other.
    expect(
      unresolvedMistakeIds([
        att('q1', false, 100, { subject: 'maths', topic: 'sequences' }),
        att('q2', true, 200, { subject: 'verbal', topic: 'sequences' }),
      ]),
    ).toEqual(['q1']);
  });

  it('re-includes a question that was rescued then got wrong again', () => {
    expect(
      unresolvedMistakeIds([
        att('q1', false, 100),
        att('q1', true, 200), // rescued here
        att('q1', false, 300), // wrong again
      ]),
    ).toEqual(['q1']);
  });

  it('does not rescue a later wrong with an earlier correct', () => {
    // q1 right (long ago), q2 wrong (recently). q2 should NOT be rescued by
    // the earlier correct.
    expect(
      unresolvedMistakeIds([
        att('q1', true, 100),
        att('q2', false, 200),
      ]),
    ).toEqual(['q2']);
  });

  it('returns IDs sorted oldest-mistake first (spaced-repetition order)', () => {
    // The review queue surfaces mistakes made longer ago before recent
    // ones, so a stale mistake is not buried under today's slip-ups.
    // Use different topics so no rescue interference.
    expect(
      unresolvedMistakeIds([
        att('q1', false, 300, { topic: 't1' }),
        att('q2', false, 100, { topic: 't2' }),
        att('q3', false, 200, { topic: 't3' }),
      ]),
    ).toEqual(['q2', 'q3', 'q1']);
  });

  it('handles a mixed log across multiple topics + subjects', () => {
    const out = unresolvedMistakeIds([
      att('m1', false, 100, { subject: 'maths', topic: 'fractions' }),
      att('m2', true, 200, { subject: 'maths', topic: 'percentages' }),
      att('m3', false, 300, { subject: 'maths', topic: 'percentages' }),
      att('e1', false, 400, { subject: 'english', topic: 'spelling' }),
      // Rescues m1 (same topic as m1 — maths:fractions)
      att('m4', true, 500, { subject: 'maths', topic: 'fractions' }),
    ]);
    // m1 rescued at t=500. m3 NOT rescued (no later correct on
    // maths:percentages after t=300). e1 NOT rescued.
    expect(out.sort()).toEqual(['e1', 'm3'].sort());
  });
});

describe('unresolvedMistakes (enriched with attempt data)', () => {
  it('returns the kid\'s most recent wrong attempt for each unresolved question', () => {
    const out = unresolvedMistakes([
      att('q1', false, 100, { selectedAnswer: 'first guess' }),
      att('q1', false, 300, { selectedAnswer: 'second guess' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].questionId).toBe('q1');
    expect(out[0].wrongAttempt.selectedAnswer).toBe('second guess');
    expect(out[0].wrongAttempt.answeredAt).toBe(300);
  });

  it('excludes rescued questions just like unresolvedMistakeIds does', () => {
    const out = unresolvedMistakes([
      att('q1', false, 100),
      att('q2', true, 200), // rescues q1 (same default topic)
    ]);
    expect(out).toHaveLength(0);
  });

  it('returns items sorted most-recent-mistake first', () => {
    const out = unresolvedMistakes([
      att('q1', false, 300, { topic: 't1' }),
      att('q2', false, 100, { topic: 't2' }),
      att('q3', false, 200, { topic: 't3' }),
    ]);
    expect(out.map((x) => x.questionId)).toEqual(['q1', 'q3', 'q2']);
  });
});

describe('pickSimilarQuestion', () => {
  const bank = [
    { id: 'q1', subject: 'maths', topic: 'fractions' },
    { id: 'q2', subject: 'maths', topic: 'fractions' },
    { id: 'q3', subject: 'maths', topic: 'fractions' },
    { id: 'q4', subject: 'maths', topic: 'percentages' },
    { id: 'q5', subject: 'english', topic: 'fractions' }, // wrong subject
  ];

  it('returns a different question on the same subject + topic', () => {
    const seq = [0]; // deterministic — picks index 0 of candidates
    const rng = () => seq.shift() ?? 0;
    // Candidates for q1: q2, q3 (subject=maths AND topic=fractions AND id!=q1).
    // q5 excluded (different subject), q4 excluded (different topic).
    const out = pickSimilarQuestion('q1', bank, new Set(), rng);
    expect(out?.id).toBe('q2');
  });

  it('returns null when there are no other same-topic questions', () => {
    // Only q4 is on maths:percentages.
    expect(pickSimilarQuestion('q4', bank)).toBeNull();
  });

  it('returns null when the original ID is not in the bank', () => {
    expect(pickSimilarQuestion('missing', bank)).toBeNull();
  });

  it('respects the exclude set', () => {
    // q1 + exclude q2 + exclude q3 → no candidates left.
    expect(
      pickSimilarQuestion('q1', bank, new Set(['q2', 'q3'])),
    ).toBeNull();
  });

  it('does not return the original even if it slips into the bank twice', () => {
    const out = pickSimilarQuestion('q1', bank);
    expect(out?.id).not.toBe('q1');
  });
});
