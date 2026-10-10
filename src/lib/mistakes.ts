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
 */
import type { Attempt } from '@/data/types';

const topicKey = (subject: string, topic: string): string =>
  `${subject}:${topic}`;

/**
 * Return the IDs of all questions whose most recent wrong attempt has NOT
 * been rescued by a later correct attempt on the same topic. Sorted by the
 * timestamp of the wrong attempt, OLDEST first — so the review queue
 * (which takes the first N) resurfaces mistakes made longer ago before
 * recent ones, the spaced-repetition intuition: a stale mistake should not
 * stay buried under today's slip-ups.
 */
export function unresolvedMistakeIds(attempts: readonly Attempt[]): string[] {
  // Walk chronologically so we can read off the latest "correct on topic"
  // time as we go.
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);

  const lastCorrectOnTopic = new Map<string, number>();
  const lastCorrectOnQuestion = new Map<string, number>();
  /** questionId → { topicKey, t } for the kid's latest wrong attempt at this question. */
  const lastWrong = new Map<string, { tk: string; t: number }>();

  for (const a of sorted) {
    const tk = topicKey(a.subject, a.topic);
    if (a.isCorrect) {
      lastCorrectOnTopic.set(tk, a.answeredAt);
      lastCorrectOnQuestion.set(a.questionId, a.answeredAt);
    } else {
      lastWrong.set(a.questionId, { tk, t: a.answeredAt });
    }
  }

  const unresolved: { id: string; t: number }[] = [];
  for (const [qid, { tk, t }] of lastWrong) {
    const lastOk = Math.max(
      lastCorrectOnTopic.get(tk) ?? -Infinity,
      lastCorrectOnQuestion.get(qid) ?? -Infinity,
    );
    if (lastOk < t) unresolved.push({ id: qid, t });
  }

  unresolved.sort((a, b) => a.t - b.t);
  return unresolved.map((x) => x.id);
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
