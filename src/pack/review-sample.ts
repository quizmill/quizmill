import { shuffle, type Rng } from '@/lib/selection';

/** How many questions one review draw shows. */
export type ReviewBatchSize = 10 | 20;

export const REVIEW_BATCH_SIZES: readonly ReviewBatchSize[] = [10, 20];

/** The shape the sampler reads — any question with an id and a category. */
export interface ReviewSampleQuestion {
  id: string;
  categoryKey: string;
}

export interface ReviewDraw<Q extends ReviewSampleQuestion> {
  /** The questions to show, interleaved across categories. */
  picked: Q[];
  /** `seen` plus this draw's ids — pass it back on the next draw. Empty
   *  again once every question in the bank has been shown. */
  seen: Set<string>;
  /** True when this draw had to start a new cycle: fewer unseen questions
   *  were left than the batch asked for, so the bank was reopened. */
  cycled: boolean;
}

/**
 * Draw the next batch for the pack review page: `size` questions spread
 * across the pack's categories, preferring questions not yet shown this
 * visit. Nothing is stored — `seen` lives in the page's memory.
 *
 * Spread: every category contributes in turn (its questions shuffled),
 * round-robin, until the batch is full, so a 10-question draw from a
 * 4-category pack shows at least two from each category rather than
 * whatever a plain shuffle lands on. Categories with fewer questions
 * drop out of the rotation once empty and the rest fill the gap.
 *
 * Repeats: unseen questions go first. When fewer unseen remain than
 * `size`, those are all taken and the shortfall comes from the start of
 * a new cycle — so "draw again" walks the whole bank before anything
 * repeats, and the returned `seen` then holds only the new cycle's ids.
 */
export function drawReviewSample<Q extends ReviewSampleQuestion>(
  bank: readonly Q[],
  options: { size: number; seen?: ReadonlySet<string>; rng?: Rng },
): ReviewDraw<Q> {
  const rng = options.rng ?? Math.random;
  const size = Math.max(0, Math.min(options.size, bank.length));
  const seen = options.seen ?? new Set<string>();
  const unseen = bank.filter((q) => !seen.has(q.id));

  const picked = interleaveByCategory(unseen, rng).slice(0, size);
  const cycled = picked.length < size;
  if (cycled) {
    const pickedIds = new Set(picked.map((q) => q.id));
    const rest = bank.filter((q) => !pickedIds.has(q.id));
    picked.push(...interleaveByCategory(rest, rng).slice(0, size - picked.length));
  }

  // On a cycle the new `seen` is just the questions taken from the
  // reopened bank: the leftovers of the old cycle have all been shown now.
  const leftoverIds = new Set(unseen.map((q) => q.id));
  const nextSeen = cycled
    ? new Set(picked.filter((q) => !leftoverIds.has(q.id)).map((q) => q.id))
    : new Set([...seen, ...picked.map((q) => q.id)]);
  return { picked, seen: nextSeen, cycled };
}

/** Shuffle within each category, then take one from each in turn. */
function interleaveByCategory<Q extends ReviewSampleQuestion>(
  questions: readonly Q[],
  rng: Rng,
): Q[] {
  const byCategory = new Map<string, Q[]>();
  for (const q of shuffle(questions, rng)) {
    const list = byCategory.get(q.categoryKey);
    if (list) list.push(q);
    else byCategory.set(q.categoryKey, [q]);
  }
  const buckets = shuffle([...byCategory.values()], rng);
  const out: Q[] = [];
  for (let i = 0; out.length < questions.length; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) out.push(bucket[i]);
    }
  }
  return out;
}
