/**
 * The pack library — insert, eject, and swap learning packs at runtime,
 * so one installed app can play many packs (one active at a time).
 *
 * Inserted packs live in IndexedDB (src/lib/packStore.ts) with a small
 * metadata index in localStorage (`LIBRARY_INDEX_KEY`) so listing stays
 * synchronous and doesn't parse every question bank. Activation writes a
 * POINTER (`ACTIVE_PACK_ID_KEY`) and mirrors that one pack into
 * localStorage (`insertedPackKey(id)`): the inline bootstrap in layout.tsx
 * and `src/pack/runtime.ts` resolve the pointer to the mirror synchronously
 * before the engine bundle evaluates, and a reload rebinds the whole app
 * to it. Only the active pack is mirrored — localStorage is ~5 MB per
 * origin, shared with all progress, and two or three packs filled it.
 * Without IndexedDB (some private modes) packs fall back to living in
 * localStorage, as they all did before; `migrateInsertedPacks` moves
 * those over once it is there.
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
import { dropPackAssets } from '@/lib/packAssets';
import {
  deleteStoredPack,
  packStoreAvailable,
  readStoredPack,
  storageErrorMessage,
  writeStoredPack,
} from '@/lib/packStore';
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
  /** The pack revision this content is: a bundle's `packVersion`, or —
   *  for a pack fetched with a licence key — the ETag the unlock endpoint
   *  served it under, which is what a later `If-None-Match` compares
   *  (src/lib/packUpdates.ts). Absent for packs inserted as plain files. */
  packVersion?: string;
  /** The unlock endpoint base a licence-key pack was fetched from, so the
   *  daily update check asks the same place. Absent for other inserts. */
  unlockUrl?: string;
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

/** Whether a pack is on the shelf — the index, read synchronously. */
export function hasInsertedPack(id: string): boolean {
  return browser() && readIndex().some((e) => e.id === id);
}

/** The localStorage copy of a pack (the active mirror, or a pack kept
 *  there by an older build or a device without IndexedDB). */
function readLocalPack(id: string): ActivePack | null {
  try {
    const raw = window.localStorage.getItem(insertedPackKey(id));
    if (!raw) return null;
    const pack = JSON.parse(raw) as ActivePack;
    return pack && typeof pack === 'object' && pack.manifest ? pack : null;
  } catch {
    return null;
  }
}

/** The full content of one inserted pack, or null when absent/corrupt. */
export async function getInsertedPack(id: string): Promise<ActivePack | null> {
  if (!browser()) return null;
  return (await readStoredPack(id)) ?? readLocalPack(id);
}

/**
 * Move packs that live in localStorage (inserted by an older build) into
 * IndexedDB and free their localStorage copy — all but the active pack's,
 * which the synchronous boot reads. Idempotent and safe to call on every
 * load; does nothing where IndexedDB is unavailable. A pack is only ever
 * removed from localStorage once IndexedDB holds it.
 */
