/**
 * The upgrade claim hand-off — so a purchase started from the installed
 * app unlocks IN the installed app. On iOS a home-screen app keeps its
 * storage apart from Safari: the checkout opens in a browser layer over
 * the app, its return lands on `/unlock#key=…` inside that layer, and the
 * pack unlocks there, not in the app the learner goes back to. So the app
 * collects the key itself:
 *
 *   1. Leaving. Each tap on the upgrade card mints a claim (128 random
 *      bits, 32 lowercase hex), keeps it under the pack, and adds
 *      `claim=<claim>` to the link next to `ref`.
 *   2. Coming back. While a claim is pending the app asks the SAME url:
 *
 *        POST <upgrade.url>   content-type: application/json
 *        { "claim": "<claim>" }
 *          → { "status": "pending" }              keep asking (also the
 *                                                 answer for a claim the
 *                                                 url hasn't seen yet)
 *          → { "status": "paid", "key": "<key>" } unlock with that key
 *          → { "status": "revoked" }              forget the claim
 *
 *      A paid key goes through the ordinary licence-key unlock
 *      (src/lib/unlock.ts) — the claim is only a way to fetch the key.
 *      ANY other answer (network or CORS failure, non-JSON, a non-2xx, no
 *      or an unknown `status`) means the link doesn't speak this protocol:
 *      every claim for the pack is dropped and its link leaves without one
 *      from then on, on this device. A plain checkout page costs one failed
 *      request and nothing more.
 *
 * GET on the url stays the checkout; supporting the POST is optional. The
 * claim is a bearer secret for one purchase: it goes in the link, the
 * check and `quizmill.<packId>.upgradeClaims.v1` — never an event, a log
 * or the screen. Claims expire after 48 h unasked; at most five per pack.
 *
 * Pure where it can be: fetch, clock, "already unlocked?" and the unlock
 * itself are injected, so every outcome is unit-tested without a browser.
 */
import type { PackUpgrade } from '@/pack/data';

/** Claims kept per pack; a sixth tap drops the oldest. */
export const CLAIM_MAX = 5;

/** A claim this old is dropped without being asked about. */
export const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

/** While the app is visible: ask every 3 s for a minute, then rest. */
export const CLAIM_POLL_MS = 3_000;
export const CLAIM_WINDOW_MS = 60_000;

export interface UpgradeClaim {
  claim: string;
  /** The pack the purchase is for (manifest `upgrade.packId`), when hinted. */
  packId?: string;
  /** The upgrade url the claim left on — and the one asked about it. */
  url: string;
  createdAt: number;
}

interface ClaimStore {
  claims: UpgradeClaim[];
  /** The upgrade url answered outside the protocol: no more claims here. */
  off?: true;
}

/** Per pack, like its progress. */
export function claimsStorageKey(packId: string): string {
  return `quizmill.${packId}.upgradeClaims.v1`;
}

/** 128 bits from the platform CSPRNG, as 32 lowercase hex characters. */
export function newClaimId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isClaim(value: unknown): value is UpgradeClaim {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<UpgradeClaim>;
  return typeof c.claim === 'string' && typeof c.url === 'string' && typeof c.createdAt === 'number';
}

export function readClaims(packId: string): ClaimStore {
  try {
    const raw = window.localStorage.getItem(claimsStorageKey(packId));
    if (!raw) return { claims: [] };
    const parsed = JSON.parse(raw) as Partial<ClaimStore>;
    const claims = Array.isArray(parsed.claims) ? parsed.claims.filter(isClaim) : [];
    return parsed.off ? { claims, off: true } : { claims };
  } catch {
    return { claims: [] };
  }
}

function writeClaims(packId: string, store: ClaimStore): void {
  try {
    window.localStorage.setItem(claimsStorageKey(packId), JSON.stringify(store));
  } catch {
    // no storage — the hand-off simply doesn't happen; /unlock still works
  }
}

/** Re-read, change, write — so a tap during a check is never clobbered. */
function updateClaims(packId: string, change: (store: ClaimStore) => ClaimStore): void {
  writeClaims(packId, change(readClaims(packId)));
}

