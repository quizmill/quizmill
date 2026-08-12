/**
 * File export/import — serverless progress transfer.
 *
 * The zero-infrastructure sibling of the sync backends: the same
 * RemoteData contract they mirror to a server, serialised to a JSON file
 * instead. Export downloads everything the active pack has stored
 * locally; import merges a file through the exact same last-write-wins
 * logic a cloud pull uses (`storage.mergeRemote`), so importing is always
 * additive and idempotent — existing progress is never lost, duplicates
 * collapse.
 *
 * Use cases: moving to a new device without any backend configured,
 * offline backups, or archiving a season of practice before a reset.
 *
 * Pure parsing/validation so the rules are unit-testable
 * (tests/transfer.test.tsx).
 */
import { APP_CONFIG } from '@/config';
import type { Attempt, Session } from '@/data/types';
import * as storage from './storage';
import type { EarnedAchievement, QuestionVote } from './storage';
import type { RemoteData } from './syncBackend';

export const TRANSFER_FORMAT = 'quizmill-progress';
export const TRANSFER_VERSION = 1;

export interface TransferPayload {
  format: typeof TRANSFER_FORMAT;
  version: number;
  packId: string;
  exportedAt: number; // unix ms
  data: RemoteData;
}

// ── Export ──────────────────────────────────────────────────────────────

/** Snapshot everything the active pack has stored locally. */
export function buildExportPayload(now: number = Date.now()): TransferPayload {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    packId: APP_CONFIG.packId,
    exportedAt: now,
    data: {
      sessions: storage.loadSessions(),
      attempts: storage.loadAttempts(),
      achievements: storage.loadAchievements(),
      votes: storage.loadVotes(),
    },
  };
}

/** e.g. `quizmill-solar-system-demo-2026-08-12.json` */
export function exportFileName(packId: string, now: number = Date.now()): string {
  const d = new Date(now);
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  return `quizmill-${packId}-${stamp}.json`;
}

// ── Import ──────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; payload: TransferPayload }
  | { ok: false; error: string };

function isSession(r: unknown): r is Session {
  const s = r as Session;
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    typeof s.subject === 'string' &&
    typeof s.startedAt === 'number' &&
    typeof s.questionCount === 'number' &&
    typeof s.correctCount === 'number'
  );
}

function isAttempt(r: unknown): r is Attempt {
  const a = r as Attempt;
  return (
    !!a &&
    typeof a === 'object' &&
    typeof a.id === 'string' &&
    typeof a.sessionId === 'string' &&
    typeof a.questionId === 'string' &&
    typeof a.answeredAt === 'number' &&
    typeof a.isCorrect === 'boolean'
  );
}

function isAchievement(r: unknown): r is EarnedAchievement {
  const a = r as EarnedAchievement;
  return (
    !!a && typeof a === 'object' && typeof a.id === 'string' && typeof a.earnedAt === 'number'
  );
}

function isVote(r: unknown): r is QuestionVote {
  const v = r as QuestionVote;
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.questionId === 'string' &&
    (v.vote === 'up' || v.vote === 'down') &&
    typeof v.votedAt === 'number'
  );
}

function pick<T>(raw: unknown, guard: (r: unknown) => r is T): T[] {
  // Individually malformed rows are dropped rather than failing the whole
  // file — a hand-edited or truncated backup should still restore what it can.
  return Array.isArray(raw) ? raw.filter(guard) : [];
}

/**
 * Parse + validate an exported file against the pack this app is running.
 * A file from a different pack is refused outright: question/session ids
 * are pack-scoped, so cross-pack merging would corrupt stats.
 */
export function parseTransferPayload(text: string, expectedPackId: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not a valid quizmill export file (unreadable JSON).' };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Not a valid quizmill export file.' };
  }
  const p = raw as Record<string, unknown>;
  if (p.format !== TRANSFER_FORMAT) {
    return { ok: false, error: 'Not a valid quizmill export file.' };
  }
  if (typeof p.version !== 'number' || p.version > TRANSFER_VERSION) {
    return {
      ok: false,
      error: 'This file was exported by a newer version of the app — update this app first.',
    };
  }
  if (typeof p.packId !== 'string' || !p.packId) {
    return { ok: false, error: 'Not a valid quizmill export file (missing pack).' };
  }
  if (p.packId !== expectedPackId) {
    return {
      ok: false,
      error: `This file is for a different pack ("${p.packId}") — open it in that pack's app instead.`,
    };
  }
  const d = (p.data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    payload: {
      format: TRANSFER_FORMAT,
      version: p.version,
      packId: p.packId,
      exportedAt: typeof p.exportedAt === 'number' ? p.exportedAt : 0,
      data: {
        sessions: pick(d.sessions, isSession),
        attempts: pick(d.attempts, isAttempt),
        achievements: pick(d.achievements, isAchievement),
        votes: pick(d.votes, isVote),
      },
    },
  };
}

/**
 * Merge a parsed payload into local storage (last-write-wins, additive)
 * and wake the UI. Returns true when anything actually changed.
 */
export function applyTransferPayload(payload: TransferPayload): boolean {
  const changed = storage.mergeRemote(payload.data);
  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('quizmill:storage'));
  }
  return changed;
}
