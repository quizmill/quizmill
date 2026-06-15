/**
 * Cloud sync — the local-first glue between localStorage and Supabase.
 *
 * Model (single user, multiple devices):
 *   • localStorage stays the source of truth for READS — instant, offline,
 *     and the entire app keeps reading through `useStorage` unchanged.
 *   • Every local WRITE is mirrored up to Supabase via a persisted,
 *     retry-on-reconnect queue (see `storage.onMutation`).
 *   • On sign-in we PULL the remote rows and merge them down, then (first
 *     time only) PUSH everything local up so a new device's history lands
 *     in the cloud.
 *
 * Sync only runs while signed in. Signed out, the queue is dormant and the
 * app behaves exactly as the pure local-only build.
 */
import { getSupabase } from './supabase';
import * as storage from './storage';
import type { Mutation } from './storage';
import type { Attempt, Session } from '@/data/types';

import { KEY_PREFIX } from './storage';

const QUEUE_KEY = `${KEY_PREFIX}syncQueue.v1`;
const MIGRATED_PREFIX = `${KEY_PREFIX}sync.migrated.`; // + uid
const STORAGE_EVENT = 'quizmill:storage'; // event-bus name, not a storage key
const MAX_TRIES = 6; // drop a poison op after this many failures

// ── Queue shape ─────────────────────────────────────────────────────────

type QueueOp =
  | { t: 'sessions'; op: 'upsert'; row: Session }
  | { t: 'attempts'; op: 'upsert'; row: Attempt }
  | { t: 'achievements'; op: 'upsert'; row: storage.EarnedAchievement }
  | { t: 'votes'; op: 'upsert'; row: storage.QuestionVote }
  | { t: 'votes'; op: 'delete'; questionId: string }
  | { t: 'clear-all'; op: 'delete' }
  | { t: 'clear-sessions'; op: 'delete'; sessionIds: string[] };

type PendingOp = QueueOp & { tries: number };

// ── Module state ────────────────────────────────────────────────────────

let started = false;
let uid: string | null = null;
let draining = false;
let drainTimer: ReturnType<typeof setTimeout> | null = null;

// ── Observable sync status ───────────────────────────────────────────────
//
// A tiny pub/sub so the UI can surface online/offline + "caught up" state
// without reaching into the queue itself. Only meaningful while signed in;
// signed out (or sync not configured) the state is 'idle' and the UI hides.

export type SyncState = 'idle' | 'offline' | 'syncing' | 'synced';

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
): SyncState {
  if (!signedIn) return 'idle';
  if (!online) return 'offline';
  if (pending > 0 || isDraining) return 'syncing';
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
    state: deriveSyncState(signedIn, isOnline(), pending, draining),
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

// ── Field mapping: local camelCase  ⇄  Supabase snake_case ───────────────

function sessionToRow(s: Session, user_id: string) {
  return {
    id: s.id,
    user_id,
    subject: s.subject,
    started_at: new Date(s.startedAt).toISOString(),
    ended_at: s.endedAt != null ? new Date(s.endedAt).toISOString() : null,
    question_count: s.questionCount,
    correct_count: s.correctCount,
    mode: s.mode ?? 'practice',
  };
}
function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: r.id as string,
    subject: r.subject as Session['subject'],
    startedAt: Date.parse(r.started_at as string),
    endedAt: r.ended_at ? Date.parse(r.ended_at as string) : null,
    questionCount: r.question_count as number,
    correctCount: r.correct_count as number,
    mode: r.mode as Session['mode'],
  };
}

function attemptToRow(a: Attempt, user_id: string) {
  return {
    id: a.id,
    user_id,
    session_id: a.sessionId,
    question_id: a.questionId,
    answered_at: new Date(a.answeredAt).toISOString(),
    selected_answer: a.selectedAnswer,
    is_correct: a.isCorrect,
    time_taken_seconds: a.timeTakenSeconds,
    subject: a.subject,
    topic: a.topic,
    difficulty: a.difficulty,
  };
}
function rowToAttempt(r: Record<string, unknown>): Attempt {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    questionId: r.question_id as string,
    answeredAt: Date.parse(r.answered_at as string),
    selectedAnswer: r.selected_answer as string,
    isCorrect: r.is_correct as boolean,
    timeTakenSeconds: r.time_taken_seconds as number,
    subject: r.subject as Attempt['subject'],
    topic: r.topic as string,
    difficulty: r.difficulty as number,
  };
}

function achievementToRow(a: storage.EarnedAchievement, user_id: string) {
  return {
    user_id,
    achievement_id: a.id,
    earned_at: new Date(a.earnedAt).toISOString(),
  };
}
function rowToAchievement(r: Record<string, unknown>): storage.EarnedAchievement {
  return {
    id: r.achievement_id as string,
    earnedAt: Date.parse(r.earned_at as string),
  };
}

