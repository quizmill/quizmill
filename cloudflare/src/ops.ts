/**
 * Pure request-validation + SQL-building for the quizmill sync worker.
 *
 * Kept free of Cloudflare types so the rules are unit-testable from the
 * engine's vitest suite (tests/worker-sync.test.ts). The worker entry
 * (worker.ts) binds the statements produced here to the D1 database.
 *
 * Wire protocol — mirrored by src/lib/backends/httpBackend.ts:
 *   POST /v1/ops   { pack, ops: WireOp[] }   apply idempotent mutations
 *   GET  /v1/rows?pack=…                     pull every row for user+pack
 *
 * Storage model: ONE generic table. Rows are opaque JSON (`data`) keyed by
 * (user_id, pack_id, tbl, id) with a secondary `ref` used only so
 * "clear these sessions" can also delete the attempts that belong to them
 * (attempts store their sessionId in `ref`). The server never interprets
 * row contents — merge semantics live in the client (storage.mergeRemote),
 * exactly like the localStorage source of truth it mirrors.
 */

export const TABLES = ['sessions', 'attempts', 'achievements', 'votes', 'notes', 'events'] as const;
export type TableName = (typeof TABLES)[number];

export type WireOp =
  | { t: TableName; op: 'upsert'; id: string; ref?: string; data: unknown }
  | { t: 'votes' | 'notes'; op: 'delete'; id: string }
  | { t: 'clear-all'; op: 'delete' }
  | { t: 'clear-sessions'; op: 'delete'; sessionIds: string[] };

export interface OpsRequest {
  pack: string;
  ops: WireOp[];
}

export interface SqlStatement {
  sql: string;
  params: (string | number | null)[];
}

// Sanity ceilings — a single practice answer is <1 KB, so anything near
// these limits is malformed or abusive, not real traffic.
const MAX_OPS_PER_REQUEST = 500;
const MAX_ROW_JSON_BYTES = 32_768;
const MAX_ID_LENGTH = 200;
const MAX_SESSION_IDS = 500;

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

function isTable(v: unknown): v is TableName {
  return typeof v === 'string' && (TABLES as readonly string[]).includes(v);
}

/** Validate one wire op. Returns null when the shape is unacceptable. */
export function parseOp(raw: unknown): WireOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.t === 'clear-all' && o.op === 'delete') {
    return { t: 'clear-all', op: 'delete' };
  }
  if (o.t === 'clear-sessions' && o.op === 'delete') {
    if (
      !Array.isArray(o.sessionIds) ||
      o.sessionIds.length === 0 ||
      o.sessionIds.length > MAX_SESSION_IDS ||
      !o.sessionIds.every(isId)
    ) {
      return null;
    }
    return { t: 'clear-sessions', op: 'delete', sessionIds: o.sessionIds as string[] };
  }
  if ((o.t === 'votes' || o.t === 'notes') && o.op === 'delete') {
    return isId(o.id) ? { t: o.t, op: 'delete', id: o.id } : null;
  }
  if (isTable(o.t) && o.op === 'upsert') {
    if (!isId(o.id)) return null;
    if (o.ref !== undefined && !isId(o.ref)) return null;
    if (!o.data || typeof o.data !== 'object') return null;
    if (JSON.stringify(o.data).length > MAX_ROW_JSON_BYTES) return null;
    return {
      t: o.t,
      op: 'upsert',
      id: o.id,
      ...(o.ref !== undefined ? { ref: o.ref as string } : {}),
      data: o.data,
    };
  }
  return null;
}

/** Validate a whole POST /v1/ops body. Returns null on any bad input —
 *  all-or-nothing, so a half-garbled batch never half-applies. */
export function parseOpsRequest(body: unknown): OpsRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!isId(b.pack)) return null;
  if (!Array.isArray(b.ops) || b.ops.length === 0 || b.ops.length > MAX_OPS_PER_REQUEST) {
    return null;
  }
  const ops: WireOp[] = [];
  for (const raw of b.ops) {
    const op = parseOp(raw);
    if (!op) return null;
    ops.push(op);
  }
  return { pack: b.pack, ops };
}

const UPSERT_SQL = `INSERT INTO rows (user_id, pack_id, tbl, id, ref, data)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, pack_id, tbl, id)
DO UPDATE SET ref = excluded.ref, data = excluded.data`;

// Achievements are write-once (the client keeps the earliest unlock time),
// so a re-push of an existing row must not overwrite it.
const INSERT_IGNORE_SQL = `INSERT INTO rows (user_id, pack_id, tbl, id, ref, data)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, pack_id, tbl, id)
DO NOTHING`;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** Translate one validated op into the D1 statements that apply it. */
export function statementsForOp(
  op: WireOp,
  userId: string,
  packId: string,
): SqlStatement[] {
  switch (op.t) {
    case 'clear-all':
      return [
        {
          sql: 'DELETE FROM rows WHERE user_id = ? AND pack_id = ?',
          params: [userId, packId],
        },
      ];
    case 'clear-sessions': {
      const marks = placeholders(op.sessionIds.length);
      return [
        {
          sql: `DELETE FROM rows WHERE user_id = ? AND pack_id = ? AND tbl = 'attempts' AND ref IN (${marks})`,
          params: [userId, packId, ...op.sessionIds],
        },
        {
          sql: `DELETE FROM rows WHERE user_id = ? AND pack_id = ? AND tbl = 'sessions' AND id IN (${marks})`,
          params: [userId, packId, ...op.sessionIds],
        },
      ];
    }
    default:
      if (op.op === 'delete') {
        return [
          {
            sql: 'DELETE FROM rows WHERE user_id = ? AND pack_id = ? AND tbl = ? AND id = ?',
            params: [userId, packId, op.t, op.id],
          },
        ];
      }
      return [
        {
          sql: op.t === 'achievements' ? INSERT_IGNORE_SQL : UPSERT_SQL,
          params: [userId, packId, op.t, op.id, op.ref ?? '', JSON.stringify(op.data)],
        },
      ];
  }
}

/**
 * Derive the user id from a bearer sync key: uppercase, strip separators,
 * require enough material to be un-guessable, SHA-256 → hex. Must match
 * src/lib/syncKey.ts's hashSyncKey (which hashes the canonical
 * "QM…"-prefixed body the client always sends).
 */
export async function userIdFromKey(bearer: string): Promise<string | null> {
  const material = bearer.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (material.length < 20) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
