/**
 * Pure helpers behind the Coach page: group the learner's sessions by
 * day, and lay one session out question by question for a replay.
 *
 * Works on the engine's denormalised records only (Session / Attempt) plus
 * a minimal question lookup, so it is unit-testable without a pack. Empty
 * sessions (started, nothing answered) are dropped — there is nothing to
 * go through together — and attempts whose question is no longer in the
 * pack are counted but not laid out.
 */
import type { Attempt, Session, SessionMode } from '@/data/types';
import { toDayKey } from './streak';

export interface CoachSession {
  session: Session;
  mode: SessionMode;
  /** Attempts in the order they were answered. */
  attempts: Attempt[];
  answered: number;
  correct: number;
  /** Category keys seen in this session's attempts, first-seen order. */
  subjects: string[];
  /** Seconds from the first answer to the last (0 for a single answer). */
  spanSeconds: number;
  /** True when the session never wrote an end record. */
  abandoned: boolean;
}

export interface CoachDay {
  /** Local-day key from streak.ts (`YYYY-M-D`, unpadded). */
  dayKey: string;
  /** Local midnight, for formatting. */
  date: Date;
  sessions: CoachSession[];
  answered: number;
  correct: number;
}

export const SESSION_MODE_LABEL: Record<SessionMode, string> = {
  practice: 'Practice',
  review: 'Mistakes review',
  drive: 'Drive mode',
  notes: 'Notes practice',
};

function byAnsweredAt(a: Attempt, b: Attempt): number {
  return a.answeredAt - b.answeredAt || (a.position ?? 0) - (b.position ?? 0);
}

/**
 * Sessions with at least one attempt, grouped by the LOCAL day they
 * started, newest day first; within a day newest session first. An attempt
 * whose session record is missing (a partial sync, an old import) still
 * shows up under a synthesised session so nothing the learner answered is
 * hidden from the parent.
 */
export function groupSessionsByDay(
  sessions: readonly Session[],
  attempts: readonly Attempt[],
): CoachDay[] {
  const bySession = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const list = bySession.get(a.sessionId);
    if (list) list.push(a);
    else bySession.set(a.sessionId, [a]);
  }

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const coachSessions: CoachSession[] = [];
  for (const [sessionId, list] of bySession) {
    list.sort(byAnsweredAt);
    const first = list[0];
    const last = list[list.length - 1];
    const session: Session = sessionById.get(sessionId) ?? {
      id: sessionId,
      subject: first.subject,
      startedAt: first.answeredAt,
      endedAt: null,
      questionCount: list.length,
      correctCount: list.filter((a) => a.isCorrect).length,
      mode: first.mode,
    };
    const subjects: string[] = [];
    for (const a of list) if (!subjects.includes(a.subject)) subjects.push(a.subject);
    coachSessions.push({
      session,
      mode: session.mode ?? first.mode ?? 'practice',
      attempts: list,
      answered: list.length,
      correct: list.filter((a) => a.isCorrect).length,
      subjects,
      spanSeconds: Math.max(0, Math.round((last.answeredAt - first.answeredAt) / 1000)),
      abandoned: session.endedAt === null,
    });
  }

  const days = new Map<string, CoachDay>();
  for (const cs of coachSessions) {
    const started = new Date(cs.session.startedAt);
    const dayKey = toDayKey(started);
    let day = days.get(dayKey);
    if (!day) {
      const date = new Date(started);
      date.setHours(0, 0, 0, 0);
      day = { dayKey, date, sessions: [], answered: 0, correct: 0 };
      days.set(dayKey, day);
    }
    day.sessions.push(cs);
    day.answered += cs.answered;
    day.correct += cs.correct;
  }

  const out = [...days.values()];
  for (const day of out) {
    day.sessions.sort((a, b) => b.session.startedAt - a.session.startedAt);
  }
  out.sort((a, b) => b.date.getTime() - a.date.getTime());
  return out;
}

export interface ReplayStep<Q> {
  attempt: Attempt;
  question: Q;
  /** 1-based position in the replay (after dropping unknown questions). */
  index: number;
  /** First shown step of its session — a whole-day replay draws a
   *  divider here. Always true for the first step. */
  sessionStart: boolean;
}

export interface Replay<Q> {
  steps: ReplayStep<Q>[];
  /** Attempts skipped because their question is not in this pack. */
  unknownQuestions: number;
  answered: number;
  correct: number;
}

/** Lay attempts out in answer order, joined to the pack's questions. One
 *  session's attempts, or a whole day's (see `dayReplay`). */
export function sessionReplay<Q extends { id: string }>(
  attempts: readonly Attempt[],
  questionById: ReadonlyMap<string, Q>,
): Replay<Q> {
  const sorted = [...attempts].sort(byAnsweredAt);
  const steps: ReplayStep<Q>[] = [];
  let unknownQuestions = 0;
  let lastSession: string | null = null;
  for (const attempt of sorted) {
    const question = questionById.get(attempt.questionId);
    if (!question) {
      unknownQuestions++;
      continue;
    }
    steps.push({
      attempt,
      question,
      index: steps.length + 1,
      sessionStart: attempt.sessionId !== lastSession,
    });
    lastSession = attempt.sessionId;
  }
  return {
    steps,
    unknownQuestions,
    answered: steps.length,
    correct: steps.filter((s) => s.attempt.isCorrect).length,
  };
}

/** Every answer of one day in the order given, across all its sessions. */
export function dayReplay<Q extends { id: string }>(
  day: CoachDay,
  questionById: ReadonlyMap<string, Q>,
): Replay<Q> {
  return sessionReplay(
    day.sessions.flatMap((s) => s.attempts),
    questionById,
  );
}

/** Earlier attempts at the same question, oldest first — the history a
 *  parent needs to know whether a miss is new or a repeat, and what was
 *  picked the previous times. */
export function priorAttempts(
  attempt: Attempt,
  all: readonly Attempt[],
): Attempt[] {
  return all
    .filter(
      (a) =>
        a.questionId === attempt.questionId &&
        a.id !== attempt.id &&
        a.answeredAt < attempt.answeredAt,
    )
    .sort(byAnsweredAt);
}

/** "A" or "A, C" → the option keys the learner selected. */
export function selectedKeys(attempt: Pick<Attempt, 'selectedAnswer'>): string[] {
  return attempt.selectedAnswer
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Human-friendly duration: 12 s, 2 min, 1 h 05 min. */
export function formatSpan(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}
