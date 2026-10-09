import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { AppEvent, Attempt, Session } from '../src/data/types';
import { statementsForOp } from '../cloudflare/src/ops';
import {
  REPORT_SQL,
  buildReport,
  parseRowsJson,
  renderAnalyticsSection,
  renderMarkdown,
  type RawRow,
} from '../cloudflare/src/report';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 9, 6, 0, 0); // 2026-10-09T06:00Z

// ── fixture: two packs, three learners ──────────────────────────────────

let seq = 0;
const attempt = (
  user: string,
  pack: string,
  questionId: string,
  isCorrect: boolean,
  answeredAt: number,
  sessionId = 's',
): RawRow => ({
  user_id: user,
  pack_id: pack,
  tbl: 'attempts',
  data: JSON.stringify({
    id: `a${++seq}`,
    sessionId,
    questionId,
    answeredAt,
    selectedAnswer: 'A',
    isCorrect,
    timeTakenSeconds: 3,
    subject: 'planets',
    topic: questionId,
    difficulty: 1,
  } satisfies Attempt),
});

const session = (user: string, pack: string, id: string, startedAt: number): RawRow => ({
  user_id: user,
  pack_id: pack,
  tbl: 'sessions',
  data: JSON.stringify({
    id,
    subject: 'planets',
    startedAt,
    endedAt: startedAt + 60_000,
    questionCount: 2,
    correctCount: 1,
  } satisfies Session),
});

const event = (
  user: string,
  pack: string,
  type: AppEvent['type'],
  at: number,
  data?: AppEvent['data'],
): RawRow => ({
  user_id: user,
  pack_id: pack,
  tbl: 'events',
  data: JSON.stringify({ id: `e${++seq}`, type, at, ...(data ? { data } : {}) } satisfies AppEvent),
});

function fixture(): RawRow[] {
  return [
    // Alice: active this week, one mistake rescued, one still open.
    session('alice', 'solar', 's1', NOW - 2 * DAY),
    attempt('alice', 'solar', 'q1', false, NOW - 2 * DAY, 's1'),
    attempt('alice', 'solar', 'q2', false, NOW - 2 * DAY, 's1'),
    session('alice', 'solar', 's2', NOW - 1 * DAY),
    attempt('alice', 'solar', 'q1', true, NOW - 1 * DAY, 's2'),
    attempt('alice', 'solar', 'q3', true, NOW - 1 * DAY, 's2'),
    event('alice', 'solar', 'app_open', NOW - 2 * DAY),
    event('alice', 'solar', 'app_open', NOW - 1 * DAY),
    event('alice', 'solar', 'game_open', NOW - 1 * DAY, { game: 'snake' }),
    // Bob: last practised three weeks ago (30d-active, not 7d), all correct.
    session('bob', 'solar', 's3', NOW - 21 * DAY),
    attempt('bob', 'solar', 'q1', true, NOW - 21 * DAY, 's3'),
    event('bob', 'solar', 'app_open', NOW - 21 * DAY),
    event('bob', 'solar', 'export', NOW - 20 * DAY),
    // Carol: dormant since spring, one open mistake; also a second pack.
    session('carol', 'solar', 's4', NOW - 120 * DAY),
    attempt('carol', 'solar', 'q2', false, NOW - 120 * DAY, 's4'),
    session('carol', 'capitals', 's5', NOW - 3 * DAY),
    attempt('carol', 'capitals', 'c1', true, NOW - 3 * DAY, 's5'),
    attempt('carol', 'capitals', 'c2', true, NOW - 3 * DAY, 's5'),
    event('carol', 'capitals', 'app_open', NOW - 3 * DAY),
    // Rows the report must ignore: other tables and unparseable data.
    { user_id: 'alice', pack_id: 'solar', tbl: 'votes', data: '{"questionId":"q1","vote":"up"}' },
    { user_id: 'alice', pack_id: 'solar', tbl: 'attempts', data: '{not json' },
  ];
}

describe('buildReport (per-pack aggregates over mirrored rows)', () => {
  it('counts learners, activity windows, sessions, attempts and mistakes per pack', () => {
    const report = buildReport(fixture(), NOW);
    expect(report.packs.map((p) => p.packId)).toEqual(['solar', 'capitals']); // most learners first

    const solar = report.packs[0];
    expect(solar.learners).toBe(3);
    expect(solar.active7d).toBe(1); // alice
    expect(solar.active30d).toBe(2); // alice + bob
    expect(solar.sessions).toEqual({ total: 4, last30d: 3 });
    expect(solar.attempts).toEqual({ total: 6, last30d: 5, correct: 3 });
    // alice rescued q1 (q2 still open); carol's q2 is open; bob never erred.
    expect(solar.mistakes).toEqual({ rescued: 1, open: 2 });

    const capitals = report.packs[1];
    expect(capitals.learners).toBe(1);
    expect(capitals.active7d).toBe(1);
    expect(capitals.active30d).toBe(1);
    expect(capitals.sessions).toEqual({ total: 1, last30d: 1 });
    expect(capitals.attempts).toEqual({ total: 2, last30d: 2, correct: 2 });
    expect(capitals.mistakes).toEqual({ rescued: 0, open: 0 });
  });

  it('tallies events by type with 7d/30d windows, busiest type first', () => {
    const { packs } = buildReport(fixture(), NOW);
    expect(packs[0].events).toEqual([
      { type: 'app_open', total: 3, last30d: 3, last7d: 2 },
      { type: 'export', total: 1, last30d: 1, last7d: 0 },
      { type: 'game_open', total: 1, last30d: 1, last7d: 1 },
    ]);
    expect(packs[1].events).toEqual([{ type: 'app_open', total: 1, last30d: 1, last7d: 1 }]);
  });

  it('never carries a user id into the report', () => {
    const text = JSON.stringify(buildReport(fixture(), NOW));
    for (const user of ['alice', 'bob', 'carol']) expect(text).not.toContain(user);
  });

  it('reads an empty database as an empty report, not a crash', () => {
    expect(buildReport([], NOW).packs).toEqual([]);
  });
});

