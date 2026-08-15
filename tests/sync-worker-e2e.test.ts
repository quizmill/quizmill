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
import { httpBackend, setSyncKey } from '../src/lib/backends/httpBackend';
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
