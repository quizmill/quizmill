/**
 * Pure validation + SQL for the worker's analytics routes — the receiving
 * end of src/lib/analytics.ts. Kept free of Cloudflare types so the rules
 * are unit-tested from the engine's vitest suite
 * (tests/worker-analytics.test.ts), exactly like ops.ts.
 *
 * Wire protocol:
 *   POST /v1/analytics            { event, packId, deviceId, appBuild, ts }
 *                                 no auth (devices hold no key); 204 or 400
 *   GET  /v1/analytics/summary?pack=<id>&days=<n>
 *                                 per-event totals + distinct devices, and
 *                                 a per-day device series; bearer
 *                                 ANALYTICS_READ_TOKEN when one is set
 *
 * What is stored is exactly what arrives: an event name from a closed
 * list, the pack, a random device id, the app build and two timestamps.
 * Nothing links a device id to a sync key, a name, or an address — the
 * worker never looks at request IPs or user agents.
 */

/** MUST match FUNNEL_EVENTS in src/lib/analytics.ts (asserted in tests). */
export const FUNNEL_EVENTS = [
  'app_open',
  'first_answer',
  'session_10',
  'upsell_seen',
  'upsell_clicked',
  'bundle_inserted',
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export interface Beacon {
  event: FunnelEvent;
  packId: string;
  deviceId: string;
  appBuild: string;
  ts: number;
}

export interface SqlStatement {
  sql: string;
  params: (string | number | null)[];
}

/**
 * Hard cap on a beacon body, checked BEFORE JSON.parse: a real beacon is
 * ~170 bytes, so anything past this is not one and is refused unread
 * (413) rather than parsed into Worker memory.
 */
export const MAX_BEACON_BYTES = 1024;

const MAX_ID_LENGTH = 200;
const MAX_DEVICE_ID_LENGTH = 64;
const MAX_BUILD_LENGTH = 100;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

function isEvent(v: unknown): v is FunnelEvent {
  return typeof v === 'string' && (FUNNEL_EVENTS as readonly string[]).includes(v);
}

/** A device id is a UUID the client minted — letters, digits, dashes. */
function isDeviceId(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= MAX_DEVICE_ID_LENGTH &&
    /^[A-Za-z0-9-]+$/.test(v)
  );
}

/** Validate a `POST /v1/analytics` body. Null = reject with 400. */
export function parseBeacon(raw: unknown): Beacon | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (!isEvent(b.event)) return null;
  if (!isId(b.packId)) return null;
  if (!isDeviceId(b.deviceId)) return null;
  if (b.appBuild !== undefined && typeof b.appBuild !== 'string') return null;
  const appBuild = (b.appBuild as string | undefined) ?? '';
  if (appBuild.length > MAX_BUILD_LENGTH) return null;
  if (typeof b.ts !== 'number' || !Number.isFinite(b.ts) || b.ts < 0) return null;
  return { event: b.event, packId: b.packId, deviceId: b.deviceId, appBuild, ts: b.ts };
}

/** One insert per beacon. `receivedAt` (server clock, unix ms) is what the
 *  summary windows on — client clocks are not to be trusted. */
export function statementsForBeacon(b: Beacon, receivedAt: number): SqlStatement[] {
  return [
    {
      sql: `INSERT INTO analytics_events (event, pack_id, device_id, app_build, ts, received_at)
VALUES (?, ?, ?, ?, ?, ?)`,
      params: [b.event, b.packId, b.deviceId, b.appBuild, Math.round(b.ts), receivedAt],
    },
  ];
}

export interface SummaryQuery {
  pack: string;
  /** Window length, 1..365 days back from now. */
  days: number;
}

/** Validate `GET /v1/analytics/summary` params. Null = 400. */
export function parseSummaryQuery(params: URLSearchParams): SummaryQuery | null {
  const pack = params.get('pack') ?? '';
  if (!isId(pack)) return null;
  const raw = Number(params.get('days'));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw) || 1, MAX_DAYS) : DEFAULT_DAYS;
  return { pack, days: Math.max(1, days) };
}

/**
 * The two reads behind a summary, scoped to one pack and a window
 * starting at `sinceMs` (server receipt time). Index-friendly: both hit
 * analytics_by_pack.
 */
export function summaryStatements(pack: string, sinceMs: number): SqlStatement[] {
  return [
    {
      sql: `SELECT event, COUNT(*) AS count, COUNT(DISTINCT device_id) AS devices
FROM analytics_events
WHERE pack_id = ? AND received_at >= ?
GROUP BY event`,
      params: [pack, sinceMs],
    },
    {
      sql: `SELECT date(received_at / 1000, 'unixepoch') AS day, event, COUNT(DISTINCT device_id) AS devices
FROM analytics_events
WHERE pack_id = ? AND received_at >= ?
GROUP BY day, event
ORDER BY day, event`,
      params: [pack, sinceMs],
    },
  ];
}

export interface Summary {
  pack: string;
  days: number;
  /** ISO timestamp the window starts at. */
  since: string;
  /** Every funnel event, zero-filled, in funnel order. */
  events: Record<FunnelEvent, { count: number; devices: number }>;
  /** Distinct devices per day per event — only days/events that occurred. */
  daily: { day: string; event: FunnelEvent; devices: number }[];
}

/** Assemble the response from the two result sets. */
export function buildSummary(
  query: SummaryQuery,
  sinceMs: number,
  totals: { event: string; count: number; devices: number }[],
  daily: { day: string; event: string; devices: number }[],
): Summary {
  const events = Object.fromEntries(
    FUNNEL_EVENTS.map((e) => [e, { count: 0, devices: 0 }]),
  ) as Summary['events'];
  for (const row of totals) {
    if (isEvent(row.event)) events[row.event] = { count: row.count, devices: row.devices };
  }
  return {
    pack: query.pack,
    days: query.days,
    since: new Date(sinceMs).toISOString(),
    events,
    daily: daily
      .filter((r): r is { day: string; event: FunnelEvent; devices: number } => isEvent(r.event))
      .map((r) => ({ day: r.day, event: r.event, devices: r.devices })),
  };
}
