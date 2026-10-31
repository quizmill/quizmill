/**
 * Unlocking a pack with a licence key — the one-tap path for a learner
 * who holds a key to a pack that is not in the registry: a link opens
 * `/unlock#key=…`, the app fetches the bundle from the pack author's
 * endpoint with that key, inserts it into the library and makes it
 * active. The same handler sits behind "Have a licence key?" on /packs
 * (a second device, or an installed PWA whose storage is separate from
 * the browser the link opened in).
 *
 * The key alone says which pack: the endpoint answers with the bundle
 * the key opens, and the pack's id is the one in that bundle's manifest.
 * So the route works and the entry renders in EVERY build, whatever the
 * active pack declares — a private pack needs no other pack edited to
 * point at it. The contract the app codes against:
 *
 *   GET <unlockUrl>/v1/unlock?key=<licence-key>[&pack=<packId>]
 *     200  application/json  a pack bundle (as `quizmill bundle` writes)
 *     403  { "error": "<text the app may show>" }  key unknown / revoked
 *     404  `pack` was passed and the key does not open that pack
 *
 * Where `unlockUrl` is the build's default endpoint (NEXT_PUBLIC_UNLOCK_URL,
 * falling back to the hosted service at sync.quizmill.dev) unless the
 * active pack's manifest overrides it with `upgrade.unlockUrl` (an author
 * hosting their own). `pack` is sent only by the upgrade claim hand-off,
 * when the manifest hints at the pack its purchase opens (`upgrade.packId`,
 * the sampler → full bank case); the server then refuses a key for any
 * other pack, and the app refuses a bundle for any other pack before it
 * touches storage. The generic key entries never send it
 * (`anyPackUnlockConfig`): a key there may be for any pack at all.
 *
 * CORS `*`, no cookies. How keys are issued is none of the engine's
 * business, and the key itself goes exactly three places: the request
 * above, `quizmill.<packId>.licence` in localStorage, and the screen the
 * learner is looking at. Never an event, never a beacon, never a URL
 * after load (the route reads it from the FRAGMENT — which no server or
 * log ever sees — and clears it at once; a `?key=` is cleared too, but
 * never used).
 *
 * Pure where it can be: the fetch is injectable, so every outcome is
 * unit-tested without a browser.
 */
import { APP_CONFIG } from '@/config';
import type { PackUpgrade } from '@/pack/data';
import { recordEvent } from './storage';
import { cachePackAssets } from './packAssets';
import { activatePack, getInsertedPack, insertPack, type PackLibraryEntry } from './packLibrary';
import { isStorageErrorMessage } from './packStore';

/** The route a licence-key link opens; the key rides in its fragment. */
export const UNLOCK_PATH = '/unlock';

/** Build-time override of the default unlock endpoint. */
export const UNLOCK_URL_ENV = 'NEXT_PUBLIC_UNLOCK_URL';

/** The hosted unlock service every build talks to unless told otherwise. */
export const DEFAULT_UNLOCK_URL = 'https://sync.quizmill.dev';

/** sessionStorage: the confirmation Home shows once after an unlock
 *  (the unlock ends in a full navigation, so React state can't carry it). */
export const UNLOCKED_TOAST_KEY = 'quizmill.unlocked.v1';

/** Where a pack's licence key is kept — per pack, like its progress. */
export function licenceKeyStorageKey(packId: string): string {
  return `quizmill.${packId}.licence`;
}

/** The licence key a pack was unlocked with on this device, or null. */
export function storedLicenceKey(packId: string): string | null {
  try {
    return window.localStorage.getItem(licenceKeyStorageKey(packId))?.trim() || null;
  } catch {
    return null;
  }
}

/** A key with everything but its first group hidden (`QL-····-····-····`),
 *  so the shelf can say a pack holds one without showing it. */
export function maskLicenceKey(key: string): string {
  const groups = key.split('-');
  if (groups.length < 2) return '····';
  return [groups[0], ...groups.slice(1).map(() => '····')].join('-');
}

/** Where the daily update check keeps its record for a pack (when it last
 *  asked, and whether the key was refused) — see src/lib/packUpdates.ts.
 *  A fresh unlock resets it to "checked now", so a key entered again
 *  resumes the checks from tomorrow. */
export function updateCheckStorageKey(packId: string): string {
  return `quizmill.${packId}.packUpdate.v1`;
}