function voteToRow(v: storage.QuestionVote, user_id: string) {
  return {
    user_id,
    question_id: v.questionId,
    vote: v.vote,
    comment: v.comment ?? null,
    voted_at: new Date(v.votedAt).toISOString(),
  };
}
function rowToVote(r: Record<string, unknown>): storage.QuestionVote {
  return {
    questionId: r.question_id as string,
    vote: r.vote as storage.VoteDir,
    comment: (r.comment as string) ?? undefined,
    votedAt: Date.parse(r.voted_at as string),
  };
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
    case 'clear-all':
      return enqueue({ t: 'clear-all', op: 'delete' });
    case 'clear-sessions':
      return enqueue({ t: 'clear-sessions', op: 'delete', sessionIds: m.sessionIds });
  }
}

// ── Draining the queue to Supabase ───────────────────────────────────────

/** Execute one op. Throws on a (retryable) failure. */
async function runOp(op: PendingOp, user_id: string): Promise<void> {
  const sb = getSupabase()!;
  switch (op.t) {
    case 'sessions': {
      const { error } = await sb.from('sessions').upsert(sessionToRow(op.row, user_id));
      if (error) throw error;
      return;
    }
    case 'attempts': {
      const { error } = await sb.from('attempts').upsert(attemptToRow(op.row, user_id));
      if (error) throw error;
      return;
    }
    case 'achievements': {
      const { error } = await sb
        .from('achievements')
        .upsert(achievementToRow(op.row, user_id), { onConflict: 'user_id,achievement_id' });
      if (error) throw error;
      return;
    }
    case 'votes': {
      if (op.op === 'delete') {
        const { error } = await sb
          .from('votes')
          .delete()
          .eq('user_id', user_id)
          .eq('question_id', op.questionId);
        if (error) throw error;
        return;
      }
      const { error } = await sb
        .from('votes')
        .upsert(voteToRow(op.row, user_id), { onConflict: 'user_id,question_id' });
      if (error) throw error;
      return;
    }
    case 'clear-all': {
      for (const table of ['sessions', 'attempts', 'achievements', 'votes']) {
        const { error } = await sb.from(table).delete().eq('user_id', user_id);
        if (error) throw error;
      }
      return;
    }
    case 'clear-sessions': {
      const { error: aErr } = await sb
        .from('attempts')
        .delete()
        .eq('user_id', user_id)
        .in('session_id', op.sessionIds);
      if (aErr) throw aErr;
      const { error: sErr } = await sb
        .from('sessions')
        .delete()
        .eq('user_id', user_id)
        .in('id', op.sessionIds);
      if (sErr) throw sErr;
      return;
    }
  }
}

async function drain(): Promise<void> {
  if (draining || !uid) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const sb = getSupabase();
  if (!sb) return;

  draining = true;
  notifyStatus();
  try {
    let q = loadQueue();
    while (q.length > 0) {
      const op = q[0];
      try {
        await runOp(op, uid);
        q = q.slice(1); // success → drop from front
        saveQueue(q);
        notifyStatus();
      } catch (err) {
        // Retry later. Drop poison ops that keep failing so they don't
        // wedge the whole queue forever.
        op.tries += 1;
        if (op.tries >= MAX_TRIES) {
          console.warn('[sync] dropping op after repeated failures', op, err);
          q = q.slice(1);
          saveQueue(q);
          continue;
        }
        saveQueue(q);
        notifyStatus();
        break; // stop; a later drain (online/interval) retries
      }
    }
  } finally {
    draining = false;
    notifyStatus();
  }
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
  const sb = getSupabase();
  if (!sb) return;
  const [sessions, attempts, achievements, votes] = await Promise.all([
    sb.from('sessions').select('*').eq('user_id', user_id),
    sb.from('attempts').select('*').eq('user_id', user_id),
    sb.from('achievements').select('*').eq('user_id', user_id),
    sb.from('votes').select('*').eq('user_id', user_id),
  ]);

  const changed = storage.mergeRemote({
    sessions: (sessions.data ?? []).map(rowToSession),
    attempts: (attempts.data ?? []).map(rowToAttempt),
    achievements: (achievements.data ?? []).map(rowToAchievement),
    votes: (votes.data ?? []).map(rowToVote),
  });

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

// ── Public entry point ───────────────────────────────────────────────────

/** Start the sync engine. Idempotent; no-op when sync isn't configured or
 *  outside the browser. Call once from a client component mounted in the
 *  root layout. */
export function startSync(): void {
  if (started || typeof window === 'undefined') return;
  const sb = getSupabase();
  if (!sb) return;
  started = true;

  storage.onMutation(handleMutation);
  window.addEventListener('online', () => {
    notifyStatus(); // flip offline → syncing immediately
    void drain();
  });
  window.addEventListener('offline', () => notifyStatus());
  setInterval(() => void drain(), 30_000); // safety net for missed reconnects

  // Pick up an already-restored session, then track future auth changes.
  void sb.auth.getSession().then(({ data }) => {
    if (data.session) void handleSignedIn(data.session.user.id);
  });
  sb.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      if (session.user.id !== uid) void handleSignedIn(session.user.id);
    } else {
      uid = null; // signed out → stop mirroring (local data stays put)
      notifyStatus();
    }
  });
}
