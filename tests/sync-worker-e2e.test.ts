/**
 * Full-pipeline sync e2e for notes (and friends): the REAL client pieces
 * (storage rows → httpBackend wire encoding → bearer sync-key auth) hit
 * the REAL Cloudflare worker code (validation → SQL) running against a
 * REAL SQLite database (node:sqlite) loaded with cloudflare/schema.sql.
 * Only the network is stubbed — global fetch routes into worker.fetch.
 *
 * This is the layer the unit tests couldn't see: tests/worker-sync.test.ts
 * checks each half in isolation, but nothing previously proved a note
 * recorded on device A actually lands in the database and merges onto
 * device B.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../cloudflare/src/worker';
import {
  getStoredKeyName,
  httpBackend,
  reconcileKeyName,
  saveKeyName,
  setSyncKey,
} from '../src/lib/backends/httpBackend';
import { generateSyncKey } from '../src/lib/syncKey';
import * as storage from '../src/lib/storage';

// node:sqlite is a real builtin (node 22.5+), but vite's resolver doesn't
// know it yet — createRequire sidesteps the bundler entirely.
const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

// hashSyncKey needs Web Crypto; older happy-dom-less node envs vary.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

// ── D1 over node:sqlite ─────────────────────────────────────────────────

interface BoundStmt {
  bind(...values: unknown[]): BoundStmt;
  all<T>(): Promise<{ results: T[] }>;
  runNow(): void;
}

function makeD1(db: DatabaseSync) {
  const prepare = (sql: string): BoundStmt => {
    let params: unknown[] = [];
    const stmt: BoundStmt = {
      bind(...values: unknown[]) {
        params = values;
        return stmt;
      },
      async all<T>() {
        const results = db.prepare(sql).all(...(params as never[])) as T[];
        return { results };
      },
      runNow() {
        db.prepare(sql).run(...(params as never[]));
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(statements: BoundStmt[]) {
      for (const s of statements) s.runNow();
      return [];
    },
  };
}

// ── Wire fetch → worker ─────────────────────────────────────────────────

let db: DatabaseSync;
let env: { DB: ReturnType<typeof makeD1> };

beforeAll(() => {
  // Route the client's fetch('/v1/…') calls straight into the worker.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://sync.test');
    return worker.fetch(new Request(url, init), env as never);
  }) as typeof fetch;
});

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Point the client at a fresh device (own localStorage) with this key. */
async function useDevice(syncKey: string) {
  (globalThis as { window?: unknown }).window = {
    localStorage: fakeLocalStorage(),
    dispatchEvent: () => true,
  };
  expect(await setSyncKey(syncKey)).toBe(true);
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'schema.sql'), 'utf8'));
  env = { DB: makeD1(db) };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  db.close();
});

