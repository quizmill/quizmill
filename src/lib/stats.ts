/**
 * Pure aggregations over attempts and sessions, feeding the Progress
 * page and the achievements engine. All inputs are plain arrays so
 * these can be tested without any storage layer. Category definitions
 * are passed in (not imported from APP_CONFIG) for the same reason.
 */
import type { Attempt, Session } from '@/data/types';

export interface CategoryAccuracy {
  key: string;
  label: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
}

/** Accuracy per pack category, in the order the categories are given.
 *  Categories with no attempts are included with zeroes. */
export function accuracyByCategory(
  attempts: readonly Attempt[],
  categories: readonly { key: string; label: string; shortLabel?: string }[],
): CategoryAccuracy[] {
  return categories.map((cat) => {
    let attempted = 0;
    let correct = 0;
    for (const a of attempts) {
      if (a.subject !== cat.key) continue;
      attempted += 1;
      if (a.isCorrect) correct += 1;
    }
    return {
      key: cat.key,
      label: cat.shortLabel ?? cat.label,
      attempted,
      correct,
      accuracyPct: attempted === 0 ? 0 : Math.round((correct / attempted) * 100),
    };
  });
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD, local time
  attempted: number;
  correct: number;
  accuracyPct: number;
}

/**
 * Accuracy per day, for one category (or all when null). Days with no
 * attempts are omitted; results are sorted oldest-first.
 */
export function accuracyByDay(
  attempts: readonly Attempt[],
  categoryKey: string | null,
): DailyPoint[] {
  const map = new Map<string, { attempted: number; correct: number }>();
  for (const a of attempts) {
    if (categoryKey && a.subject !== categoryKey) continue;
    const d = new Date(a.answeredAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const row = map.get(key) ?? { attempted: 0, correct: 0 };
    row.attempted += 1;
    if (a.isCorrect) row.correct += 1;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([date, { attempted, correct }]) => ({
      date,
      attempted,
      correct,
      accuracyPct: Math.round((correct / attempted) * 100),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface QuestionAccuracy {
  questionId: string;
  categoryKey: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
}

/**
 * Accuracy per question across the whole history — the "weak spots"
 * list. Sorted weakest-first by accuracy; ties prefer more attempts
 * (more reliable signal). A minimum-attempts threshold keeps one-off
 * unlucky answers from dominating.
 */
export function weakestQuestions(
  attempts: readonly Attempt[],
  minAttempts = 2,
): QuestionAccuracy[] {
  const map = new Map<
    string,
    { categoryKey: string; attempted: number; correct: number }
  >();
  for (const a of attempts) {
    const row = map.get(a.questionId) ?? {
      categoryKey: a.subject,
      attempted: 0,
      correct: 0,
    };
    row.attempted += 1;
    if (a.isCorrect) row.correct += 1;
    map.set(a.questionId, row);
  }
  return [...map.entries()]
    .filter(([, r]) => r.attempted >= minAttempts)
    .map(([questionId, r]) => ({
      questionId,
      categoryKey: r.categoryKey,
      attempted: r.attempted,
      correct: r.correct,
      accuracyPct: Math.round((r.correct / r.attempted) * 100),
    }))
    .sort((a, b) => {
      if (a.accuracyPct !== b.accuracyPct) return a.accuracyPct - b.accuracyPct;
      return b.attempted - a.attempted;
    });
}

export function completedSessionDates(sessions: readonly Session[]): Date[] {
  return sessions
    .filter((s): s is Session & { endedAt: number } => s.endedAt !== null)
    .map((s) => new Date(s.endedAt));
}
