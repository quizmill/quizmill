/**
 * Pure rules + SQL for the worker's licence-key unlock service — the
 * serving end of the app's `/unlock` route (src/lib/unlock.ts) and of
 * `quizmill share` (cli/bin/quizmill.js). Kept free of Cloudflare types
 * so every rule is unit-tested from the engine's vitest suite
 * (tests/worker-unlock.test.ts), exactly like ops.ts and analytics.ts;
 * worker.ts binds the statements to D1 and the bundles to R2.
 *
 * Wire protocol:
 *   GET    /v1/unlock?key=<key>[&pack=<id>]
 *            200  the pack bundle (quizmill-pack-bundle), ETag: "<version>"
 *            304  when If-None-Match carries that ETag
 *            403  { error }  key unknown / revoked / over its use limit
 *            404  { error }  `pack` was passed and the key opens another
 *   PUT    /v1/packs/:id          bearer UNLOCK_ADMIN_TOKEN; body = bundle
 *            stores it, mints the pack's first key when it has none
 *            → { ok, id, version, questions, bytes, keys: [...] }
 *   POST   /v1/packs/:id/keys     bearer; { label?, maxUses? } → { key }
 *   GET    /v1/packs/:id/keys     bearer; → { keys: [...] }
 *   DELETE /v1/keys/:key          bearer; revoke → { ok, key }
 *
 * Trust model: a licence key is the capability to DOWNLOAD one pack's
 * bundle — the author mints keys, hands them out (a share link, a
 * purchase receipt) and revokes them; the worker never lists packs and
 * never serves a bundle without a live key, so an unknown key reveals
 * nothing about whether a pack exists. Keys are stored in clear (the
 * author lists them back), unlike sync keys, which are hashed: holding a
 * licence key opens a pack's content, not anyone's practice history.
 *
 * Stored keys are OPAQUE strings: whatever the table holds unlocks, as
 * given. `QL-XXXX-XXXX-XXXX` is only what `share` mints; a writer with
 * table access may insert keys in another provider's format and they
 * unlock the same way. The routes reject only empty and over-long input.
 */
import type { SqlStatement } from './ops';

// ── Key format ──────────────────────────────────────────────────────────
//
// `QL-XXXX-XXXX-XXXX`: 12 symbols of Crockford base32 (60 bits), chosen
// to survive being read aloud and typed on a phone — no I/L/O/U, and on
// input the Crockford confusables fold (i/l → 1, o → 0). Visibly a
// different thing from a `QM-` sync key, which opens a learner's
// history rather than a pack.

/** The longest key the routes will look up; anything longer is refused
 *  with the unknown-key words, like an empty one. */
export const MAX_LICENCE_KEY_LENGTH = 128;

/** Crockford base32 — digits then letters without I, L, O, U. */
export const LICENCE_KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const PREFIX = 'QL';
const GROUPS = 3;
const GROUP_LEN = 4;
/** Symbols in a key body (prefix and separators excluded). */
export const LICENCE_KEY_LENGTH = GROUPS * GROUP_LEN;

/**
 * Mint a fresh key, e.g. `QL-7F3K-9Q2M-X4PD`. 32 divides 256, so a byte's
 * low five bits are uniform — no rejection sampling needed.
 */
export function generateLicenceKey(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const symbols = Array.from(randomBytes(LICENCE_KEY_LENGTH), (b) => LICENCE_KEY_ALPHABET[b & 31]);
  return formatLicenceKey(symbols.join(''));
}

function formatLicenceKey(body: string): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    groups.push(body.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN));
  }
  return `${PREFIX}-${groups.join('-')}`;
}

/**
 * Canonicalise raw input into the `QL-XXXX-XXXX-XXXX` form, or null when
 * it isn't a plausible key. Tolerates case, spaces, any (or no)
 * separators, the Crockford confusables and an optional `QL` prefix.
 * The stored key is always the canonical form, so a lookup by the
 * canonical form is exact.
 */
export function normalizeLicenceKey(raw: string): string | null {
  let body = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (body.startsWith(PREFIX) && body.length === PREFIX.length + LICENCE_KEY_LENGTH) {
    body = body.slice(PREFIX.length);
  }
  body = body.replace(/[IL]/g, '1').replace(/O/g, '0');
  if (body.length !== LICENCE_KEY_LENGTH) return null;
  for (const ch of body) {
    if (!LICENCE_KEY_ALPHABET.includes(ch)) return null;
  }
  return formatLicenceKey(body);
}

/**
 * The stored keys a raw input may name, in lookup order: the input
 * exactly as given (stored keys are opaque, so a key in another
 * provider's format matches only this way), then — when it reads as a
 * typed QL key and differs — its canonical form. Whitespace around the
 * input is a paste artefact, never part of a key, and is dropped first.
 * Empty for input that is empty or over-long, which is refused without
 * a lookup.
 */
