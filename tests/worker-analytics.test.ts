/**
 * The analytics half of the sync worker: beacon validation, the insert it
 * produces, and the summary query — pure, like ops.ts — plus a full
 * pipeline run (real client beacon → real worker → real SQLite) so the
 * summary is proven against rows the client actually sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import worker from '../cloudflare/src/worker';
import {
  FUNNEL_EVENTS as WORKER_FUNNEL_EVENTS,
  parseBeacon,
  parseSummaryQuery,
  statementsForBeacon,
  summaryStatements,
} from '../cloudflare/src/analytics';
import {
  ANALYTICS_URL_ENV,
  FUNNEL_EVENTS,
  sendFunnelEvent,
  stopAnalyticsForTests,
} from '../src/lib/analytics';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

const beacon = {
  event: 'app_open',
  packId: 'solar-system-demo',
  deviceId: '0f7a2b1c-6d3e-4f5a-8b9c-0d1e2f3a4b5c',
  appBuild: 'abc1234',
  ts: 1_700_000_000_000,
};

describe('parseBeacon', () => {
  it('accepts a well-formed beacon', () => {
    expect(parseBeacon(beacon)).toEqual(beacon);
  });

  it('accepts a missing appBuild (older or dev builds) as empty', () => {
    const { appBuild: _omit, ...rest } = beacon;
    expect(parseBeacon(rest)).toEqual({ ...rest, appBuild: '' });
  });

  it('client and worker agree on the closed funnel list', () => {
    expect([...WORKER_FUNNEL_EVENTS]).toEqual([...FUNNEL_EVENTS]);
  });

  it('rejects unknown events, bad ids, bad timestamps and junk', () => {
    expect(parseBeacon({ ...beacon, event: 'game_open' })).toBeNull();
    expect(parseBeacon({ ...beacon, event: 'x'.repeat(50) })).toBeNull();
    expect(parseBeacon({ ...beacon, packId: '' })).toBeNull();
    expect(parseBeacon({ ...beacon, deviceId: 'not a uuid!' })).toBeNull();
    expect(parseBeacon({ ...beacon, deviceId: 'a'.repeat(80) })).toBeNull();
    expect(parseBeacon({ ...beacon, ts: 'yesterday' })).toBeNull();
    expect(parseBeacon({ ...beacon, ts: -1 })).toBeNull();
    expect(parseBeacon({ ...beacon, appBuild: 'x'.repeat(200) })).toBeNull();
    expect(parseBeacon(null)).toBeNull();
    expect(parseBeacon('app_open')).toBeNull();
  });
});

describe('statementsForBeacon', () => {
  it('inserts one row carrying the client ts and the server receipt time', () => {
    const [stmt] = statementsForBeacon(parseBeacon(beacon)!, 1_700_000_005_000);
    expect(stmt.sql).toContain('INSERT INTO analytics_events');
    expect(stmt.params).toEqual([
      'app_open',
      'solar-system-demo',
      beacon.deviceId,
      'abc1234',
      beacon.ts,
      1_700_000_005_000,
    ]);
  });
});

describe('parseSummaryQuery', () => {
  it('requires a pack and defaults to 30 days, clamped to a year', () => {
    expect(parseSummaryQuery(new URLSearchParams('pack=demo'))).toEqual({
      pack: 'demo',
      days: 30,
    });
    expect(parseSummaryQuery(new URLSearchParams('pack=demo&days=7'))).toEqual({
      pack: 'demo',
      days: 7,
    });
    expect(parseSummaryQuery(new URLSearchParams('pack=demo&days=9999'))?.days).toBe(365);
    expect(parseSummaryQuery(new URLSearchParams('pack=demo&days=0'))?.days).toBe(30);
    expect(parseSummaryQuery(new URLSearchParams('pack=demo&days=abc'))?.days).toBe(30);
    expect(parseSummaryQuery(new URLSearchParams(''))).toBeNull();
  });

  it('scopes every summary statement to the pack and the window', () => {
    const stmts = summaryStatements('demo', 1_000);
    expect(stmts.length).toBeGreaterThan(0);
    for (const s of stmts) {
      expect(s.sql).toContain('pack_id = ?');
      expect(s.sql).toContain('received_at >= ?');
      expect(s.params).toEqual(['demo', 1_000]);
    }
  });
});

// ── Full pipeline: client beacon → worker.fetch → SQLite → summary ──────

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

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('analytics end-to-end (client beacon ↔ real worker ↔ real SQLite)', () => {
  let db: DatabaseSync;
  let env: { DB: ReturnType<typeof makeD1>; ANALYTICS_READ_TOKEN?: string };
  const inflight: Promise<unknown>[] = [];

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'schema.sql'), 'utf8'));
    env = { DB: makeD1(db) };
    process.env[ANALYTICS_URL_ENV] = 'https://sync.test/v1/analytics';
    // Beacons go out via the keepalive-fetch fallback (no sendBeacon here),
    // routed straight into the worker exactly as a browser would send them:
    // a text/plain body, no preflight.
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const p = worker.fetch(new Request(new URL(String(input)), init), env as never);
      inflight.push(p);
      return p;
    });
  });

  afterEach(() => {
    stopAnalyticsForTests();
    delete process.env[ANALYTICS_URL_ENV];
    vi.unstubAllGlobals();
    db.close();
  });

  async function device(id: string) {
    vi.stubGlobal('window', { localStorage: fakeLocalStorage(), dispatchEvent: () => true });
    // Give the fresh device a known id so the summary's device counts are
    // deterministic.
    window.localStorage.setItem('quizmill.deviceId.v1', id);
  }

  async function summary(query: string) {
    const res = await worker.fetch(
      new Request(`https://sync.test/v1/analytics/summary?${query}`),
      env as never,
    );
    return { status: res.status, body: await res.json() };
  }

  it('beacons from two devices roll up into the per-event summary', async () => {
    await device('11111111-1111-4111-8111-111111111111');
    expect(sendFunnelEvent({ id: 'e1', type: 'app_open', at: Date.now() })).toBe(true);
    expect(sendFunnelEvent({ id: 'e2', type: 'app_open', at: Date.now() })).toBe(true);
    expect(sendFunnelEvent({ id: 'e3', type: 'first_answer', at: Date.now() })).toBe(true);
    await device('22222222-2222-4222-8222-222222222222');
    expect(sendFunnelEvent({ id: 'e4', type: 'app_open', at: Date.now() })).toBe(true);
    await Promise.all(inflight);

    const { status, body } = await summary('pack=solar-system-demo');
    expect(status).toBe(200);
    expect(body.pack).toBe('solar-system-demo');
    expect(body.days).toBe(30);
    expect(body.events.app_open).toEqual({ count: 3, devices: 2 });
    expect(body.events.first_answer).toEqual({ count: 1, devices: 1 });
    expect(body.events.session_10).toEqual({ count: 0, devices: 0 });
    expect(Object.keys(body.events)).toEqual([...FUNNEL_EVENTS]);
    // One row per (day, event) that occurred — both today.
    expect(body.daily).toHaveLength(2);
    expect(body.daily.map((d: { event: string; devices: number }) => [d.event, d.devices])).toEqual([
      ['app_open', 2],
      ['first_answer', 1],
    ]);

    // Another pack sees none of it.
    const other = await summary('pack=other-pack');
    expect(other.body.events.app_open).toEqual({ count: 0, devices: 0 });
  });

  it('the ingest route needs no sync key and answers 204 with CORS headers', async () => {
    const res = await worker.fetch(
      new Request('https://sync.test/v1/analytics', {
        method: 'POST',
        body: JSON.stringify(beacon),
      }),
      env as never,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(db.prepare('SELECT COUNT(*) AS n FROM analytics_events').get()).toEqual({ n: 1 });
  });

  it('rejects a malformed beacon without storing anything', async () => {
    for (const body of ['not json', JSON.stringify({ ...beacon, event: 'export' })]) {
      const res = await worker.fetch(
        new Request('https://sync.test/v1/analytics', { method: 'POST', body }),
        env as never,
      );
      expect(res.status).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM analytics_events').get()).toEqual({ n: 0 });
  });

  it('the summary is gated by ANALYTICS_READ_TOKEN when one is configured', async () => {
    env.ANALYTICS_READ_TOKEN = 'sekrit';
    expect((await summary('pack=demo')).status).toBe(401);
    const res = await worker.fetch(
      new Request('https://sync.test/v1/analytics/summary?pack=demo', {
        headers: { authorization: 'Bearer sekrit' },
      }),
      env as never,
    );
    expect(res.status).toBe(200);
  });

  it('the summary needs a pack', async () => {
    expect((await summary('')).status).toBe(400);
  });
});
