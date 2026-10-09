/**
 * quizmill sync worker — a ~150-line Cloudflare Worker that mirrors a
 * device's practice history into a D1 (SQLite) database.
 *
 * Why this exists: the engine's original cloud-sync backend is Supabase,
 * whose free-tier projects are PAUSED after a week of inactivity and
 * eventually deleted. Cloudflare's free tier has no such lifecycle —
 * Workers and D1 databases stay up indefinitely — and the daily limits
 * (100k requests, 100k row writes) are far beyond what a family of
 * practice apps generates. Deploy once, forget it.
 *
 * Trust model: there are no accounts. A client authenticates with a random
 * ~98-bit sync key (Authorization: Bearer QM-…); the worker never stores
 * the key, only partitions rows by its SHA-256. Knowing a key IS owning
 * its data — the same model as an unlisted URL, appropriate for the
 * low-stakes data mirrored here (quiz attempts, stickers, votes).
 *
 * Deploy (see cloudflare/README.md):
 *   npx wrangler d1 create quizmill-sync        # paste id in wrangler.toml
 *   npx wrangler d1 execute quizmill-sync --remote --file=schema.sql
 *   npx wrangler deploy
 *
 * schema.sql is idempotent — re-run it on an existing deployment to pick
 * up later tables (the `profiles` table backing key names was added
 * after the first release).
 */
import {
  parseOpsRequest,
  parseProfileRequest,
  statementsForOp,
  statementsForProfile,
  userIdFromKey,
  TABLES,
} from './ops';
import type { TableName } from './ops';
import {
  MAX_BEACON_BYTES,
  buildSummary,
  parseBeacon,
  parseSummaryQuery,
  statementsForBeacon,
  summaryStatements,
} from './analytics';

// Minimal D1 surface, declared locally so the engine repo's `tsc` run
// doesn't need @cloudflare/workers-types. Matches the real runtime API.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}
interface Env {
  DB: D1Database;
  /** Optional (`wrangler secret put ANALYTICS_READ_TOKEN`): when set, the
   *  analytics summary needs it as a bearer token. Unset = the aggregate
   *  counts are readable by anyone who knows a pack id. */
  ANALYTICS_READ_TOKEN?: string;
}

