/**
 * Reproduces the "Couldn't sync N · retry" report: a client that ships
 * the notes table before the sync server knows it (stale worker / old
 * Supabase schema). The server 400s every notes op; the engine burns
 * MAX_TRIES retries and then DROPS the op — and because the once-per-user
 * bulk-push flag stays set, the note never reaches the cloud even after
 * the server is upgraded. The fix: dropping an op clears the bulk-push
 * flag, so the next app start / sign-in re-seeds the cloud with
 * idempotent upserts and the system self-heals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSyncBackendProvider, type SyncBackend, type QueueOp } from '@/lib/syncBackend';
import * as storage from '@/lib/storage';
import { startSync, retrySync, getSyncStatus } from '@/lib/sync';
import type { QuestionNote } from '@/lib/storage';

const ENV_KEYS = [
  'NEXT_PUBLIC_SYNC_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SYNC_BACKEND',
] as const;

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _dump: () => map,
  };
}

// ── A fake cloud that doesn't understand notes until "upgraded" ────────

const cloud = {
  acceptNotes: false,
  notes: new Map<string, QuestionNote>(),
  otherOps: 0,
};

let authCb: ((userId: string | null) => void) | null = null;

const staleThenUpgradedBackend: SyncBackend = {
  getUserId: async () => 'user-1',
  onAuthChange: (cb) => {
    authCb = cb;
  },
  runOp: async (op: QueueOp) => {
    if (op.t === 'notes') {
      if (!cloud.acceptNotes) {
        throw new Error('sync worker 400 on /v1/ops'); // stale server
      }
      if (op.op === 'delete') cloud.notes.delete(op.questionId);
      else cloud.notes.set(op.row.questionId, op.row);
      return;
    }
    cloud.otherOps += 1; // everything else always syncs fine
  },
  pullAll: async () => ({
    sessions: [],
    attempts: [],
    achievements: [],
    votes: [],
    notes: cloud.acceptNotes ? [...cloud.notes.values()] : [],
    events: [],
  }),
};

registerSyncBackendProvider({
  kind: 'stale-test',
  isConfigured: () => true,
  create: () => staleThenUpgradedBackend,
});

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    localStorage: fakeLocalStorage(),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {}); // the loud drop
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sync self-heals after a stale server drops notes ops', () => {
  it('drop clears the bulk-push flag; the next sign-in re-seeds the cloud', async () => {
    startSync();
    await flush(); // getUserId → handleSignedIn → pull, set migrated flag

    const migratedKey = `${storage.KEY_PREFIX}sync.migrated.user-1`;
    expect(window.localStorage.getItem(migratedKey)).toBe('1');

    // The user leaves a note; the stale server rejects it on every drain.
    storage.recordNote('q1', 'more questions on this please', 1000);
    await vi.advanceTimersByTimeAsync(800); // scheduled drain → try 1
    expect(getSyncStatus().pending).toBe(1);

    for (let i = 0; i < 5; i++) {
      retrySync(); // tries 2..6 — the 6th pass drops the op
      await flush();
    }
    expect(getSyncStatus().pending).toBe(0); // dropped, queue is empty

    // THE FIX: the drop must clear the once-per-user bulk-push flag so a
    // later start can recover the row — without it the note is lost for good.
    expect(window.localStorage.getItem(migratedKey)).toBeNull();

    // The worker gets redeployed (now understands notes), and the app is
    // reopened — startSync's auth pickup runs handleSignedIn again.
    cloud.acceptNotes = true;
    expect(authCb).not.toBeNull();
    authCb!(null); // signed out (uid cleared)
    authCb!('user-1'); // ...and back in = what a fresh app start does
    await flush(); // pull + bulk re-push (flag is gone) + drain
    await flush();

    expect(cloud.notes.get('q1')?.text).toBe('more questions on this please');
    expect(window.localStorage.getItem(migratedKey)).toBe('1');
  });
});
