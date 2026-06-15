import { describe, it, expect } from 'vitest';
import {
  normalizeFriendCode,
  isValidFriendCode,
  normalizeShareCode,
  isValidShareCode,
} from '@/lib/friend-code';

describe('friend codes', () => {
  it('normalises spaces, underscores and case toward canonical form', () => {
    expect(normalizeFriendCode('brave otter 42')).toBe('BRAVE-OTTER-42');
    expect(normalizeFriendCode('Brave_Otter_42')).toBe('BRAVE-OTTER-42');
    expect(normalizeFriendCode('  BRAVE--OTTER--42  ')).toBe('BRAVE-OTTER-42');
    expect(normalizeFriendCode('-brave-otter-42-')).toBe('BRAVE-OTTER-42');
  });

  it('accepts canonical TWO-WORDS-NN codes', () => {
    expect(isValidFriendCode('brave otter 42')).toBe(true);
    expect(isValidFriendCode('HAPPY-PANDA-07')).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidFriendCode('brave-otter')).toBe(false); // no number
    expect(isValidFriendCode('brave-otter-4')).toBe(false); // 1 digit
    expect(isValidFriendCode('brave-otter-123')).toBe(false); // 3 digits
    expect(isValidFriendCode('brave-otter-4a')).toBe(false); // letter in digits
    expect(isValidFriendCode('')).toBe(false);
  });
});

describe('share codes', () => {
  it('normalises by stripping spaces/dashes and upcasing', () => {
    expect(normalizeShareCode('ab c-de f')).toBe('ABCDEF');
  });

  it('accepts 6 unambiguous chars and rejects ambiguous/short ones', () => {
    expect(isValidShareCode('ABCDEF')).toBe(true);
    expect(isValidShareCode('K7P2QR')).toBe(true);
    expect(isValidShareCode('ABC0EF')).toBe(false); // 0 is excluded
    expect(isValidShareCode('ABC1EF')).toBe(false); // 1 is excluded
    expect(isValidShareCode('ABCIEF')).toBe(false); // I is excluded
    expect(isValidShareCode('ABCDE')).toBe(false); // too short
  });
});