export interface UnlockConfig {
  /** The endpoint base: the manifest's `upgrade.unlockUrl`, else the build's. */
  unlockUrl: string;
  /** The pack a key is expected to open (manifest `upgrade.packId`), when
   *  the active pack hints at one; sent as `pack=` and checked against
   *  the bundle. Absent, the bundle's manifest alone names the pack. */
  packId?: string;
}

/**
 * The unlock contract for an active pack's `upgrade` block and the
 * build's endpoint setting — always something: the per-pack override
 * wins, then the build's NEXT_PUBLIC_UNLOCK_URL, then the hosted default.
 */
export function resolveUnlockConfig(
  upgrade: Pick<PackUpgrade, 'packId' | 'unlockUrl'> | undefined,
  envUrl: string | undefined,
): UnlockConfig {
  const fromEnv = envUrl?.trim();
  const unlockUrl = upgrade?.unlockUrl || (fromEnv ? fromEnv : DEFAULT_UNLOCK_URL);
  return { unlockUrl, ...(upgrade?.packId ? { packId: upgrade.packId } : {}) };
}

/** The ACTIVE pack's unlock contract — never null (see resolveUnlockConfig). */
export function unlockConfig(): UnlockConfig {
  return resolveUnlockConfig(APP_CONFIG.upgrade, process.env.NEXT_PUBLIC_UNLOCK_URL);
}

/**
 * The same endpoint with no `pack=` hint — for the generic key entries
 * (the /unlock link, Packs → Have a licence key?, the starter card),
 * where a learner may hold a key to ANY pack. The active pack's
 * `upgrade.packId` names the pack ITS upgrade sells; sending it there
 * would make the server refuse every key for a different pack.
 */
