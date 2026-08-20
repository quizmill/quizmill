/**
 * Pure logic for the pack practice runner — same machinery as the CCA
 * runner (src/variants/claude-cert/runner.ts) over the generic
 * PackQuestion shape. The React components are the I/O shells;
 * everything that can be a function of plain inputs lives here.
 */
import { APP_BUILD } from '@/config';
import type { Attempt, Session, SessionMode } from '@/data/types';
import { pickSessionQuestions, type AttemptSummary } from '@/lib/selection';
import { correctKeysOf, type OptionKey, type PackQuestion } from '@/pack/data';

export const QUESTION_COUNT = 10;

/**
 * Grade a selection against a question. Both single- and multi-answer
 * questions grade by set-equality — every correct key must be chosen and
 * no incorrect one — so multi-answer is all-or-nothing (no partial
 * credit). An empty selection is never correct.
 */
export function gradeSelection(
  question: Pick<PackQuestion, 'correctKey' | 'correctKeys'>,
  selected: OptionKey[],
): boolean {
  const correct = correctKeysOf(question);
  if (selected.length !== correct.length) return false;
  const chosen = new Set(selected);
  return correct.every((k) => chosen.has(k));
}

/**
 * Compute the next selection when an option is tapped. Single-answer mode
 * replaces the selection; multi-answer mode toggles the key in/out.
 */
export function nextSelection(
  prev: OptionKey[],
  key: OptionKey,
  multi: boolean,
): OptionKey[] {
  if (!multi) return [key];
  return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
}

/** Render option keys as a natural list: "A", "A and B", "A, B and C". */
export function formatKeyList(keys: OptionKey[]): string {
  if (keys.length <= 1) return keys.join('');
  if (keys.length === 2) return `${keys[0]} and ${keys[1]}`;
  return `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`;
}

export interface RunnerState {
  sessionId: string;
  questions: PackQuestion[];
  currentIndex: number;
  correctCount: number;
  startedAt: number;
  /** When the CURRENT question appeared — buildAttempt derives the real
   *  timeTakenSeconds from it. Stamped at session start and by moveToNext. */
  questionShownAt: number;
}

/** Filter the full pack bank to questions for one category. */
export function bankForCategory(
  questions: PackQuestion[],
  categoryKey: string,
): PackQuestion[] {
  return questions.filter((q) => q.categoryKey === categoryKey);
}

/** Restrict a bank to one level band. A null/undefined level (the "All"
 *  filter, or a pack with no levels) returns the bank unchanged. */
export function filterByLevel(
  bank: PackQuestion[],
  level: string | null | undefined,
): PackQuestion[] {
  if (!level) return bank;
  return bank.filter((q) => q.level === level);
}

/**
 * Latest attempt per question (optionally restricted to one category) —
 * feeds the unseen bias and the repeat ranking in the selection engine.
 */
export function attemptHistory(
  attempts: {
    questionId: string;
    subject: string;
    answeredAt: number;
    isCorrect: boolean;
  }[],
  categoryKey?: string,
): Map<string, AttemptSummary> {
  const history = new Map<string, AttemptSummary>();
  for (const a of attempts) {
    if (categoryKey && a.subject !== categoryKey) continue;
    const prev = history.get(a.questionId);
    if (!prev || a.answeredAt >= prev.lastAnsweredAt) {
      history.set(a.questionId, {
        lastAnsweredAt: a.answeredAt,
        lastCorrect: a.isCorrect,
      });
    }
  }
  return history;
}

/** True when every question in the bank has been attempted — the dealt
 *  round can only be repeats, which the UI should say out loud. */
export function isBankFullySeen(
  bank: PackQuestion[],
  history: ReadonlyMap<string, AttemptSummary>,
): boolean {
  return bank.length > 0 && bank.every((q) => history.has(q.id));
}

/**
 * Pick the session's questions from the bank. Returns null when there's
 * nothing to pick from (empty bank). Wraps each question in a `topic`
 * field so the engine's SelectableQuestion shape is satisfied; unwraps
 * before returning.
 */
export function pickSessionFromBank(
  bank: PackQuestion[],
  history: ReadonlyMap<string, AttemptSummary>,
  rng?: () => number,
): PackQuestion[] | null {
  if (bank.length === 0) return null;
  const selectable = bank.map((q) => ({ ...q, topic: q.categoryKey }));
  const picked = pickSessionQuestions(selectable, {
    count: Math.min(QUESTION_COUNT, bank.length),
    historicalAttemptedIds: new Set(history.keys()),
    currentSessionIds: new Set(),
    history,
    rng,
  });
  if (picked.length === 0) return null;
  return picked.map((p) => {
    const { topic: _topic, ...rest } = p;
    return rest as PackQuestion;
  });
}

