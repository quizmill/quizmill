/**
 * The upgrade card's outbound link. A pack's manifest `upgrade.url` is the
 * destination; we append `?ref=<packId>-<placement>` so whoever runs that
 * page can tell which pack, and which card, sent the learner — the only
 * analytics the engine offers here, and deliberately nothing more (no
 * device id, no progress). Existing query params survive; a stale `ref`
 * is overwritten; a `#fragment` stays at the end where it belongs.
 */
import { unlockedEntry } from './packLibrary';

export type UpgradePlacement = 'home' | 'settings';

/**
 * The upgrade a pack still has to pitch. A sample may name ITS OWN id as
 * the pack its upgrade opens (`upgrade.packId` — one pack id, a built-in
 * edition and a fuller one a licence key fetches under the same id; see
 * src/lib/packLibrary.ts). Once that unlocked edition is the content in
 * use there is nothing left to offer, whether or not its manifest still
 * carries the block — so the card, and the locked exam tile that points
 * at it, go. Any other pack's upgrade passes through untouched.
 */
export function upgradeOnOffer<U extends { packId?: string }>(
  packId: string,
  upgrade: U | undefined,
): U | undefined {
  if (!upgrade) return undefined;
  if (upgrade.packId === packId && unlockedEntry(packId) !== null) return undefined;
  return upgrade;
}

export function upgradeHref(url: string, packId: string, placement: UpgradePlacement): string {
  const u = new URL(url);
  u.searchParams.set('ref', `${packId}-${placement}`);
  return u.toString();
}
