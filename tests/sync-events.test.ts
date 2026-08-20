/**
 * Events flow through the sync queue like any other table — and a STALE
 * server that predates the events table (rejects those ops with a 400)
 * must not wedge the queue: the poison-drop machinery clears them while
 * everything else keeps syncing. That is the deployment-order guarantee:
 * shipping the new client before the new worker degrades to "no events
 * in the cloud yet", never to a broken sync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../src/data/types';
import * as storage from '../src/lib/storage';
import { getSyncStatus, retrySync, startSync } from '../src/lib/sync';
import {
  registerSyncBackendProvider,
  type QueueOp,
  type SyncBackend,
} from '../src/lib/syncBackend';

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const cloud = {
  acceptEvents: true,
  events: new Map<string, AppEvent>(),
  otherOps: 0,
};

const backend: SyncBackend = {
  getUserId: async () => 'user-1',
  onAuthChange: () => {},
  runOp: async (op: QueueOp) => {
    if (op.t === 'events') {
      if (!cloud.acceptEvents) {
        throw new Error('sync worker 400 on /v1/ops'); // pre-events server
      }
      cloud.events.set(op.row.id, op.row);
      return;
    }
    cloud.otherOps += 1;
  },
  pullAll: async () => ({
    sessions: [],
    attempts: [],
    achievements: [],
    votes: [],
    notes: [],
    events: [],
  }),
};

registerSyncBackendProvider({
  kind: 'events-test',
  isConfigured: () => true,
  create: () => backend,
});

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SYNC_BACKEND = 'events-test';
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    localStorage: fakeLocalStorage(),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  cloud.acceptEvents = true;
  cloud.events.clear();
  cloud.otherOps = 0;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SYNC_BACKEND;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('events through the sync queue', () => {
  it('mirrors a recorded event up like any other row', async () => {
    startSync();
    await flush(); // sign-in pickup

    const e = storage.recordEvent('game_open', { game: 'snake' }, 1000);
    await vi.advanceTimersByTimeAsync(800); // scheduled drain
    expect(cloud.events.get(e!.id)).toEqual(e);
    expect(getSyncStatus().pending).toBe(0);
  });

  it('a pre-events server rejects the op but the rest of the queue survives', async () => {
    cloud.acceptEvents = false;
    startSync();
    await flush();

    storage.recordEvent('app_open', undefined, 1000);
    storage.recordNote('q1', 'still syncs fine', 2000); // a non-events op
    await vi.advanceTimersByTimeAsync(800);

    // The note went up despite the events op failing in the same pass.
    expect(cloud.otherOps).toBeGreaterThan(0);
    expect(getSyncStatus().pending).toBe(1); // only the event is stuck

    for (let i = 0; i < 5; i++) {
      retrySync(); // tries 2..6 — the 6th pass drops the poison op
      await flush();
    }
    expect(getSyncStatus().pending).toBe(0); // dropped, not wedged
  });
});