const CORS_HEADERS: Record<string, string> = {
  // Bearer-key auth with no cookies, so a wildcard origin is safe — the
  // key itself is the capability, not the caller's origin.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

async function authenticate(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return userIdFromKey(match[1].trim());
}

async function handlePull(request: Request, env: Env, userId: string): Promise<Response> {
  const pack = new URL(request.url).searchParams.get('pack') ?? '';
  if (!pack) return json({ error: 'missing pack' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT tbl, data FROM rows WHERE user_id = ? AND pack_id = ?',
  )
    .bind(userId, pack)
    .all<{ tbl: string; data: string }>();

  const out: Record<TableName, unknown[]> = {
    sessions: [],
    attempts: [],
    achievements: [],
    votes: [],
    notes: [],
    events: [],
  };
  for (const row of results) {
    if ((TABLES as readonly string[]).includes(row.tbl)) {
      try {
        out[row.tbl as TableName].push(JSON.parse(row.data));
      } catch {
        // an unparseable row is dropped rather than failing the whole pull
      }
    }
  }
  return json(out);
}

async function handleOps(request: Request, env: Env, userId: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const parsed = parseOpsRequest(body);
  if (!parsed) return json({ error: 'invalid ops request' }, 400);

  const statements = parsed.ops
    .flatMap((op) => statementsForOp(op, userId, parsed.pack))
    .map((s) => env.DB.prepare(s.sql).bind(...s.params));
  await env.DB.batch(statements);
  return json({ ok: true, applied: parsed.ops.length });
}

/**
 * The optional human-readable name for this key ("Leo", "Dad's key") —
 * how an app holding several keys tells them apart. Not pack-scoped: the
 * key names a learner, not a pack. `null` = this key has no name.
 */
async function handleGetProfile(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT name FROM profiles WHERE user_id = ?')
    .bind(userId)
    .all<{ name: string }>();
  return json({ name: results[0]?.name ?? null });
}

async function handlePutProfile(request: Request, env: Env, userId: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const parsed = parseProfileRequest(body);
  if (!parsed) return json({ error: 'invalid profile request' }, 400);
  const statements = statementsForProfile(parsed.name, userId).map((s) =>
    env.DB.prepare(s.sql).bind(...s.params),
  );
  await env.DB.batch(statements);
  // Echo the stored (canonicalised) name so the client shows what landed.
  return json({ ok: true, name: parsed.name || null });
}

// ── Anonymous funnel analytics (no sync key involved) ───────────────────

/**
 * Ingest one beacon from a hosted app (src/lib/analytics.ts). Devices
 * hold no credential, so this route is open; the body is validated
 * against a closed event list and tight size limits, and the reply is an
 * empty 204 — `navigator.sendBeacon` never reads it anyway. The body
 * arrives as text/plain (a CORS-simple request, no preflight), so it is
 * parsed by hand rather than via request.json()'s content-type sniffing.
 * Size is bounded before anything is parsed: a declared Content-Length
 * over the cap is refused without reading the body at all, and the read
 * body is measured again (the header is optional and unverified).
 */
async function handleBeacon(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BEACON_BYTES) {
    return json({ error: 'beacon too large' }, 413);
  }
  const text = await request.text();
  if (text.length > MAX_BEACON_BYTES) {
    return json({ error: 'beacon too large' }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const beacon = parseBeacon(body);
  if (!beacon) return json({ error: 'invalid beacon' }, 400);
  const statements = statementsForBeacon(beacon, Date.now()).map((s) =>
    env.DB.prepare(s.sql).bind(...s.params),
  );
  await env.DB.batch(statements);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  if (env.ANALYTICS_READ_TOKEN) {
    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || match[1].trim() !== env.ANALYTICS_READ_TOKEN) {
      return json({ error: 'missing or invalid analytics token' }, 401);
    }
  }
  const query = parseSummaryQuery(new URL(request.url).searchParams);
  if (!query) return json({ error: 'missing pack' }, 400);
  const sinceMs = Date.now() - query.days * 86_400_000;
  const [totalsStmt, dailyStmt] = summaryStatements(query.pack, sinceMs);
  const totals = await env.DB.prepare(totalsStmt.sql)
    .bind(...totalsStmt.params)
    .all<{ event: string; count: number; devices: number }>();
  const daily = await env.DB.prepare(dailyStmt.sql)
    .bind(...dailyStmt.params)
    .all<{ day: string; event: string; devices: number }>();
  return json(buildSummary(query, sinceMs, totals.results, daily.results));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { pathname } = new URL(request.url);
    if (pathname === '/') {
      // Unauthenticated liveness probe — handy right after `wrangler deploy`.
      return json({ service: 'quizmill-sync', ok: true });
    }

    // Analytics carries no sync key — it is anonymous by design — so it
    // is routed before authentication.
    try {
      if (pathname === '/v1/analytics' && request.method === 'POST') {
        return await handleBeacon(request, env);
      }
      if (pathname === '/v1/analytics/summary' && request.method === 'GET') {
        return await handleSummary(request, env);
      }
    } catch (err) {
      console.error('[quizmill-sync]', err);
      return json({ error: 'internal error' }, 500);
    }

    const userId = await authenticate(request);
    if (!userId) return json({ error: 'missing or invalid sync key' }, 401);

    try {
      if (pathname === '/v1/rows' && request.method === 'GET') {
        return await handlePull(request, env, userId);
      }
      if (pathname === '/v1/ops' && request.method === 'POST') {
        return await handleOps(request, env, userId);
      }
      if (pathname === '/v1/profile') {
        if (request.method === 'GET') return await handleGetProfile(env, userId);
        if (request.method === 'POST') return await handlePutProfile(request, env, userId);
      }
    } catch (err) {
      console.error('[quizmill-sync]', err);
      return json({ error: 'internal error' }, 500);
    }
    return json({ error: 'not found' }, 404);
  },
};
