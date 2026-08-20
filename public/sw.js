/**
 * Service worker for offline practice.
 *
 * Strategy: precache the ENTIRE static export at install (it's a small,
 * fully-static app), then serve cache-first with a runtime cache-as-you-go
 * top-up for anything the manifest missed. Precaching matters because a
 * route is otherwise only cached once visited online: Home would load
 * offline but tapping a category dead-ended on the uncached practice
 * route. Navigation responses are also revalidated in the background when
 * online, so a deploy starts rolling out the moment the iPad reconnects.
 *
 * `__BUILD_VERSION__` and `__PRECACHE_MANIFEST__` are replaced at build
 * time (see `scripts/finalise-build.ts`) with the short git SHA and the
 * full file list of `out/`. A fresh cache name per deploy + the activate
 * purge keep stale chunks from surviving across deploys. In dev the
 * placeholders are unstamped: JSON.parse throws, the manifest stays empty,
 * and the worker degrades to pure cache-as-you-go.
 */
const CACHE_VERSION = '__BUILD_VERSION__';
const CACHE_NAME = `quizmill-${CACHE_VERSION}`;
// Images of runtime-inserted packs, prefetched by the page at insert time
// (src/lib/packAssets.ts). Deploy-independent — it must survive the
// activate purge, like the packs themselves survive in localStorage.
const PACK_ASSETS_CACHE = 'quizmill-pack-assets';

let PRECACHE_MANIFEST = [];
try {
  PRECACHE_MANIFEST = JSON.parse('__PRECACHE_MANIFEST__');
} catch {
  // unstamped (dev) — no precache, runtime caching still applies
}

self.addEventListener('install', (event) => {
  // Take control on first install without waiting for old tabs to close.
  self.skipWaiting();
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  // Deliberately not cache.addAll: one flaky asset must not abort the
  // whole install — anything missed here is picked up by the runtime
  // cache-as-you-go path on first use.
  await Promise.allSettled(
    PRECACHE_MANIFEST.map(async (path) => {
      // Manifest paths are relative to the SW location, so this works
      // under any base path.
      const url = new URL(path, self.location.href).toString();
      if (await cache.match(url)) return;
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) await cache.put(url, res);
    }),
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== PACK_ASSETS_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Cross-origin: only IMAGES are ours to answer — a runtime-inserted
    // pack's diagrams live on the pack's origin and were prefetched into
    // PACK_ASSETS_CACHE at insert time. Everything else cross-origin
    // (sync backends, fonts…) stays untouched.
    if (req.destination === 'image') event.respondWith(handlePackAsset(req));
    return;
  }
  // Don't try to cache range requests (e.g. video seeking) — partial
  // responses confuse Cache.
  if (req.headers.has('range')) return;

  event.respondWith(handleFetch(req));
});

async function handlePackAsset(req) {
  const cache = await caches.open(PACK_ASSETS_CACHE);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  // Not prefetched (inserted before this feature, or the prefetch missed
  // one) — cache as you go, so anything viewed online works offline next.
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    cache.put(req.url, res.clone());
  }
  return res;
}

async function handleFetch(req) {
  const cache = await caches.open(CACHE_NAME);
  // Query strings must not defeat the cache for route requests:
  //  - navigations carry app state (/practice/?subject=planets) but are
  //    served by the same cached route shell;
  //  - the client router's payload fetches carry a ?_rsc= cache-buster.
  // Exact match first (keeps genuinely query-distinct entries working),
  // then retry ignoring the search for those two shapes.
  const ignorableSearch =
    req.mode === 'navigate' || new URL(req.url).searchParams.has('_rsc');
  const cached =
    (await cache.match(req)) ||
    (ignorableSearch
      ? await cache.match(req, { ignoreSearch: true })
      : undefined);

  if (cached) {
    // For navigation requests, kick off a background revalidation so the
    // next visit picks up a fresh deploy.
    if (req.mode === 'navigate') {
      fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
        })
        .catch(() => {
          /* offline, that's fine */
        });
    }
    return cached;
  }

  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      // Clone before caching — body is a one-shot stream.
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    if (req.mode === 'navigate') {
      // Offline AND nothing cached for this URL — fall back to whatever
      // entry page we DO have cached.
      const fallback =
        (await cache.match('./')) ||
        (await cache.match('index.html'));
      if (fallback) return fallback;
    }
    throw err;
  }
}
