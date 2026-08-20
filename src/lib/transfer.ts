/**
 * Progress export/import — move local progress between devices as a file.
 *
 * A snapshot is a single JSON file carrying the five synced tables
 * (sessions, attempts, achievements, votes, notes) for ONE pack, stamped with a
 * format marker + version so future builds can keep reading old files.
 * Import merges via storage.mergeRemote — the same last-write-wins rules
 * as a cloud pull — so importing is idempotent and never loses newer
 * local rows. Like a cloud pull, an import does not feed the sync queue.
 *
 * Prefs and the scratchpad are deliberately excluded: they're device-local
 * by design (see storage.ts) and carry no progress.
 */
import type { AppEvent, Attempt, Session } from '@/data/types';
import { APP_CONFIG } from '@/config';
import {
  loadAchievements,
  loadAttempts,
  loadEvents,
  loadNotes,
  loadSessions,
  loadVotes,
  mergeRemote,
  type EarnedAchievement,
  type QuestionNote,
  type QuestionVote,
} from './storage';

export const SNAPSHOT_FORMAT = 'quizmill-progress';
export const SNAPSHOT_VERSION = 1;

export interface ProgressSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  packId: string;
  packTitle?: string;
  exportedAt: number; // unix ms
  sessions: Session[];
  attempts: Attempt[];
  achievements: EarnedAchievement[];
  votes: QuestionVote[];
  /** Added post-v1; absent in older files, so always optional on read. */
  notes?: QuestionNote[];
  /** Added post-v1; absent in older files, so always optional on read. */
  events?: AppEvent[];
}

export type TransferErrorCode =
  | 'not-json'
  | 'wrong-format'
  | 'newer-version'
  | 'wrong-pack';

/** Import failure the UI can show verbatim — `message` is user-facing. */
export class TransferError extends Error {
  readonly code: TransferErrorCode;

  constructor(code: TransferErrorCode, message: string) {
    super(message);
    this.name = 'TransferError';
    this.code = code;
  }
}

// ---- row guards ----
//
// Light structural checks so a hand-edited or truncated file can't plant
// junk rows in storage. Extra fields pass through untouched (forward
// compatibility with richer rows from newer builds).

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSession(v: unknown): v is Session {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.subject === 'string' &&
    typeof v.startedAt === 'number'
  );
}

function isAttempt(v: unknown): v is Attempt {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.sessionId === 'string' &&
    typeof v.questionId === 'string' &&
    typeof v.answeredAt === 'number'
  );
}

function isAchievement(v: unknown): v is EarnedAchievement {
  return isRecord(v) && typeof v.id === 'string' && typeof v.earnedAt === 'number';
}

function isVote(v: unknown): v is QuestionVote {
  return (
    isRecord(v) &&
    typeof v.questionId === 'string' &&
    (v.vote === 'up' || v.vote === 'down') &&
    typeof v.votedAt === 'number'
  );
}

function isNote(v: unknown): v is QuestionNote {
  return (
    isRecord(v) &&
    typeof v.questionId === 'string' &&
    typeof v.text === 'string' &&
    typeof v.updatedAt === 'number'
  );
}

function isEvent(v: unknown): v is AppEvent {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.type === 'string' &&
    typeof v.at === 'number'
  );
}

function rows<T>(v: unknown, guard: (row: unknown) => row is T): T[] {
  return Array.isArray(v) ? v.filter(guard) : [];
}

// ---- export ----

/** Assemble a snapshot of everything stored for the active pack. */
export function buildSnapshot(now: number = Date.now()): ProgressSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    packId: APP_CONFIG.packId,
    packTitle: APP_CONFIG.title,
    exportedAt: now,
    sessions: loadSessions(),
    attempts: loadAttempts(),
    achievements: loadAchievements(),
    votes: loadVotes(),
    notes: loadNotes(),
    events: loadEvents(),
  };
}