export async function migrateInsertedPacks(): Promise<void> {
  if (!browser() || !(await packStoreAvailable())) return;
  const active = getActivePackPointer();
  for (const { id } of readIndex()) {
    const local = readLocalPack(id);
    if (!local) continue;
    try {
      if (!(await readStoredPack(id))) await writeStoredPack(id, local);
      if (id !== active) window.localStorage.removeItem(insertedPackKey(id));
    } catch {
      // IndexedDB refused it — the localStorage copy stays, nothing lost
    }
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
 * The images a bundle carries inline (`quizmill bundle`), kept only when
 * they are what they claim: a plain relative image path mapped to a
 * `data:image/…` URL. Anything else (a script URL, a remote URL, a path
 * that climbs out of assets/) is dropped rather than stored — the map
 * ends up in <img src>, so it gets the same scrutiny as assetsBase.
 * Undefined when nothing survives, so the stored pack has no `assets`
 * key at all.
 */
function embeddedAssets(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const kept: Record<string, string> = {};
  for (const [rel, src] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof src === 'string' &&
      /^data:image\/[a-z0-9.+-]+;base64,/i.test(src) &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(rel) &&
      !rel.includes('..')
    ) {
      kept[rel] = src;
    }
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Validate and store a pack in the library. `raw` is the ActivePack shape
 * (`{ manifest, questions, scenarios?, concepts? }`) parsed from user
 * input — full schema + cross-file validation runs before anything is
 * stored. Re-inserting an existing id replaces its content (pack update);
 * progress is unaffected either way. `buildPackId` (the pack compiled into
 * this deployment) is refused — that one is built in, not inserted.
 * `packVersion` overrides the version the bundle envelope carries (the
 * unlock path passes the endpoint's ETag); `unlockUrl` is kept only when
 * given, so a later file insert of the same pack simply forgets it.
 */
export async function insertPack(
  raw: unknown,
  opts: { origin?: string; buildPackId: string; packVersion?: string; unlockUrl?: string },
): Promise<InsertResult> {
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

  // Keep the recorded assets location so the pack's images resolve after
  // activation — but only a plain http(s) URL (never javascript:/data:).
  const assetsBase =
    typeof candidate.assetsBase === 'string' && /^https?:\/\//i.test(candidate.assetsBase)
      ? candidate.assetsBase.replace(/\/+$/, '')
      : undefined;
  const assets = embeddedAssets(candidate.assets);
  const pack: ActivePack = {
    manifest,
    questions: candidate.questions as ActivePack['questions'],
    scenarios: candidate.scenarios as ActivePack['scenarios'],
    concepts: candidate.concepts as ActivePack['concepts'],
    ...(assetsBase ? { assetsBase } : {}),
    ...(assets ? { assets } : {}),
  };
  // The bundle envelope's own revision (tools/pack/bundle.ts) unless the
  // caller knows better; never an empty string.
  const envelopeVersion = (candidate as { packVersion?: unknown }).packVersion;
  const packVersion =
    opts.packVersion || (typeof envelopeVersion === 'string' && envelopeVersion ? envelopeVersion : undefined);
  const entry: PackLibraryEntry = {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    themeColor: manifest.themeColor,
    questionCount: pack.questions.length,
    categoryCount: manifest.categories.length,
    insertedAt: Date.now(),
    origin: opts.origin,
    ...(packVersion ? { packVersion } : {}),
    ...(opts.unlockUrl ? { unlockUrl: opts.unlockUrl } : {}),
  };
  try {
    // Free localStorage of packs an older build kept there before adding one.
    await migrateInsertedPacks();
    const inStore = await packStoreAvailable();
    if (inStore) await writeStoredPack(entry.id, pack);
    // The active pack's mirror follows its update; without IndexedDB,
    // localStorage is the only home a pack has.
    if (!inStore || getActivePackPointer() === entry.id) {
      window.localStorage.setItem(insertedPackKey(entry.id), JSON.stringify(pack));
    }
    writeIndex([...readIndex().filter((e) => e.id !== entry.id), entry]);
  } catch (e) {
    return { ok: false, errors: [storageErrorMessage(e)] };
  }
  // Ask the browser not to evict a pack unlocked with a licence key under
  // storage pressure — best effort, the answer doesn't change anything here.
  if (opts.unlockUrl && typeof navigator !== 'undefined') {
    void navigator.storage?.persist?.().catch(() => false);
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
export async function ejectPack(id: string): Promise<{ wasActive: boolean }> {
  if (!browser()) return { wasActive: false };
  const wasActive = getActivePackPointer() === id;
  // Capture the pack before removal so its offline-cached images can be
  // dropped too (fire-and-forget).
  const pack = await getInsertedPack(id);
  if (pack) void dropPackAssets(pack);
  await deleteStoredPack(id);
  window.localStorage.removeItem(insertedPackKey(id));
  writeIndex(readIndex().filter((e) => e.id !== id));
  if (wasActive) window.localStorage.removeItem(ACTIVE_PACK_ID_KEY);
  emit();
  return { wasActive };
}

export type ActivateResult = { ok: true } | { ok: false; error: string };

/**
 * Point the app at an inserted pack (or back at the build-time pack with
 * `null`): writes the pointer and moves the localStorage mirror the boot
 * reads from the previous pack to this one — the old copy goes FIRST, so
 * two big packs never have to fit side by side, and comes back if the new
 * one doesn't fit. The caller reloads the page so every module rebinds to
 * the new pack. Clears any external handoff blob (`HANDOFF_PACK_KEY`),
 * which would otherwise outrank the pointer.
 */
export async function activatePack(id: string | null): Promise<ActivateResult> {
  if (!browser()) return { ok: false, error: 'not in a browser' };
  await migrateInsertedPacks();
  const pack = id === null ? null : await getInsertedPack(id);
  if (id !== null && pack === null) return { ok: false, error: `"${id}" is not on this device` };

  const ls = window.localStorage;
  const previous = getActivePackPointer();
  // Only a copy IndexedDB also holds may go — otherwise it is the pack.
  const prevKey =
    previous && previous !== id && (await readStoredPack(previous))
      ? insertedPackKey(previous)
      : null;
  const prevRaw = prevKey === null ? null : ls.getItem(prevKey);
  try {
    if (prevKey !== null) ls.removeItem(prevKey);
    if (id !== null) {
      ls.setItem(insertedPackKey(id), JSON.stringify(pack));
      ls.setItem(ACTIVE_PACK_ID_KEY, id);
    } else {
      ls.removeItem(ACTIVE_PACK_ID_KEY);
    }
  } catch (e) {
    try {
      if (prevKey !== null && prevRaw !== null) ls.setItem(prevKey, prevRaw);
    } catch {
      // it fitted a moment ago; nothing more to try
    }
    return { ok: false, error: storageErrorMessage(e) };
  }
  ls.removeItem(HANDOFF_PACK_KEY);
  emit();
  return { ok: true };
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