export function licenceKeyCandidates(raw: string): string[] {
  const key = raw.trim();
  if (key.length === 0 || key.length > MAX_LICENCE_KEY_LENGTH) return [];
  const canonical = normalizeLicenceKey(key);
  return canonical && canonical !== key ? [key, canonical] : [key];
}

// ── Ids and labels ──────────────────────────────────────────────────────

/** The manifest's own rule for a pack id (tools/pack/schema.ts). */
const PACK_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_PACK_ID_LENGTH = 40;
const MAX_LABEL_LENGTH = 80;
/** Browsers keep an inserted pack in ~5 MiB; well past that is not a pack. */
export const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;

export function isPackId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_PACK_ID_LENGTH && PACK_ID.test(v);
}

/** The R2 object a pack's bundle lives under. */
export function bundleObjectKey(packId: string): string {
  return `${packId}.json`;
}

// ── Rows ────────────────────────────────────────────────────────────────

/** One `licence_keys` row as D1 returns it. */
export interface LicenceKeyRow {
  key: string;
  pack_id: string;
  label: string;
  uses: number;
  max_uses: number | null;
  created_at: string;
  revoked_at: string | null;
}

/** The same row as the API speaks it. */
export interface LicenceKey {
  key: string;
  packId: string;
  label: string;
  uses: number;
  maxUses: number | null;
  createdAt: string;
  revokedAt: string | null;
}

