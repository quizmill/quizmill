/**
 * HTTP sync backend — the client half of the quizmill sync protocol
 * (docs/sync-protocol.md). Works against ANY server that implements the
 * protocol's two endpoints; the Cloudflare Worker in cloudflare/ is the
 * reference implementation, but a self-hosted express/Deno/whatever
 * server plugs in identically — just point NEXT_PUBLIC_SYNC_URL at it.
 *
 * The server is a dumb, generic mirror: it stores each row as opaque JSON
 * keyed by (user, pack, table, id), so this module ships the local shapes
 * over the wire verbatim — no field-mapping layer. Identity is a sync
 * key held in localStorage (see src/lib/syncKey.ts); every request carries
 * it as a bearer token and the server partitions rows by its SHA-256.
 *
 * "Signed in" simply means "this device has a key stored". Creating or
 * entering a key in Settings flips auth on; forgetting it flips auth off
 * (local data always stays put).
 */
import { APP_CONFIG } from '@/config';
import type { Attempt, Session } from '@/data/types';
import type { EarnedAchievement, QuestionNote, QuestionVote } from '../storage';
import { KEY_PREFIX } from '../storage';
import { hashSyncKey, normalizeSyncKey } from '../syncKey';
import type { QueueOp, RemoteData, SyncBackend } from '../syncBackend';

const PACK_ID = APP_CONFIG.packId;

/** Sync-server base URL for this build ('' = backend not configured). */
export const SYNC_URL = (process.env.NEXT_PUBLIC_SYNC_URL ?? '').replace(/\/+$/, '');

// APP-level (no pack prefix): the sync key identifies the learner, not the
// pack — the server already partitions rows by (user, pack), so one key
// serves every pack the library swaps in. Was per-pack before the library
// existed; the legacy key is migrated on first read.
const KEY_STORAGE = 'quizmill.syncKey.v1';
const LEGACY_KEY_STORAGE = `${KEY_PREFIX}syncKey.v1`;

// ── Wire protocol (mirrored by cloudflare/src/ops.ts) ───────────────────

export type WireOp =
  | {
      t: 'sessions' | 'attempts' | 'achievements' | 'votes' | 'notes';
      op: 'upsert';
      id: string;
      /** Secondary key used for grouped deletes — attempts carry their
       *  sessionId here so "clear these sessions" can find them. */
      ref?: string;
      data: Session | Attempt | EarnedAchievement | QuestionVote | QuestionNote;
    }
  | { t: 'votes' | 'notes'; op: 'delete'; id: string }
  | { t: 'clear-all'; op: 'delete' }
  | { t: 'clear-sessions'; op: 'delete'; sessionIds: string[] };

/** Translate an engine queue op to the wire shape. Pure — unit-tested. */
export function toWireOp(op: QueueOp): WireOp {
  switch (op.t) {
    case 'sessions':
      return { t: 'sessions', op: 'upsert', id: op.row.id, data: op.row };
    case 'attempts':
      return {
        t: 'attempts',
        op: 'upsert',
        id: op.row.id,
        ref: op.row.sessionId,
        data: op.row,
      };
    case 'achievements':
      return { t: 'achievements', op: 'upsert', id: op.row.id, data: op.row };
    case 'votes':
      return op.op === 'delete'
        ? { t: 'votes', op: 'delete', id: op.questionId }
        : { t: 'votes', op: 'upsert', id: op.row.questionId, data: op.row };
    case 'notes':
      return op.op === 'delete'
        ? { t: 'notes', op: 'delete', id: op.questionId }
        : { t: 'notes', op: 'upsert', id: op.row.questionId, data: op.row };
    case 'clear-all':
      return { t: 'clear-all', op: 'delete' };
    case 'clear-sessions':
      return { t: 'clear-sessions', op: 'delete', sessionIds: op.sessionIds };
  }
}

// ── Key storage + auth events ───────────────────────────────────────────

const authListeners = new Set<(userId: string | null) => void>();

/** The canonical sync key stored on this device, or null. */
export function getStoredSyncKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = window.localStorage.getItem(KEY_STORAGE);
    if (key) return key;
    const legacy = window.localStorage.getItem(LEGACY_KEY_STORAGE);
    if (legacy) {
      window.localStorage.setItem(KEY_STORAGE, legacy);
      window.localStorage.removeItem(LEGACY_KEY_STORAGE);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

async function notifyAuth(): Promise<void> {
  const key = getStoredSyncKey();
  const uid = key ? await hashSyncKey(key) : null;
  for (const cb of authListeners) cb(uid);
}

/**
 * Store a key (canonicalised) and flip auth on. Returns false when the
 * input isn't a valid key — nothing is stored in that case.
 */
export async function setSyncKey(raw: string): Promise<boolean> {
  const canonical = normalizeSyncKey(raw);
  if (!canonical || typeof window === 'undefined') return false;
  window.localStorage.setItem(KEY_STORAGE, canonical);
  await notifyAuth();
  return true;
}

/** Forget the key on this device and flip auth off. Local data stays. */
export async function clearSyncKey(): Promise<void> {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY_STORAGE);
  await notifyAuth();
}

// ── HTTP ────────────────────────────────────────────────────────────────

async function request(path: string, init?: RequestInit): Promise<Response> {
  const key = getStoredSyncKey();
  if (!key) throw new Error('no sync key on this device');
  const res = await fetch(`${SYNC_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${key}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`sync worker ${res.status} on ${path}`);
  }
  return res;
}

// ── SyncBackend impl ────────────────────────────────────────────────────

export const httpBackend: SyncBackend = {
  async getUserId() {
    const key = getStoredSyncKey();
    return key ? hashSyncKey(key) : null;
  },

  onAuthChange(cb) {
    authListeners.add(cb);
  },

  async runOp(op: QueueOp) {
    await request('/v1/ops', {
      method: 'POST',
      body: JSON.stringify({ pack: PACK_ID, ops: [toWireOp(op)] }),
    });
  },

  async pullAll(): Promise<RemoteData> {
    const res = await request(`/v1/rows?pack=${encodeURIComponent(PACK_ID)}`);
    const body = (await res.json()) as Partial<RemoteData>;
    return {
      sessions: body.sessions ?? [],
      attempts: body.attempts ?? [],
      achievements: body.achievements ?? [],
      votes: body.votes ?? [],
      // Older servers (pre-notes) don't return this key.
      notes: body.notes ?? [],
    };
  },
};