/** `quizmill-progress-<packId>-YYYY-MM-DD.json` (local date). */
export function snapshotFilename(packId: string, exportedAt: number): string {
  const d = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `quizmill-progress-${packId}-${stamp}.json`;
}

/**
 * Save the snapshot out of the browser. On phones that support sharing
 * files (iOS/Android PWAs and browsers) this opens the native share sheet —
 * the easy path to AirDrop / Drive / Files / messaging. Everywhere else it
 * falls back to a plain file download.
 */
export async function exportProgressFile(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const snapshot = buildSnapshot();
  const json = JSON.stringify(snapshot, null, 2);
  const filename = snapshotFilename(snapshot.packId, snapshot.exportedAt);
  const file = new File([json], filename, { type: 'application/json' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      // Dismissing the share sheet is not an error — and not a download.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // Share failed for a real reason (some browsers lie in canShare);
      // fall through to the download path.
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

// ---- import ----

/**
 * Parse + validate exported JSON. Throws TransferError with a user-facing
 * message when the file isn't a quizmill snapshot, was made by a newer
 * format version, or belongs to a different pack (question ids are
 * pack-scoped, so cross-pack imports would only plant orphan rows).
 */
export function parseSnapshot(
  text: string,
  expectedPackId: string = APP_CONFIG.packId,
): ProgressSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TransferError('not-json', "That file isn't valid JSON.");
  }

  if (!isRecord(raw) || raw.format !== SNAPSHOT_FORMAT) {
    throw new TransferError(
      'wrong-format',
      "That file isn't a quizmill progress export.",
    );
  }
  if (typeof raw.version !== 'number' || raw.version > SNAPSHOT_VERSION) {
    throw new TransferError(
      'newer-version',
      'That file was exported by a newer version of the app — update this app first.',
    );
  }
  if (raw.packId !== expectedPackId) {
    const label =
      typeof raw.packTitle === 'string' && raw.packTitle
        ? raw.packTitle
        : String(raw.packId);
    throw new TransferError(
      'wrong-pack',
      `That file holds progress for a different pack (${label}) — open that pack's app to import it.`,
    );
  }

  return {
    format: SNAPSHOT_FORMAT,
    version: raw.version,
    packId: expectedPackId,
    packTitle: typeof raw.packTitle === 'string' ? raw.packTitle : undefined,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    sessions: rows(raw.sessions, isSession),
    attempts: rows(raw.attempts, isAttempt),
    achievements: rows(raw.achievements, isAchievement),
    votes: rows(raw.votes, isVote),
    notes: rows(raw.notes, isNote),
    events: rows(raw.events, isEvent),
  };
}

export interface ImportResult {
  changed: boolean;
  /** Net-new rows per table (updates to existing rows don't count). */
  added: {
    sessions: number;
    attempts: number;
    achievements: number;
    votes: number;
    notes: number;
  };
}

/** Merge a parsed snapshot into local storage (last-write-wins per row). */
export function applySnapshot(snapshot: ProgressSnapshot): ImportResult {
  // Compare actual content, not mergeRemote's flag: its vote tie-break
  // (votedAt >=) reports "changed" for identical rows, which would make a
  // repeat import claim it merged something.
  const tables = () => ({
    sessions: loadSessions(),
    attempts: loadAttempts(),
    achievements: loadAchievements(),
    votes: loadVotes(),
    notes: loadNotes(),
    events: loadEvents(),
  });
  const before = tables();

  mergeRemote({
    sessions: snapshot.sessions,
    attempts: snapshot.attempts,
    achievements: snapshot.achievements,
    votes: snapshot.votes,
    notes: snapshot.notes,
    events: snapshot.events,
  });

  const after = tables();
  return {
    changed: JSON.stringify(after) !== JSON.stringify(before),
    added: {
      sessions: after.sessions.length - before.sessions.length,
      attempts: after.attempts.length - before.attempts.length,
      achievements: after.achievements.length - before.achievements.length,
      votes: after.votes.length - before.votes.length,
      notes: after.notes.length - before.notes.length,
    },
  };
}
