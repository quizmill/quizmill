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
import type { AppEvent, Attempt, Session } from '@/data/types';
import type { EarnedAchievement, QuestionNote, QuestionVote } from '../storage';
import { KEY_PREFIX, recordEvent } from '../storage';
import { hashSyncKey, normalizeKeyName, normalizeSyncKey } from '../syncKey';
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
// The key's optional human-readable name, cached for offline render.
// The server holds the shared copy (GET/POST /v1/profile) so the name
// follows the key onto every device that enters it.
const NAME_STORAGE = 'quizmill.syncKeyName.v1';
// Raised while a name hasn't been accepted by the server yet.
const NAME_PENDING_STORAGE = 'quizmill.syncKeyName.pending.v1';

// ── Wire protocol (mirrored by cloudflare/src/ops.ts) ───────────────────

export type WireOp =
  | {
      t: 'sessions' | 'attempts' | 'achievements' | 'votes' | 'notes' | 'events';
      op: 'upsert';
      id: string;
      /** Secondary key used for grouped deletes — attempts carry their
       *  sessionId here so "clear these sessions" can find them. */
      ref?: string;
      data: Session | Attempt | EarnedAchievement | QuestionVote | QuestionNote | AppEvent;
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
    case 'events':
      return { t: 'events', op: 'upsert', id: op.row.id, data: op.row };
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
  // A different key is a different learner: forget the old key's name
  // rather than mislabelling the new one until the server answers.
  if (getStoredSyncKey() !== canonical) {
    window.localStorage.removeItem(NAME_STORAGE);
    window.localStorage.removeItem(NAME_PENDING_STORAGE);
  }
  window.localStorage.setItem(KEY_STORAGE, canonical);
  recordEvent('sync_sign_in');
  await notifyAuth();
  return true;
}

/** Forget the key on this device and flip auth off. Local data stays. */
export async function clearSyncKey(): Promise<void> {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY_STORAGE);
  window.localStorage.removeItem(NAME_STORAGE);
  window.localStorage.removeItem(NAME_PENDING_STORAGE);
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

// ── Key names ───────────────────────────────────────────────────────────
//
// One optional label per key ("Leo", "Dad's key") so a household holding
// several keys can tell whose history a device is syncing. Stored on the
// server against the same hashed user id (never the key), and cached here
// so the name renders offline and before the network answers.

/** The name cached on this device for its key, or null. */
export function getStoredKeyName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const name = normalizeKeyName(window.localStorage.getItem(NAME_STORAGE) ?? '');
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Cache the name locally. `pending` marks a name the server hasn't
 * accepted yet — the one case where a local name outranks the server's
 * "no name" (see reconcileKeyName).
 */
function cacheKeyName(name: string, pending: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (name) window.localStorage.setItem(NAME_STORAGE, name);
    else window.localStorage.removeItem(NAME_STORAGE);
    if (pending) window.localStorage.setItem(NAME_PENDING_STORAGE, '1');
    else window.localStorage.removeItem(NAME_PENDING_STORAGE);
  } catch {
    // a full or blocked localStorage costs the cache, not the feature
  }
}

function isNamePending(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(NAME_PENDING_STORAGE) === '1';
  } catch {
    return false;
  }
}

/** The server's name for this key. Null when unnamed; undefined when the
 *  server couldn't be asked (offline, or a deployment predating names). */
async function fetchKeyName(): Promise<string | null | undefined> {
  try {
    const res = await request('/v1/profile');
    const body = (await res.json()) as { name?: string | null };
    return normalizeKeyName(body.name ?? '') || null;
  } catch {
    return undefined;
  }
}

async function pushKeyName(name: string): Promise<boolean> {
  try {
    await request('/v1/profile', { method: 'POST', body: JSON.stringify({ name }) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Settle on one name for this key across devices, and return the name to
 * show (null = unnamed).
 *
 * The server holds the copy every device agrees on, so its name wins.
 * When the server has none, the local name only survives if it never
 * reached the server (renamed offline, or named against a worker too old
 * to store it) — that push is retried here. Otherwise a server with no
 * name means the name was cleared on another device, and this device
 * drops it rather than resurrecting it on the next sync.
 */
export async function reconcileKeyName(): Promise<string | null> {
  const local = getStoredKeyName();
  const remote = await fetchKeyName();
  if (remote === undefined) return local; // couldn't ask — keep showing ours
  if (remote) {
    cacheKeyName(remote, false);
    return remote;
  }
  if (local && isNamePending()) {
    cacheKeyName(local, !(await pushKeyName(local)));
    return local;
  }
  cacheKeyName('', false);
  return null;
}

/**
 * Name this key (or clear the name with ''). The name is cached locally
 * either way; `synced` reports whether the server took it too, so the UI
 * can be honest about a rename the other devices haven't seen yet.
 */
export async function saveKeyName(
  raw: string,
): Promise<{ name: string | null; synced: boolean }> {
  const name = normalizeKeyName(raw);
  const synced = await pushKeyName(name);
  cacheKeyName(name, !synced);
  return { name: name || null, synced };
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
      // Older servers don't return these keys (pre-notes / pre-events).
      notes: body.notes ?? [],
      events: body.events ?? [],
    };
  },
};
