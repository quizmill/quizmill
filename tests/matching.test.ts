import { describe, expect, it } from 'vitest';
import {
  buildAttempt,
  formatAnswer,
  gradeSelection,
  isAnswerReady,
  matchRowsRight,
  nextSelection,
  type RunnerState,
} from '@/pack/runner';
import {
  answerKeysOf,
  correctKeysOf,
  isMatching,
  isMultiAnswer,
  matchPick,
  matchPicksOf,
  type AnswerKey,
  type PackQuestion,
} from '@/pack/data';
import { answerBoxLabel, buildPaperResult, markStatus } from '@/pack/paper';

// Matching questions (#269): a pick is encoded "row=choice" and rides in
// the same selection array single/multi-answer questions use, so every
// runner, the attempt row and storage carry it unchanged.

const yesNo: PackQuestion = {
  id: 'yn',
  categoryKey: 'c',
  difficulty: 2,
  prompt: 'For each statement, select Yes or No.',
  rows: [
    { key: '1', text: 'one' },
    { key: '2', text: 'two', explanation: 'because' },
    { key: '10', text: 'ten' },
  ],
  choices: [
    { key: 'yes', text: 'Yes' },
    { key: 'no', text: 'No' },
  ],
  correctMatch: { '1': 'yes', '2': 'no', '10': 'yes' },
  explanation: 'x'.repeat(40),
  source: 'original',
  reviewStatus: 'reviewed',
};

const all: AnswerKey[] = ['1=yes', '2=no', '10=yes'];

describe('matching question helpers', () => {
  it('recognises a matching question and its answer keys, in row order', () => {
    expect(isMatching(yesNo)).toBe(true);
    expect(isMultiAnswer(yesNo)).toBe(false);
    expect(answerKeysOf(yesNo)).toEqual(all);
    // No option keys to show for a matching question.
    expect(correctKeysOf(yesNo)).toEqual([]);
    expect(matchPick('2', 'no')).toBe('2=no');
  });

  it('reads picks back per row, ignoring non-match keys', () => {
    expect(matchPicksOf(['1=yes', 'A', '10=no'])).toEqual({ '1': 'yes', '10': 'no' });
  });

  it('replaces a row\'s earlier pick instead of adding a second one', () => {
    let s: AnswerKey[] = [];
    s = nextSelection(s, '1=yes', false);
    s = nextSelection(s, '2=yes', false);
    s = nextSelection(s, '1=no', false);
    expect(s).toEqual(['2=yes', '1=no']);
  });

  it('treats a row key that names an Object.prototype member as unanswered', () => {
    const proto = { rows: [{ key: 'constructor', text: 'c' }, { key: 'other', text: 'o' }] };
    expect(matchPicksOf(['other=yes']).constructor).toBeUndefined();
    expect(isAnswerReady(proto, ['other=yes'])).toBe(false);
    expect(isAnswerReady(proto, ['other=yes', 'constructor=no'])).toBe(true);
  });

  it('is ready only when every row has a pick', () => {
    expect(isAnswerReady(yesNo, ['1=yes', '2=no'])).toBe(false);
    expect(isAnswerReady(yesNo, all)).toBe(true);
    expect(isAnswerReady(yesNo, [])).toBe(false);
  });

  it('grades all-or-nothing: one wrong row makes the question wrong', () => {
    expect(gradeSelection(yesNo, all)).toBe(true);
    expect(gradeSelection(yesNo, ['1=yes', '2=yes', '10=yes'])).toBe(false);
    expect(gradeSelection(yesNo, ['1=yes', '2=no'])).toBe(false);
    expect(matchRowsRight(yesNo, ['1=yes', '2=yes', '10=yes'])).toEqual({ right: 2, total: 3 });
  });

  it('stores the picks on the attempt in row order', () => {
    const state: RunnerState = {
      sessionId: 's',
      questions: [yesNo],
      currentIndex: 0,
      correctCount: 0,
      startedAt: 0,
      questionShownAt: 0,
    };
    const a = buildAttempt({
      state,
      question: yesNo,
      selected: ['10=yes', '1=yes', '2=no'],
      categoryKey: 'c',
      now: 1000,
      attemptId: 'a',
    });
    expect(a.selectedAnswer).toBe('1=yes,2=no,10=yes');
    expect(a.isCorrect).toBe(true);
  });

  it('marks a paper sheet\'s matching answer like an on-screen one', () => {
    const sheet = {
      id: 'sheet-m',
      code: 'P-M',
      createdAt: 0,
      categoryKey: 'c',
      questionIds: ['yn'],
    };
    const right = buildPaperResult(
      sheet,
      [{ questionId: 'yn', question: yesNo, selected: ['2=no', '10=yes', '1=yes'] }],
      5000,
    );
    expect(right.attempts[0]).toMatchObject({
      id: 'sheet-m:a1',
      selectedAnswer: '1=yes,2=no,10=yes',
      isCorrect: true,
      mode: 'paper',
    });
    // A row left blank on the sheet is a wrong row, not a skipped question.
    const partial = buildPaperResult(
      sheet,
      [{ questionId: 'yn', question: yesNo, selected: ['1=yes', '2=no'] }],
      5000,
    );
    expect(partial.attempts[0]).toMatchObject({ selectedAnswer: '1=yes,2=no', isCorrect: false });
    expect(answerBoxLabel(yesNo)).toBe('Tick one box in each row');
    // Re-entering the same picks in another order is not a change.
    const saved = { keys: ['1=yes', '2=no', '10=yes'] as AnswerKey[], answeredAt: 1 };
    expect(markStatus(saved, ['10=yes', '2=no', '1=yes'])).toBe('saved');
    expect(markStatus(saved, ['10=no', '2=no', '1=yes'])).toBe('changed');
  });

  it('summarises a matching answer as its choices, row by row', () => {
    expect(formatAnswer(yesNo, ['1=yes', '10=no'])).toBe('Yes · — · No');
    expect(formatAnswer({}, ['A', 'C'])).toBe('A and C');
  });

  it('leaves single- and multi-answer grading as it was', () => {
    expect(isAnswerReady({}, ['B'])).toBe(true);
    expect(isAnswerReady({}, [])).toBe(false);
    expect(gradeSelection({ correctKey: 'B' }, ['B'])).toBe(true);
    expect(gradeSelection({ correctKeys: ['A', 'C'] }, ['C', 'A'])).toBe(true);
  });
});
