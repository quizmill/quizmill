/**
 * First-party funnel analytics — the only thing a hosted app ever tells
 * its author about whether it is found and used.
 *
 * Privacy stance, in one breath: anonymous (a random device id, never a
 * name, key or email), first-party (the beacon goes to the URL the host
 * app was BUILT with — nobody else's), no cookies, no cross-site, and a
 * one-tap off switch in Settings. The payload is exactly
 * `{ event, packId, deviceId, appBuild, ts }` — no progress, no answers,
 * no user agent. Dormant unless NEXT_PUBLIC_ANALYTICS_URL is set at build
 * time, the same pattern as cloud sync.
 *
 * Two halves:
 *  - the BEACON: a `navigator.sendBeacon` fire-and-forget POST for every
 *    FUNNEL event recorded through `recordEvent` (storage.ts). Events keep
 *    flowing into the local events store and the sync mirror exactly as
 *    before — the beacon is an extra subscriber on the mutation bus, not a
 *    second event system;
 *  - the MILESTONES: `first_answer` and `session_10` are derived here from
 *    the same bus (attempts / sessions rows), so every answer-producing
 *    path — the visual runners, Drive, paper marking — counts without
 *    being instrumented. The remaining funnel events (`upsell_*`,
 *    `bundle_inserted`) are recorded at their call sites.
 *
 * The receiver is a route on the sync worker (cloudflare/src/analytics.ts)
 * — any server accepting the same JSON body works.
 */
import type { AppEvent, AppEventType } from '@/data/types';
import { APP_BUILD, APP_CONFIG } from '@/config';
import { KEY_PREFIX, loadAttempts, loadSessions, onMutation, recordEvent } from './storage';
import type { Mutation } from './storage';

/** Build-time env var naming the beacon endpoint. Unset → dormant. */
export const ANALYTICS_URL_ENV = 'NEXT_PUBLIC_ANALYTICS_URL';

/** App-level (not per-pack): one device id for every pack the app plays. */
export const DEVICE_ID_KEY = 'quizmill.deviceId.v1';

/** App-level off switch. '0' = off; absent = on (the documented default). */
export const ANALYTICS_PREF_KEY = 'quizmill.analytics.v1';

/** Local event fired after saveAnalyticsEnabled so mounted hooks re-read. */
export const ANALYTICS_EVENT = 'quizmill:analytics';

/**
 * Per-pack record of which milestones have already fired, so a milestone
 * is a once-per-device fact even across `amendAttempt` re-emits and
 * idempotent session re-saves. Deliberately NOT synced and NOT wiped by
 * "Reset all progress": a funnel step happened once, whatever the learner
 * later does to their history.
 */
const MILESTONES_KEY = `${KEY_PREFIX}funnel.v1`;

/** The tenth completed session marks a device as a retained learner. */
export const SESSION_MILESTONE = 10;

/**
 * The closed list of events that leave the device. Everything else
 * `recordEvent` captures (game_open, export, …) stays local/synced only.
 * MUST match FUNNEL_EVENTS in cloudflare/src/analytics.ts (asserted in
 * tests/worker-analytics.test.ts).
 */
export const FUNNEL_EVENTS: readonly AppEventType[] = [
  'app_open',
  'first_answer',
  'session_10',
  'upsell_seen',
  'upsell_clicked',
  'bundle_inserted',
];

export interface AnalyticsBeacon {
  event: AppEventType;
  packId: string;
  deviceId: string;
  appBuild: string;
  ts: number;
}

function browser(): boolean {
  return typeof window !== 'undefined';
}

/** The endpoint this build beacons to, or null when analytics is off. */
export function analyticsUrl(): string | null {
  // Spelled out so Next inlines it at build time (no dynamic env lookup).
  const url = process.env.NEXT_PUBLIC_ANALYTICS_URL;
  return url ? url : null;
}

export function analyticsConfigured(): boolean {
  return analyticsUrl() !== null;
}

/** Optional privacy page the host app links from the Settings note. */
export function privacyUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_PRIVACY_URL;
  return url ? url : null;
}

// ── Device id ───────────────────────────────────────────────────────────

/** The device's random id, minted on first use. Empty outside a browser. */
export function loadDeviceId(): string {
  if (!browser()) return '';
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    return regenerateDeviceId();
  } catch {
    return '';
  }
}

/** Mint a fresh id — the "forget this device" lever in Settings. */
export function regenerateDeviceId(): string {
  const id = crypto.randomUUID();
  if (!browser()) return id;
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // storage unavailable (private mode) — the id simply won't persist
  }
  window.dispatchEvent(new Event(ANALYTICS_EVENT));
  return id;
}