/**
 * Mint and keep a claim for a tap on the pack's upgrade link; null when
 * the link has shown it doesn't speak the protocol (or nothing can be kept).
 */
export function startClaim(
  packId: string,
  upgrade: Pick<PackUpgrade, 'url' | 'packId'>,
  now: number = Date.now(),
): string | null {
  const store = readClaims(packId);
  if (store.off) return null;
  const claim = newClaimId();
  const entry: UpgradeClaim = {
    claim,
    ...(upgrade.packId ? { packId: upgrade.packId } : {}),
    url: upgrade.url,
    createdAt: now,
  };
  writeClaims(packId, { claims: [...store.claims, entry].slice(-CLAIM_MAX) });
  if (readClaims(packId).claims.every((c) => c.claim !== claim)) return null;
  return claim;
}

/** The upgrade link with `claim=` added; the rest (ref, fragment) kept. */
export function claimHref(href: string, claim: string): string {
  const u = new URL(href);
  u.searchParams.set('claim', claim);
  return u.toString();
}

export function hasPendingClaims(packId: string): boolean {
  return readClaims(packId).claims.length > 0;
}

/** How a paid key's unlock went: in, try again later, or never. */
export type ClaimUnlockResult = 'ok' | 'retry' | 'failed';

export interface ClaimDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  /** The pack the purchase is for is already on this device. */
  isUnlocked: () => boolean;
  /** The ordinary licence-key unlock, run with a paid key. */
  unlock: (key: string) => Promise<ClaimUnlockResult>;
}

type ClaimAnswer =
  | { status: 'pending' }
  | { status: 'revoked' }
  | { status: 'paid'; key: string }
  | null; // not the protocol

async function askAbout(url: string, claim: string, fetchImpl: typeof fetch): Promise<ClaimAnswer> {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: unknown; key?: unknown } | null;
    if (body?.status === 'pending' || body?.status === 'revoked') return { status: body.status };
    if (body?.status === 'paid' && typeof body.key === 'string' && body.key.trim()) {
      return { status: 'paid', key: body.key.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask about every pending claim for the pack once, oldest first, and act
 * on the answers. `unlocked` once a paid key went in (the caller is then
 * navigating away); `pending` while some claim is still worth asking
 * about; `none` when nothing is left.
 */
export async function checkClaims(
  packId: string,
  upgrade: Pick<PackUpgrade, 'url'>,
  deps: ClaimDeps,
): Promise<'unlocked' | 'pending' | 'none'> {
  const now = deps.now();
  const store = readClaims(packId);
  if (store.off || store.claims.length === 0) return 'none';
  if (deps.isUnlocked()) {
    updateClaims(packId, (s) => ({ ...s, claims: [] }));
    return 'none';
  }
  const fresh = store.claims.filter((c) => now - c.createdAt < CLAIM_TTL_MS);
  if (fresh.length < store.claims.length) {
    updateClaims(packId, (s) => ({
      ...s,
      claims: s.claims.filter((c) => now - c.createdAt < CLAIM_TTL_MS),
    }));
  }
  const drop = (claim: string) =>
    updateClaims(packId, (s) => ({ ...s, claims: s.claims.filter((c) => c.claim !== claim) }));

  for (const { claim } of fresh) {
    const answer = await askAbout(upgrade.url, claim, deps.fetchImpl);
    if (answer === null) {
      writeClaims(packId, { claims: [], off: true });
      return 'none';
    }
    if (answer.status === 'revoked') drop(claim);
    if (answer.status !== 'paid') continue;
    // A key pasted by hand while we were asking wins: nothing to do.
    if (deps.isUnlocked()) {
      updateClaims(packId, (s) => ({ ...s, claims: [] }));
      return 'none';
    }
    const result = await deps.unlock(answer.key);
    if (result === 'retry') continue;
    drop(claim);
    if (result === 'ok') return 'unlocked';
  }
  return hasPendingClaims(packId) ? 'pending' : 'none';
}
