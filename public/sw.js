/**
 * Service worker for offline practice.
 *
 * Strategy: cache-first on a single named cache. On the kid's first online
 * visit everything they touch (HTML, JS, CSS, SVG question images) gets
 * cached, so subsequent visits work fully offline. Navigation responses are
 * also revalidated in the background when online, so a deploy starts
 * rolling out the moment the iPad reconnects.
 *
 * `__BUILD_VERSION__` is replaced at build time (see
 * `scripts/finalise-build.ts`) with the short git SHA, giving every deploy
 * a fresh cache name. The activate handler purges old versions so we don't
 * keep stale chunks around across deploys.
 */
const CACHE_VERSION = '__BUILD_VERSION__';
const CACHE_NAME = `quizmill-${CACHE_VERSION}`;

self.addEventListener('install', () => {
  // Take control on first install without waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Don't try to cache range requests (e.g. video seeking) — partial
  // responses confuse Cache.
  if (req.headers.has('range')) return;

  event.respondWith(handleFetch(req));
});

async function handleFetch(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

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
