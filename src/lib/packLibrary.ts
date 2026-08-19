/**
 * The pack library — insert, eject, and swap learning packs at runtime,
 * so one installed app can play many packs (one active at a time).
 *
 * Inserted packs live wholesale in localStorage (`insertedPackKey(id)`)
 * with a small metadata index (`LIBRARY_INDEX_KEY`) so listing doesn't
 * parse every question bank. Activation writes only a POINTER
 * (`ACTIVE_PACK_ID_KEY`); the inline bootstrap in layout.tsx and
 * `src/pack/runtime.ts` resolve it to the stored pack before the engine
 * bundle evaluates, and a reload rebinds the whole app to it.
 *
 * Progress is untouched by all of this: every store is already namespaced
 * `quizmill.<packId>.*`, so each pack's sessions/attempts/stickers wait
 * under its own keys while another pack is active, and ejecting a pack
 * deliberately KEEPS them — re-insert the pack and the progress is back.
 *
 * Every mutation dispatches `PACK_LIBRARY_EVENT` on window so mounted UI
 * can re-read.
 */
import { validatePack } from '../../tools/pack/schema';
import type { ActivePack } from '@/pack/runtime';
import {
  ACTIVE_PACK_ID_KEY,
  HANDOFF_PACK_KEY,
  LIBRARY_INDEX_KEY,
  insertedPackKey,
} from './packKeys';

export const PACK_LIBRARY_EVENT = 'quizmill:packlibrary';

/** Listing metadata for one inserted pack — everything the shelf UI needs
 *  without parsing the full question bank. */
export interface PackLibraryEntry {
  id: string;
  title: string;
  description: string;
  themeColor: string;
  questionCount: number;
  categoryCount: number;
  /** Unix ms of the (latest) insert. */
  insertedAt: number;
  /** Where the pack came from — a URL or file name, purely informational. */
  origin?: string;
}

export type InsertResult =
  | { ok: true; entry: PackLibraryEntry }
  | { ok: false; errors: string[] };

function browser(): boolean {
  return typeof window !== 'undefined';
}

function emit(): void {
  window.dispatchEvent(new Event(PACK_LIBRARY_EVENT));
}

function readIndex(): PackLibraryEntry[] {
  try {
    const raw = window.localStorage.getItem(LIBRARY_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PackLibraryEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as PackLibraryEntry).id === 'string' &&
        typeof (e as PackLibraryEntry).title === 'string',
    );
  } catch {
    return [];
  }
}

function writeIndex(entries: PackLibraryEntry[]): void {
  window.localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify(entries));
}

/** All inserted packs, newest first. */
export function listInsertedPacks(): PackLibraryEntry[] {
  if (!browser()) return [];
  return readIndex().sort((a, b) => b.insertedAt - a.insertedAt);
}

/** The full content of one inserted pack, or null when absent/corrupt. */
export function getInsertedPack(id: string): ActivePack | null {
  if (!browser()) return null;
  try {
    const raw = window.localStorage.getItem(insertedPackKey(id));
    if (!raw) return null;
    const pack = JSON.parse(raw) as ActivePack;
    return pack && typeof pack === 'object' && pack.manifest ? pack : null;
  } catch {
    return null;
  }
}

