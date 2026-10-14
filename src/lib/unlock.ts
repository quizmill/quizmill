/**
 * Unlocking a pack with a licence key — the one-tap path for a learner
 * who holds a key to a pack that is not in the registry: a link opens
 * `/unlock#key=…`, the app fetches the bundle from the pack author's
 * endpoint with that key, inserts it into the library and makes it
 * active. The same handler sits behind "Have a licence key?" on /packs
 * (a second device, or an installed PWA whose storage is separate from
 * the browser the link opened in).
 *
 * The contract the app codes against — the endpoint is the AUTHOR's,
 * declared by the active pack's manifest (`upgrade.unlockUrl`, with
 * `upgrade.packId` naming the pack it serves):
 *
 *   GET <unlockUrl>/v1/unlock?pack=<packId>&key=<licence-key>
 *     200  application/json  a pack bundle (as `quizmill bundle` writes)
 *     403  { "error": "<text the app may show>" }  key unknown / revoked
 *     404  unknown pack
 *
 * CORS `*`, no cookies. How keys are issued is none of the engine's
 * business, and the key itself goes exactly three places: the request
 * above, `quizmill.<packId>.licence` in localStorage, and the screen the
 * learner is looking at. Never an event, never a beacon, never a URL
 * after load (the route reads it from the FRAGMENT — which no server or
 * log ever sees — and clears it at once; a `?key=` is cleared too, but
 * never used). The bundle must be the pack the manifest named: any other
 * id is refused before it touches storage.
 *
 * Pure where it can be: the fetch is injectable, so every outcome is
 * unit-tested without a browser.
 */
import { APP_CONFIG } from '@/config';
import { recordEvent } from './storage';
import { activatePack, insertPack, type PackLibraryEntry } from './packLibrary';

/** The route a licence-key link opens; the key rides in its fragment. */
export const UNLOCK_PATH = '/unlock';

/** sessionStorage: the confirmation Home shows once after an unlock
 *  (the unlock ends in a full navigation, so React state can't carry it). */
export const UNLOCKED_TOAST_KEY = 'quizmill.unlocked.v1';

/** Where a pack's licence key is kept — per pack, like its progress. */
export function licenceKeyStorageKey(packId: string): string {
  return `quizmill.${packId}.licence`;
}

export interface UnlockConfig {
  /** The pack the key unlocks (manifest `upgrade.packId`). */
  packId: string;
  /** The author's endpoint base (manifest `upgrade.unlockUrl`). */
  unlockUrl: string;
}

/** The active pack's unlock contract, or null when it declares none. */
export function unlockConfig(): UnlockConfig | null {
  const u = APP_CONFIG.upgrade;
  if (!u?.packId || !u.unlockUrl) return null;
  return { packId: u.packId, unlockUrl: u.unlockUrl };
}

/**
 * The key carried by a `#key=…` fragment, or null. Only the fragment is
 * read — a key in the query string would be sent to the host and land in
 * its logs, so that spelling is deliberately not honoured.
 */
