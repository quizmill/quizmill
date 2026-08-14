/**
 * Cloud sync — the local-first glue between localStorage and the cloud.
 *
 * Model (single user, multiple devices):
 *   • localStorage stays the source of truth for READS — instant, offline,
 *     and the entire app keeps reading through `useStorage` unchanged.
 *   • Every local WRITE is mirrored up to the configured backend via a
 *     persisted, retry-on-reconnect queue (see `storage.onMutation`).
 *   • On sign-in we PULL the remote rows and merge them down, then (first
 *     time only) PUSH everything local up so a new device's history lands
 *     in the cloud.
 *
 * The cloud side is pluggable (src/lib/syncBackend.ts): a Cloudflare
 * Worker + D1 mirror with sync-key auth, or the original Supabase mirror
 * with email-OTP auth. This engine is backend-agnostic — it owns only the
 * queue, drain, and merge machinery.
 *
 * Sync only runs while signed in. Signed out, the queue is dormant and the
 * app behaves exactly as the pure local-only build.
 */
import * as storage from './storage';
import type { Mutation } from './storage';
import { getSyncBackend, type QueueOp } from './syncBackend';

import { KEY_PREFIX } from './storage';

const QUEUE_KEY = `${KEY_PREFIX}syncQueue.v1`;
const MIGRATED_PREFIX = `${KEY_PREFIX}sync.migrated.`; // + uid
const STORAGE_EVENT = 'quizmill:storage'; // event-bus name, not a storage key
const MAX_TRIES = 6; // drop a poison op after this many failures
// Hard ceiling on any single remote op. Neither backend client has a
// built-in timeout, so a request that stalls (common on flaky mobile
// networks) would otherwise hang `await runOp` forever, latch
// `draining = true`, and wedge the whole sync engine until a page reload.
// We turn a stall into an ordinary retryable failure instead.
const OP_TIMEOUT_MS = 15_000;

type PendingOp = QueueOp & { tries: number };

// ── Module state ────────────────────────────────────────────────────────

let started = false;
let uid: string | null = null;
let draining = false;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
// True when the last drain pass left work behind because of failures
// (not merely because we're mid-flight). Lets the UI distinguish "still
// working" from "tried and couldn't" instead of spinning forever.
let syncError = false;

/** Race a promise against a timeout so a stalled request can't hang the
 *  drain loop indefinitely. Rejects with a retryable error on timeout. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync op timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ── Observable sync status ───────────────────────────────────────────────
//
// A tiny pub/sub so the UI can surface online/offline + "caught up" state
// without reaching into the queue itself. Only meaningful while signed in;
// signed out (or sync not configured) the state is 'idle' and the UI hides.

export type SyncState = 'idle' | 'offline' | 'syncing' | 'synced' | 'error';

export interface SyncStatus {
  /** Coarse machine state, drives which marker (if any) the UI shows. */
  state: SyncState;
  /** Local writes still waiting to reach the cloud. */
  pending: number;
  /** Whether a user is signed in (sync active at all). */
  signedIn: boolean;
}

/** Pure derivation — exported for unit testing. */
export function deriveSyncState(
  signedIn: boolean,
  online: boolean,
  pending: number,
  isDraining: boolean,
  hasError: boolean,
): SyncState {
  if (!signedIn) return 'idle';
  if (!online) return 'offline';
  // An in-flight drain is always "syncing", even after an earlier failure —
  // we're actively retrying.
  if (isDraining) return 'syncing';
  // Tried, still have work, and the last pass couldn't clear it → surface a
  // distinct error so the UI isn't a perpetual spinner over stuck data.
  if (pending > 0 && hasError) return 'error';
  if (pending > 0) return 'syncing';
  return 'synced';
}

const IDLE_STATUS: SyncStatus = { state: 'idle', pending: 0, signedIn: false };
let currentStatus: SyncStatus = IDLE_STATUS;
const statusListeners = new Set<() => void>();

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Recompute the status and notify subscribers only when it actually
 *  changes — keeps the snapshot reference stable for useSyncExternalStore. */
function notifyStatus(): void {
  const signedIn = uid !== null;
  const pending = signedIn ? loadQueue().length : 0;
  const next: SyncStatus = {
    state: deriveSyncState(signedIn, isOnline(), pending, draining, syncError),
    pending,
    signedIn,
  };
  const prev = currentStatus;
  if (
    prev.state === next.state &&
    prev.pending === next.pending &&
    prev.signedIn === next.signedIn
  ) {
    return;
  }
  currentStatus = next;
  for (const cb of statusListeners) cb();
}

/** Subscribe to sync-status changes. Returns an unsubscribe fn. */
export function subscribeSyncStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

/** Current sync status snapshot (stable reference between changes). */
export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

// ── Queue persistence ───────────────────────────────────────────────────

