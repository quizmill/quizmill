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

// ---------------------------------------------------------------------------
// Streak reminders (progressive enhancement).
//
// Periodic Background Sync wakes us roughly once a day. We read the streak
// summary the client mirrored into IndexedDB (a SW can't see localStorage) and,
// if a streak is on the line today, show a local notification. Constants and
// the fire-or-not rule are kept in lockstep with `src/lib/reminders.ts` — that
// module is the unit-tested source of truth for the decision.
// ---------------------------------------------------------------------------
const REMINDERS_DB = 'quizmill-reminders';
const REMINDERS_STORE = 'mirror';
const REMINDER_SYNC_TAG = 'streak-reminder';

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readAllMirrors() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const open = indexedDB.open(REMINDERS_DB, 1);
      // The client owns the schema; if this SW races ahead of it, create the
      // store so the read doesn't throw (it'll just be empty).
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(REMINDERS_STORE)) {
          db.createObjectStore(REMINDERS_STORE, { keyPath: 'packId' });
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        try {
          const tx = db.transaction(REMINDERS_STORE, 'readonly');
          const req = tx.objectStore(REMINDERS_STORE).getAll();
          req.onsuccess = () => done(req.result || []);
          req.onerror = () => done([]);
        } catch {
          done([]);
        }
      };
      open.onerror = () => done([]);
    } catch {
      done([]);
    }
  });
}

/** Mirror of reminderDecision() in src/lib/reminders.ts — keep in sync. */
function reminderForMirror(mirror, now) {
  const today = dayKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  const atRisk =
    mirror.streak >= 1 &&
    mirror.lastQualifyingDay === yesterday &&
    mirror.lastActiveDay !== today;
  if (!atRisk) return null;
  return {
    tag: `streak-reminder-${mirror.packId}`,
    title: mirror.title,
    body: `🔥 Keep your ${mirror.streak}-day streak — practise today before midnight.`,
  };
}

async function showStreakReminders() {
  if (!self.registration || !self.registration.showNotification) return;
  const mirrors = await readAllMirrors();
  const now = new Date();
  for (const mirror of mirrors) {
    const note = reminderForMirror(mirror, now);
    if (!note) continue;
    await self.registration.showNotification(note.title, {
      body: note.body,
      tag: note.tag,
      // Coalesce: a fresh wake replaces a still-pending reminder rather than
      // stacking another.
      renotify: false,
      icon: './icon.svg',
      badge: './icon.svg',
      data: { url: './' },
    });
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === REMINDER_SYNC_TAG) {
    event.waitUntil(showStreakReminders());
  }
});

// Belt-and-braces: let the page trigger the same check (e.g. a "preview"
// button, or browsers that expose only one-off sync).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'streak-reminder-check') {
    event.waitUntil(showStreakReminders());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.href).href;
      const clientsArr = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientsArr) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
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
