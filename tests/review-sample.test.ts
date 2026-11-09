import { describe, expect, it } from 'vitest';
import { seededRng } from '@/lib/selection';
import { drawReviewSample } from '@/pack/review-sample';

/** A bank of `perCategory` questions in each of the given categories. */
function bank(categories: Record<string, number>) {
  return Object.entries(categories).flatMap(([categoryKey, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${categoryKey}-${i + 1}`, categoryKey })),
  );
}

const count = (qs: { categoryKey: string }[]) =>
  qs.reduce<Record<string, number>>((acc, q) => {
    acc[q.categoryKey] = (acc[q.categoryKey] ?? 0) + 1;
    return acc;
  }, {});

describe('drawReviewSample', () => {
  it('draws the batch size, with no duplicates, from a big bank', () => {
    const qs = bank({ a: 50, b: 50, c: 50 });
    const { picked, seen, cycled } = drawReviewSample(qs, { size: 20, rng: seededRng(1) });
    expect(picked).toHaveLength(20);
    expect(new Set(picked.map((q) => q.id)).size).toBe(20);
    expect(seen.size).toBe(20);
    expect(cycled).toBe(false);
  });

  it('spreads the draw evenly across categories', () => {
    const qs = bank({ a: 40, b: 40, c: 40, d: 40 });
    for (let seed = 1; seed <= 5; seed++) {
      const { picked } = drawReviewSample(qs, { size: 10, rng: seededRng(seed) });
      const perCategory = Object.values(count(picked));
      expect(perCategory).toHaveLength(4);
      // 10 over 4 categories: round-robin gives 3,3,2,2.
      expect(Math.max(...perCategory) - Math.min(...perCategory)).toBeLessThanOrEqual(1);
    }
  });

  it('lets the bigger categories fill the gap when a small one runs out', () => {
    const qs = bank({ tiny: 1, big: 30 });
    const { picked } = drawReviewSample(qs, { size: 10, rng: seededRng(3) });
    expect(picked).toHaveLength(10);
    expect(count(picked)).toEqual({ tiny: 1, big: 9 });
  });

  it('interleaves categories rather than grouping them', () => {
    const qs = bank({ a: 20, b: 20 });
    const { picked } = drawReviewSample(qs, { size: 10, rng: seededRng(7) });
    const keys = picked.map((q) => q.categoryKey);
    // Two categories of equal size alternate strictly.
    for (let i = 1; i < keys.length; i++) expect(keys[i]).not.toBe(keys[i - 1]);
  });

  it('never repeats a question until the whole bank has been shown', () => {
    const qs = bank({ a: 13, b: 12 }); // 25 questions, batches of 10
    let seen = new Set<string>();
    const shown: string[] = [];
    const rng = seededRng(11);

    const first = drawReviewSample(qs, { size: 10, seen, rng });
    const second = drawReviewSample(qs, { size: 10, seen: first.seen, rng });
    expect(first.cycled).toBe(false);
    expect(second.cycled).toBe(false);
    shown.push(...first.picked.map((q) => q.id), ...second.picked.map((q) => q.id));
    expect(new Set(shown).size).toBe(20);

    // Third draw: only 5 unseen remain — all five come first, then the
    // bank reopens for the other five.
    const third = drawReviewSample(qs, { size: 10, seen: second.seen, rng });
    expect(third.cycled).toBe(true);
    expect(third.picked).toHaveLength(10);
    const leftovers = qs.filter((q) => !second.seen.has(q.id)).map((q) => q.id);
    expect(third.picked.slice(0, 5).map((q) => q.id).sort()).toEqual(leftovers.sort());
    expect(new Set(third.picked.map((q) => q.id)).size).toBe(10);
    // The new cycle's seen set holds only the five taken from the reopened bank.
    expect(third.seen.size).toBe(5);
    for (const id of leftovers) expect(third.seen.has(id)).toBe(false);
    seen = third.seen;

    // And the next draw avoids those five.
    const fourth = drawReviewSample(qs, { size: 10, seen, rng });
    for (const q of fourth.picked) expect(seen.has(q.id)).toBe(false);
  });

  it('shows the whole pack when it is smaller than the batch', () => {
    const qs = bank({ a: 4, b: 3 });
    const { picked, seen, cycled } = drawReviewSample(qs, { size: 20, rng: seededRng(5) });
    expect(picked).toHaveLength(7);
    expect(cycled).toBe(false);
    expect(seen.size).toBe(7);
    // Drawing again from a fully-seen small bank reopens it — and still
    // shows everything, once each.
    const again = drawReviewSample(qs, { size: 20, seen, rng: seededRng(6) });
    expect(again.picked).toHaveLength(7);
    expect(new Set(again.picked.map((q) => q.id)).size).toBe(7);
  });

  it('handles an empty bank', () => {
    expect(drawReviewSample([], { size: 10 })).toEqual({
      picked: [],
      seen: new Set(),
      cycled: false,
    });
  });
});