function loadQueue(): PendingOp[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingOp[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: PendingOp[]): void {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function enqueue(...ops: QueueOp[]): void {
  if (!ops.length) return;
  const q = loadQueue();
  for (const op of ops) q.push({ ...op, tries: 0 });
  saveQueue(q);
  notifyStatus();
  scheduleDrain();
}

// ── Local mutation → queue ───────────────────────────────────────────────

function handleMutation(m: Mutation): void {
  if (!uid) return; // signed out → local-only, nothing to mirror
  switch (m.table) {
    case 'sessions':
      return enqueue({ t: 'sessions', op: 'upsert', row: m.row });
    case 'attempts':
      return enqueue({ t: 'attempts', op: 'upsert', row: m.row });
    case 'achievements':
      return enqueue({ t: 'achievements', op: 'upsert', row: m.row });
    case 'votes':
      return 'op' in m
        ? enqueue({ t: 'votes', op: 'delete', questionId: m.questionId })
        : enqueue({ t: 'votes', op: 'upsert', row: m.row });
    case 'notes':
      return 'op' in m
        ? enqueue({ t: 'notes', op: 'delete', questionId: m.questionId })
        : enqueue({ t: 'notes', op: 'upsert', row: m.row });
    case 'clear-all':
      return enqueue({ t: 'clear-all', op: 'delete' });
    case 'clear-sessions':
      return enqueue({ t: 'clear-sessions', op: 'delete', sessionIds: m.sessionIds });
  }
}

// ── Draining the queue to the backend ────────────────────────────────────

async function drain(): Promise<void> {
  if (draining || !uid) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const backend = getSyncBackend();
  if (!backend) return;

  draining = true;
  notifyStatus();
  try {
    // Work over a snapshot of the queue and attempt EVERY op, rather than
    // stopping at the first failure. A single un-sendable op must not block
    // the others behind it (head-of-line blocking). Ops are idempotent
    // upserts/deletes, so if the tab closes mid-pass the untouched snapshot
    // simply replays next time — safe to re-send.
    const snapshot = loadQueue();
    const kept: PendingOp[] = [];
    let anyFailed = false;
    for (const op of snapshot) {
      try {
        await withTimeout(backend.runOp(op, uid), OP_TIMEOUT_MS);
        // success → simply don't carry it forward
      } catch (err) {
        op.tries += 1;
        if (op.tries >= MAX_TRIES) {
          // Drop a poison op so it can't wedge the queue forever — but make
          // the loss loud rather than a silent console.warn.
          console.error('[sync] dropping op after repeated failures', op, err);
        } else {
          anyFailed = true;
          kept.push(op); // retry on a later drain (interval / reconnect)
        }
      }
    }
    // Reconcile with anything enqueued WHILE we were draining: the live
    // queue is [..snapshot we just processed.., ..newly appended..]. Keep
    // the still-failing ops, then the new ones, in order.
    const live = loadQueue();
    const appended = live.slice(snapshot.length);
    saveQueue([...kept, ...appended]);
    syncError = anyFailed;
  } finally {
    draining = false;
    notifyStatus();
  }
}

/** Manually kick a drain — used by the UI's "retry" affordance when sync is
 *  in the error state. Clears the sticky error so the next pass re-evaluates. */
export function retrySync(): void {
  syncError = false;
  notifyStatus();
  void drain();
}

function scheduleDrain(): void {
  if (drainTimer) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void drain();
  }, 800);
}

// ── Pull + initial migration on sign-in ──────────────────────────────────

async function pullAll(user_id: string): Promise<void> {
  const backend = getSyncBackend();
  if (!backend) return;
  const changed = storage.mergeRemote(await backend.pullAll(user_id));
  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }
}

/** Enqueue every local row as an upsert — runs once per user so a device's
 *  pre-existing history reaches the cloud. */
function pushAllLocal(): void {
  const ops: QueueOp[] = [
    ...storage.loadSessions().map((row) => ({ t: 'sessions', op: 'upsert', row }) as QueueOp),
    ...storage.loadAttempts().map((row) => ({ t: 'attempts', op: 'upsert', row }) as QueueOp),
    ...storage
      .loadAchievements()
      .map((row) => ({ t: 'achievements', op: 'upsert', row }) as QueueOp),
    ...storage.loadVotes().map((row) => ({ t: 'votes', op: 'upsert', row }) as QueueOp),
    ...storage.loadNotes().map((row) => ({ t: 'notes', op: 'upsert', row }) as QueueOp),
  ];
  enqueue(...ops);
}

async function handleSignedIn(user_id: string): Promise<void> {
  uid = user_id;
  notifyStatus(); // signed in → start reflecting sync state
  try {
    await pullAll(user_id);
  } catch (err) {
    console.warn('[sync] pull failed; will rely on queued writes', err);
  }
  // First sign-in for this user on this device: seed the cloud with whatever
  // history already lived here. Idempotent upserts, so safe, but we only do
  // the bulk push once to keep the queue small on later loads.
  const migratedKey = MIGRATED_PREFIX + user_id;
  if (window.localStorage.getItem(migratedKey) !== '1') {
    pushAllLocal();
    window.localStorage.setItem(migratedKey, '1');
  }
  void drain();
}

/**
 * Re-enqueue everything local as idempotent upserts and drain. No-op when
 * signed out. Used after a file import (src/lib/transfer.ts): imported rows
 * arrive via mergeRemote, which deliberately doesn't emit mutations — but
 * from the cloud's perspective they ARE new local writes and must go up.
 */
export function pushAllToCloud(): void {
  if (!uid) return;
  pushAllLocal();
  void drain();
}

// ── Public entry point ───────────────────────────────────────────────────

/** Start the sync engine. Idempotent; no-op when sync isn't configured or
 *  outside the browser. Call once from a client component mounted in the
 *  root layout. */
export function startSync(): void {
  if (started || typeof window === 'undefined') return;
  const backend = getSyncBackend();
  if (!backend) return;
  started = true;

  storage.onMutation(handleMutation);
  window.addEventListener('online', () => {
    notifyStatus(); // flip offline → syncing immediately
    void drain();
  });
  window.addEventListener('offline', () => notifyStatus());
  setInterval(() => void drain(), 30_000); // safety net for missed reconnects

  // Pick up an already-present identity (a restored Supabase session, or a
  // sync key stored on this device), then track future auth changes.
  void backend.getUserId().then((userId) => {
    if (userId) void handleSignedIn(userId);
  });
  backend.onAuthChange((userId) => {
    if (userId) {
      if (userId !== uid) void handleSignedIn(userId);
    } else {
      uid = null; // signed out → stop mirroring (local data stays put)
      notifyStatus();
    }
  });
}
