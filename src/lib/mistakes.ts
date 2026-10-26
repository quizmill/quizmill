/**
 * Mistake-review selection.
 *
 * Rescue rule (topic-based): a question Q is an unresolved mistake iff its
 * most recent wrong attempt happened AFTER any correct attempt on the same
 * (subject, topic). This reflects the pedagogical view that what matters is
 * the CONCEPT, not the specific question — getting any same-topic question
 * right shows the kid understands and rescues the original mistake.
 *
 * A later correct attempt at the SAME question always rescues too, whatever
 * topic label either attempt carries. Attempts migrated from older engines
 * carry free-text topics ("reading comprehension") while this engine writes
 * the question id as topic; without the question-id fallback such a mistake
 * could never be rescued and would pin itself to the top of every review.
 *
 * Packs write the question id as the topic, so in practice rescue is
 * per-question and the review runner re-asks the very question that was
 * missed (see `buildAttempt` in src/pack/runner.ts).
 *
 * The weak-spot list generalises this: a missed question stays listed
 * until it has been answered right N times in a row (N a device pref),
 * counted per question id. The rule above is the case N = 1.
 */
import type { Attempt } from '@/data/types';

const topicKey = (subject: string, topic: string): string =>
  `${subject}:${topic}`;

/** A question missed at least once, and how far it has come back since. */
export interface MissedQuestion {
  id: string;
  /** Right answers in a row since the latest wrong one. A later correct
   *  answer on the same topic by ANOTHER question counts as the first of
   *  them (the topic rescue above), never as more. */
  streak: number;
  /** When the latest wrong answer was given. */
  wrongAt: number;
}

/**
 * Every question with at least one wrong attempt, with its streak since
 * the latest wrong one. Oldest latest-mistake first — so the review queue
 * (which takes the first N) resurfaces mistakes made longer ago before
 * recent ones, the spaced-repetition intuition: a stale mistake should
 * not stay buried under today's slip-ups.
 */
export function missedQuestions(attempts: readonly Attempt[]): MissedQuestion[] {
  // Walk chronologically so the streak and the latest "correct on topic"
  // time can be read off as we go.
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);

  const lastCorrectOnTopic = new Map<string, number>();
  /** questionId → the latest wrong attempt at it and the run since. */
  const missed = new Map<string, { tk: string; t: number; streak: number }>();

  for (const a of sorted) {
    const tk = topicKey(a.subject, a.topic);
    if (a.isCorrect) {
      lastCorrectOnTopic.set(tk, a.answeredAt);
      const m = missed.get(a.questionId);
      if (m) m.streak++;
    } else {
      missed.set(a.questionId, { tk, t: a.answeredAt, streak: 0 });
    }
  }

  const out: MissedQuestion[] = [];
  for (const [id, { tk, t, streak }] of missed) {
    const topicRescued = (lastCorrectOnTopic.get(tk) ?? -Infinity) >= t;
    out.push({ id, streak: streak === 0 && topicRescued ? 1 : streak, wrongAt: t });
  }
  return out.sort((a, b) => a.wrongAt - b.wrongAt);
}

/**
 * The weak-spot list: missed questions not yet answered right
 * `clearAfter` times in a row. Derived, never stored — changing
 * `clearAfter` (a device pref, see src/lib/weakSpotPref.ts) only changes
 * what the list shows.
 */
export function weakSpots(
  attempts: readonly Attempt[],
  clearAfter: number,
): MissedQuestion[] {
  return missedQuestions(attempts).filter((m) => m.streak < clearAfter);
}

/**
 * Return the IDs of all questions whose most recent wrong attempt has NOT
 * been rescued by a later correct attempt on the same topic (or at the
 * same question) — the weak-spot list with a single right answer clearing
 * a question. Oldest mistake first.
 */
export function unresolvedMistakeIds(attempts: readonly Attempt[]): string[] {
  return weakSpots(attempts, 1).map((m) => m.id);
}

/**
 * The unresolved mistakes made in ONE session, in the order that session
 * asked them — for reviewing a just-marked paper sheet with the page still
 * in hand. The global queue is oldest-mistake-first across all history, so
 * it would open on unrelated questions; this keeps to the sheet. Mistakes
 * rescued since (in any session) drop out, same rule as the queue.
 */
export function sessionMistakeIds(
  attempts: readonly Attempt[],
  sessionId: string,
): string[] {
  const unresolved = new Set(unresolvedMistakeIds(attempts));
  const seen = new Set<string>();
  return attempts
    .filter((a) => a.sessionId === sessionId && !a.isCorrect)
    .sort(
      (a, b) =>
        (a.position ?? Infinity) - (b.position ?? Infinity) ||
        a.answeredAt - b.answeredAt,
    )
    .map((a) => a.questionId)
    .filter((id) => unresolved.has(id) && !seen.has(id) && seen.add(id));
}

export function unresolvedMistakeCount(attempts: readonly Attempt[]): number {
  return unresolvedMistakeIds(attempts).length;
}