/** The inserted-pack id the app is pointed at, or null (build-time pack). */
export function getActivePackPointer(): string | null {
  if (!browser()) return null;
  try {
    return window.localStorage.getItem(ACTIVE_PACK_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * Validate and store a pack in the library. `raw` is the ActivePack shape
 * (`{ manifest, questions, scenarios?, concepts? }`) parsed from user
 * input — full schema + cross-file validation runs before anything is
 * stored. Re-inserting an existing id replaces its content (pack update);
 * progress is unaffected either way. `buildPackId` (the pack compiled into
 * this deployment) is refused — that one is built in, not inserted.
 */
export function insertPack(
  raw: unknown,
  opts: { origin?: string; buildPackId: string },
): InsertResult {
  if (!browser()) return { ok: false, errors: ['not in a browser'] };
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['not a pack: expected a JSON object with "manifest" and "questions"'] };
  }
  const candidate = raw as Partial<ActivePack>;
  if (!candidate.manifest || !candidate.questions) {
    return { ok: false, errors: ['not a pack: expected a JSON object with "manifest" and "questions"'] };
  }
  const result = validatePack({
    manifest: candidate.manifest,
    questions: candidate.questions,
    scenarios: candidate.scenarios,
    concepts: candidate.concepts,
  });
  if (!result.ok) return { ok: false, errors: result.errors };

  const manifest = candidate.manifest as ActivePack['manifest'];
  if (manifest.id === opts.buildPackId) {
    return {
      ok: false,
      errors: [`"${manifest.id}" is the pack built into this app — it's always on the shelf.`],
    };
  }

  const pack: ActivePack = {
    manifest,
    questions: candidate.questions as ActivePack['questions'],
    scenarios: candidate.scenarios as ActivePack['scenarios'],
    concepts: candidate.concepts as ActivePack['concepts'],
  };
  const entry: PackLibraryEntry = {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    themeColor: manifest.themeColor,
    questionCount: pack.questions.length,
    categoryCount: manifest.categories.length,
    insertedAt: Date.now(),
    origin: opts.origin,
  };
  try {
    window.localStorage.setItem(insertedPackKey(entry.id), JSON.stringify(pack));
    writeIndex([...readIndex().filter((e) => e.id !== entry.id), entry]);
  } catch {
    // Almost certainly QuotaExceededError — the pack didn't fit.
    return {
      ok: false,
      errors: ['not enough storage space on this device — eject a pack you no longer use and try again'],
    };
  }
  emit();
  return { ok: true, entry };
}

/**
 * Remove a pack from the library. Progress (sessions, attempts, stickers,
 * notes — everything under `quizmill.<id>.*`) is deliberately kept, so
 * re-inserting the pack later picks up exactly where the learner left off.
 * Ejecting the ACTIVE pack clears the pointer — the app falls back to the
 * build-time pack on next load. Returns whether a reload is needed.
 */
export function ejectPack(id: string): { wasActive: boolean } {
  if (!browser()) return { wasActive: false };
  const wasActive = getActivePackPointer() === id;
  window.localStorage.removeItem(insertedPackKey(id));
  writeIndex(readIndex().filter((e) => e.id !== id));
  if (wasActive) window.localStorage.removeItem(ACTIVE_PACK_ID_KEY);
  emit();
  return { wasActive };
}

/**
 * Point the app at an inserted pack (or back at the build-time pack with
 * `null`). Only writes the pointer — the caller reloads the page so every
 * module rebinds to the new pack. Clears any external handoff blob
 * (`HANDOFF_PACK_KEY`), which would otherwise outrank the pointer.
 */
export function activatePack(id: string | null): boolean {
  if (!browser()) return false;
  if (id !== null && getInsertedPack(id) === null) return false;
  if (id === null) window.localStorage.removeItem(ACTIVE_PACK_ID_KEY);
  else window.localStorage.setItem(ACTIVE_PACK_ID_KEY, id);
  window.localStorage.removeItem(HANDOFF_PACK_KEY);
  emit();
  return true;
}

/** Saved-progress summary for any pack id, active or not — read straight
 *  from that pack's namespaced stores. */
export function packProgress(id: string): {
  sessions: number;
  attempts: number;
  lastPractisedAt: number | null;
} {
  const empty = { sessions: 0, attempts: 0, lastPractisedAt: null };
  if (!browser()) return empty;
  try {
    const sessions: { startedAt?: number }[] =
      JSON.parse(window.localStorage.getItem(`quizmill.${id}.sessions.v1`) ?? '[]');
    const attempts: unknown[] =
      JSON.parse(window.localStorage.getItem(`quizmill.${id}.attempts.v1`) ?? '[]');
    if (!Array.isArray(sessions) || !Array.isArray(attempts)) return empty;
    const lastPractisedAt = sessions.reduce<number | null>(
      (max, s) =>
        typeof s?.startedAt === 'number' && (max === null || s.startedAt > max)
          ? s.startedAt
          : max,
      null,
    );
    return { sessions: sessions.length, attempts: attempts.length, lastPractisedAt };
  } catch {
    return empty;
  }
}