export function anyPackUnlockConfig(): UnlockConfig {
  return { unlockUrl: unlockConfig().unlockUrl };
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

/** The exact request the contract above describes: `pack=` only with a hint. */
export function unlockEndpoint(config: UnlockConfig, key: string): string {
  const url = new URL('v1/unlock', config.unlockUrl.replace(/\/*$/, '/'));
  url.searchParams.set('key', key);
  if (config.packId) url.searchParams.set('pack', config.packId);
  return url.toString();
}

export type UnlockFailure =
  | 'offline' // the endpoint could not be reached
  | 'denied' // 403 — the key was refused; the message is the endpoint's
  | 'unknown-pack' // 404 — the key does not open the pack that was asked for
  | 'bad-response' // not a pack bundle, or an unexpected status
  | 'wrong-pack' // a bundle, but not the pack the manifest said the key is for
  | 'invalid-pack' // a bundle that failed validation
  | 'storage' // validated, but could not be stored (quota)
  | 'cancelled' // the caller gave up before the bundle arrived — not an event
  | 'not-modified'; // 304 — only ever answered to an If-None-Match (the update check)

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

/** The version an `ETag: "<version>"` header names, or undefined. */
function etagVersion(res: Response): string | undefined {
  const etag = res.headers.get('etag')?.trim().replace(/^W\//, '');
  if (!etag) return undefined;
  const version = etag.replace(/^"|"$/g, '');
  return version ? version : undefined;
}

/**
 * Fetch the bundle the key unlocks. Every non-200 is turned into a
 * reason + a sentence the learner can act on; nothing throws. An aborted
 * `signal` ends in `cancelled`, which the caller treats as silence.
 * `ifNoneMatch` (the update check) sends the version the device holds;
 * the endpoint's 304 comes back as `not-modified`. A 200 carries the
 * served `version` (the ETag) when the endpoint sets one.
 */
export async function fetchUnlockBundle(
  config: UnlockConfig,
  key: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  ifNoneMatch?: string,
): Promise<
  | { ok: true; candidate: unknown; version?: string }
  | { ok: false; reason: UnlockFailure; message: string }
> {
  let res: Response;
  try {
    // No cookies, ever: the key is the credential and travels in the URL.
    res = await fetchImpl(unlockEndpoint(config, key), {
      credentials: 'omit',
      mode: 'cors',
      ...(ifNoneMatch ? { headers: { 'if-none-match': `"${ifNoneMatch}"` } } : {}),
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
  if (res.status === 304) return { ok: false, reason: 'not-modified', message: '' };
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
    return {
      ok: false,
      reason: 'unknown-pack',
      message: config.packId
        ? 'That licence key does not open the pack this app is asking for.'
        : 'The unlock service does not know this pack.',
    };
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
  const version = etagVersion(res);
  return { ok: true, candidate: body, ...(version ? { version } : {}) };
}

/**
 * The whole unlock, start to finish: fetch → validate + insert → keep the
 * key → activate → record `pack_unlocked`. On any failure `unlock_failed`
 * is recorded with the reason (never the key; its `pack` is the bundle's
 * id once one has arrived, else the manifest's hint, else nothing — a
 * refused key names no pack) and nothing is stored, except when only the
 * activation failed: the pack is on the shelf by then, and its key stays
 * with it so updates still reach it.
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
    pack: string | undefined,
    errors?: string[],
  ): UnlockOutcome => {
    recordEvent('unlock_failed', { ...(pack ? { pack } : {}), reason });
    return { ok: false, reason, message, ...(errors ? { errors } : {}) };
  };

  const fetched = await fetchUnlockBundle(config, key, opts.fetchImpl, signal);
  // Checked before any side effect: a response that arrives after the
  // caller moved on must not touch storage.
  if (signal?.aborted) return CANCELLED;
  if (!fetched.ok) return fail(fetched.reason, fetched.message, config.packId);

  // The key says which pack: the bundle's manifest names it. When the
  // active pack hinted at the pack it expects (a sampler and its full
  // bank), a bundle for any other pack is a misconfiguration, not
  // something to install under a surprise id.
  const arriving = manifestId(fetched.candidate as { manifest: unknown }) ?? undefined;
  if (config.packId && arriving !== config.packId) {
    return fail(
      'wrong-pack',
      'The unlock service sent a different pack than this key is for.',
      config.packId,
    );
  }

  // `origin` is informational on the shelf and must not be a URL: the
  // runtime derives an assets location from URL-shaped origins, and the
  // endpoint is not where a bundle's images live (they travel inside it).
  // The endpoint itself and the version it served ride in their own
  // fields — the daily update check asks the same place with that
  // version (src/lib/packUpdates.ts).
  const inserted = await insertPack(fetched.candidate, {
    origin: `licence key · ${new URL(config.unlockUrl).host}`,
    buildPackId: opts.buildPackId,
    unlockUrl: config.unlockUrl,
    ...(fetched.version ? { packVersion: fetched.version } : {}),
    signal,
  });
  if (signal?.aborted) return CANCELLED;
  if (!inserted.ok) {
    const storage = inserted.errors.some(isStorageErrorMessage);
    return fail(
      storage ? 'storage' : 'invalid-pack',
      storage ? inserted.errors[0] : 'The pack the service sent did not validate.',
      arriving ?? config.packId,
      inserted.errors,
    );
  }

  const { entry } = inserted;
  // The key is kept as soon as the pack is on the shelf, before it is
  // opened: a pack that can't be made active still gets its updates.
  try {
    window.localStorage.setItem(licenceKeyStorageKey(entry.id), key);
    // The bundle was fetched just now, so the daily update check counts
    // this as today's look — and a key entered again lifts a refusal the
    // check may have hit (src/lib/packUpdates.ts).
    window.localStorage.setItem(
      updateCheckStorageKey(entry.id),
      JSON.stringify({ checkedAt: Date.now() }),
    );
  } catch {
    // the pack is in; a key that can't be kept just means typing it again
  }
  // The pack is on the shelf even when it can't be made active (no room
  // left in localStorage for the copy the boot reads) — say why.
  const activated = await activatePack(entry.id, { signal });
  if (signal?.aborted) return CANCELLED;
  if (!activated.ok) return fail('storage', activated.error, entry.id, [activated.error]);
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

/**
 * The ending every successful unlock shares (the key form, the /unlock
 * link, the upgrade claim): prefetch the bundle's images — fire-and-forget,
 * as the file insert does; the pack is already in — leave the confirmation
 * for Home, and load Home. A full load on purpose, not a client route: the
 * active pack is resolved once at boot (the layout bootstrap), so only a
 * fresh document renders the unlocked pack — same reason /packs reloads.
 */
export function openUnlockedPack(entry: PackLibraryEntry): void {
  void getInsertedPack(entry.id)
    .then((stored) => stored && cachePackAssets(stored))
    .catch(() => undefined);
  stashUnlockedToast({ title: entry.title, count: entry.questionCount });
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full load, see above
  window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`);
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
