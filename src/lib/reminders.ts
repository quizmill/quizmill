/**
 * Daily streak reminders — the "come back tomorrow" nudge, done the only way
 * that works without a backend on a static, offline-first PWA.
 *
 * There is no reliable cross-browser primitive for "fire a notification at 8pm
 * tomorrow" while the app is closed. The pragmatic path is **Periodic
 * Background Sync** (Chromium, installed PWA): the browser wakes the service
 * worker roughly once a day, the SW checks whether today's practice has
 * happened, and — if a streak is at risk — shows a local notification. No
 * server, no push subscription. Everywhere it's unavailable (notably iOS) the
 * in-app StreakCard on Home is the fallback nudge.
 *
 * The service worker can't read localStorage (where all attempt history
 * lives), so on each app open we mirror a tiny streak summary into IndexedDB —
 * the one client-written store a SW can read when it wakes. The pure functions
 * here (mirror shape + the fire-or-not decision) are unit-tested; the thin
 * browser glue (IndexedDB, permission, periodicSync registration) is a
 * progressive enhancement that no-ops where the APIs are missing.
 */
import type { Attempt } from '@/data/types';
import { currentStreak, toDayKey } from './streak';
import { practiceDates, STREAK_MIN_QUESTIONS_PER_DAY } from './stats';
import { loadRemindersOptIn, saveRemindersOptIn } from './storage';

/** IndexedDB the client writes and the service worker reads. Kept in lockstep
 *  with the constants in `public/sw.js` — change both together. */
export const REMINDERS_DB = 'quizmill-reminders';
export const REMINDERS_STORE = 'mirror';

/** periodicSync tag the SW listens for. Also mirrored in `public/sw.js`. */
export const REMINDER_SYNC_TAG = 'streak-reminder';

/** Roughly once a day. The browser treats this as a floor and a hint, not a
 *  precise schedule — it fires when it decides the PWA is "engaged enough". */
export const REMINDER_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The streak summary mirrored into IndexedDB for the service worker. Keyed by
 * packId so a multi-pack origin keeps one record per pack. Deliberately tiny —
 * just enough for the SW to decide whether to nudge, with no question data.
 */
export interface StreakMirror {
  packId: string;
  /** Pack title, used as the notification heading. */
  title: string;
  /** Streak length (qualifying days) as of `updatedAt`. */
  streak: number;
  /** Day key (YYYY-M-D, local) of the most recent attempt of any kind, or
   *  null if there's no history. Lets the SW tell "already practised today". */
  lastActiveDay: string | null;
  /** Day key of the most recent day that cleared the daily goal, or null. */
  lastQualifyingDay: string | null;
  /** Daily-practice goal (questions/day) at write time. */
  goal: number;
  updatedAt: number;
}

/** Day key for the day before `now`, in local time. */
function yesterdayKey(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return toDayKey(d);
}

/**
 * Build the IndexedDB mirror record from the full attempt history. Pure so it
 * can be unit-tested; the browser write happens in {@link writeStreakMirror}.
 */
export function buildStreakMirror(
  attempts: readonly Attempt[],
  packId: string,
  title: string,
  now: Date = new Date(),
  goal: number = STREAK_MIN_QUESTIONS_PER_DAY,
): StreakMirror {
  let lastActiveAt = -Infinity;
  for (const a of attempts) {
    if (a.answeredAt > lastActiveAt) lastActiveAt = a.answeredAt;
  }
  const qualifying = practiceDates(attempts, goal);
  let lastQualifyingAt = -Infinity;
  for (const d of qualifying) {
    const t = d.getTime();
    if (t > lastQualifyingAt) lastQualifyingAt = t;
  }
  return {
    packId,
    title,
    streak: currentStreak(qualifying, now),
    lastActiveDay:
      lastActiveAt === -Infinity ? null : toDayKey(new Date(lastActiveAt)),
    lastQualifyingDay:
      lastQualifyingAt === -Infinity
        ? null
        : toDayKey(new Date(lastQualifyingAt)),
    goal,
    updatedAt: now.getTime(),
  };
}

export interface ReminderDecision {
  show: boolean;
  title: string;
  body: string;
}

/**
 * Decide whether the service worker should fire a reminder right now, and with
 * what copy. Pure — the SW imports the same logic conceptually (re-implemented
 * inline there, since it can't load TS modules) and this is the tested source
 * of truth for the rules.
 *
 * Fire only when a streak is genuinely on the line today:
 *  - there's a live streak (`streak >= 1`), and
 *  - the last qualifying day was *yesterday* (so missing today breaks it — if
 *    it were older the streak is already gone and "keep your streak" is a lie),
 *  - and they haven't been active at all yet today.
 * Anyone who never practised, or already practised today, gets nothing.
 */
