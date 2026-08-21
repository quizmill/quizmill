import { describe, expect, it } from 'vitest';
import {
  MAX_KEY_NAME_LENGTH,
  SYNC_KEY_ALPHABET,
  SYNC_KEY_LENGTH,
  generateSyncKey,
  hashSyncKey,
  isValidSyncKey,
  maskSyncKey,
  normalizeKeyName,
  normalizeSyncKey,
  syncKeyLabel,
  syncKeyMailto,
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

describe('syncKeyMailto (self-email recovery)', () => {
  it('builds a mailto: with no recipient, the app name, and the canonical key', () => {
    const key = 'QM-ABCDE-FGHJK-MNPQR-STVWX';
    const url = syncKeyMailto(key.toLowerCase(), 'Solar System Practice');
    expect(url.startsWith('mailto:?')).toBe(true); // user picks the recipient
    const params = new URLSearchParams(url.slice('mailto:?'.length));
    expect(params.get('subject')).toContain('Solar System Practice');
    const body = params.get('body') ?? '';
    expect(body).toContain(key); // canonicalised, despite lowercase input
    expect(body).toContain('Settings');
  });
});

describe('normalizeKeyName (readable names for keys)', () => {
  it('keeps an ordinary name as typed', () => {
    expect(normalizeKeyName('Leo')).toBe('Leo');
    expect(normalizeKeyName("Dad's key")).toBe("Dad's key");
  });

  it('trims and collapses whitespace', () => {
    expect(normalizeKeyName('   Leo   ')).toBe('Leo');
    expect(normalizeKeyName('Leo\t\n  iPad')).toBe('Leo iPad');
  });

  it('flattens control characters instead of storing them', () => {
    expect(normalizeKeyName('Le\u0000o\u007f')).toBe('Le o');
  });

  it("treats a blank name as 'no name'", () => {
    expect(normalizeKeyName('')).toBe('');
    expect(normalizeKeyName('   \n ')).toBe('');
  });

  it('clamps to the maximum length, without a dangling space', () => {
    const long = 'Leo '.repeat(40);
    const clamped = normalizeKeyName(long);
    expect(Array.from(clamped).length).toBeLessThanOrEqual(MAX_KEY_NAME_LENGTH);
    expect(clamped).toBe(clamped.trim());
  });

  it('clamps by code point, so a trailing emoji is never split in half', () => {
    const rockets = '\u{1F680}'.repeat(MAX_KEY_NAME_LENGTH + 5);
    const clamped = normalizeKeyName(rockets);
    expect(Array.from(clamped)).toHaveLength(MAX_KEY_NAME_LENGTH);
    // A UTF-16 slice would leave a lone surrogate here.
    expect(clamped).toBe('\u{1F680}'.repeat(MAX_KEY_NAME_LENGTH));
    expect(clamped.includes('\uFFFD')).toBe(false);
  });

  it('is idempotent — normalising twice changes nothing', () => {
    const once = normalizeKeyName('  Leo   \u0007 iPad  ');
    expect(normalizeKeyName(once)).toBe(once);
  });
});

describe('syncKeyLabel', () => {
  it('prefers the name when the key has one', () => {
    expect(syncKeyLabel('QM-ABCDE-FGHJK-MNPQR-STVWX', 'Leo')).toBe('Leo');
  });

  it('falls back to a short fingerprint, never the whole key', () => {
    const label = syncKeyLabel('QM-ABCDE-FGHJK-MNPQR-STVWX', null);
    expect(label).toBe('QM-ABCDE\u2026');
    expect(label).not.toContain('STVWX');
  });

  it('survives a junk key without throwing', () => {
    expect(syncKeyLabel('nonsense', '')).toBe('this key');
  });
});

describe('syncKeyMailto with a named key', () => {
  it('names the key in the subject and body, so two keys look different', () => {
    const url = syncKeyMailto('QM-ABCDE-FGHJK-MNPQR-STVWX', 'Eleven Plus', 'Leo');
    const params = new URLSearchParams(url.slice('mailto:?'.length));
    expect(params.get('subject')).toBe('Eleven Plus \u2014 sync key for Leo');
    expect(params.get('body')).toContain('Sync key for Leo');
  });

  it('falls back to the unnamed wording for a nameless key', () => {
    const url = syncKeyMailto('QM-ABCDE-FGHJK-MNPQR-STVWX', 'Eleven Plus', '  ');
    const params = new URLSearchParams(url.slice('mailto:?'.length));
    expect(params.get('subject')).toBe('Eleven Plus \u2014 sync key');
    expect(params.get('body')).toContain('Your sync key for Eleven Plus');
  });
});
