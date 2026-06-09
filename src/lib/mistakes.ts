/**
 * Mistake-review selection.
 *
 * Rescue rule (topic-based): a question Q is an unresolved mistake iff its
 * most recent wrong attempt happened AFTER any correct attempt on the same
 * (subject, topic). This reflects the pedagogical view that what matters is
 * the CONCEPT, not the specific question — getting any same-topic question
 * right shows the kid understands and rescues the original mistake.
 *
 * The companion `pickSimilarQuestion` picks the recall question to actually
 * show the kid in a review session: a different question on the same topic.
 */
import type { Attempt } from '@/data/types';

interface MinimalQuestion {
  id: string;
  subject: string;
  topic: string;
}

const topicKey = (subject: string, topic: string): string =>
  `${subject}:${topic}`;

/**
 * Return the IDs of all questions whose most recent wrong attempt has NOT
 * been rescued by a later correct attempt on the same topic. Sorted by the
 * timestamp of the wrong attempt, most-recent first.
 */
export function unresolvedMistakeIds(attempts: readonly Attempt[]): string[] {
  // Walk chronologically so we can read off the latest "correct on topic"
  // time as we go.
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);

  const lastCorrectOnTopic = new Map<string, number>();
  /** questionId → { topicKey, t } for the kid's latest wrong attempt at this question. */
  const lastWrong = new Map<string, { tk: string; t: number }>();

  for (const a of sorted) {
    const tk = topicKey(a.subject, a.topic);
    if (a.isCorrect) {
      lastCorrectOnTopic.set(tk, a.answeredAt);
    } else {
      lastWrong.set(a.questionId, { tk, t: a.answeredAt });
    }
  }

  const unresolved: { id: string; t: number }[] = [];
  for (const [qid, { tk, t }] of lastWrong) {
    const lastOk = lastCorrectOnTopic.get(tk) ?? -Infinity;
    if (lastOk < t) unresolved.push({ id: qid, t });
  }

  unresolved.sort((a, b) => b.t - a.t);
  return unresolved.map((x) => x.id);
}

export function unresolvedMistakeCount(attempts: readonly Attempt[]): number {
  return unresolvedMistakeIds(attempts).length;
}

/**
 * Like `unresolvedMistakeIds` but each entry is enriched with the kid's
 * most recent wrong attempt at that question — useful for the mistakes
 * browser, which shows what the kid picked alongside the correct answer.
 */
export function unresolvedMistakes(
  attempts: readonly Attempt[],
): { questionId: string; wrongAttempt: Attempt }[] {
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);

  const lastCorrectOnTopic = new Map<string, number>();
  const lastWrong = new Map<string, Attempt>();

  for (const a of sorted) {
    const tk = topicKey(a.subject, a.topic);
    if (a.isCorrect) {
      lastCorrectOnTopic.set(tk, a.answeredAt);
    } else {
      lastWrong.set(a.questionId, a);
    }
  }

  const out: { questionId: string; wrongAttempt: Attempt }[] = [];
  for (const [qid, attempt] of lastWrong) {
    const tk = topicKey(attempt.subject, attempt.topic);
    const lastOk = lastCorrectOnTopic.get(tk) ?? -Infinity;
    if (lastOk < attempt.answeredAt) {
      out.push({ questionId: qid, wrongAttempt: attempt });
    }
  }

  out.sort((a, b) => b.wrongAttempt.answeredAt - a.wrongAttempt.answeredAt);
  return out;
}

/**
 * Pick a question that's "similar" to the original — same subject + topic,
 * but a different question — so the kid actually has to apply the concept
 * rather than recall an answer. Returns null if no such question exists.
 *
 * `excludeIds` lets callers avoid repeats within the current session.
 */
export function pickSimilarQuestion<Q extends MinimalQuestion>(
  originalId: string,
  bank: readonly Q[],
  excludeIds: ReadonlySet<string> = new Set(),
  rng: () => number = Math.random,
): Q | null {
  const original = bank.find((q) => q.id === originalId);
  if (!original) return null;
  const candidates = bank.filter(
    (q) =>
      q.subject === original.subject &&
      q.topic === original.topic &&
      q.id !== originalId &&
      !excludeIds.has(q.id),
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}
