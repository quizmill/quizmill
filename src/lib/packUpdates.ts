/**
 * Unlocked packs update themselves. A pack that arrived through a licence
 * key (src/lib/unlock.ts) picks up the author's newer bundle on its own:
 * on app open, when online, at most once a day per pack, the app asks
 * the same endpoint for the bundle again with the version it holds —
 *
 *   GET <unlockUrl>/v1/unlock?key=<licence-key>&pack=<packId>
 *   If-None-Match: "<stored packVersion>"
 *
 *   304  nothing to do
 *   200  a newer bundle: re-inserted under the same id (content replaced,
 *        progress kept — every store is `quizmill.<packId>.*`), then one
 *        line on Home: "Updated: now N questions"; beacon `pack_updated`
 *   403  the key no longer opens it: nothing visible, and the pack is not
 *        asked about again until a key is entered (a fresh unlock clears
 *        the record); 404 — the key opens another pack now — the same
 *   offline / network error: silent, and the pack stays due
 *
 * `pack=` always travels here (the app knows exactly which pack it
 * holds), so the endpoint refuses a key that moved to another pack and
 * the app never installs a surprise under a familiar id. The version a
 * pack is held at lives on its library entry (`packVersion`); an entry
 * from before versions were kept sends no If-None-Match, gets a 200, and
 * is compared by content so an unchanged bundle is noted, not announced.
 *
 * The active pack is bound once per page load (src/pack/source.ts), so
 * updating it in storage is not enough for Home to show the new count:
 * the notice says so (`reload`) and PackUpdatedNotice reloads Home once
 * before showing it. Any other pack updates silently on the shelf.
 *
 * Pure apart from storage and the injectable fetch — every outcome is
 * unit-tested without a browser.
 */
import { insertedPackKey } from './packKeys';
import {
  getActivePackPointer,
  insertPack,
  listInsertedPacks,
  type PackLibraryEntry,
} from './packLibrary';
import { recordEvent } from './storage';
import {
  fetchUnlockBundle,
  licenceKeyStorageKey,
  unlockConfig,
  updateCheckStorageKey,
} from './unlock';

/** How long a pack rests between two checks. */
export const PACK_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** sessionStorage: the lines Home shows once after an update (an updated
 *  active pack reloads Home, which drops React state — same reason the
 *  unlock confirmation rides in sessionStorage). */
export const PACK_UPDATED_NOTICE_KEY = 'quizmill.packUpdated.v1';

/** Fired on window when a notice was stashed, so a mounted Home re-reads. */
export const PACK_UPDATED_EVENT = 'quizmill:packupdated';

/** The per-pack record of the last check. */
export interface UpdateCheckState {
  /** Unix ms of the last answer from the endpoint (any status). */
  checkedAt: number;
  /** The key was refused (403/404): no more checks until a key is entered. */
  denied?: boolean;
}

export type PackUpdateOutcome =
  | 'updated' // a newer bundle is in; Home will say so
  | 'unchanged' // a 200 whose content matched what was held — version noted
  | 'current' // 304
  | 'denied' // 403/404 — checks stop for this pack
  | 'offline' // the endpoint could not be reached — still due
  | 'error'; // an odd status or an unusable bundle — nothing changed

export interface PackUpdatedNotice {
  id: string;
  title: string;
  count: number;
  /** The updated pack is the active one: Home must reload to rebind. */
  reload: boolean;
}

function browser(): boolean {
  return typeof window !== 'undefined';
}

