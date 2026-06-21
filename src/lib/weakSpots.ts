/**
 * Weak-spot pooling — the unified "practice what you're weak at" selection.
 *
 * Two features used to look like one ("review mistakes" vs "starred"), so
 * this composes their signals into a single, prioritised drill pool. A
 * question earns a place for any of three reasons, in priority order:
 *
 *   1. MISTAKE  — an unresolved wrong answer (mistakes.ts). Exact repair.
 *   2. STARRED  — the learner flagged it. Explicit intent signal.
 *   3. SHAKY    — the system flagged it: a low-accuracy question you've
 *                 seen, or (to broaden) an unseen question in a category
 *                 whose overall accuracy is weak.
 *
 * The result is a de-duplicated, ordered id list plus a breakdown the UI
 * uses for its "N mistakes · N saved · N shaky" copy. Pure data in, pure
 * data out — engine-clean and trivially testable.
 */
import type { Attempt } from '@/data/types';
import { unresolvedMistakeIds } from './mistakes';
import { weakestQuestions } from './stats';

/** The minimal question shape the pool needs (the pack maps its own). */
export interface WeakSpotQuestion {
  id: string;
  categoryKey: string;
}

export interface WeakSpotBreakdown {
  /** Unresolved mistakes still in the bank. */
  mistakes: number;
  /** Starred questions still in the bank (and not already a mistake). */
  starred: number;
  /** System-flagged low-accuracy / weak-category questions. */
  shaky: number;
  /** Distinct candidate questions across all three. */
  total: number;
}

export interface WeakSpotPool {
  /** Ordered question ids: mistakes, then starred, then shaky. */
  orderedIds: string[];
  breakdown: WeakSpotBreakdown;
}

export interface WeakSpotOptions {
  /** A category needs at least this many attempts to be judged shaky. */
  minCategoryAttempts?: number;
  /** Accuracy at/below this (percent) counts as shaky. */
  maxAccuracyPct?: number;
  /** A question needs at least this many attempts to be judged shaky. */
  minQuestionAttempts?: number;
}

const DEFAULTS = {
  minCategoryAttempts: 4,
  maxAccuracyPct: 70,
  minQuestionAttempts: 2,
};

/**
 * Categories whose overall accuracy is weak (enough attempts, low hit
 * rate). Used to broaden the pool with fresh questions in areas the
 * learner struggles with, not just questions they've already missed.
 */
export function shakyCategories(
  attempts: readonly Attempt[],
  minAttempts: number = DEFAULTS.minCategoryAttempts,
  maxAccuracyPct: number = DEFAULTS.maxAccuracyPct,
): Set<string> {
  const map = new Map<string, { attempted: number; correct: number }>();
  for (const a of attempts) {
    const row = map.get(a.subject) ?? { attempted: 0, correct: 0 };
    row.attempted += 1;
    if (a.isCorrect) row.correct += 1;
    map.set(a.subject, row);
  }
  const out = new Set<string>();
  for (const [cat, r] of map) {
    if (r.attempted >= minAttempts && (r.correct / r.attempted) * 100 <= maxAccuracyPct) {
      out.add(cat);
    }
  }
  return out;
}

/**
 * Build the prioritised weak-spot pool over a question bank. Mistakes lead
 * (exact repair), then the learner's starred questions, then system-flagged
 * shaky questions and fresh questions from weak categories. De-duplicated,
 * with each question attributed to the highest-priority reason it qualified.
 */
export function buildWeakSpotPool<Q extends WeakSpotQuestion>(
  bank: readonly Q[],
  attempts: readonly Attempt[],
  starredIds: ReadonlySet<string>,
  options: WeakSpotOptions = {},
): WeakSpotPool {
  const opts = { ...DEFAULTS, ...options };
  const inBank = new Set(bank.map((q) => q.id));

  const seen = new Set<string>();
  const orderedIds: string[] = [];
  let mistakes = 0;
  let starred = 0;
  let shaky = 0;

  const add = (id: string, bucket: 'mistake' | 'starred' | 'shaky'): void => {
    if (!inBank.has(id) || seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
    if (bucket === 'mistake') mistakes += 1;
    else if (bucket === 'starred') starred += 1;
    else shaky += 1;
  };

  // 1. Unresolved mistakes — most-recent first.
  for (const id of unresolvedMistakeIds(attempts)) add(id, 'mistake');

  // 2. Starred — the learner's own intent signal.
  for (const id of starredIds) add(id, 'starred');

  // 3a. Individually shaky questions you've seen but not mastered.
  for (const w of weakestQuestions(attempts, opts.minQuestionAttempts)) {
    if (w.accuracyPct <= opts.maxAccuracyPct) add(w.questionId, 'shaky');
  }

  // 3b. Broaden: fresh (unseen) questions in weak categories.
  const cats = shakyCategories(attempts, opts.minCategoryAttempts, opts.maxAccuracyPct);
  if (cats.size > 0) {
    const attemptedIds = new Set(attempts.map((a) => a.questionId));
    for (const q of bank) {
      if (cats.has(q.categoryKey) && !attemptedIds.has(q.id)) add(q.id, 'shaky');
    }
  }

  return {
    orderedIds,
    breakdown: { mistakes, starred, shaky, total: orderedIds.length },
  };
}
