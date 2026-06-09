import { describe, expect, it } from 'vitest';
import {
  OTP_MAX_LENGTH,
  OTP_MIN_LENGTH,
  isOtpLongEnough,
  sanitiseOtpInput,
} from '../src/lib/otp';

describe('sanitiseOtpInput', () => {
  it('keeps an 8-character alphanumeric code intact (the original bug)', () => {
    // Pre-fix, this would have been truncated to 6 chars and the
    // letters would have been stripped to digits-only.
    expect(sanitiseOtpInput('AB3C4D5F')).toBe('AB3C4D5F');
  });

  it('uppercases letters so it matches the emailed code visually', () => {
    expect(sanitiseOtpInput('ab12cd34')).toBe('AB12CD34');
  });

  it('strips spaces, dashes, and other punctuation from a paste', () => {
    // Email clients sometimes wrap codes with prefixes or whitespace.
    expect(sanitiseOtpInput(' AB-34 5C ')).toBe('AB345C');
    expect(sanitiseOtpInput('code: 12-AB-34')).toBe('CODE12AB34');
  });

  it('caps overlong input at OTP_MAX_LENGTH (defensive against pasted noise)', () => {
    const long = 'A'.repeat(OTP_MAX_LENGTH + 5);
    expect(sanitiseOtpInput(long)).toHaveLength(OTP_MAX_LENGTH);
  });

  it('returns empty string for purely punctuation/whitespace input', () => {
    expect(sanitiseOtpInput('   ')).toBe('');
    expect(sanitiseOtpInput('-_-')).toBe('');
  });

  it('preserves pure-digit codes (the 6-digit case still works)', () => {
    expect(sanitiseOtpInput('123456')).toBe('123456');
  });
});

describe('isOtpLongEnough', () => {
  it('false for codes shorter than OTP_MIN_LENGTH', () => {
    expect(isOtpLongEnough('')).toBe(false);
    expect(isOtpLongEnough('ABC')).toBe(false);
    expect(isOtpLongEnough('A'.repeat(OTP_MIN_LENGTH - 1))).toBe(false);
  });

  it('true at the minimum length boundary', () => {
    expect(isOtpLongEnough('A'.repeat(OTP_MIN_LENGTH))).toBe(true);
  });

  it('true for the 8-char codes the bug-reporting kid is receiving', () => {
    expect(isOtpLongEnough('AB3C4D5F')).toBe(true);
  });

  it('trims surrounding whitespace before checking', () => {
    expect(isOtpLongEnough(`   ${'A'.repeat(OTP_MIN_LENGTH)}   `)).toBe(true);
    expect(isOtpLongEnough('     AB     ')).toBe(false);
  });
});
