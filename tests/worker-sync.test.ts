import { describe, expect, it } from 'vitest';
import type { Attempt, Session } from '../src/data/types';
import { toWireOp } from '../src/lib/backends/httpBackend';
import { hashSyncKey, generateSyncKey } from '../src/lib/syncKey';
import {
  parseOp,
  parseOpsRequest,
  statementsForOp,
  userIdFromKey,
  type WireOp,
} from '../cloudflare/src/ops';

const session: Session = {
  id: 's1',
  subject: 'planets',
  startedAt: 1000,
  endedAt: 2000,
  questionCount: 5,
  correctCount: 4,
  mode: 'practice',
};

const attempt: Attempt = {
  id: 'a1',
  sessionId: 's1',
  questionId: 'q1',
  answeredAt: 1500,
  selectedAnswer: 'B',
  isCorrect: true,
  timeTakenSeconds: 7,
  subject: 'planets',
  topic: 'q1',
  difficulty: 2,
};

describe('toWireOp (client → wire)', () => {
  it('ships rows verbatim, keyed by their natural id', () => {
    expect(toWireOp({ t: 'sessions', op: 'upsert', row: session })).toEqual({
      t: 'sessions',
      op: 'upsert',
      id: 's1',
      data: session,
    });
    expect(
      toWireOp({ t: 'votes', op: 'upsert', row: { questionId: 'q1', vote: 'up', votedAt: 1 } }),
    ).toEqual({
      t: 'votes',
      op: 'upsert',
      id: 'q1',
      data: { questionId: 'q1', vote: 'up', votedAt: 1 },
    });
    expect(
      toWireOp({
        t: 'notes',
        op: 'upsert',
        row: { questionId: 'q1', text: 'go deeper', updatedAt: 1 },
      }),
    ).toEqual({
      t: 'notes',
      op: 'upsert',
      id: 'q1',
      data: { questionId: 'q1', text: 'go deeper', updatedAt: 1 },
    });
  });

  it('ships events keyed by their own id', () => {
    const event = { id: 'e1', type: 'game_open' as const, at: 5, data: { game: 'snake' } };
    expect(toWireOp({ t: 'events', op: 'upsert', row: event })).toEqual({
      t: 'events',
      op: 'upsert',
      id: 'e1',
      data: event,
    });
  });

  it('marks attempts with their session as ref, for grouped deletes', () => {
    expect(toWireOp({ t: 'attempts', op: 'upsert', row: attempt })).toEqual({
      t: 'attempts',
      op: 'upsert',
      id: 'a1',
      ref: 's1',
      data: attempt,
    });
  });

  it('passes deletes through', () => {
    expect(toWireOp({ t: 'votes', op: 'delete', questionId: 'q9' })).toEqual({
      t: 'votes',
      op: 'delete',
      id: 'q9',
    });
    expect(toWireOp({ t: 'notes', op: 'delete', questionId: 'q9' })).toEqual({
      t: 'notes',
      op: 'delete',
      id: 'q9',
    });
    expect(toWireOp({ t: 'clear-all', op: 'delete' })).toEqual({
      t: 'clear-all',
      op: 'delete',
    });
    expect(
      toWireOp({ t: 'clear-sessions', op: 'delete', sessionIds: ['s1', 's2'] }),
    ).toEqual({ t: 'clear-sessions', op: 'delete', sessionIds: ['s1', 's2'] });
  });
});

