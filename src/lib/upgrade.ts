/**
 * The upgrade card's outbound link. A pack's manifest `upgrade.url` is the
 * destination; we append `?ref=<packId>-<placement>` so whoever runs that
 * page can tell which pack, and which card, sent the learner — the only
 * analytics the engine offers here, and deliberately nothing more (no
 * device id, no progress). Existing query params survive; a stale `ref`
 * is overwritten; a `#fragment` stays at the end where it belongs.
 */
export type UpgradePlacement = 'home' | 'settings';

export function upgradeHref(url: string, packId: string, placement: UpgradePlacement): string {
  const u = new URL(url);
  u.searchParams.set('ref', `${packId}-${placement}`);
  return u.toString();
}
