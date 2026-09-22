import { describe, expect, it } from 'vitest';
import type { Attempt, Session } from '@/data/types';
import {
  dayReplay,
  formatSpan,
  groupSessionsByDay,
  priorAttempts,
  selectedKeys,
  sessionReplay,
} from '@/lib/coachSessions';

/** Local-time timestamp for a given day/hour — the grouping is by local day. */
function at(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

function attempt(over: Partial<Attempt> & { sessionId: string; answeredAt: number }): Attempt {
  return {
    id: `a-${over.sessionId}-${over.answeredAt}`,
    questionId: 'q1',
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'maths',
    topic: 'q1',
    difficulty: 2,
    ...over,
  };
}

function session(over: Partial<Session> & { id: string; startedAt: number }): Session {
  return {
    subject: 'maths',
    endedAt: over.startedAt + 60_000,
    questionCount: 3,
    correctCount: 2,
    ...over,
  };
}

describe('groupSessionsByDay', () => {
  it('returns nothing when nothing was answered', () => {
    expect(groupSessionsByDay([], [])).toEqual([]);
  });

  it('drops sessions that have no attempts (started, never answered)', () => {
    const s = session({ id: 's-empty', startedAt: at(2026, 9, 21, 19), endedAt: null });
    expect(groupSessionsByDay([s], [])).toEqual([]);
  });

  it('groups by local day, newest day first, newest session first within a day', () => {
    const sessions = [
      session({ id: 'mon-early', startedAt: at(2026, 9, 21, 9) }),
      session({ id: 'mon-late', startedAt: at(2026, 9, 21, 20) }),
      session({ id: 'sat', startedAt: at(2026, 9, 12, 19) }),
    ];
    const attempts = [
      attempt({ sessionId: 'mon-early', answeredAt: at(2026, 9, 21, 9, 1) }),
      attempt({ sessionId: 'mon-late', answeredAt: at(2026, 9, 21, 20, 1), isCorrect: false }),
      attempt({ sessionId: 'mon-late', answeredAt: at(2026, 9, 21, 20, 2) }),
      attempt({ sessionId: 'sat', answeredAt: at(2026, 9, 12, 19, 1) }),
    ];
    const days = groupSessionsByDay(sessions, attempts);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-9-21', '2026-9-12']);
    expect(days[0].sessions.map((s) => s.session.id)).toEqual(['mon-late', 'mon-early']);
    expect(days[0].answered).toBe(3);
    expect(days[0].correct).toBe(2);
  });

  it('summarises each session: score, subjects in first-seen order, span, abandoned', () => {
    const s = session({ id: 's1', startedAt: at(2026, 9, 21, 19), endedAt: null, mode: 'review' });
    const attempts = [
      attempt({ sessionId: 's1', answeredAt: at(2026, 9, 21, 19, 1), subject: 'english', isCorrect: false }),
      attempt({ sessionId: 's1', answeredAt: at(2026, 9, 21, 19, 3), subject: 'maths' }),
      attempt({ sessionId: 's1', answeredAt: at(2026, 9, 21, 19, 2), subject: 'english' }),
    ];
    const [day] = groupSessionsByDay([s], attempts);
    const [cs] = day.sessions;
    expect(cs.mode).toBe('review');
    expect(cs.answered).toBe(3);
    expect(cs.correct).toBe(2);
    expect(cs.subjects).toEqual(['english', 'maths']);
    expect(cs.spanSeconds).toBe(120);
    expect(cs.abandoned).toBe(true);
    // attempts come back in answer order regardless of input order
    expect(cs.attempts.map((a) => a.answeredAt)).toEqual([
      at(2026, 9, 21, 19, 1),
      at(2026, 9, 21, 19, 2),
      at(2026, 9, 21, 19, 3),
    ]);
  });

  it('synthesises a session for attempts whose session record is missing', () => {
    const attempts = [
      attempt({ sessionId: 'ghost', answeredAt: at(2026, 9, 21, 19, 1), mode: 'practice' }),
    ];
    const [day] = groupSessionsByDay([], attempts);
    expect(day.sessions).toHaveLength(1);
    expect(day.sessions[0].session.id).toBe('ghost');
    expect(day.sessions[0].session.startedAt).toBe(at(2026, 9, 21, 19, 1));
    expect(day.sessions[0].mode).toBe('practice');
  });

  it('defaults the mode to practice for older records', () => {
    const s = session({ id: 's1', startedAt: at(2026, 9, 21, 19) });
    const [day] = groupSessionsByDay([s], [attempt({ sessionId: 's1', answeredAt: at(2026, 9, 21, 19, 1) })]);
    expect(day.sessions[0].mode).toBe('practice');
  });
});

describe('sessionReplay', () => {
  const bank = new Map([
    ['q1', { id: 'q1' }],
    ['q2', { id: 'q2' }],
  ]);

  it('lays attempts out in answer order and numbers them', () => {
    const attempts = [
      attempt({ sessionId: 's', answeredAt: 200, questionId: 'q2' }),
      attempt({ sessionId: 's', answeredAt: 100, questionId: 'q1' }),
    ];
    const replay = sessionReplay(attempts, bank);
    expect(replay.steps.map((s) => [s.index, s.question.id])).toEqual([
      [1, 'q1'],
      [2, 'q2'],
    ]);
    expect(replay.unknownQuestions).toBe(0);
  });

  it('skips and counts attempts whose question is not in the pack', () => {
    const attempts = [
      attempt({ sessionId: 's', answeredAt: 100, questionId: 'q1' }),
      attempt({ sessionId: 's', answeredAt: 200, questionId: 'gone' }),
      attempt({ sessionId: 's', answeredAt: 300, questionId: 'q2' }),
    ];
    const replay = sessionReplay(attempts, bank);
    expect(replay.steps.map((s) => [s.index, s.question.id])).toEqual([
      [1, 'q1'],
      [2, 'q2'],
    ]);
    expect(replay.unknownQuestions).toBe(1);
  });
});

describe('selectedKeys', () => {
  it('splits the stored comma-joined selection', () => {
    expect(selectedKeys({ selectedAnswer: 'A' })).toEqual(['A']);
    expect(selectedKeys({ selectedAnswer: 'A,C' })).toEqual(['A', 'C']);
    expect(selectedKeys({ selectedAnswer: '' })).toEqual([]);
  });
});

describe('formatSpan', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatSpan(0)).toBe('0 s');
    expect(formatSpan(45)).toBe('45 s');
    expect(formatSpan(130)).toBe('2 min');
    expect(formatSpan(3900)).toBe('1 h 05 min');
  });
});

