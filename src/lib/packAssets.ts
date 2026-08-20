/**
 * Offline image support for runtime-inserted packs.
 *
 * A pack inserted via /packs stores its JSON in localStorage, but its
 * images live on the pack's origin (assetsBase) — unreachable offline.
 * So at insert time every referenced image is prefetched into a
 * dedicated, deploy-independent CacheStorage cache; the service worker
 * serves image requests from it cache-first (and tops it up as images
 * are viewed online). Ejecting a pack drops its entries again.
 *
 * The cache NAME is shared with public/sw.js — the worker exempts it
 * from the per-deploy cache purge, so cached pack images survive app
 * updates just like the packs themselves do in localStorage.
 */
import type { ActivePack } from '@/pack/runtime';

export const PACK_ASSETS_CACHE = 'quizmill-pack-assets';

/**
 * Every image URL a pack references, deduped in first-seen order:
 * absolute http(s) image paths as-is, relative ones resolved against the
 * pack's assetsBase — or skipped when it has none (a file-picker insert;
 * nothing to prefetch from).
 */
export function collectPackImageUrls(pack: ActivePack): string[] {
  const base = pack.assetsBase?.replace(/\/+$/, '');
  const urls = new Set<string>();
  const add = (src: string | undefined) => {
    if (!src) return;
    if (/^https?:\/\//i.test(src)) urls.add(src);
    else if (base) urls.add(`${base}/${src.replace(/^\/+/, '')}`);
  };
  for (const q of pack.questions) {
    add(q.image);
    for (const o of q.options ?? []) add(o.image);
  }
  return [...urls];
}

function cacheStorage(): CacheStorage | undefined {
  return typeof caches !== 'undefined' ? caches : undefined;
}

/**
 * Prefetch a pack's images into the pack-assets cache so they render
 * offline. Failures are counted, never thrown — a missed image simply
 * falls back to the network (and the service worker's cache-as-you-go
 * top-up) like before.
 */
export async function cachePackAssets(
  pack: ActivePack,
  fetchImpl: typeof fetch = fetch,
): Promise<{ total: number; cached: number; failed: number }> {
  const urls = collectPackImageUrls(pack);
  const storage = cacheStorage();
  if (!storage || urls.length === 0) {
    return { total: urls.length, cached: 0, failed: urls.length };
  }
  const cache = await storage.open(PACK_ASSETS_CACHE);
  let cached = 0;
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) return;
        await cache.put(url, res.clone());
        cached++;
      } catch {
        // offline or CORS-less host — the SW top-up path still applies
      }
    }),
  );
  return { total: urls.length, cached, failed: urls.length - cached };
}

/** Remove a pack's images from the cache (on eject). Best-effort. */
export async function dropPackAssets(pack: ActivePack): Promise<void> {
  const storage = cacheStorage();
  if (!storage) return;
  try {
    const cache = await storage.open(PACK_ASSETS_CACHE);
    for (const url of collectPackImageUrls(pack)) {
      await cache.delete(url);
    }
  } catch {
    // cache gone or unavailable — nothing to clean
  }
}
