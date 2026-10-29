import { describe, expect, it } from 'vitest';
import { confettiPieces, scoreTier } from '@/pack/ScoreCelebration';

describe('scoreTier', () => {
  it('is perfect only when every answered question is right', () => {
    expect(scoreTier(20, 20)).toBe('perfect');
    expect(scoreTier(1, 1)).toBe('perfect');
    expect(scoreTier(19, 20)).toBe('great');
  });

  it('scales down through great and good', () => {
    expect(scoreTier(16, 20)).toBe('great'); // 80%
    expect(scoreTier(15, 20)).toBe('good');
    expect(scoreTier(10, 20)).toBe('good'); // 50%
  });

  it('keeps a low mark (or nothing answered) quiet, never zero-shamed', () => {
    expect(scoreTier(9, 20)).toBe('steady');
    expect(scoreTier(0, 20)).toBe('steady');
    expect(scoreTier(0, 0)).toBe('steady');
  });
});

describe('confettiPieces', () => {
  it('is deterministic, so a re-render never reshuffles the burst', () => {
    expect(confettiPieces(40)).toEqual(confettiPieces(40));
  });

  it('spreads pieces across the screen width', () => {
    const lefts = confettiPieces(60).map((p) => p.left);
    expect(Math.min(...lefts)).toBeLessThan(15);
    expect(Math.max(...lefts)).toBeGreaterThan(85);
  });
});