export function toLicenceKey(row: LicenceKeyRow): LicenceKey {
  return {
    key: row.key,
    packId: row.pack_id,
    label: row.label,
    uses: row.uses,
    maxUses: row.max_uses,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

const ROW_COLUMNS = 'key, pack_id, label, uses, max_uses, created_at, revoked_at';

export function keyLookupStatement(key: string): SqlStatement {
  return { sql: `SELECT ${ROW_COLUMNS} FROM licence_keys WHERE key = ?`, params: [key] };
}

/**
 * The rows any of `candidates` (licenceKeyCandidates) names; the caller
 * takes the first in candidate order. Null when there is nothing to
 * look up.
 */
export function keyCandidatesLookupStatement(candidates: string[]): SqlStatement | null {
  if (candidates.length === 0) return null;
  const marks = candidates.map(() => '?').join(', ');
  return { sql: `SELECT ${ROW_COLUMNS} FROM licence_keys WHERE key IN (${marks})`, params: candidates };
}

/** Every key of a pack, oldest first (insertion order breaks a tie within
 *  one millisecond) — what `share --list` prints. */
export function keysForPackStatement(packId: string): SqlStatement {
  return {
    sql: `SELECT ${ROW_COLUMNS} FROM licence_keys WHERE pack_id = ? ORDER BY created_at, rowid`,
    params: [packId],
  };
}

export interface MintRequest {
  label: string;
  maxUses: number | null;
}

/** Validate a `POST /v1/packs/:id/keys` body (an empty body is fine). Null = 400. */
export function parseMintRequest(raw: unknown): MintRequest | null {
  if (raw === undefined || raw === null) return { label: '', maxUses: null };
  if (typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  let label = '';
  if (b.label !== undefined) {
    if (typeof b.label !== 'string') return null;
    label = b.label.replace(/\s+/g, ' ').trim();
    if (label.length > MAX_LABEL_LENGTH) return null;
  }
  let maxUses: number | null = null;
  if (b.maxUses !== undefined && b.maxUses !== null) {
    if (typeof b.maxUses !== 'number' || !Number.isInteger(b.maxUses) || b.maxUses < 1) return null;
    maxUses = b.maxUses;
  }
  return { label, maxUses };
}

export function statementsForMint(
  key: string,
  packId: string,
  mint: MintRequest,
  createdAtMs: number,
): SqlStatement[] {
  return [
    {
      sql: `INSERT INTO licence_keys (key, pack_id, label, uses, max_uses, created_at, revoked_at)
VALUES (?, ?, ?, 0, ?, ?, NULL)`,
      params: [key, packId, mint.label, mint.maxUses, new Date(createdAtMs).toISOString()],
    },
  ];
}

/**
 * Claim one use of a key — one successful download; 304s and refusals
 * don't count. The claim is a single conditional UPDATE so two devices
 * racing for the last use of a key, or a download overlapping a
 * revocation, cannot both be served: it returns the row it changed, and
 * no row means the key was revoked or spent in the meantime (the caller
 * re-reads it for the reason).
 */
export function claimUseStatement(key: string): SqlStatement {
  return {
    sql: `UPDATE licence_keys SET uses = uses + 1
WHERE key = ? AND revoked_at IS NULL AND (max_uses IS NULL OR uses < max_uses)
RETURNING ${ROW_COLUMNS}`,
    params: [key],
  };
}

/** Revoking twice keeps the first timestamp. */
export function statementsForRevoke(key: string, revokedAtMs: number): SqlStatement[] {
  return [
    {
      sql: 'UPDATE licence_keys SET revoked_at = ? WHERE key = ? AND revoked_at IS NULL',
      params: [new Date(revokedAtMs).toISOString(), key],
    },
  ];
}

// ── The unlock decision ─────────────────────────────────────────────────

export type UnlockDecision =
  | { ok: true; packId: string }
  | { ok: false; status: 403 | 404; error: string };

/** What a refused key is told. Unknown and malformed keys get the SAME
 *  words — an attacker learns nothing about which keys (or packs) exist. */
export const KEY_NOT_RECOGNISED = 'That licence key was not recognised.';
export const KEY_REVOKED = 'This licence key has been revoked.';
export const KEY_EXHAUSTED = 'This licence key has been used on too many devices.';
export const KEY_OTHER_PACK = 'That licence key does not open this pack.';

/**
 * Whether a key row (null = no such key) opens a pack. `pack` is the
 * optional id the caller insists on — a sampler asking for its full bank
 * — and is answered 404 rather than 403 so the app can word it ("does
 * not open the pack this app is asking for") without the words leaking
 * to a caller who has no valid key: the key is checked first.
 */
export function decideUnlock(row: LicenceKeyRow | null, pack?: string | null): UnlockDecision {
  if (!row) return { ok: false, status: 403, error: KEY_NOT_RECOGNISED };
  if (row.revoked_at) return { ok: false, status: 403, error: KEY_REVOKED };
  if (row.max_uses !== null && row.uses >= row.max_uses) {
    return { ok: false, status: 403, error: KEY_EXHAUSTED };
  }
  if (pack && pack !== row.pack_id) return { ok: false, status: 404, error: KEY_OTHER_PACK };
  return { ok: true, packId: row.pack_id };
}

// ── Bundle uploads ──────────────────────────────────────────────────────

/** What the worker checks of an uploaded bundle. The pack inside was
 *  validated by `quizmill share` on the way up and is validated again by
 *  the app on the way in; the worker keeps only the envelope straight —
 *  a bundle, for THIS id, whose manifest agrees. */
export interface StoredBundle {
  text: string;
  bytes: number;
  questions: number;
  /** What the ETag says: the pack's git revision when it is clean, else
   *  a content hash — so a re-share with uncommitted edits still reads
   *  as new to a device holding the previous bundle (#172). */
  version: string;
}

export type UploadOutcome = { ok: true; bundle: StoredBundle } | { ok: false; error: string };

export async function parseBundleUpload(
  raw: unknown,
  packId: string,
  sha256: (text: string) => Promise<string> = sha256Hex,
): Promise<UploadOutcome> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'body is not a pack bundle' };
  }
  const b = raw as Record<string, unknown>;
  if (b.format !== 'quizmill-pack-bundle') {
    return { ok: false, error: 'body is not a pack bundle (`quizmill bundle` writes one)' };
  }
  if (b.id !== packId) {
    return { ok: false, error: `bundle is for pack "${String(b.id)}", not "${packId}"` };
  }
  const manifest = b.manifest;
  if (!manifest || typeof manifest !== 'object' || (manifest as { id?: unknown }).id !== packId) {
    return { ok: false, error: `bundle manifest id is not "${packId}"` };
  }
  if (!Array.isArray(b.questions) || b.questions.length === 0) {
    return { ok: false, error: 'bundle has no questions' };
  }
  const text = JSON.stringify(raw);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BUNDLE_BYTES) {
    return { ok: false, error: `bundle is ${bytes} bytes; the limit is ${MAX_BUNDLE_BYTES}` };
  }
  const packVersion = typeof b.packVersion === 'string' ? b.packVersion : '';
  const version =
    packVersion && !packVersion.endsWith('-dirty') ? packVersion : (await sha256(text)).slice(0, 16);
  return { ok: true, bundle: { text, bytes, questions: b.questions.length, version } };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The strong ETag a stored version is served under. */
export function bundleEtag(version: string): string {
  return `"${version}"`;
}

/** Whether an If-None-Match header names this ETag (`*` and lists included). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  return ifNoneMatch
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .includes(etag);
}

/**
 * Constant-time comparison of a presented bearer token with the configured
 * one; false when either is missing. Length is not hidden — it is the
 * token's bytes that must not leak through timing.
 */
export function adminTokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