export function reminderDecision(
  mirror: StreakMirror,
  now: Date = new Date(),
): ReminderDecision {
  const today = toDayKey(now);
  const yesterday = yesterdayKey(now);
  const atRisk =
    mirror.streak >= 1 &&
    mirror.lastQualifyingDay === yesterday &&
    mirror.lastActiveDay !== today;

  if (!atRisk) return { show: false, title: '', body: '' };

  return {
    show: true,
    title: mirror.title,
    body: `🔥 Keep your ${mirror.streak}-day streak — practise today before midnight.`,
  };
}

// ---------------------------------------------------------------------------
// Browser glue — progressive enhancement. Everything below no-ops where the
// relevant API is missing, so importing this module is always safe.
// ---------------------------------------------------------------------------

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/** Notifications + a service worker are the floor; without them there's no
 *  reminder path at all (the in-app StreakCard still nudges). */
export function notificationsSupported(): boolean {
  return (
    hasWindow() &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

/** Whether the browser can wake the SW on a schedule. Chromium + installed
 *  PWA only; absent on iOS/Firefox, where we fall back to the in-app nudge. */
export function periodicSyncSupported(): boolean {
  return (
    hasWindow() &&
    'serviceWorker' in navigator &&
    'PeriodicSyncManager' in window
  );
}

export interface ReminderState {
  /** True only when scheduled background reminders can actually run. */
  scheduledSupported: boolean;
  /** Notification permission, or 'default' where the API is missing. */
  permission: NotificationPermission;
  /** Whether the user has switched reminders on. */
  optedIn: boolean;
}

export function reminderState(): ReminderState {
  return {
    scheduledSupported: notificationsSupported() && periodicSyncSupported(),
    permission: notificationsSupported() ? Notification.permission : 'default',
    optedIn: loadRemindersOptIn(),
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(REMINDERS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(REMINDERS_STORE)) {
        db.createObjectStore(REMINDERS_STORE, { keyPath: 'packId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Mirror the latest streak summary into IndexedDB for the SW to read. */
export async function writeStreakMirror(mirror: StreakMirror): Promise<void> {
  if (!hasWindow() || !('indexedDB' in window)) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(REMINDERS_STORE, 'readwrite');
      tx.objectStore(REMINDERS_STORE).put(mirror);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB can be unavailable (private mode, quota) — reminders are a
    // best-effort enhancement, so a write failure must never surface.
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!hasWindow() || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.ready) ?? null;
  } catch {
    return null;
  }
}

/** Register periodic background sync if the browser supports it. Safe to call
 *  repeatedly — the browser dedups by tag. */
async function registerPeriodicSync(): Promise<void> {
  if (!periodicSyncSupported()) return;
  const reg = await registration();
  // periodicSync is a non-standard addition not in the DOM lib types.
  const ps = (reg as unknown as { periodicSync?: PeriodicSyncManagerLike })
    ?.periodicSync;
  if (!ps) return;
  try {
    await ps.register(REMINDER_SYNC_TAG, {
      minInterval: REMINDER_MIN_INTERVAL_MS,
    });
  } catch {
    // Permission for periodic sync can be denied independently — ignore.
  }
}

async function unregisterPeriodicSync(): Promise<void> {
  const reg = await registration();
  const ps = (reg as unknown as { periodicSync?: PeriodicSyncManagerLike })
    ?.periodicSync;
  if (!ps?.unregister) return;
  try {
    await ps.unregister(REMINDER_SYNC_TAG);
  } catch {
    // already gone
  }
}

interface PeriodicSyncManagerLike {
  register(tag: string, opts?: { minInterval?: number }): Promise<void>;
  unregister?(tag: string): Promise<void>;
}

/**
 * Turn reminders on: ask for notification permission, and if granted, remember
 * the opt-in and register periodic sync. Returns the resulting state so the UI
 * can reflect a denied permission. No-ops to a sensible state when unsupported.
 */
export async function enableReminders(): Promise<ReminderState> {
  if (!notificationsSupported()) return reminderState();
  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  if (permission === 'granted') {
    saveRemindersOptIn(true);
    await registerPeriodicSync();
  } else {
    saveRemindersOptIn(false);
  }
  return reminderState();
}

/** Turn reminders off: clear the opt-in and unregister periodic sync. */
export async function disableReminders(): Promise<ReminderState> {
  saveRemindersOptIn(false);
  await unregisterPeriodicSync();
  return reminderState();
}

/**
 * Refresh the SW-visible state on app open / attempt change: always re-mirror
 * the latest streak summary, and if the user is opted in, re-assert the
 * periodic-sync registration (cheap, idempotent — covers a SW that was
 * replaced by a deploy).
 */
export async function refreshReminders(
  mirror: StreakMirror,
): Promise<void> {
  await writeStreakMirror(mirror);
  if (loadRemindersOptIn()) await registerPeriodicSync();
}
