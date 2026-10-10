import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_STORED_EVENTS,
  loadAchievements,
  loadAttempts,
  loadEvents,
  loadNotes,
  loadSessions,
  loadVotes,
  mergeRemote,
  onMutation,
  saveAchievements,
  saveEvents,
  saveNotes,
  saveVotes,
  ATTEMPTS_KEY,
  SESSIONS_KEY,
} from '@/lib/storage';
import type { AppEvent, Attempt, Session } from '@/data/types';

// Pins the per-table merge rules of storage.mergeRemote — the one place
// that decides which copy of a row survives a cloud pull or a file import.
// Each table has its own tie-break and they are deliberately different;
// a refactor must keep every one of them.

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    subject: 'cat-a',
    startedAt: 1000,
    endedAt: 2000,
    questionCount: 5,
    correctCount: 3,
    ...over,
  };
}

function attempt(id: string, over: Partial<Attempt> = {}): Attempt {
  return {
    id,
    sessionId: 's1',
    questionId: 'q1',
    answeredAt: 1500,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 4,
    subject: 'cat-a',
    topic: 'q1',
    difficulty: 2,
    ...over,
  };
}

function event(id: string, at: number): AppEvent {
  return { id, type: 'app_open', at };
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeLocalStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mergeRemote — sessions', () => {
  it('keeps the row that progressed furthest; the local copy wins a tie', () => {
    window.localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify([
        session('tie', { correctCount: 1 }),
        session('local-newer', { endedAt: 5000, correctCount: 1 }),
        session('remote-newer', { endedAt: 1500, correctCount: 1 }),
      ]),
    );
    const changed = mergeRemote({
      sessions: [
        session('tie', { correctCount: 9 }),
        session('local-newer', { endedAt: 3000, correctCount: 9 }),
        session('remote-newer', { endedAt: 4000, correctCount: 9 }),
        session('remote-only'),
      ],
    });
    expect(changed).toBe(true);
    const byId = new Map(loadSessions().map((s) => [s.id, s]));
    expect(byId.get('tie')?.correctCount).toBe(1);
    expect(byId.get('local-newer')?.correctCount).toBe(1);
    expect(byId.get('remote-newer')?.correctCount).toBe(9);
    expect(byId.has('remote-only')).toBe(true);
    expect(byId.size).toBe(4);
  });

  it('scores an open session by startedAt (endedAt null)', () => {
    window.localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify([session('s', { startedAt: 1000, endedAt: null, correctCount: 0 })]),
    );
    mergeRemote({ sessions: [session('s', { startedAt: 1000, endedAt: 1200, correctCount: 2 })] });
    expect(loadSessions()[0].correctCount).toBe(2);
  });
});

describe('mergeRemote — attempts and events are insert-if-absent', () => {
  it('never replaces an existing attempt, whatever the remote copy says', () => {
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([attempt('a1', { isCorrect: true })]));
    const changed = mergeRemote({
      attempts: [attempt('a1', { isCorrect: false, answeredAt: 99999 }), attempt('a2')],
    });
    expect(changed).toBe(true);
    const byId = new Map(loadAttempts().map((a) => [a.id, a]));
    expect(byId.get('a1')?.isCorrect).toBe(true);
    expect(byId.has('a2')).toBe(true);
  });

  it('reports no change when every attempt is already present', () => {
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([attempt('a1')]));
    expect(mergeRemote({ attempts: [attempt('a1')] })).toBe(false);
  });

  it('keeps events chronological so the local cap drops the oldest', () => {
    saveEvents([event('e-mid', 500)]);
    mergeRemote({ events: [event('e-new', 900), event('e-old', 100), event('e-mid', 1)] });
    expect(loadEvents().map((e) => e.id)).toEqual(['e-old', 'e-mid', 'e-new']);
    expect(loadEvents().find((e) => e.id === 'e-mid')?.at).toBe(500);
  });

  it('applies the local event cap after a merge', () => {
    const remote = Array.from({ length: MAX_STORED_EVENTS + 5 }, (_, i) => event(`e${i}`, i));
    mergeRemote({ events: remote });
    const kept = loadEvents();
    expect(kept).toHaveLength(MAX_STORED_EVENTS);
    expect(kept[0].id).toBe('e5'); // the five oldest fell off
  });
});

