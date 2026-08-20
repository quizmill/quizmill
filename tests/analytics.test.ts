/**
 * Analytics capture — app events, attempt amendment, and (crucially)
 * backwards compatibility: rows written by pre-analytics builds must keep
 * flowing through storage, merge, transfer, and the Supabase mapper
 * without loss or error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, Attempt, Session } from '@/data/types';
import {
  amendAttempt,
  clearAll,
  loadAttempts,
  loadEvents,
  MAX_STORED_EVENTS,
  mergeRemote,
  onMutation,
  recordEvent,
  saveAttempt,
  type Mutation,
} from '@/lib/storage';
import { applySnapshot, buildSnapshot, parseSnapshot } from '@/lib/transfer';
import { sessionToRow, supabaseBackend } from '@/lib/backends/supabaseBackend';
import { APP_CONFIG } from '@/config';

// Minimal localStorage so the storage module (node test env) has a window.
function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeLocalStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function attempt(id: string, extra: Partial<Attempt> = {}): Attempt {
  return {
    id,
    sessionId: 's1',
    questionId: 'q1',
    answeredAt: 1000,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'c',
    topic: 'q1',
    difficulty: 1,
    ...extra,
  };
}

describe('recordEvent / loadEvents', () => {
  it('stores the event and emits an events mutation', () => {
    const seen: Mutation[] = [];
    const off = onMutation((m) => seen.push(m));
    const e = recordEvent('game_open', { game: 'snake' }, 42);
    off();
    expect(e).not.toBeNull();
    expect(loadEvents()).toEqual([
      { id: e!.id, type: 'game_open', at: 42, data: { game: 'snake' } },
    ]);
    expect(seen).toEqual([{ table: 'events', row: e }]);
  });

  it('omits empty data and caps local storage at MAX_STORED_EVENTS', () => {
    const e = recordEvent('app_open', {}, 1);
    expect(e && 'data' in e).toBe(false);
    for (let i = 0; i < MAX_STORED_EVENTS + 10; i++) recordEvent('app_open', undefined, i + 2);
    const stored = loadEvents();
    expect(stored).toHaveLength(MAX_STORED_EVENTS);
    // The cap drops the OLDEST events, keeping the newest window.
    expect(stored[stored.length - 1].at).toBe(MAX_STORED_EVENTS + 11);
  });

  it('is wiped by clearAll', () => {
    recordEvent('app_open');
    clearAll();
    expect(loadEvents()).toEqual([]);
  });
});

describe('amendAttempt', () => {
  it('patches the row in place and re-emits it for sync', () => {
    saveAttempt(attempt('a1'));
    const seen: Mutation[] = [];
    const off = onMutation((m) => seen.push(m));
    amendAttempt('a1', { feedbackSeconds: 7 });
    off();
    expect(loadAttempts()[0].feedbackSeconds).toBe(7);
    expect(seen).toEqual([
      { table: 'attempts', row: expect.objectContaining({ id: 'a1', feedbackSeconds: 7 }) },
    ]);
  });

  it('is a silent no-op for an unknown id', () => {
    const seen: Mutation[] = [];
    const off = onMutation((m) => seen.push(m));
    amendAttempt('missing', { feedbackSeconds: 7 });
    off();
    expect(seen).toEqual([]);
    expect(loadAttempts()).toEqual([]);
  });
});

describe('mergeRemote events', () => {
  it('merges by id, ignores duplicates, keeps chronological order', () => {
    const a: AppEvent = { id: 'e1', type: 'app_open', at: 2 };
    const b: AppEvent = { id: 'e2', type: 'export', at: 1 };
    expect(mergeRemote({ events: [a] })).toBe(true);
    expect(mergeRemote({ events: [a, b] })).toBe(true);
    expect(loadEvents().map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(mergeRemote({ events: [a] })).toBe(false);
  });
});

describe('backwards compatibility', () => {
  // Rows exactly as a pre-analytics build wrote them: no position,
  // firstSelected, mode, appBuild, display, events — and timeTaken = 1.
  const legacySession: Session = {
    id: 'ls',
    subject: 'c',
    startedAt: 100,
    endedAt: 200,
    questionCount: 10,
    correctCount: 8,
  };
  const legacyAttempt = attempt('la', { timeTakenSeconds: 1 });

  it('legacy rows merge cleanly alongside new-shape rows', () => {
    const newAttempt = attempt('na', {
      position: 3,
      firstSelected: 'B',
      mode: 'review',
      feedbackSeconds: 4,
      appBuild: 'abc1234',
    });
    expect(mergeRemote({ sessions: [legacySession], attempts: [legacyAttempt, newAttempt] })).toBe(
      true,
    );
    const byId = new Map(loadAttempts().map((r) => [r.id, r]));
    expect(byId.get('la')).toEqual(legacyAttempt);
    expect(byId.get('na')?.firstSelected).toBe('B');
  });

  it('a legacy snapshot (no events key) still imports; a new one round-trips events', () => {
    recordEvent('progress_view', undefined, 5);
    const withEvents = JSON.parse(JSON.stringify(buildSnapshot(10)));
    expect(withEvents.events).toHaveLength(1);

    clearAll();
    const legacy = { ...withEvents };
    delete legacy.events;
    const parsed = parseSnapshot(JSON.stringify(legacy), APP_CONFIG.packId);
    expect(parsed.events).toEqual([]);
    applySnapshot(parsed);
    expect(loadEvents()).toEqual([]);

    clearAll();
    const applied = applySnapshot(parseSnapshot(JSON.stringify(withEvents), APP_CONFIG.packId));
    expect(applied.changed).toBe(true);
    expect(loadEvents().map((e) => e.type)).toEqual(['progress_view']);
  });
});

describe('supabase backend never fails on analytics data', () => {
  it("clamps the newer session modes to the schema's pair and drops new fields", () => {
    const row = sessionToRow(
      {
        id: 's',
        subject: 'drive',
        startedAt: 0,
        endedAt: null,
        questionCount: 5,
        correctCount: 0,
        mode: 'drive',
        appBuild: 'abc1234',
        display: 'standalone',
        platform: 'touch',
      },
      'u1',
    );
    expect(row.mode).toBe('practice');
    expect('app_build' in row || 'appBuild' in row).toBe(false);
    expect(sessionToRow({ ...legacyish(), mode: 'review' }, 'u1').mode).toBe('review');
  });

  it('swallows events ops entirely — even with no client configured', async () => {
    await expect(
      supabaseBackend.runOp(
        { t: 'events', op: 'upsert', row: { id: 'e', type: 'app_open', at: 1 } },
        'u1',
      ),
    ).resolves.toBeUndefined();
  });
});

function legacyish(): Session {
  return {
    id: 's',
    subject: 'c',
    startedAt: 0,
    endedAt: null,
    questionCount: 5,
    correctCount: 0,
  };
}