export function loadUpdateCheck(packId: string): UpdateCheckState | null {
  if (!browser()) return null;
  try {
    const raw = window.localStorage.getItem(updateCheckStorageKey(packId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UpdateCheckState>;
    if (typeof parsed.checkedAt !== 'number') return null;
    return { checkedAt: parsed.checkedAt, ...(parsed.denied ? { denied: true } : {}) };
  } catch {
    return null;
  }
}

function saveUpdateCheck(packId: string, state: UpdateCheckState): void {
  try {
    window.localStorage.setItem(updateCheckStorageKey(packId), JSON.stringify(state));
  } catch {
    // storage full — worst case the pack is asked about again next open
  }
}

/** The licence key held for a pack, or null — no key, no check. */
function licenceKeyFor(packId: string): string | null {
  try {
    const key = window.localStorage.getItem(licenceKeyStorageKey(packId));
    return key && key.trim() ? key : null;
  } catch {
    return null;
  }
}

/** Whether a pack is due: it holds a key, was not refused, and has not been
 *  asked about within the interval. */
export function updateDue(packId: string, now: number): boolean {
  if (!licenceKeyFor(packId)) return false;
  const state = loadUpdateCheck(packId);
  if (!state) return true;
  if (state.denied) return false;
  return now - state.checkedAt >= PACK_UPDATE_INTERVAL_MS;
}

/** The manifest id a bundle claims, or null. */
function manifestId(candidate: unknown): string | null {
  const m = (candidate as { manifest?: unknown }).manifest;
  if (typeof m !== 'object' || m === null) return null;
  const id = (m as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/** The envelope's own revision, when the endpoint set no ETag. */
function envelopeVersion(candidate: unknown): string | undefined {
  const v = (candidate as { packVersion?: unknown }).packVersion;
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * Ask the endpoint about ONE pack and act on the answer. Assumes the
 * caller checked `updateDue`. Records the check for every answer that
 * came from the endpoint; a network failure records nothing.
 */
export async function checkPackUpdate(
  entry: PackLibraryEntry,
  opts: { buildPackId: string; fetchImpl?: typeof fetch; now?: number },
): Promise<PackUpdateOutcome> {
  const now = opts.now ?? Date.now();
  const key = licenceKeyFor(entry.id);
  if (!key) return 'error';
  // The endpoint the pack came from; an entry from before it was kept
  // falls back to the build's (the active pack's override, else the
  // build's setting, else the hosted default).
  const unlockUrl = entry.unlockUrl ?? unlockConfig().unlockUrl;
  const fetched = await fetchUnlockBundle(
    { unlockUrl, packId: entry.id },
    key,
    opts.fetchImpl,
    undefined,
    entry.packVersion,
  );

  if (!fetched.ok) {
    if (fetched.reason === 'offline' || fetched.reason === 'cancelled') return 'offline';
    if (fetched.reason === 'not-modified') {
      saveUpdateCheck(entry.id, { checkedAt: now });
      return 'current';
    }
    if (fetched.reason === 'denied' || fetched.reason === 'unknown-pack') {
      saveUpdateCheck(entry.id, { checkedAt: now, denied: true });
      return 'denied';
    }
    saveUpdateCheck(entry.id, { checkedAt: now });
    return 'error';
  }

  // Checked by fetchUnlockBundle's pack hint on the server; checked again
  // here before anything touches storage.
  if (manifestId(fetched.candidate) !== entry.id) {
    saveUpdateCheck(entry.id, { checkedAt: now });
    return 'error';
  }

  const storageKey = insertedPackKey(entry.id);
  const before = window.localStorage.getItem(storageKey);
  const inserted = insertPack(fetched.candidate, {
    origin: entry.origin,
    buildPackId: opts.buildPackId,
    unlockUrl,
    ...(fetched.version
      ? { packVersion: fetched.version }
      : envelopeVersion(fetched.candidate)
        ? { packVersion: envelopeVersion(fetched.candidate) }
        : {}),
  });
  saveUpdateCheck(entry.id, { checkedAt: now });
  if (!inserted.ok) return 'error';

  // A 200 for content the device already holds (an entry that had no
  // version to send, or an endpoint that ignores If-None-Match) is not
  // news — the version is noted and nothing is announced.
  if (before !== null && before === window.localStorage.getItem(storageKey)) return 'unchanged';

  recordEvent('pack_updated', { pack: entry.id });
  stashPackUpdatedNotice({
    id: entry.id,
    title: inserted.entry.title,
    count: inserted.entry.questionCount,
    reload: getActivePackPointer() === entry.id,
  });
  return 'updated';
}

/**
 * The app-open sweep: every due pack, one after another (a shelf holds a
 * handful at most). Nothing at all while offline. Returns the outcome per
 * pack asked about — packs not due are simply absent.
 */
export async function checkPackUpdates(opts: {
  buildPackId: string;
  fetchImpl?: typeof fetch;
  now?: number;
  /** Defaults to navigator.onLine (true where the browser cannot say). */
  online?: boolean;
}): Promise<Record<string, PackUpdateOutcome>> {
  const outcomes: Record<string, PackUpdateOutcome> = {};
  if (!browser()) return outcomes;
  const online =
    opts.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!online) return outcomes;
  const now = opts.now ?? Date.now();
  for (const entry of listInsertedPacks()) {
    if (!updateDue(entry.id, now)) continue;
    outcomes[entry.id] = await checkPackUpdate(entry, { ...opts, now });
  }
  return outcomes;
}

// ── The notice Home shows ───────────────────────────────────────────────

function readNotices(): PackUpdatedNotice[] {
  try {
    const raw = window.sessionStorage.getItem(PACK_UPDATED_NOTICE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is PackUpdatedNotice =>
        typeof n === 'object' &&
        n !== null &&
        typeof (n as PackUpdatedNotice).id === 'string' &&
        typeof (n as PackUpdatedNotice).title === 'string' &&
        typeof (n as PackUpdatedNotice).count === 'number',
    );
  } catch {
    return [];
  }
}

export function writePackUpdatedNotices(notices: PackUpdatedNotice[]): void {
  try {
    if (notices.length === 0) window.sessionStorage.removeItem(PACK_UPDATED_NOTICE_KEY);
    else window.sessionStorage.setItem(PACK_UPDATED_NOTICE_KEY, JSON.stringify(notices));
  } catch {
    // no sessionStorage — Home simply shows no notice
  }
}

/** Leave a line for Home: one per pack, the latest replacing an earlier
 *  one for the same pack. Tells a mounted Home at once. */
export function stashPackUpdatedNotice(notice: PackUpdatedNotice): void {
  if (!browser()) return;
  writePackUpdatedNotices([
    ...readNotices().filter((n) => n.id !== notice.id),
    { id: notice.id, title: notice.title, count: notice.count, reload: Boolean(notice.reload) },
  ]);
  window.dispatchEvent(new Event(PACK_UPDATED_EVENT));
}

/** Read WITHOUT clearing — for Home to decide whether a reload comes first. */
export function peekPackUpdatedNotices(): PackUpdatedNotice[] {
  if (!browser()) return [];
  return readNotices();
}

/** Read AND clear the stashed lines — they show exactly once. */
export function takePackUpdatedNotices(): PackUpdatedNotice[] {
  if (!browser()) return [];
  const notices = readNotices();
  if (notices.length > 0) writePackUpdatedNotices([]);
  return notices;
}