describe('mergeRemote — achievements keep the earliest unlock', () => {
  it('replaces only when the remote earnedAt is strictly earlier', () => {
    saveAchievements([
      { id: 'tie', earnedAt: 100 },
      { id: 'local-earlier', earnedAt: 100 },
      { id: 'remote-earlier', earnedAt: 100 },
    ]);
    const changed = mergeRemote({
      achievements: [
        { id: 'tie', earnedAt: 100 },
        { id: 'local-earlier', earnedAt: 200 },
        { id: 'remote-earlier', earnedAt: 50 },
      ],
    });
    expect(changed).toBe(true);
    const byId = new Map(loadAchievements().map((a) => [a.id, a.earnedAt]));
    expect(byId.get('tie')).toBe(100);
    expect(byId.get('local-earlier')).toBe(100);
    expect(byId.get('remote-earlier')).toBe(50);
  });

  it('reports no change when nothing is earlier or new', () => {
    saveAchievements([{ id: 'x', earnedAt: 100 }]);
    expect(mergeRemote({ achievements: [{ id: 'x', earnedAt: 100 }] })).toBe(false);
  });
});

describe('mergeRemote — votes and notes are last-write-wins, remote wins a tie', () => {
  it('votes: remote replaces on >= votedAt, and a tie still counts as a change', () => {
    saveVotes([
      { questionId: 'tie', vote: 'up', votedAt: 100 },
      { questionId: 'local-newer', vote: 'up', votedAt: 300 },
    ]);
    const changed = mergeRemote({
      votes: [
        { questionId: 'tie', vote: 'down', votedAt: 100 },
        { questionId: 'local-newer', vote: 'down', votedAt: 200 },
      ],
    });
    // The tie-break reports "changed" even for an identical timestamp —
    // transfer.applySnapshot compensates by diffing content. Pinned so a
    // refactor that silently "fixes" this is noticed.
    expect(changed).toBe(true);
    const byQ = new Map(loadVotes().map((v) => [v.questionId, v.vote]));
    expect(byQ.get('tie')).toBe('down');
    expect(byQ.get('local-newer')).toBe('up');
  });

  it('notes: same rule on updatedAt', () => {
    saveNotes([
      { questionId: 'tie', text: 'local', updatedAt: 100 },
      { questionId: 'local-newer', text: 'local', updatedAt: 300 },
    ]);
    expect(
      mergeRemote({
        notes: [
          { questionId: 'tie', text: 'remote', updatedAt: 100 },
          { questionId: 'local-newer', text: 'remote', updatedAt: 200 },
        ],
      }),
    ).toBe(true);
    const byQ = new Map(loadNotes().map((n) => [n.questionId, n.text]));
    expect(byQ.get('tie')).toBe('remote');
    expect(byQ.get('local-newer')).toBe('local');
  });

  it('a strictly older remote vote changes nothing', () => {
    saveVotes([{ questionId: 'q', vote: 'up', votedAt: 300 }]);
    expect(mergeRemote({ votes: [{ questionId: 'q', vote: 'down', votedAt: 200 }] })).toBe(false);
    expect(loadVotes()[0].vote).toBe('up');
  });
});

describe('mergeRemote — contract', () => {
  it('returns false for an empty pull and writes nothing', () => {
    expect(mergeRemote({})).toBe(false);
    expect(mergeRemote({ sessions: [], attempts: [], votes: [] })).toBe(false);
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBeNull();
  });

  it('never emits mutations (merged rows must not feed the sync queue)', () => {
    const seen: unknown[] = [];
    const off = onMutation((m) => seen.push(m));
    mergeRemote({
      sessions: [session('s1')],
      attempts: [attempt('a1')],
      achievements: [{ id: 'st', earnedAt: 1 }],
      votes: [{ questionId: 'q', vote: 'up', votedAt: 1 }],
      notes: [{ questionId: 'q', text: 't', updatedAt: 1 }],
      events: [event('e', 1)],
    });
    off();
    expect(seen).toEqual([]);
  });

  it('is a no-op outside the browser', () => {
    vi.stubGlobal('window', undefined);
    expect(mergeRemote({ sessions: [session('s1')] })).toBe(false);
  });
});
