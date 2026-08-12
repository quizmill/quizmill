import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySnapshot,
  buildSnapshot,
  parseSnapshot,
  snapshotFilename,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  TransferError,
} from '@/lib/transfer';
import {
  ATTEMPTS_KEY,
  SESSIONS_KEY,
  loadAchievements,
  loadAttempts,
  loadSessions,
  loadVotes,
  saveAchievements,
  saveVotes,
} from '@/lib/storage';
import { APP_CONFIG } from '@/config';
import type { Attempt, Session } from '@/data/types';

// Minimal localStorage so the storage module (node test env) has a window.
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

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeLocalStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function validSnapshotJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    packId: APP_CONFIG.packId,
    exportedAt: 123,
    sessions: [session('s1')],
    attempts: [attempt('a1')],
    achievements: [{ id: 'st1', earnedAt: 1600 }],
    votes: [{ questionId: 'q1', vote: 'up', votedAt: 1700 }],
    ...over,
  });
}

describe('buildSnapshot / snapshotFilename', () => {
  it('captures all four tables with format + pack stamps', () => {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify([session('s1')]));
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([attempt('a1')]));
    saveAchievements([{ id: 'st1', earnedAt: 1600 }]);
    saveVotes([{ questionId: 'q1', vote: 'down', comment: 'meh', votedAt: 1700 }]);

    const snap = buildSnapshot(999);
    expect(snap.format).toBe(SNAPSHOT_FORMAT);
    expect(snap.version).toBe(SNAPSHOT_VERSION);
    expect(snap.packId).toBe(APP_CONFIG.packId);
    expect(snap.exportedAt).toBe(999);
    expect(snap.sessions).toHaveLength(1);
    expect(snap.attempts).toHaveLength(1);
    expect(snap.achievements).toHaveLength(1);
    expect(snap.votes[0].comment).toBe('meh');
  });

  it('a fresh export round-trips through parseSnapshot', () => {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify([session('s1')]));
    const snap = buildSnapshot(999);
    const parsed = parseSnapshot(JSON.stringify(snap));
    expect(parsed.sessions).toEqual(snap.sessions);
    expect(parsed.exportedAt).toBe(999);
  });

  it('names the file with pack id and zero-padded local date', () => {
    const name = snapshotFilename('solar-system', new Date(2026, 0, 5).getTime());
    expect(name).toBe('quizmill-progress-solar-system-2026-01-05.json');
  });
});

describe('parseSnapshot validation', () => {
  it('rejects non-JSON', () => {
    expect(() => parseSnapshot('not json {')).toThrowError(TransferError);
    try {
      parseSnapshot('not json {');
    } catch (e) {
      expect((e as TransferError).code).toBe('not-json');
    }
  });

  it('rejects JSON that is not a quizmill snapshot', () => {
    for (const bad of ['[]', '"hi"', '{}', JSON.stringify({ format: 'other' })]) {
      try {
        parseSnapshot(bad);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as TransferError).code).toBe('wrong-format');
      }
    }
  });

  it('rejects files from a newer format version', () => {
    try {
      parseSnapshot(validSnapshotJson({ version: SNAPSHOT_VERSION + 1 }));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as TransferError).code).toBe('newer-version');
    }
  });

  it("rejects another pack's snapshot, naming that pack", () => {
    try {
      parseSnapshot(
        validSnapshotJson({ packId: 'other-pack', packTitle: 'Other Pack' }),
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as TransferError).code).toBe('wrong-pack');
      expect((e as TransferError).message).toContain('Other Pack');
    }
  });

  it('drops malformed rows but keeps valid ones', () => {
    const parsed = parseSnapshot(
      validSnapshotJson({
        sessions: [session('s1'), { id: 42 }, 'junk', null],
        attempts: [attempt('a1'), { id: 'a2' }], // a2 missing sessionId etc.
        achievements: [{ id: 'st1', earnedAt: 1 }, { id: 'st2' }],
        votes: [
          { questionId: 'q1', vote: 'up', votedAt: 1 },
          { questionId: 'q2', vote: 'sideways', votedAt: 1 },
        ],
      }),
    );
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.attempts).toHaveLength(1);
    expect(parsed.achievements).toHaveLength(1);
    expect(parsed.votes).toHaveLength(1);
  });

  it('tolerates missing tables (treated as empty)', () => {
    const parsed = parseSnapshot(
      JSON.stringify({
        format: SNAPSHOT_FORMAT,
        version: 1,
        packId: APP_CONFIG.packId,
      }),
    );
    expect(parsed.sessions).toEqual([]);
    expect(parsed.attempts).toEqual([]);
    expect(parsed.achievements).toEqual([]);
    expect(parsed.votes).toEqual([]);
  });
});

describe('applySnapshot', () => {
  it('imports into an empty device and reports added counts', () => {
    const result = applySnapshot(parseSnapshot(validSnapshotJson()));
    expect(result.changed).toBe(true);
    expect(result.added).toEqual({
      sessions: 1,
      attempts: 1,
      achievements: 1,
      votes: 1,
    });
    expect(loadSessions()).toHaveLength(1);
    expect(loadAttempts()).toHaveLength(1);
    expect(loadAchievements()).toHaveLength(1);
    expect(loadVotes()).toHaveLength(1);
  });

  it('is idempotent — importing the same file twice adds nothing', () => {
    applySnapshot(parseSnapshot(validSnapshotJson()));
    const second = applySnapshot(parseSnapshot(validSnapshotJson()));
    expect(second.changed).toBe(false);
    expect(second.added).toEqual({
      sessions: 0,
      attempts: 0,
      achievements: 0,
      votes: 0,
    });
    expect(loadAttempts()).toHaveLength(1);
  });

  it('merges with existing local progress without losing newer local rows', () => {
    // Local: session s1 ended later than the snapshot's copy, plus its own s2.
    window.localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify([session('s1', { endedAt: 9999, correctCount: 5 }), session('s2')]),
    );
    const result = applySnapshot(parseSnapshot(validSnapshotJson()));
    expect(result.changed).toBe(true);
    const s1 = loadSessions().find((s) => s.id === 's1');
    expect(s1?.endedAt).toBe(9999); // local, further-progressed row wins
    expect(loadSessions()).toHaveLength(2);
    expect(result.added.sessions).toBe(0); // both already existed locally
    expect(result.added.attempts).toBe(1);
  });
});