describe('parseOp / parseOpsRequest (worker validation)', () => {
  it('accepts every wire shape the client produces', () => {
    const ops = [
      toWireOp({ t: 'sessions', op: 'upsert', row: session }),
      toWireOp({ t: 'attempts', op: 'upsert', row: attempt }),
      toWireOp({ t: 'achievements', op: 'upsert', row: { id: 'st1', earnedAt: 1 } }),
      toWireOp({
        t: 'notes',
        op: 'upsert',
        row: { questionId: 'q1', text: 'more like this', updatedAt: 1 },
      }),
      toWireOp({ t: 'events', op: 'upsert', row: { id: 'e1', type: 'app_open', at: 1 } }),
      toWireOp({ t: 'votes', op: 'delete', questionId: 'q1' }),
      toWireOp({ t: 'notes', op: 'delete', questionId: 'q1' }),
      toWireOp({ t: 'clear-all', op: 'delete' }),
      toWireOp({ t: 'clear-sessions', op: 'delete', sessionIds: ['s1'] }),
    ];
    const parsed = parseOpsRequest({ pack: 'demo', ops });
    expect(parsed).not.toBeNull();
    expect(parsed!.ops).toHaveLength(ops.length);
  });

  it('rejects malformed ops and rejects the whole batch with them', () => {
    expect(parseOp({ t: 'sessions', op: 'upsert', id: '', data: {} })).toBeNull();
    expect(parseOp({ t: 'nope', op: 'upsert', id: 'x', data: {} })).toBeNull();
    expect(parseOp({ t: 'sessions', op: 'upsert', id: 'x', data: 'str' })).toBeNull();
    expect(parseOp({ t: 'clear-sessions', op: 'delete', sessionIds: [] })).toBeNull();
    expect(parseOp({ t: 'clear-sessions', op: 'delete', sessionIds: [1] })).toBeNull();
    // one bad op poisons the batch (all-or-nothing)
    expect(
      parseOpsRequest({
        pack: 'demo',
        ops: [toWireOp({ t: 'clear-all', op: 'delete' }), { t: 'junk' }],
      }),
    ).toBeNull();
    expect(parseOpsRequest({ pack: '', ops: [] })).toBeNull();
  });

  it('rejects oversized rows', () => {
    const huge = { blob: 'x'.repeat(40_000) };
    expect(parseOp({ t: 'sessions', op: 'upsert', id: 's', data: huge })).toBeNull();
  });
});

describe('statementsForOp (worker SQL)', () => {
  const uid = 'user-hash';
  const pack = 'demo';

  it('upserts with last-write-wins for sessions/attempts/votes', () => {
    const [stmt] = statementsForOp(
      toWireOp({ t: 'sessions', op: 'upsert', row: session }),
      uid,
      pack,
    );
    expect(stmt.sql).toContain('DO UPDATE');
    expect(stmt.params).toEqual([uid, pack, 'sessions', 's1', '', JSON.stringify(session)]);
  });

  it('keeps achievements write-once (DO NOTHING on conflict)', () => {
    const [stmt] = statementsForOp(
      toWireOp({ t: 'achievements', op: 'upsert', row: { id: 'st1', earnedAt: 5 } }),
      uid,
      pack,
    );
    expect(stmt.sql).toContain('DO NOTHING');
  });

  it('stores an attempt with its session id in ref', () => {
    const [stmt] = statementsForOp(
      toWireOp({ t: 'attempts', op: 'upsert', row: attempt }),
      uid,
      pack,
    );
    expect(stmt.params[4]).toBe('s1');
  });

  it('clear-sessions deletes the sessions AND the attempts inside them', () => {
    const op: WireOp = { t: 'clear-sessions', op: 'delete', sessionIds: ['s1', 's2'] };
    const stmts = statementsForOp(op, uid, pack);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toContain("tbl = 'attempts'");
    expect(stmts[0].sql).toContain('ref IN (?, ?)');
    expect(stmts[0].params).toEqual([uid, pack, 's1', 's2']);
    expect(stmts[1].sql).toContain("tbl = 'sessions'");
    expect(stmts[1].sql).toContain('id IN (?, ?)');
  });

  it('clear-all wipes only this user + pack', () => {
    const [stmt] = statementsForOp({ t: 'clear-all', op: 'delete' }, uid, pack);
    expect(stmt.sql).toBe('DELETE FROM rows WHERE user_id = ? AND pack_id = ?');
    expect(stmt.params).toEqual([uid, pack]);
  });

  it('vote and note deletes target one row', () => {
    const [stmt] = statementsForOp({ t: 'votes', op: 'delete', id: 'q7' }, uid, pack);
    expect(stmt.params).toEqual([uid, pack, 'votes', 'q7']);
    const [nStmt] = statementsForOp({ t: 'notes', op: 'delete', id: 'q7' }, uid, pack);
    expect(nStmt.params).toEqual([uid, pack, 'notes', 'q7']);
  });

  it('note upserts are last-write-wins like votes', () => {
    const note = { questionId: 'q1', text: 'go deeper', updatedAt: 9 };
    const [stmt] = statementsForOp(
      toWireOp({ t: 'notes', op: 'upsert', row: note }),
      uid,
      pack,
    );
    expect(stmt.sql).toContain('DO UPDATE');
    expect(stmt.params).toEqual([uid, pack, 'notes', 'q1', '', JSON.stringify(note)]);
  });
});

