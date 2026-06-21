import { describe, expect, it } from 'vitest';
import { buildWeakSpotPool, shakyCategories } from '@/lib/weakSpots';
import type { Attempt } from '@/data/types';

let seq = 0;
function attempt(
  questionId: string,
  subject: string,
  isCorrect: boolean,
  agoMs = 0,
): Attempt {
  return {
    id: `a${seq++}`,
    sessionId: 's',
    questionId,
    answeredAt: Date.now() - agoMs,
    selectedAnswer: 'A',
    isCorrect,
    timeTakenSeconds: 1,
    subject,
    topic: questionId, // per-question rescue, as the pack runner records it
    difficulty: 1,
  };
}

function bank(ids: [string, string][]): { id: string; categoryKey: string }[] {
  return ids.map(([id, categoryKey]) => ({ id, categoryKey }));
}

describe('shakyCategories', () => {
  it('flags a category below the accuracy threshold with enough attempts', () => {
    const attempts = [
      attempt('q1', 'maths', false),
      attempt('q2', 'maths', false),
      attempt('q3', 'maths', true),
      attempt('q4', 'maths', false),
    ];
    // 1/4 = 25% ≤ 70%, 4 attempts ≥ 4 → shaky.
    expect([...shakyCategories(attempts)]).toEqual(['maths']);
  });

  it('ignores a category without enough attempts', () => {
    const attempts = [attempt('q1', 'maths', false), attempt('q2', 'maths', false)];
    expect(shakyCategories(attempts).size).toBe(0);
  });

  it('ignores a strong category', () => {
    const attempts = [
      attempt('q1', 'maths', true),
      attempt('q2', 'maths', true),
      attempt('q3', 'maths', true),
      attempt('q4', 'maths', false),
    ];
    // 3/4 = 75% > 70% → not shaky.
    expect(shakyCategories(attempts).size).toBe(0);
  });
});

describe('buildWeakSpotPool', () => {
  it('is empty with no signal', () => {
    const out = buildWeakSpotPool(bank([['q1', 'c']]), [], new Set());
    expect(out.orderedIds).toEqual([]);
    expect(out.breakdown.total).toBe(0);
  });

  it('leads with unresolved mistakes', () => {
    const b = bank([['q1', 'c'], ['q2', 'c']]);
    const attempts = [attempt('q1', 'c', false)];
    const out = buildWeakSpotPool(b, attempts, new Set());
    expect(out.orderedIds[0]).toBe('q1');
    expect(out.breakdown.mistakes).toBe(1);
  });

  it('includes starred questions even when answered correctly', () => {
    const b = bank([['q1', 'c'], ['q2', 'c']]);
    const attempts = [attempt('q2', 'c', true)];
    const out = buildWeakSpotPool(b, attempts, new Set(['q2']));
    expect(out.orderedIds).toContain('q2');
    expect(out.breakdown.starred).toBe(1);
  });

  it('does not double-count a starred mistake (mistake wins)', () => {
    const b = bank([['q1', 'c']]);
    const attempts = [attempt('q1', 'c', false)];
    const out = buildWeakSpotPool(b, attempts, new Set(['q1']));
    expect(out.orderedIds).toEqual(['q1']);
    expect(out.breakdown.mistakes).toBe(1);
    expect(out.breakdown.starred).toBe(0);
    expect(out.breakdown.total).toBe(1);
  });

  it('pulls fresh (unseen) questions from a shaky category', () => {
    // q1/q2 answered, category weak; q3 unseen in the same category.
    const b = bank([['q1', 'c'], ['q2', 'c'], ['q3', 'c'], ['q4', 'other']]);
    const attempts = [
      attempt('q1', 'c', false),
      attempt('q2', 'c', false),
      attempt('q1', 'c', false),
      attempt('q2', 'c', false),
    ];
    const out = buildWeakSpotPool(b, attempts, new Set());
    expect(out.orderedIds).toContain('q3');
    expect(out.orderedIds).not.toContain('q4'); // different, healthy category
    expect(out.breakdown.shaky).toBeGreaterThan(0);
  });

  it('skips ids that are not in the bank', () => {
    const out = buildWeakSpotPool(bank([['q1', 'c']]), [], new Set(['ghost']));
    expect(out.orderedIds).toEqual([]);
  });
});
