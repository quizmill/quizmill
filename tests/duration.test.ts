import { describe, expect, it } from 'vitest';
import { formatSpan } from '@/lib/duration';

describe('formatSpan', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatSpan(0)).toBe('0 s');
    expect(formatSpan(45)).toBe('45 s');
    expect(formatSpan(130)).toBe('2 min');
    expect(formatSpan(3900)).toBe('1 h 05 min');
  });

  it('rounds to the nearest minute once past a minute', () => {
    expect(formatSpan(60)).toBe('1 min');
    expect(formatSpan(89)).toBe('1 min');
    expect(formatSpan(90)).toBe('2 min');
    expect(formatSpan(270)).toBe('5 min');
    expect(formatSpan(3570)).toBe('1 h 00 min'); // 59.5 min rounds up to the hour
  });
});