describe('dayReplay', () => {
  it('concatenates a day\'s sessions oldest first and marks where each session starts', () => {
    const sessions = [
      session({ id: 'early', startedAt: at(2026, 9, 21, 19) }),
      session({ id: 'late', startedAt: at(2026, 9, 21, 20) }),
    ];
    const attempts = [
      attempt({ sessionId: 'late', answeredAt: at(2026, 9, 21, 20, 1), questionId: 'q3' }),
      attempt({ sessionId: 'early', answeredAt: at(2026, 9, 21, 19, 2), questionId: 'q2', isCorrect: false }),
      attempt({ sessionId: 'early', answeredAt: at(2026, 9, 21, 19, 1), questionId: 'q1' }),
    ];
    const [day] = groupSessionsByDay(sessions, attempts);
    const replay = dayReplay(day, new Map([['q1', { id: 'q1' }], ['q2', { id: 'q2' }], ['q3', { id: 'q3' }]]));
    expect(replay.steps.map((s) => [s.index, s.question.id, s.sessionStart])).toEqual([
      [1, 'q1', true],
      [2, 'q2', false],
      [3, 'q3', true],
    ]);
    expect(replay.answered).toBe(3);
    expect(replay.correct).toBe(2);
  });
});

describe('priorAttempts', () => {
  it('lists earlier attempts at the same question, oldest first, excluding this and later ones', () => {
    const target = attempt({ sessionId: 's3', answeredAt: 300, questionId: 'q1', isCorrect: false });
    const all = [
      attempt({ sessionId: 's4', answeredAt: 400, questionId: 'q1' }), // later — ignored
      target,
      attempt({ sessionId: 's2', answeredAt: 200, questionId: 'q1', selectedAnswer: 'C' }),
      attempt({ sessionId: 's1', answeredAt: 100, questionId: 'q1', isCorrect: false, selectedAnswer: 'B' }),
      attempt({ sessionId: 's1', answeredAt: 150, questionId: 'q2', isCorrect: false }), // other question
    ];
    expect(priorAttempts(target, all).map((a) => [a.answeredAt, a.isCorrect, a.selectedAnswer])).toEqual([
      [100, false, 'B'],
      [200, true, 'C'],
    ]);
  });
});
