// .tsx so this runs on happy-dom (vitest environmentMatchGlobs) — the
// export/import round-trip exercises real localStorage via storage.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../src/config';
import * as storage from '../src/lib/storage';
import {
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  applyTransferPayload,
  buildExportPayload,
  exportFileName,
  parseTransferPayload,
} from '../src/lib/transfer';
import type { Session, Attempt } from '../src/data/types';

const PACK = APP_CONFIG.packId;

const session: Session = {
  id: 'sess-1',
  subject: 'planets',
  startedAt: 1_000,
  endedAt: 2_000,
  questionCount: 2,
  correctCount: 1,
  mode: 'practice',
};

const attempt: Attempt = {
  id: 'att-1',
  sessionId: 'sess-1',
  questionId: 'q-1',
  answeredAt: 1_500,
  selectedAnswer: 'A',
  isCorrect: true,
  timeTakenSeconds: 4,
  subject: 'planets',
  topic: 'q-1',
  difficulty: 1,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('export → parse round trip', () => {
  it('captures everything local and parses back losslessly', () => {
    storage.saveSession(session);
    storage.saveAttempt(attempt);
    storage.recordEarnedAchievements(['first-steps'], 3_000);
    storage.recordVote('q-1', 'down', 'ambiguous wording', 4_000);

    const payload = buildExportPayload(5_000);
    expect(payload.format).toBe(TRANSFER_FORMAT);
    expect(payload.version).toBe(TRANSFER_VERSION);
    expect(payload.packId).toBe(PACK);

    const parsed = parseTransferPayload(JSON.stringify(payload), PACK);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.data.sessions).toEqual([session]);
    expect(parsed.payload.data.attempts).toEqual([attempt]);
    expect(parsed.payload.data.achievements).toEqual([
      { id: 'first-steps', earnedAt: 3_000 },
    ]);
    expect(parsed.payload.data.votes).toEqual([
      { questionId: 'q-1', vote: 'down', comment: 'ambiguous wording', votedAt: 4_000 },
    ]);
  });

  it('names the file after the pack and date', () => {
    expect(exportFileName('solar-system-demo', Date.UTC(2026, 7, 12, 12))).toMatch(
      /^quizmill-solar-system-demo-2026-08-12\.json$/,
    );
  });
});

describe('parseTransferPayload validation', () => {
  it('rejects junk, wrong formats, and newer versions', () => {
    expect(parseTransferPayload('not json', PACK).ok).toBe(false);
    expect(parseTransferPayload('42', PACK).ok).toBe(false);
    expect(parseTransferPayload(JSON.stringify({ format: 'other' }), PACK).ok).toBe(false);
    const future = { ...buildExportPayload(), version: TRANSFER_VERSION + 1 };
    const res = parseTransferPayload(JSON.stringify(future), PACK);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/newer version/);
  });

  it("refuses another pack's file — ids are pack-scoped", () => {
    const other = { ...buildExportPayload(), packId: 'someone-elses-pack' };
    const res = parseTransferPayload(JSON.stringify(other), PACK);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('someone-elses-pack');
  });

  it('drops malformed rows instead of failing the whole file', () => {
    const payload = {
      format: TRANSFER_FORMAT,
      version: 1,
      packId: PACK,
      exportedAt: 1,
      data: {
        sessions: [session, { id: 42 }, null],
        attempts: 'nope',
        achievements: [{ id: 'ok', earnedAt: 1 }, { id: 'missing-time' }],
        votes: [{ questionId: 'q', vote: 'sideways', votedAt: 1 }],
      },
    };
    const res = parseTransferPayload(JSON.stringify(payload), PACK);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.data.sessions).toEqual([session]);
    expect(res.payload.data.attempts).toEqual([]);
    expect(res.payload.data.achievements).toEqual([{ id: 'ok', earnedAt: 1 }]);
    expect(res.payload.data.votes).toEqual([]);
  });
});

describe('applyTransferPayload', () => {
  it('merges additively and reports whether anything changed', () => {
    storage.saveSession(session);
    const incoming: import('../src/lib/transfer').TransferPayload = {
      format: TRANSFER_FORMAT,
      version: 1,
      packId: PACK,
      exportedAt: 1,
      data: {
        sessions: [session], // duplicate — no-op
        attempts: [attempt], // new
        achievements: [],
        votes: [],
      },
    };
    expect(applyTransferPayload(incoming)).toBe(true);
    expect(storage.loadAttempts()).toEqual([attempt]);
    expect(storage.loadSessions()).toEqual([session]);
    // Importing the exact same file again changes nothing.
    expect(applyTransferPayload(incoming)).toBe(false);
  });
});