describe('client and worker agree on identity', () => {
  it('userIdFromKey(bearer) === hashSyncKey(key) for any generated key', async () => {
    const key = generateSyncKey();
    expect(await userIdFromKey(key)).toBe(await hashSyncKey(key));
    // …even when the bearer arrives sloppily formatted
    expect(await userIdFromKey(key.toLowerCase().replace(/-/g, ' '))).toBe(
      await hashSyncKey(key),
    );
  });

  it('rejects keys with too little material to be safe', async () => {
    expect(await userIdFromKey('short')).toBeNull();
    expect(await userIdFromKey('')).toBeNull();
  });
});

describe('events table (server side)', () => {
  it('statementsForOp upserts events like any row table (not insert-ignore)', () => {
    const op = parseOp(
      toWireOp({ t: 'events', op: 'upsert', row: { id: 'e1', type: 'app_open', at: 1 } }),
    );
    expect(op).not.toBeNull();
    const [stmt] = statementsForOp(op as WireOp, 'user', 'pack');
    expect(stmt.sql).toContain('DO UPDATE');
    expect(stmt.params).toEqual([
      'user',
      'pack',
      'events',
      'e1',
      '',
      JSON.stringify({ id: 'e1', type: 'app_open', at: 1 }),
    ]);
  });
});

describe('backwards compatibility (pre-analytics clients)', () => {
  it('still accepts the original five-table batch with legacy row shapes', () => {
    // Exactly what an old client sends: no events table, no analytics
    // fields on sessions/attempts, timeTakenSeconds hard-coded to 1.
    const legacyOps = [
      {
        t: 'sessions',
        op: 'upsert',
        id: 's1',
        data: {
          id: 's1',
          subject: 'c',
          startedAt: 1,
          endedAt: null,
          questionCount: 10,
          correctCount: 0,
        },
      },
      {
        t: 'attempts',
        op: 'upsert',
        id: 'a1',
        ref: 's1',
        data: {
          id: 'a1',
          sessionId: 's1',
          questionId: 'q1',
          answeredAt: 2,
          selectedAnswer: 'A',
          isCorrect: true,
          timeTakenSeconds: 1,
          subject: 'c',
          topic: 'q1',
          difficulty: 1,
        },
      },
    ];
    const parsed = parseOpsRequest({ pack: 'demo', ops: legacyOps });
    expect(parsed).not.toBeNull();
    expect(parsed!.ops).toHaveLength(2);
  });

  it('a new-shape attempt row passes the same validation untouched', () => {
    const parsed = parseOp({
      t: 'attempts',
      op: 'upsert',
      id: 'a2',
      ref: 's1',
      data: {
        ...attempt,
        position: 4,
        firstSelected: 'B',
        mode: 'review',
        feedbackSeconds: 3,
        appBuild: 'abc1234',
      },
    });
    expect(parsed).not.toBeNull();
  });
});
