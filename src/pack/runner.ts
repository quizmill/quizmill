/**
 * Pure logic for the pack practice runner — same machinery as the CCA
 * runner (src/variants/claude-cert/runner.ts) over the generic
 * PackQuestion shape. The React components are the I/O shells;
 * everything that can be a function of plain inputs lives here.
 */
import type { Attempt, Session } from '@/data/types';
import { pickSessionQuestions } from '@/lib/selection';
import type { OptionKey, PackQuestion } from '@/pack/data';

export const QUESTION_COUNT = 10;

export interface RunnerState {
  sessionId: string;
  questions: PackQuestion[];
  currentIndex: number;
  correctCount: number;
  startedAt: number;
}

/** Filter the full pack bank to questions for one category. */
export function bankForCategory(
  questions: PackQuestion[],
  categoryKey: string,
): PackQuestion[] {
  return questions.filter((q) => q.categoryKey === categoryKey);
}

/**
 * Build the follow-up bank for a set of starred questions: every question
 * that shares a *topic* with at least one starred question. A topic is any
 * of a question's `conceptId`, `categoryKey`, or `tags` — so follow-up
 * practice reinforces the same material from new angles, not just the exact
 * questions starred. The starred questions themselves are included (they're
 * fair game to re-ask). Order follows the source bank.
 */
export function relatedTopicBank(
  questions: PackQuestion[],
  starredIds: ReadonlySet<string>,
): PackQuestion[] {
  if (starredIds.size === 0) return [];
  const concepts = new Set<string>();
  const categories = new Set<string>();
  const tags = new Set<string>();
  for (const q of questions) {
    if (!starredIds.has(q.id)) continue;
    if (q.conceptId) concepts.add(q.conceptId);
    categories.add(q.categoryKey);
    for (const t of q.tags ?? []) tags.add(t);
  }
  return questions.filter((q) => {
    if (starredIds.has(q.id)) return true;
    if (q.conceptId && concepts.has(q.conceptId)) return true;
    if (categories.has(q.categoryKey)) return true;
    return (q.tags ?? []).some((t) => tags.has(t));
  });
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

/** Past-attempt IDs on the same category — used to bias toward unseen. */
export function historicalIdsForCategory(
  attempts: { questionId: string; subject: string }[],
  categoryKey: string,
): Set<string> {
  return new Set(
    attempts.filter((a) => a.subject === categoryKey).map((a) => a.questionId),
  );
}

/**
 * Pick the session's questions from the bank. Returns null when there's
 * nothing to pick from (empty bank). Wraps each question in a `topic`
 * field so the engine's SelectableQuestion shape is satisfied; unwraps
 * before returning.
 */
export function pickSessionFromBank(
  bank: PackQuestion[],
  historicalIds: Set<string>,
  rng?: () => number,
): PackQuestion[] | null {
  if (bank.length === 0) return null;
  const selectable = bank.map((q) => ({ ...q, topic: q.categoryKey }));
  const picked = pickSessionQuestions(selectable, {
    count: Math.min(QUESTION_COUNT, bank.length),
    historicalAttemptedIds: historicalIds,
    currentSessionIds: new Set(),
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
  selected: OptionKey;
  categoryKey: string;
  now: number;
  attemptId: string;
  timeTakenSeconds?: number;
}

export function buildAttempt(args: BuildAttemptArgs): Attempt {
  const { state, question, selected, categoryKey, now, attemptId } = args;
  return {
    id: attemptId,
    sessionId: state.sessionId,
    questionId: question.id,
    answeredAt: now,
    selectedAnswer: selected,
    isCorrect: selected === question.correctKey,
    timeTakenSeconds: args.timeTakenSeconds ?? 1,
    // Subject is the engine type — packs store the category key here.
    subject: categoryKey,
    // Per-question rescue, same as CCA: pack questions are
    // self-contained, so a mistake is only rescued by re-answering
    // that exact question correctly (see claude-cert/runner.ts for
    // the contrast with 11+'s per-concept rescue model).
    topic: question.id,
    difficulty: question.difficulty,
  };
}

/** Persisted "session started" record. endedAt: null while running. */
export function buildSessionStart(
  state: RunnerState,
  categoryKey: string,
  mode: Session['mode'] = 'practice',
): Session {
  return {
    id: state.sessionId,
    subject: categoryKey,
    startedAt: state.startedAt,
    endedAt: null,
    questionCount: state.questions.length,
    correctCount: 0,
    mode,
  };
}

/** Persisted "session ended" record. Idempotent — call with the final state. */
export function buildSessionEnd(
  state: RunnerState,
  categoryKey: string,
  endedAt: number,
  mode: Session['mode'] = 'practice',
): Session {
  return {
    id: state.sessionId,
    subject: categoryKey,
    startedAt: state.startedAt,
    endedAt,
    questionCount: state.questions.length,
    correctCount: state.correctCount,
    mode,
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

/** Move to the next question. Caller must ensure !isLastQuestion(state). */
export function moveToNext(state: RunnerState): RunnerState {
  return { ...state, currentIndex: state.currentIndex + 1 };
}
