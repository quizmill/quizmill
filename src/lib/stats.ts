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

export interface LevelNudge {
  direction: 'up' | 'down';
  from: string; // current level key
  to: string; // suggested adjacent level key
  accuracyPct: number; // recent accuracy at `from`
  sample: number; // attempts weighed
}

export interface LevelNudgeOptions {
  /** How many of the most-recent attempts at the level to weigh. */
  window?: number;
  /** Don't nudge until this many attempts at the level exist. */
  minSample?: number;
  /** Recent accuracy at/above this suggests moving up. */
  upPct?: number;
  /** Recent accuracy at/below this suggests moving down. */
  downPct?: number;
}

/**
 * Adaptive level nudge: suggest moving up or down a level based on how the
 * learner is doing at the level they're currently on. Pure and generic —
 * attempts only store the category, so `levelOf` maps a questionId to its
 * level key (undefined if none); `levelKeys` is the manifest level order;
 * `current` is the active level filter (null = "All").
 *
 * Returns null when there's no clear signal: no level selected, too few
 * attempts at it, accuracy in the unremarkable middle, or already at the
 * relevant end of the ladder.
 */
export function levelNudge(
  attempts: readonly Attempt[],
  levelOf: (questionId: string) => string | undefined,
  levelKeys: readonly string[],
  current: string | null,
  opts: LevelNudgeOptions = {},
): LevelNudge | null {
  const { window = 8, minSample = 5, upPct = 80, downPct = 40 } = opts;
  if (!current) return null;
  const idx = levelKeys.indexOf(current);
  if (idx < 0) return null;

  const recent = attempts
    .filter((a) => levelOf(a.questionId) === current)
    .sort((a, b) => b.answeredAt - a.answeredAt)
    .slice(0, window);
  if (recent.length < minSample) return null;

  const correct = recent.filter((a) => a.isCorrect).length;
  const accuracyPct = Math.round((correct / recent.length) * 100);
  const up = levelKeys[idx + 1];
  const down = levelKeys[idx - 1];

  if (accuracyPct >= upPct && up) {
    return { direction: 'up', from: current, to: up, accuracyPct, sample: recent.length };
  }
  if (accuracyPct <= downPct && down) {
    return { direction: 'down', from: current, to: down, accuracyPct, sample: recent.length };
  }
  return null;
}