describe('notes sync end-to-end (client engine ↔ real worker ↔ real SQLite)', () => {
  it('a note recorded on device A lands in the cloud and merges onto device B', async () => {
    const key = generateSyncKey();

    // Device A: leave a note, mirror the resulting rows up.
    await useDevice(key);
    storage.recordNote('q-photosynthesis', 'want harder ones on light reactions', 1234);
    for (const row of storage.loadNotes()) {
      await httpBackend.runOp({ t: 'notes', op: 'upsert', row }, 'unused');
    }

    // Device B: same key, fresh storage — pull and merge.
    await useDevice(key);
    const pulled = await httpBackend.pullAll('unused');
    expect(pulled.notes).toHaveLength(1);
    storage.mergeRemote(pulled);
    expect(storage.getNote('q-photosynthesis')?.text).toBe(
      'want harder ones on light reactions',
    );
    expect(storage.getNote('q-photosynthesis')?.updatedAt).toBe(1234);
  });

  it('editing and deleting a note propagate (last-write-wins upsert, then delete)', async () => {
    const key = generateSyncKey();
    await useDevice(key);

    const v1 = { questionId: 'q1', text: 'first thought', updatedAt: 100 };
    const v2 = { questionId: 'q1', text: 'sharper second thought', updatedAt: 200 };
    await httpBackend.runOp({ t: 'notes', op: 'upsert', row: v1 }, 'u');
    await httpBackend.runOp({ t: 'notes', op: 'upsert', row: v2 }, 'u');
    expect((await httpBackend.pullAll('u')).notes).toEqual([v2]);

    await httpBackend.runOp({ t: 'notes', op: 'delete', questionId: 'q1' }, 'u');
    expect((await httpBackend.pullAll('u')).notes).toEqual([]);
  });

  it('notes are partitioned by sync key — another key sees nothing', async () => {
    const keyA = generateSyncKey();
    const keyB = generateSyncKey();

    await useDevice(keyA);
    await httpBackend.runOp(
      { t: 'notes', op: 'upsert', row: { questionId: 'q1', text: 'mine', updatedAt: 1 } },
      'u',
    );

    await useDevice(keyB);
    expect((await httpBackend.pullAll('u')).notes).toEqual([]);
  });

  it('clear-all wipes notes along with the other tables for this pack', async () => {
    const key = generateSyncKey();
    await useDevice(key);
    await httpBackend.runOp(
      { t: 'notes', op: 'upsert', row: { questionId: 'q1', text: 'note', updatedAt: 1 } },
      'u',
    );
    await httpBackend.runOp({ t: 'clear-all', op: 'delete' }, 'u');
    expect((await httpBackend.pullAll('u')).notes).toEqual([]);
  });

  it('REGRESSION of the field report: a pre-notes worker 400s the notes op while other tables sync', async () => {
    // Simulate the stale deployment by re-mounting the worker with the old
    // table list (what a worker built before this feature enforces).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const isNotesOp = body?.ops?.some((o: { t: string }) => o.t === 'notes');
      if (isNotesOp) {
        // Old parseOpsRequest: unknown table → whole batch rejected.
        return new Response(JSON.stringify({ error: 'invalid ops request' }), { status: 400 });
      }
      return originalFetch(input as never, init);
    }) as typeof fetch;

    try {
      const key = generateSyncKey();
      await useDevice(key);
      // Sessions still sync…
      await httpBackend.runOp(
        {
          t: 'sessions',
          op: 'upsert',
          row: {
            id: 's1',
            subject: 'planets',
            startedAt: 1,
            endedAt: 2,
            questionCount: 1,
            correctCount: 1,
            mode: 'practice',
          },
        },
        'u',
      );
      // …but the notes op throws — this is what fed "Couldn't sync N · retry".
      await expect(
        httpBackend.runOp(
          { t: 'notes', op: 'upsert', row: { questionId: 'q1', text: 'n', updatedAt: 1 } },
          'u',
        ),
      ).rejects.toThrow(/400/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('one sync key, many packs (the pack-library app model)', () => {
  // The multi-pack app syncs every pack under ONE app-level key; the
  // worker partitions rows by (user, pack) — these tests prove that
  // partition holds end-to-end, so consolidating per-pack installs into
  // one app cannot cross-contaminate or amplify anything server-side.

  /** Raw wire call so we can vary the pack id (httpBackend pins PACK_ID
   *  to the build manifest at module load). */
  async function ops(key: string, pack: string, wireOps: unknown[]): Promise<Response> {
    return fetch('https://sync.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pack, ops: wireOps }),
    });
  }
  async function pull(key: string, pack: string): Promise<Record<string, unknown[]>> {
    const res = await fetch(`https://sync.test/v1/rows?pack=${encodeURIComponent(pack)}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    return res.json() as Promise<Record<string, unknown[]>>;
  }
  const session = (id: string, subject: string) => ({
    t: 'sessions',
    op: 'upsert',
    id,
    data: { id, subject, startedAt: 1, endedAt: 2, questionCount: 1, correctCount: 1 },
  });

  it('keeps each pack\'s rows isolated under the same key, even with equal row ids', async () => {
    const key = generateSyncKey();

    // Same row id "s1" written under two packs — the PK includes pack_id,
    // so these are two rows, not one overwriting the other.
    expect((await ops(key, 'solar-system-demo', [session('s1', 'planets')])).status).toBe(200);
    expect((await ops(key, 'world-capitals', [session('s1', 'europe')])).status).toBe(200);

    const solar = await pull(key, 'solar-system-demo');
    const capitals = await pull(key, 'world-capitals');
    expect(solar.sessions).toHaveLength(1);
    expect(capitals.sessions).toHaveLength(1);
    expect((solar.sessions[0] as { subject: string }).subject).toBe('planets');
    expect((capitals.sessions[0] as { subject: string }).subject).toBe('europe');
  });

  it('clear-all scoped to one pack leaves the other packs\' rows untouched', async () => {
    const key = generateSyncKey();
    await ops(key, 'solar-system-demo', [session('s1', 'planets')]);
    await ops(key, 'world-capitals', [session('s1', 'europe')]);

    // "Reset all local progress" while solar is active → wipes ONLY solar.
    expect(
      (await ops(key, 'solar-system-demo', [{ t: 'clear-all', op: 'delete' }])).status,
    ).toBe(200);

    expect((await pull(key, 'solar-system-demo')).sessions).toHaveLength(0);
    expect((await pull(key, 'world-capitals')).sessions).toHaveLength(1);
  });

  it('a consolidating user reaches their old per-pack-app rows with the same key + pack id', async () => {
    // Yesterday: the dedicated pack app synced under (key, world-capitals).
    const key = generateSyncKey();
    await ops(key, 'world-capitals', [session('old-session', 'africa')]);

    // Today: the multi-pack app, SAME key, activates that pack and pulls
    // the same partition — the history is simply there.
    const pulled = await pull(key, 'world-capitals');
    expect(pulled.sessions).toHaveLength(1);
    expect((pulled.sessions[0] as { id: string }).id).toBe('old-session');
  });
});

/** Return to a device captured earlier (each device has its own
 *  localStorage, so a handle is just its window). */
function resumeDevice(handle: unknown): void {
  (globalThis as { window?: unknown }).window = handle;
}

describe('key names end-to-end (name a key, read it on the other device)', () => {
  it('a name set on one device shows up on every device holding the key', async () => {
    const key = generateSyncKey();

    // Dad's iPad: name the key.
    await useDevice(key);
    expect(await saveKeyName('Leo')).toEqual({ name: 'Leo', synced: true });

    // Leo's phone: same key, fresh storage — the name arrives with it.
    await useDevice(key);
    expect(getStoredKeyName()).toBeNull();
    expect(await reconcileKeyName()).toBe('Leo');
    expect(getStoredKeyName()).toBe('Leo'); // …and is cached for offline
  });

  it('names are per key: two keys in one house stay distinguishable', async () => {
    const dad = generateSyncKey();
    const son = generateSyncKey();

    await useDevice(dad);
    await saveKeyName("Dad's key");
    await useDevice(son);
    await saveKeyName('Leo');

    await useDevice(dad);
    expect(await reconcileKeyName()).toBe("Dad's key");
    await useDevice(son);
    expect(await reconcileKeyName()).toBe('Leo');
  });

  it('a rename propagates to the other device', async () => {
    const key = generateSyncKey();
    await useDevice(key);
    await saveKeyName('Leo');
    await saveKeyName('Leo (year 6)');

    await useDevice(key);
    expect(await reconcileKeyName()).toBe('Leo (year 6)');
  });

  it('clearing a name clears it everywhere — a cached name is not resurrected', async () => {
    const key = generateSyncKey();

    // Device A names the key; device B picks the name up and caches it.
    await useDevice(key);
    await saveKeyName('Leo');
    await useDevice(key);
    const deviceB = globalThis.window;
    expect(await reconcileKeyName()).toBe('Leo');

    // Device A clears the name…
    await useDevice(key);
    expect(await saveKeyName('   ')).toEqual({ name: null, synced: true });

    // …and device B drops its cached copy on the next reconcile rather
    // than pushing the stale name back up.
    resumeDevice(deviceB);
    expect(await reconcileKeyName()).toBeNull();
    expect(getStoredKeyName()).toBeNull();
  });

  it('stores the canonical name, so odd whitespace round-trips cleanly', async () => {
    const key = generateSyncKey();
    await useDevice(key);
    await saveKeyName('   Leo    iPad  ');
    await useDevice(key);
    expect(await reconcileKeyName()).toBe('Leo iPad');
  });

  it('naming a key never touches the practice rows behind it', async () => {
    const key = generateSyncKey();
    await useDevice(key);
    await httpBackend.runOp(
      { t: 'notes', op: 'upsert', row: { questionId: 'q1', text: 'note', updatedAt: 1 } },
      'u',
    );
    await saveKeyName('Leo');
    expect((await httpBackend.pullAll('u')).notes).toHaveLength(1);

    // …and resetting one pack's progress keeps the name: forgetting the
    // history shouldn't make the device forget whose it is.
    await httpBackend.runOp({ t: 'clear-all', op: 'delete' }, 'u');
    expect((await httpBackend.pullAll('u')).notes).toHaveLength(0);
    expect(await reconcileKeyName()).toBe('Leo');
  });
});

describe('key names against a server that does not support them', () => {
  /** A worker deployed before names existed: /v1/profile is a 404. */
  function withPreNamesServer<T>(run: () => Promise<T>): Promise<T> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/v1/profile')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      return originalFetch(input as never, init);
    }) as typeof fetch;
    return run().finally(() => {
      globalThis.fetch = originalFetch;
    });
  }

  it('keeps the name on this device and says it did not sync', async () => {
    const key = generateSyncKey();
    await useDevice(key);
    const saved = await withPreNamesServer(() => saveKeyName('Leo'));
    expect(saved).toEqual({ name: 'Leo', synced: false });
    // Still shown here — the label is local-first, like the rest of the app.
    expect(getStoredKeyName()).toBe('Leo');
    expect(await withPreNamesServer(() => reconcileKeyName())).toBe('Leo');
  });

  it('pushes the name up by itself once the server is upgraded', async () => {
    const key = generateSyncKey();

    // Named while the server can't store it — the name is pending here.
    await useDevice(key);
    const device = globalThis.window;
    await withPreNamesServer(() => saveKeyName('Leo'));

    // Server upgraded: the next reconcile drains the pending name up…
    expect(await reconcileKeyName()).toBe('Leo');

    // …so a device linking afterwards reads it from the server.
    await useDevice(key);
    expect(await reconcileKeyName()).toBe('Leo');

    resumeDevice(device);
    expect(getStoredKeyName()).toBe('Leo');
  });
});