export function readKeyFromHash(hash: string): string | null {
  const m = hash.match(/[#&]key=([^&]*)/);
  if (!m) return null;
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // a stray % — take the fragment as typed
  }
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

/**
 * Drop the fragment — and a `?key=` in the query string — from the address
 * bar without a navigation, so the key is gone from the URL (history,
 * share sheet, screenshots) at once. A query-string key is never
 * honoured (see `readKeyFromHash`), but a link spelt that way must not
 * leave the secret on screen either. Other query parameters survive.
 */
export function stripKeyFromLocation(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  const hadQueryKey = params.has('key');
  if (!hash && !hadQueryKey) return;
  params.delete('key');
  const rest = params.toString();
  window.history.replaceState(null, '', pathname + (rest ? `?${rest}` : ''));
}

/** The exact request the contract above describes. */
export function unlockEndpoint(config: UnlockConfig, key: string): string {
  const url = new URL('v1/unlock', config.unlockUrl.replace(/\/*$/, '/'));
  url.searchParams.set('pack', config.packId);
  url.searchParams.set('key', key);
  return url.toString();
}

export type UnlockFailure =
  | 'offline' // the endpoint could not be reached
  | 'denied' // 403 — the key was refused; the message is the endpoint's
  | 'unknown-pack' // 404
  | 'bad-response' // not a pack bundle, or an unexpected status
  | 'wrong-pack' // a bundle, but not the pack the key is for
  | 'invalid-pack' // a bundle that failed validation
  | 'storage' // validated, but could not be stored (quota)
  | 'cancelled'; // the caller gave up before the bundle arrived — not an event

export type UnlockOutcome =
  | { ok: true; entry: PackLibraryEntry }
  | { ok: false; reason: UnlockFailure; message: string; errors?: string[] };

/** Fallback line shown under every failure — the file path still works. */
export const UNLOCK_FALLBACK = 'You can also insert the file under Packs.';

const MAX_SERVER_MESSAGE = 200;

/** The refusal text a 403 body may carry — a short plain string, or
 *  nothing (the engine shows its own line then). */
function refusalMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const text = (body as { error?: unknown }).error;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SERVER_MESSAGE) return null;
  return trimmed;
}

function isBundle(value: unknown): value is { manifest: unknown; questions: unknown } {
  return (
    typeof value === 'object' && value !== null && 'manifest' in value && 'questions' in value
  );
}

/** The id a bundle's manifest claims, or null when it has none. */
function manifestId(bundle: { manifest: unknown }): string | null {
  const m = bundle.manifest;
  if (typeof m !== 'object' || m === null) return null;
  const id = (m as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

const CANCELLED = { ok: false, reason: 'cancelled', message: '' } as const satisfies UnlockOutcome;

/**
 * Fetch the bundle the key unlocks. Every non-200 is turned into a
 * reason + a sentence the learner can act on; nothing throws. An aborted
 * `signal` ends in `cancelled`, which the caller treats as silence.
 */
export async function fetchUnlockBundle(
  config: UnlockConfig,
  key: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ ok: true; candidate: unknown } | { ok: false; reason: UnlockFailure; message: string }> {
  let res: Response;
  try {
    // No cookies, ever: the key is the credential and travels in the URL.
    res = await fetchImpl(unlockEndpoint(config, key), {
      credentials: 'omit',
      mode: 'cors',
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) return CANCELLED;
    return {
      ok: false,
      reason: 'offline',
      message: 'Could not reach the unlock service — check your connection and try again.',
    };
  }
  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {
    // a non-JSON body — handled per status below
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason: 'denied',
      message: refusalMessage(body) ?? 'That licence key was not accepted.',
    };
  }
  if (res.status === 404) {
    return { ok: false, reason: 'unknown-pack', message: 'The unlock service does not know this pack.' };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: 'bad-response',
      message: `The unlock service answered HTTP ${res.status} — try again later.`,
    };
  }
  if (!isBundle(body)) {
    return { ok: false, reason: 'bad-response', message: 'The unlock service did not return a pack.' };
  }
  return { ok: true, candidate: body };
}

/**
 * The whole unlock, start to finish: fetch → validate + insert → activate
 * → keep the key → record `pack_unlocked`. On any failure `unlock_failed`
 * is recorded with the reason (never the key) and nothing is stored.
 * The caller navigates to Home afterwards — a full load, so every module
 * rebinds to the new pack.
 *
 * `signal` lets the caller abandon a request it no longer wants (a newer
 * key arrived while this one was still being answered): once aborted,
 * nothing is inserted, activated, kept or recorded, whatever the
 * endpoint eventually says.
 */
export async function unlockPack(
  key: string,
  opts: {
    config: UnlockConfig;
    buildPackId: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<UnlockOutcome> {
  const { config, signal } = opts;
  const fail = (
    reason: UnlockFailure,
    message: string,
    errors?: string[],
  ): UnlockOutcome => {
    recordEvent('unlock_failed', { pack: config.packId, reason });
    return { ok: false, reason, message, ...(errors ? { errors } : {}) };
  };

  const fetched = await fetchUnlockBundle(config, key, opts.fetchImpl, signal);
  // Checked before any side effect: a response that arrives after the
  // caller moved on must not touch storage.
  if (signal?.aborted) return CANCELLED;
  if (!fetched.ok) return fail(fetched.reason, fetched.message);

  // The endpoint serves one pack per key; a bundle for any other pack is
  // a misconfiguration, not something to install under a surprise id.
  if (manifestId(fetched.candidate as { manifest: unknown }) !== config.packId) {
    return fail('wrong-pack', 'The unlock service sent a different pack than this key is for.');
  }

  // `origin` is informational on the shelf and must not be a URL: the
  // runtime derives an assets location from URL-shaped origins, and the
  // endpoint is not where a bundle's images live (they travel inside it).
  const inserted = insertPack(fetched.candidate, {
    origin: `licence key · ${new URL(config.unlockUrl).host}`,
    buildPackId: opts.buildPackId,
  });
  if (!inserted.ok) {
    const quota = inserted.errors.some((e) => e.includes('storage space'));
    return fail(
      quota ? 'storage' : 'invalid-pack',
      quota ? inserted.errors[0] : 'The pack the service sent did not validate.',
      inserted.errors,
    );
  }

  const { entry } = inserted;
  activatePack(entry.id);
  try {
    window.localStorage.setItem(licenceKeyStorageKey(entry.id), key);
  } catch {
    // the pack is in; a key that can't be kept just means typing it again
  }
  recordEvent('pack_unlocked', { pack: entry.id });
  return { ok: true, entry };
}

export interface UnlockedToast {
  title: string;
  count: number;
}

/** Leave the confirmation for Home to pick up after the navigation. */
export function stashUnlockedToast(toast: UnlockedToast): void {
  try {
    window.sessionStorage.setItem(UNLOCKED_TOAST_KEY, JSON.stringify(toast));
  } catch {
    // no sessionStorage — Home simply shows no toast
  }
}

/** Read AND clear the stashed confirmation — it shows exactly once. */
export function takeUnlockedToast(): UnlockedToast | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(UNLOCKED_TOAST_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(UNLOCKED_TOAST_KEY);
    const parsed = JSON.parse(raw) as Partial<UnlockedToast>;
    if (typeof parsed.title !== 'string' || typeof parsed.count !== 'number') return null;
    return { title: parsed.title, count: parsed.count };
  } catch {
    return null;
  }
}
