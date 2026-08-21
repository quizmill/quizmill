/**
 * Sync keys — the auth model for the Cloudflare Worker sync backend.
 *
 * There is no email flow and no account database: a device holds a random
 * high-entropy key, every request carries it as a bearer token, and the
 * worker partitions data by SHA-256(key). Entering the same key on another
 * device links the two — like a Wi-Fi password for your practice history.
 *
 * Format: `QM-XXXXX-XXXXX-XXXXX-XXXXX` — 20 symbols from a 30-character
 * alphabet (~98 bits of entropy), chosen to survive handwriting and
 * read-aloud: no 0/O, 1/I/L, or U (visually/aurally ambiguous). Input is
 * normalised case- and separator-insensitively, so `qm abcde …` works.
 *
 * Pure module (crypto injected/global) so every rule is unit-testable.
 */

/** 30 unambiguous symbols — no 0/O, 1/I/L, U. */
export const SYNC_KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

const GROUPS = 4;
const GROUP_LEN = 5;
/** Symbols in a key body (prefix and separators excluded). */
export const SYNC_KEY_LENGTH = GROUPS * GROUP_LEN;

const PREFIX = 'QM';

/**
 * Generate a fresh key, e.g. `QM-H3KDA-P9RWX-T2MNQ-C7FGB`.
 * Uses rejection sampling so every symbol is uniformly likely (256 isn't a
 * multiple of 30 — plain modulo would bias the front of the alphabet).
 */
export function generateSyncKey(
  randomBytes: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const limit = 256 - (256 % SYNC_KEY_ALPHABET.length); // 240
  const symbols: string[] = [];
  while (symbols.length < SYNC_KEY_LENGTH) {
    for (const byte of randomBytes(SYNC_KEY_LENGTH)) {
      if (byte < limit && symbols.length < SYNC_KEY_LENGTH) {
        symbols.push(SYNC_KEY_ALPHABET[byte % SYNC_KEY_ALPHABET.length]);
      }
    }
  }
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    groups.push(symbols.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN).join(''));
  }
  return `${PREFIX}-${groups.join('-')}`;
}

/**
 * Canonicalise raw user input into the `QM-XXXXX-…` form, or return null
 * when it isn't a plausible key. Tolerates case, spaces, and any (or no)
 * separators; the `QM` prefix is optional on input.
 */
export function normalizeSyncKey(raw: string): string | null {
  let body = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (body.startsWith(PREFIX) && body.length === PREFIX.length + SYNC_KEY_LENGTH) {
    body = body.slice(PREFIX.length);
  }
  if (body.length !== SYNC_KEY_LENGTH) return null;
  for (const ch of body) {
    if (!SYNC_KEY_ALPHABET.includes(ch)) return null;
  }
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    groups.push(body.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN));
  }
  return `${PREFIX}-${groups.join('-')}`;
}

/** True when the input canonicalises to a valid key. */
export function isValidSyncKey(raw: string): boolean {
  return normalizeSyncKey(raw) !== null;
}

/**
 * The user id a key maps to: SHA-256 over the canonical key with all
 * separators stripped ("QMABCDE…"), hex-encoded. The worker derives the
 * same value server-side from the bearer token, so client and server agree
 * on identity without ever storing the key anywhere but the device.
 */
export async function hashSyncKey(key: string): Promise<string> {
  const canonical = normalizeSyncKey(key);
  if (!canonical) throw new Error('not a valid sync key');
  const material = canonical.replace(/[^A-Z0-9]/g, '');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Key names ───────────────────────────────────────────────────────────
//
// A key is unguessable noise by design, which makes "is this the iPad's
// key or my son's?" unanswerable from the key alone. So a key may carry
// one optional name the learner picks ("Leo", "Dad's key"). The name is
// mirrored to the sync server against the same hashed user id, so it
// travels to every device that enters the key — and, like the key itself,
// it is app-level rather than per-pack.

/** Longest name kept, in code points (so emoji survive whole). */
export const MAX_KEY_NAME_LENGTH = 40;

function isControl(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x20 || cp === 0x7f;
}

/**
 * Canonicalise a name: control characters become spaces, runs of
 * whitespace collapse, the ends are trimmed, and the result is clamped to
 * MAX_KEY_NAME_LENGTH code points (clamping by code point, not by UTF-16
 * unit, so a trailing emoji is kept whole rather than split into half a
 * surrogate pair). `''` means "no name".
 *
 * MUST match normalizeKeyName in cloudflare/src/ops.ts — client and
 * server canonicalise identically, so what you type is what comes back
 * on the other device (asserted in tests/worker-sync.test.ts).
 */
export function normalizeKeyName(raw: string): string {
  const flattened = Array.from(raw)
    .map((ch) => (isControl(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(flattened).slice(0, MAX_KEY_NAME_LENGTH).join('').trim();
}

/**
 * How to refer to a key in prose: its name when it has one, else a short
 * fingerprint of the key itself (`QM-H3KDA…`) — enough to tell two keys
 * apart on screen without printing either in full.
 */
export function syncKeyLabel(key: string, name?: string | null): string {
  const named = normalizeKeyName(name ?? '');
  if (named) return named;
  const canonical = normalizeSyncKey(key);
  return canonical ? `${canonical.split('-').slice(0, 2).join('-')}…` : 'this key';
}

/**
 * A mailto: URL that opens the user's own mail app with the key pre-filled,
 * addressed to nobody — they send it to themselves. This is the recovery
 * story for lost keys with zero infrastructure: the email goes out through
 * the user's mail client, so no server (ours included) ever sees the key
 * or the address. Recovery = search your inbox for the app's name.
 */
export function syncKeyMailto(
  key: string,
  appTitle: string,
  name?: string | null,
): string {
  const canonical = normalizeSyncKey(key) ?? key;
  const named = normalizeKeyName(name ?? '');
  // The name goes in the subject too: recovery is "search your inbox",
  // and a household with two keys needs to know which mail is whose.
  const subject = named
    ? `${appTitle} — sync key for ${named}`
    : `${appTitle} — sync key`;
  const body =
    (named ? `Sync key for ${named} (${appTitle}):\n\n` : `Your sync key for ${appTitle}:\n\n`) +
    `${canonical}\n\n` +
    `To link a new device (or recover your progress), open the app, go to ` +
    `Settings → Sync across devices, and enter this key.\n\n` +
    `Keep this email — anyone with the key can access this practice history.`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Masked rendering for the Settings card, e.g. `QM-H3KDA-•••••-•••••-•••••`. */
export function maskSyncKey(key: string): string {
  const canonical = normalizeSyncKey(key);
  if (!canonical) return '•••';
  const parts = canonical.split('-');
  return [parts[0], parts[1], ...parts.slice(2).map((p) => '•'.repeat(p.length))].join('-');
}
