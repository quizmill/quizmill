import { describe, expect, it } from 'vitest';
import {
  SYNC_KEY_ALPHABET,
  SYNC_KEY_LENGTH,
  generateSyncKey,
  hashSyncKey,
  isValidSyncKey,
  maskSyncKey,
  normalizeSyncKey,
} from '../src/lib/syncKey';

const CANONICAL = /^QM(-[A-Z2-9]{5}){4}$/;

describe('generateSyncKey', () => {
  it('produces the canonical QM-XXXXX-XXXXX-XXXXX-XXXXX form', () => {
    const key = generateSyncKey();
    expect(key).toMatch(CANONICAL);
    for (const ch of key.replace(/^QM/, '').replace(/-/g, '')) {
      expect(SYNC_KEY_ALPHABET).toContain(ch);
    }
  });

  it('never emits ambiguous symbols (0/O, 1/I/L, U)', () => {
    for (const banned of ['0', 'O', '1', 'I', 'L', 'U']) {
      expect(SYNC_KEY_ALPHABET).not.toContain(banned);
    }
  });

  it('generates distinct keys', () => {
    expect(generateSyncKey()).not.toBe(generateSyncKey());
  });

  it('rejection-samples instead of biasing via modulo', () => {
    // Feed bytes ≥ 240 first — they must be discarded, not mapped. A biased
    // modulo implementation would turn 240 into alphabet[0] ('A').
    let calls = 0;
    const scripted = (n: number): Uint8Array => {
      calls += 1;
      // First batch: all 255 (rejected). Later batches: all 0 → 'A…A'.
      return new Uint8Array(n).fill(calls === 1 ? 255 : 0);
    };
    const key = generateSyncKey(scripted);
    expect(key).toBe('QM-AAAAA-AAAAA-AAAAA-AAAAA');
    expect(calls).toBeGreaterThan(1); // the all-255 batch was thrown away
  });
});

describe('normalizeSyncKey', () => {
  it('canonicalises case, spaces, and missing separators', () => {
    const key = generateSyncKey();
    const sloppy = key.toLowerCase().replace(/-/g, ' ');
    expect(normalizeSyncKey(sloppy)).toBe(key);
    expect(normalizeSyncKey(key.replace(/-/g, ''))).toBe(key);
  });

  it('accepts the body with the QM prefix omitted', () => {
    const key = generateSyncKey();
    const body = key.slice(3); // drop "QM-"
    expect(normalizeSyncKey(body)).toBe(key);
  });

  it('rejects wrong lengths, bad symbols, and junk', () => {
    expect(normalizeSyncKey('')).toBeNull();
    expect(normalizeSyncKey('QM-SHORT')).toBeNull();
    expect(normalizeSyncKey('A'.repeat(SYNC_KEY_LENGTH + 1))).toBeNull();
    // Right length but contains a symbol outside the alphabet (0).
    expect(normalizeSyncKey('0'.repeat(SYNC_KEY_LENGTH))).toBeNull();
    expect(isValidSyncKey('not a key')).toBe(false);
    expect(isValidSyncKey(generateSyncKey())).toBe(true);
  });
});

describe('hashSyncKey', () => {
  it('yields a stable 64-hex id, insensitive to case and separators', async () => {
    const key = generateSyncKey();
    const a = await hashSyncKey(key);
    const b = await hashSyncKey(key.toLowerCase().replace(/-/g, ''));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it('maps different keys to different ids', async () => {
    expect(await hashSyncKey(generateSyncKey())).not.toBe(
      await hashSyncKey(generateSyncKey()),
    );
  });

  it('throws on invalid input rather than hashing garbage', async () => {
    await expect(hashSyncKey('nope')).rejects.toThrow();
  });
});

describe('maskSyncKey', () => {
  it('keeps the first group readable and hides the rest', () => {
    const masked = maskSyncKey('QM-ABCDE-FGHJK-MNPQR-STVWX');
    expect(masked).toBe('QM-ABCDE-•••••-•••••-•••••');
  });
});