export interface BuildAttemptArgs {
  state: RunnerState;
  question: PackQuestion;
  /** The chosen option key(s) — length 1 for single-answer questions. */
  selected: OptionKey[];
  categoryKey: string;
  now: number;
  attemptId: string;
  /** How the session runs — denormalised onto the attempt. */
  mode?: SessionMode;
  /** The first option tapped before any revision, when the UI tracked it. */
  firstSelected?: OptionKey;
  /** Override the measured time (Drive Mode times its own speech loop). */
  timeTakenSeconds?: number;
}

/** Ceiling on a measured answer time — a question left open overnight is
 *  a parked tab, not an hour of thought. */
const MAX_TIME_TAKEN_SECONDS = 3600;

export function buildAttempt(args: BuildAttemptArgs): Attempt {
  const { state, question, selected, categoryKey, now, attemptId } = args;
  const measured = Math.min(
    MAX_TIME_TAKEN_SECONDS,
    Math.max(0, Math.round((now - state.questionShownAt) / 1000)),
  );
  return {
    id: attemptId,
    sessionId: state.sessionId,
    questionId: question.id,
    answeredAt: now,
    // Persist as a sorted, comma-joined string ("A" or "A,C") — stays a
    // plain string so storage/sync/stats read it unchanged.
    selectedAnswer: [...selected].sort().join(','),
    isCorrect: gradeSelection(question, selected),
    timeTakenSeconds: args.timeTakenSeconds ?? measured,
    // Subject is the engine type — packs store the category key here.
    subject: categoryKey,
    // Per-question rescue, same as CCA: pack questions are
    // self-contained, so a mistake is only rescued by re-answering
    // that exact question correctly (see claude-cert/runner.ts for
    // the contrast with 11+'s per-concept rescue model).
    topic: question.id,
    difficulty: question.difficulty,
    position: state.currentIndex + 1,
    ...(args.firstSelected !== undefined ? { firstSelected: args.firstSelected } : {}),
    ...(args.mode !== undefined ? { mode: args.mode } : {}),
    ...(question.scenarioId ? { scenarioId: question.scenarioId } : {}),
    ...(APP_BUILD ? { appBuild: APP_BUILD } : {}),
  };
}

/**
 * Coarse device context for a session — installed-PWA vs browser tab, and
 * touch vs desktop. Deliberately nothing finer (no user agent, no screen
 * sizes): enough for adoption analysis, useless for fingerprinting.
 * Returns {} outside the browser so SSR-built sessions stay clean.
 */
export function deviceContext(): Pick<Session, 'display' | 'platform'> {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return {};
  }
  return {
    display: window.matchMedia('(display-mode: standalone)').matches
      ? 'standalone'
      : 'browser',
    platform: window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop',
  };
}

/** Persisted "session started" record. endedAt: null while running. */
export function buildSessionStart(
  state: RunnerState,
  categoryKey: string,
  mode: SessionMode = 'practice',
): Session {
  return {
    id: state.sessionId,
    subject: categoryKey,
    startedAt: state.startedAt,
    endedAt: null,
    questionCount: state.questions.length,
    correctCount: 0,
    mode,
    ...(APP_BUILD ? { appBuild: APP_BUILD } : {}),
    ...deviceContext(),
  };
}

/** Persisted "session ended" record. Idempotent — call with the final state. */
export function buildSessionEnd(
  state: RunnerState,
  categoryKey: string,
  endedAt: number,
  mode: SessionMode = 'practice',
): Session {
  return {
    id: state.sessionId,
    subject: categoryKey,
    startedAt: state.startedAt,
    endedAt,
    questionCount: state.questions.length,
    correctCount: state.correctCount,
    mode,
    ...(APP_BUILD ? { appBuild: APP_BUILD } : {}),
    ...deviceContext(),
  };
}

/** True when state.currentIndex is on the final question of the session. */
export function isLastQuestion(state: RunnerState): boolean {
  return state.currentIndex + 1 >= state.questions.length;
}

/** Score breakdown for the results screen. pct rounded to nearest int. */
export function scoreSummary(state: RunnerState): {
  correct: number;
  total: number;
  pct: number;
} {
  const total = state.questions.length;
  const pct = total === 0 ? 0 : Math.round((state.correctCount / total) * 100);
  return { correct: state.correctCount, total, pct };
}

/** Advance state after recording one answer. Returns next state. */
export function advanceAfterAnswer(
  state: RunnerState,
  wasCorrect: boolean,
): RunnerState {
  return {
    ...state,
    correctCount: state.correctCount + (wasCorrect ? 1 : 0),
  };
}

/** Move to the next question. Caller must ensure !isLastQuestion(state).
 *  Stamps questionShownAt so the next answer's time measures from here. */
export function moveToNext(state: RunnerState, now: number = Date.now()): RunnerState {
  return { ...state, currentIndex: state.currentIndex + 1, questionShownAt: now };
}

/** Seconds spent on the feedback/explanation screen after an answer,
 *  clamped like timeTakenSeconds so a parked tab can't skew analysis. */
export function feedbackSecondsSince(answeredAt: number, now: number = Date.now()): number {
  return Math.min(MAX_TIME_TAKEN_SECONDS, Math.max(0, Math.round((now - answeredAt) / 1000)));
}