// ── Preference ──────────────────────────────────────────────────────────

export function loadAnalyticsEnabled(): boolean {
  if (!browser()) return true;
  try {
    return window.localStorage.getItem(ANALYTICS_PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveAnalyticsEnabled(on: boolean): void {
  if (!browser()) return;
  try {
    if (on) window.localStorage.removeItem(ANALYTICS_PREF_KEY);
    else window.localStorage.setItem(ANALYTICS_PREF_KEY, '0');
  } catch {
    // storage unavailable — the in-page state still applies
  }
  window.dispatchEvent(new Event(ANALYTICS_EVENT));
}

// ── Beacon ──────────────────────────────────────────────────────────────

/** The wire payload for one event — nothing beyond these five fields. */
export function beaconFor(event: AppEvent, deviceId: string, appBuild: string): AnalyticsBeacon {
  return {
    event: event.type,
    packId: APP_CONFIG.packId,
    deviceId,
    appBuild,
    ts: event.at,
  };
}

/**
 * Fire-and-forget POST. `navigator.sendBeacon` is the right tool: it
 * survives the page unloading (upsell_clicked opens a new tab) and never
 * blocks the UI. The body is a plain string so the request stays a CORS
 * "simple" request — no preflight for the worker to answer. Older
 * browsers without sendBeacon get a keepalive fetch instead.
 */
function post(url: string, body: string): boolean {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav && typeof nav.sendBeacon === 'function') {
    return nav.sendBeacon(url, body);
  }
  if (typeof fetch === 'function') {
    void fetch(url, { method: 'POST', body, keepalive: true, mode: 'cors' }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Beacon one recorded event if (and only if) this build is configured,
 * the learner hasn't opted out, and the event is on the funnel list.
 * Never throws — analytics must not be able to break the app.
 */
export function sendFunnelEvent(event: AppEvent): boolean {
  const url = analyticsUrl();
  if (!url || !browser()) return false;
  if (!FUNNEL_EVENTS.includes(event.type)) return false;
  if (!loadAnalyticsEnabled()) return false;
  try {
    const deviceId = loadDeviceId();
    if (!deviceId) return false;
    return post(url, JSON.stringify(beaconFor(event, deviceId, APP_BUILD ?? '')));
  } catch {
    return false;
  }
}

// ── Milestones ──────────────────────────────────────────────────────────

type Milestones = Partial<Record<'first_answer' | 'session_10', number>>;

function loadMilestones(): Milestones {
  if (!browser()) return {};
  try {
    const raw = window.localStorage.getItem(MILESTONES_KEY);
    return raw ? (JSON.parse(raw) as Milestones) : {};
  } catch {
    return {};
  }
}

function markMilestone(key: keyof Milestones, now: number): void {
  if (!browser()) return;
  try {
    window.localStorage.setItem(
      MILESTONES_KEY,
      JSON.stringify({ ...loadMilestones(), [key]: now }),
    );
  } catch {
    // storage unavailable — worst case the milestone fires again later
  }
}

function handleMutation(m: Mutation): void {
  if (m.table === 'events') {
    sendFunnelEvent(m.row);
    return;
  }
  if (m.table === 'attempts') {
    const marks = loadMilestones();
    if (marks.first_answer) return;
    const now = Date.now();
    markMilestone('first_answer', now);
    // A device that already had history before this build ran is not on
    // its first answer — mark it so, without back-dating the milestone.
    if (loadAttempts().length <= 1) recordEvent('first_answer', undefined, now);
    return;
  }
  if (m.table === 'sessions') {
    if (m.row.endedAt === null) return;
    const marks = loadMilestones();
    if (marks.session_10) return;
    const ended = loadSessions().filter((s) => s.endedAt !== null).length;
    if (ended < SESSION_MILESTONE) return;
    const now = Date.now();
    markMilestone('session_10', now);
    // Same guard as above: exactly the tenth counts, a long-time learner
    // is simply marked.
    if (ended === SESSION_MILESTONE) recordEvent('session_10', undefined, now);
  }
}

let unsubscribe: (() => void) | null = null;

/**
 * Subscribe to the mutation bus once per page load. Call before the first
 * `recordEvent('app_open')` so the opening beacon isn't missed. Milestones
 * are derived even when the beacon is dormant — they're ordinary app
 * events, useful in the local/synced history on their own.
 */
export function startAnalytics(): void {
  if (unsubscribe || !browser()) return;
  unsubscribe = onMutation(handleMutation);
}

/** Test seam — drop the subscription so each test starts clean. */
export function stopAnalyticsForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
}
