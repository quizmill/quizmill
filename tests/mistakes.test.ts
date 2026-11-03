import { describe, expect, it } from 'vitest';
import {
  missedQuestions,
  sessionMistakeIds,
  unresolvedMistakeIds,
  weakSpots,
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

describe('rescue by question id (migrated attempts)', () => {
  // Attempts migrated from an older engine carry a free-text topic label
  // ("reading comprehension") while every attempt this engine writes uses
  // the question id as topic. A later correct answer to the SAME question
  // must still rescue the old mistake, or it sits at the top of the review
  // queue forever.
  it('unresolvedMistakeIds rescues a wrong attempt whose topic label differs from the later correct one', () => {
    expect(
      unresolvedMistakeIds([
        att('q1', false, 100, { subject: 'english', topic: 'reading comprehension' }),
        att('q1', true, 200, { subject: 'english', topic: 'q1' }),
      ]),
    ).toEqual([]);
  });

  it('does not rescue when the later correct answer is to a different question on a different topic', () => {
    expect(
      unresolvedMistakeIds([
        att('q1', false, 100, { subject: 'english', topic: 'reading comprehension' }),
        att('q2', true, 200, { subject: 'english', topic: 'q2' }),
      ]),
    ).toEqual(['q1']);
  });
});

describe('sessionMistakeIds (review scoped to one session)', () => {
  // Pack attempts carry the question id as topic (per-question rescue).
  const paper = (
    questionId: string,
    isCorrect: boolean,
    position: number,
    over: Partial<Attempt> = {},
  ) =>
    att(questionId, isCorrect, 1000, {
      sessionId: 'sheet',
      topic: questionId,
      position,
      ...over,
    });

  it("returns only that session's mistakes, not the rest of the queue", () => {
    // An older mistake sits at the head of the global queue — reviewing a
    // just-marked sheet must not open on it.
    const attempts = [
      att('old', false, 100, { sessionId: 'earlier', topic: 'old' }),
      paper('p1', true, 1),
      paper('p2', false, 2),
    ];
    expect(unresolvedMistakeIds(attempts)[0]).toBe('old');
    expect(sessionMistakeIds(attempts, 'sheet')).toEqual(['p2']);
  });

  it('keeps the order the questions had on the sheet', () => {
    // Batch marking: Q3 was entered a day before Q1, but the sheet (and
    // the paper in hand) still reads 1 then 3.
    const attempts = [
      paper('p3', false, 3, { answeredAt: 500 }),
      paper('p1', false, 1, { answeredAt: 900 }),
    ];
    expect(sessionMistakeIds(attempts, 'sheet')).toEqual(['p1', 'p3']);
  });

  it('drops mistakes that were rescued since', () => {
    const attempts = [
      paper('p1', false, 1),
      paper('p2', false, 2),
      att('p1', true, 2000, { sessionId: 'review', topic: 'p1' }),
    ];
    expect(sessionMistakeIds(attempts, 'sheet')).toEqual(['p2']);
  });

  it('returns nothing for an unknown session', () => {
    expect(sessionMistakeIds([paper('p1', false, 1)], 'nope')).toEqual([]);
  });
});

describe('weakSpots (cleared after N right answers in a row)', () => {
  // Pack attempts carry the question id as topic.
  const q = (id: string, ok: boolean, t: number) => att(id, ok, t, { topic: id });

  it('keeps a missed question until it is answered right N times in a row', () => {
    const log = [q('q1', false, 100), q('q1', true, 200)];
    expect(weakSpots(log, 2)).toEqual([{ id: 'q1', streak: 1, wrongAt: 100 }]);
    expect(weakSpots([...log, q('q1', true, 300)], 2)).toEqual([]);
  });

  it('a wrong answer resets the streak', () => {
    const log = [
      q('q1', false, 100),
      q('q1', true, 200),
      q('q1', false, 300),
      q('q1', true, 400),
    ];
    expect(weakSpots(log, 2)).toEqual([{ id: 'q1', streak: 1, wrongAt: 300 }]);
  });

  it('N = 1 is the unresolved-mistake queue', () => {
    const log = [
      q('q1', false, 100),
      q('q1', true, 200),
      q('q2', false, 150),
      q('q3', true, 50),
    ];
    expect(weakSpots(log, 1).map((m) => m.id)).toEqual(unresolvedMistakeIds(log));
    expect(weakSpots(log, 1).map((m) => m.id)).toEqual(['q2']);
  });

  it('never lists a question that was never missed', () => {
    expect(weakSpots([q('q1', true, 100), q('q1', true, 200)], 3)).toEqual([]);
  });

  it('a topic rescue by another question counts as the first right answer, never more', () => {
    const log = [
      att('m1', false, 100, { topic: 'fractions' }),
      att('m2', true, 200, { topic: 'fractions' }),
      att('m3', true, 300, { topic: 'fractions' }),
    ];
    expect(weakSpots(log, 1)).toEqual([]);
    expect(weakSpots(log, 2)).toEqual([{ id: 'm1', streak: 1, wrongAt: 100 }]);
  });

  it('a right answer to the question itself after a topic rescue makes two', () => {
    // Regression: the topic credit only showed on the returned row, so the
    // question's own right answer left it at "1 of 2" a second time.
    // Migrated attempts carry a free-text topic; this engine writes the id.
    const log = [
      att('m1', false, 100, { topic: 'fractions' }),
      att('m2', true, 200, { topic: 'fractions' }),
      att('m1', true, 300, { topic: 'm1' }),
    ];
    expect(missedQuestions(log)).toEqual([{ id: 'm1', streak: 2, wrongAt: 100 }]);
    expect(weakSpots(log, 2)).toEqual([]);
  });

  it('missedQuestions keeps cleared ones too, oldest mistake first', () => {
    const log = [q('b', false, 200), q('a', false, 100), q('a', true, 300), q('a', true, 400)];
    expect(missedQuestions(log)).toEqual([
      { id: 'a', streak: 2, wrongAt: 100 },
      { id: 'b', streak: 0, wrongAt: 200 },
    ]);
  });
});
