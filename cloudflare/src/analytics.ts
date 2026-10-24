/**
 * Pure validation + SQL for the worker's analytics routes — the receiving
 * end of src/lib/analytics.ts. Kept free of Cloudflare types so the rules
 * are unit-tested from the engine's vitest suite
 * (tests/worker-analytics.test.ts), exactly like ops.ts.
 *
 * Wire protocol:
 *   POST /v1/analytics            { event, packId, deviceId, appBuild, ts, pack? }
 *                                 no auth (devices hold no key); 204 or 400
 *                                 `pack` = the ARRIVING pack's id, sent only
 *                                 for bundle_inserted / pack_unlocked /
 *                                 unlock_failed / pack_updated (packId is
 *                                 the active pack)
 *   GET  /v1/analytics/summary?pack=<id>&days=<n>
 *                                 per-event totals + distinct devices, and
 *                                 a per-day device series, over the events
 *                                 in that pack OR about it (`pack`); bearer
 *                                 ANALYTICS_READ_TOKEN when one is set
 *
 * What is stored is exactly what arrives: an event name from a closed
 * list, the pack, a random device id, the app build and two timestamps.
 * Nothing links a device id to a sync key, a name, or an address — the
 * worker never looks at request IPs or user agents.
 */
import { isId, type SqlStatement } from './ops';

/** MUST match FUNNEL_EVENTS in src/lib/analytics.ts (asserted in tests). */
export const FUNNEL_EVENTS = [
  'app_open',
  'first_answer',
  'session_10',
  'upsell_seen',
  'upsell_clicked',
  'bundle_inserted',
  'pack_unlocked',
  'unlock_failed',
  'pack_updated',
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export interface Beacon {
  event: FunnelEvent;
  packId: string;
  deviceId: string;
  appBuild: string;
  ts: number;
  /** The arriving pack's id (insert / unlock events); absent otherwise. */
  pack?: string;
}

/**
 * Hard cap on a beacon body, checked BEFORE JSON.parse: a real beacon is
 * ~170 bytes, so anything past this is not one and is refused unread
 * (413) rather than parsed into Worker memory.
 */
export const MAX_BEACON_BYTES = 1024;

const MAX_DEVICE_ID_LENGTH = 64;
const MAX_BUILD_LENGTH = 100;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

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
  if (b.pack !== undefined && !isId(b.pack)) return null;
  return {
    event: b.event,
    packId: b.packId,
    deviceId: b.deviceId,
    appBuild,
    ts: b.ts,
    ...(b.pack !== undefined ? { pack: b.pack } : {}),
  };
}

/** One insert per beacon. `receivedAt` (server clock, unix ms) is what the
 *  summary windows on — client clocks are not to be trusted. */
export function statementsForBeacon(b: Beacon, receivedAt: number): SqlStatement[] {
  return [
    {
      sql: `INSERT INTO analytics_events (event, pack_id, device_id, app_build, ts, received_at, target_pack_id)
VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        b.event,
        b.packId,
        b.deviceId,
        b.appBuild,
        Math.round(b.ts),
        receivedAt,
        b.pack ?? null,
      ],
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
 * starting at `sinceMs` (server receipt time). A pack's summary holds
 * the events that happened IN it (pack_id) plus the ones ABOUT it
 * (target_pack_id: inserts and unlocks that brought it in), so a sampler
 * keeps its whole funnel — upsell_seen → upsell_clicked → pack_unlocked —
 * and the pack that arrived sees its own arrival. Index-friendly: the OR
 * splits over analytics_by_pack and analytics_by_target.
 */
export function summaryStatements(pack: string, sinceMs: number): SqlStatement[] {
  return [
    {
      sql: `SELECT event, COUNT(*) AS count, COUNT(DISTINCT device_id) AS devices
FROM analytics_events
WHERE (pack_id = ? OR target_pack_id = ?) AND received_at >= ?
GROUP BY event`,
      params: [pack, pack, sinceMs],
    },
    {
      sql: `SELECT date(received_at / 1000, 'unixepoch') AS day, event, COUNT(DISTINCT device_id) AS devices
FROM analytics_events
WHERE (pack_id = ? OR target_pack_id = ?) AND received_at >= ?
GROUP BY day, event
ORDER BY day, event`,
      params: [pack, pack, sinceMs],
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

/**
 * How long a beacon row is kept: the retention a hosted app's privacy page
 * (NEXT_PUBLIC_PRIVACY_URL) promises. A worker operator whose page says
 * something else sets ANALYTICS_RETENTION_DAYS (wrangler.toml `[vars]`).
 */
export const DEFAULT_RETENTION_DAYS = 365;

/** The configured window in whole days. Anything unset, non-numeric or
 *  under one day falls back to the default — a typo must never turn the
 *  purge into "delete everything". */
export function parseRetentionDays(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_RETENTION_DAYS;
}

/** Delete every row received more than `days` before `nowMs` (server
 *  receipt time, like the summary window). Run by the worker's daily Cron
 *  Trigger; a full scan once a day is cheaper than another index written
 *  on every beacon. */
export function purgeStatement(nowMs: number, days: number): SqlStatement {
  return {
    sql: 'DELETE FROM analytics_events WHERE received_at < ?',
    params: [nowMs - days * 86_400_000],
  };
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