describe('parseRowsJson (wrangler d1 execute --json, or a bare row array)', () => {
  const row: RawRow = { user_id: 'u', pack_id: 'p', tbl: 'events', data: '{}' };

  it('unwraps the wrangler envelope', () => {
    const text = JSON.stringify([{ results: [row], success: true, meta: { rows_read: 1 } }]);
    expect(parseRowsJson(text)).toEqual([row]);
  });

  it('accepts a plain array of rows and rejects anything else', () => {
    expect(parseRowsJson(JSON.stringify([row]))).toEqual([row]);
    expect(() => parseRowsJson('{"nope":1}')).toThrow(/rows/);
    expect(() => parseRowsJson('[{"user_id":"u"}]')).toThrow(/rows/);
  });
});

describe('REPORT_SQL against the real schema', () => {
  it('selects exactly the three tables the report reads, in the shape it expects', () => {
    // node:sqlite is a real builtin (node 22.5+); createRequire sidesteps
    // vite's resolver, same trick as tests/sync-worker-e2e.test.ts.
    const { DatabaseSync } = createRequire(import.meta.url)(
      'node:sqlite',
    ) as typeof import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'schema.sql'), 'utf8'));
    const ops = [
      { t: 'sessions', op: 'upsert', id: 's1', data: { id: 's1', startedAt: NOW } },
      {
        t: 'attempts',
        op: 'upsert',
        id: 'a1',
        ref: 's1',
        data: { id: 'a1', questionId: 'q1', answeredAt: NOW, isCorrect: true },
      },
      { t: 'events', op: 'upsert', id: 'e1', data: { id: 'e1', type: 'app_open', at: NOW } },
      { t: 'votes', op: 'upsert', id: 'q1', data: { questionId: 'q1', vote: 'up' } },
      { t: 'notes', op: 'upsert', id: 'q1', data: { questionId: 'q1', text: 'hi' } },
    ] as const;
    for (const op of ops) {
      for (const s of statementsForOp(op, 'user-hash', 'solar')) {
        db.prepare(s.sql).run(...(s.params as never[]));
      }
    }
    const rows = db.prepare(REPORT_SQL).all() as unknown as RawRow[];
    expect(rows.map((r) => r.tbl).sort()).toEqual(['attempts', 'events', 'sessions']);
    expect(Object.keys(rows[0]).sort()).toEqual(['data', 'pack_id', 'tbl', 'user_id']);
    expect(buildReport(rows, NOW).packs[0]).toMatchObject({
      packId: 'solar',
      learners: 1,
      active7d: 1,
      events: [{ type: 'app_open', total: 1 }],
    });
    db.close();
  });
});

describe('renderMarkdown', () => {
  it('renders an overview table and one section per pack', () => {
    const md = renderMarkdown(buildReport(fixture(), NOW), { source: 'fixture' });
    expect(md).toMatch(/^# quizmill sync usage report/);
    expect(md).toContain('| Pack | Learners | Active 7d | Active 30d | Sessions | Attempts | Mistakes rescued | Mistakes open |');
    expect(md).toContain('| `solar` | 3 | 1 | 2 | 4 | 6 | 1 | 2 |');
    expect(md).toContain('| `capitals` | 1 | 1 | 1 | 1 | 2 | 0 | 0 |');
    expect(md).toContain('## solar');
    expect(md).toContain('| `app_open` | 3 | 3 | 2 |');
    expect(md).toContain('Source: fixture');
    // Definitions travel with the numbers so the reader needn't open the code.
    expect(md).toMatch(/active.*answered at least one question/i);
  });

  it('says so when there is nothing to report', () => {
    const md = renderMarkdown(buildReport([], NOW), { source: 'fixture' });
    expect(md).toContain('No synced practice history yet.');
  });
});

describe('renderAnalyticsSection (GET /v1/analytics/summary, when deployed)', () => {
  it('renders the funnel totals as a table', () => {
    const md = renderAnalyticsSection({
      pack: 'solar',
      days: 30,
      since: '2026-09-09T06:00:00.000Z',
      events: {
        app_open: { count: 40, devices: 12 },
        first_answer: { count: 9, devices: 9 },
        session_10: { count: 3, devices: 3 },
      },
      daily: [],
    });
    expect(md).toContain('### Funnel (anonymous beacons, last 30 days)');
    expect(md).toContain('| `app_open` | 40 | 12 |');
    expect(md).toContain('| `session_10` | 3 | 3 |');
  });

  it('explains an unavailable summary instead of hiding it', () => {
    expect(renderAnalyticsSection(null, 'HTTP 404')).toContain('not available (HTTP 404)');
  });
});
