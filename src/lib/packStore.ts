/**
 * Where inserted packs' full content lives: IndexedDB, one record per pack
 * id. localStorage is capped at ~5 MB per origin (counted in UTF-16, so a
 * pack takes about twice its JSON size) and shared with every pack's
 * progress — two or three large packs filled it. IndexedDB gets a share of
 * the disk and stores the object structured.
 *
 * Every function resolves to "not stored" / false instead of throwing when
 * IndexedDB is missing or refuses to open (some private modes), so the
 * library can fall back to localStorage. Writes DO reject on failure —
 * a quota error must reach the learner (see `storageErrorMessage`).
 */
import type { ActivePack } from '@/pack/runtime';

const DB_NAME = 'quizmill-packs';
const STORE = 'packs';

function factory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null; // some sandboxed frames throw on mere access
  }
}

function openDb(): Promise<IDBDatabase | null> {
  const idb = factory();
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  if (!db) throw new Error('IndexedDB unavailable');
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      // Resolve on COMPLETE, not on the request's success: a write is only
      // durable (and a quota failure only known) once the transaction is.
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/** Whether packs can be kept in IndexedDB on this device. */
export async function packStoreAvailable(): Promise<boolean> {
  const db = await openDb();
  db?.close();
  return db !== null;
}

/** The stored pack, or null when absent, unreadable or IndexedDB is out. */
export async function readStoredPack(id: string): Promise<ActivePack | null> {
  try {
    const pack = await run<unknown>('readonly', (s) => s.get(id));
    return pack && typeof pack === 'object' && (pack as ActivePack).manifest
      ? (pack as ActivePack)
      : null;
  } catch {
    return null;
  }
}

/** Store (or replace) a pack. Rejects with the browser's error. */
export async function writeStoredPack(id: string, pack: ActivePack): Promise<void> {
  await run('readwrite', (s) => s.put(pack, id));
}

/** Drop a pack; a missing pack or store is not an error. */
export async function deleteStoredPack(id: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    // nothing stored, nothing to drop
  }
}

/** A storage write failed because the origin is out of space — Chrome and
 *  Safari name it `QuotaExceededError`, older Firefox
 *  `NS_ERROR_DOM_QUOTA_REACHED`. */
export function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export const STORAGE_FULL_MESSAGE =
  'not enough storage space on this device — eject a pack you no longer use and try again';

/** What to tell the learner when storing a pack threw: the space message
 *  only for a real quota error, otherwise the browser's own words, so a
 *  private-mode refusal or a serialisation bug isn't misreported. */
export function storageErrorMessage(e: unknown): string {
  if (isQuotaError(e)) return STORAGE_FULL_MESSAGE;
  const err = e as { name?: unknown; message?: unknown } | null;
  const name = typeof err?.name === 'string' && err.name ? err.name : 'Error';
  const detail = typeof err?.message === 'string' && err.message ? `${name}: ${err.message}` : String(e);
  return `couldn't save the pack on this device (${detail})`;
}
