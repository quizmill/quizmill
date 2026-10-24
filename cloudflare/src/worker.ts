/**
 * quizmill sync worker — a small Cloudflare Worker that mirrors a
 * device's practice history into a D1 (SQLite) database.
 *
 * Why Cloudflare: its free tier has no inactivity lifecycle — Workers and
 * D1 databases stay up indefinitely, so a practice app picked up again
 * months later still syncs — and the daily limits (100k requests, 100k
 * row writes) are far beyond what a family of practice apps generates.
 * Deploy once, forget it.
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
import type { SqlStatement, TableName } from './ops';
import {
  MAX_BEACON_BYTES,
  buildSummary,
  parseBeacon,
  parseRetentionDays,
  parseSummaryQuery,
  purgeStatement,
  statementsForBeacon,
  summaryStatements,
} from './analytics';
import {
  adminTokenMatches,
  bundleEtag,
  bundleObjectKey,
  claimUseStatement,
  decideUnlock,
  etagMatches,
  generateLicenceKey,
  isPackId,
  keyCandidatesLookupStatement,
  keyLookupStatement,
  keysForPackStatement,
  licenceKeyCandidates,
  parseBundleUpload,
  parseMintRequest,
  statementsForMint,
  statementsForRevoke,
  toLicenceKey,
  KEY_EXHAUSTED,
  KEY_NOT_RECOGNISED,
  MAX_BUNDLE_BYTES,
} from './unlock';
import type { LicenceKeyRow } from './unlock';

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
// Likewise the slice of R2 the unlock routes use: one object per pack.
interface R2Object {
  customMetadata?: Record<string, string>;
}
interface R2ObjectBody extends R2Object {
  text(): Promise<string>;
}
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<R2Object>;
}
interface Env {
  DB: D1Database;
  /** Optional (`wrangler secret put ANALYTICS_READ_TOKEN`): when set, the
   *  analytics summary needs it as a bearer token. Unset = the aggregate
   *  counts are readable by anyone who knows a pack id. */
  ANALYTICS_READ_TOKEN?: string;
  /** Optional (wrangler.toml `[vars]`): days an analytics row is kept
   *  before the daily purge deletes it. Unset = 365 (analytics.ts). */
  ANALYTICS_RETENTION_DAYS?: string;
  /** Pack bundles for licence-key unlock (wrangler.toml `[[r2_buckets]]`);
   *  without the binding the unlock routes answer 404 like any other
   *  unknown path. */
  BUNDLES?: R2Bucket;
  /** `wrangler secret put UNLOCK_ADMIN_TOKEN`: the bearer token `quizmill
   *  share` uploads bundles and mints keys with. Unset = no admin routes. */
  UNLOCK_ADMIN_TOKEN?: string;
}

const CORS_HEADERS: Record<string, string> = {
  // Bearer-key auth with no cookies, so a wildcard origin is safe — the
  // key itself is the capability, not the caller's origin.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, if-none-match',
  // The unlock ETag is the pack version the app re-checks later (#172).
  'access-control-expose-headers': 'etag',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

/** The bearer token on a request, or null when the header isn't one. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Parse a JSON body; `undefined` when it isn't JSON (the caller 400s). */
async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Bind pure SQL statements (ops.ts / analytics.ts) to the database. */
function bindAll(env: Env, statements: SqlStatement[]): D1PreparedStatement[] {
  return statements.map((s) => env.DB.prepare(s.sql).bind(...s.params));
}

async function authenticate(request: Request): Promise<string | null> {
  const key = bearerToken(request);
  return key ? userIdFromKey(key) : null;
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
  const body = await jsonBody(request);
  if (body === undefined) return json({ error: 'invalid JSON' }, 400);
  const parsed = parseOpsRequest(body);
  if (!parsed) return json({ error: 'invalid ops request' }, 400);

  const statements = parsed.ops.flatMap((op) => statementsForOp(op, userId, parsed.pack));
  await env.DB.batch(bindAll(env, statements));
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
  const body = await jsonBody(request);
  if (body === undefined) return json({ error: 'invalid JSON' }, 400);
  const parsed = parseProfileRequest(body);
  if (!parsed) return json({ error: 'invalid profile request' }, 400);
  await env.DB.batch(bindAll(env, statementsForProfile(parsed.name, userId)));
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
  await env.DB.batch(bindAll(env, statementsForBeacon(beacon, Date.now())));
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  if (env.ANALYTICS_READ_TOKEN && bearerToken(request) !== env.ANALYTICS_READ_TOKEN) {
    return json({ error: 'missing or invalid analytics token' }, 401);
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

// ── Licence-key unlock (no sync key involved; see unlock.ts) ───────────

/** The bucket, or null when this deployment has no unlock service. */
function bundles(env: Env): R2Bucket | null {
  return env.BUNDLES ?? null;
}

/** The row of a key the worker itself holds in canonical form. */
async function lookupKey(env: Env, key: string): Promise<LicenceKeyRow | null> {
  const stmt = keyLookupStatement(key);
  const { results } = await env.DB.prepare(stmt.sql).bind(...stmt.params).all<LicenceKeyRow>();
  return results[0] ?? null;
}

/**
 * The row a key from the outside (a link, a typed key, a `--revoke`
 * argument) names. Stored keys are opaque, so the input is matched as
 * given first; a typed QL key that differs from its canonical form is
 * matched by that form second. Null = no such key, or nothing to look up.
 */
async function findKey(env: Env, raw: string): Promise<LicenceKeyRow | null> {
  const candidates = licenceKeyCandidates(raw);
  const stmt = keyCandidatesLookupStatement(candidates);
  if (!stmt) return null;
  const { results } = await env.DB.prepare(stmt.sql).bind(...stmt.params).all<LicenceKeyRow>();
  for (const candidate of candidates) {
    const row = results.find((r) => r.key === candidate);
    if (row) return row;
  }
  return null;
}

/** Atomically count one use; null when the key was revoked or spent first. */
async function claimUse(env: Env, key: string): Promise<LicenceKeyRow | null> {
  const stmt = claimUseStatement(key);
  const { results } = await env.DB.prepare(stmt.sql).bind(...stmt.params).all<LicenceKeyRow>();
  return results[0] ?? null;
}

async function keysForPack(env: Env, packId: string) {
  const stmt = keysForPackStatement(packId);
  const { results } = await env.DB.prepare(stmt.sql).bind(...stmt.params).all<LicenceKeyRow>();
  return results.map(toLicenceKey);
}

/**
 * `GET /v1/unlock?key=…[&pack=…]` — the bundle a key opens. The key is
 * judged before anything is read from the bucket, and a malformed or
 * over-long key is refused with the same words as an unknown one, so
 * nothing in the reply says whether a pack exists until the caller has
 * proven they may have it. The ETag is the stored version; a matching
 * If-None-Match gets a 304 and does not count as a use. A 200 does, and
 * the use is claimed atomically AFTER the bundle is in hand: two devices
 * racing for the last use, or a download overlapping a revocation, see
 * exactly one 200 — the loser is refused with the reason the row now
 * carries.
 */
async function handleUnlock(request: Request, env: Env, bucket: R2Bucket): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const packParam = params.get('pack');
  const row = await findKey(env, params.get('key') ?? '');
  if (!row) return json({ error: KEY_NOT_RECOGNISED }, 403);
  const decision = decideUnlock(row, packParam);
  if (!decision.ok) return json({ error: decision.error }, decision.status);

  const object = await bucket.get(bundleObjectKey(decision.packId));
  if (!object) return json({ error: 'The pack behind this key is not available.' }, 404);
  const etag = bundleEtag(object.customMetadata?.version ?? '');
  if (etagMatches(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { etag, ...CORS_HEADERS } });
  }
  if (!(await claimUse(env, row.key))) {
    // Revoked or spent since the check above — say which.
    const now = decideUnlock(await lookupKey(env, row.key));
    return json({ error: now.ok ? KEY_EXHAUSTED : now.error }, now.ok ? 403 : now.status);
  }
  return new Response(await object.text(), {
    status: 200,
    headers: { 'content-type': 'application/json', etag, ...CORS_HEADERS },
  });
}

/** `PUT /v1/packs/:id` — store (or replace) a pack's bundle. Keys are
 *  left alone, so a re-share keeps every link working and every learner's
 *  progress (same pack id); a pack with no key yet gets its first one. */
async function handlePutPack(
  request: Request,
  env: Env,
  bucket: R2Bucket,
  packId: string,
): Promise<Response> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BUNDLE_BYTES) {
    return json({ error: 'bundle too large' }, 413);
  }
  const body = await jsonBody(request);
  if (body === undefined) return json({ error: 'invalid JSON' }, 400);
  const parsed = await parseBundleUpload(body, packId);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { bundle } = parsed;
  await bucket.put(bundleObjectKey(packId), bundle.text, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { version: bundle.version, questions: String(bundle.questions) },
  });
  let keys = await keysForPack(env, packId);
  if (keys.length === 0) {
    const key = generateLicenceKey();
    await env.DB.batch(
      bindAll(env, statementsForMint(key, packId, { label: '', maxUses: null }, Date.now())),
    );
    keys = await keysForPack(env, packId);
  }
  return json({
    ok: true,
    id: packId,
    version: bundle.version,
    questions: bundle.questions,
    bytes: bundle.bytes,
    keys,
  });
}

/** `POST /v1/packs/:id/keys` — mint a key for a pack that has a bundle. */
async function handleMintKey(
  request: Request,
  env: Env,
  bucket: R2Bucket,
  packId: string,
): Promise<Response> {
  // An empty body is a plain unlabelled key; anything else must be JSON.
  const text = await request.text();
  let body: unknown = null;
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
  }
  const mint = parseMintRequest(body);
  if (!mint) return json({ error: 'invalid key request' }, 400);
  if (!(await bucket.head(bundleObjectKey(packId)))) {
    return json({ error: `no bundle stored for "${packId}" — share the pack first` }, 404);
  }
  const key = generateLicenceKey();
  await env.DB.batch(bindAll(env, statementsForMint(key, packId, mint, Date.now())));
  const row = await lookupKey(env, key);
  return json({ ok: true, key: row ? toLicenceKey(row) : null });
}

/** `DELETE /v1/keys/:key` — revoke; the row stays so `--list` shows it.
 *  The key is matched like an unlock: as given first, so a key in another
 *  format revokes as it lists. */
async function handleRevokeKey(env: Env, rawKey: string): Promise<Response> {
  const row = await findKey(env, rawKey);
  if (!row) return json({ error: 'no such licence key' }, 404);
  await env.DB.batch(bindAll(env, statementsForRevoke(row.key, Date.now())));
  const after = await lookupKey(env, row.key);
  return json({ ok: true, key: after ? toLicenceKey(after) : null });
}

/**
 * Route the unlock service's paths; null when the path is not one of
 * them. Admin routes need the UNLOCK_ADMIN_TOKEN bearer; without the
 * secret or the bucket binding the whole service is absent (404), so a
 * fork that only wants sync changes nothing.
 */
async function routeUnlock(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const bucket = bundles(env);
  if (!bucket) return null;
  if (pathname === '/v1/unlock') {
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    return handleUnlock(request, env, bucket);
  }
  const packMatch = /^\/v1\/packs\/([^/]+)(\/keys)?$/.exec(pathname);
  const keyMatch = /^\/v1\/keys\/([^/]+)$/.exec(pathname);
  if (!packMatch && !keyMatch) return null;
  if (!env.UNLOCK_ADMIN_TOKEN || !adminTokenMatches(bearerToken(request), env.UNLOCK_ADMIN_TOKEN)) {
    return json({ error: 'missing or invalid admin token' }, 401);
  }
  if (keyMatch) {
    if (request.method !== 'DELETE') return json({ error: 'method not allowed' }, 405);
    return handleRevokeKey(env, decodeURIComponent(keyMatch[1]));
  }
  if (!packMatch) return null;
  const packId = decodeURIComponent(packMatch[1]);
  if (!isPackId(packId)) return json({ error: 'invalid pack id' }, 400);
  if (packMatch[2]) {
    if (request.method === 'GET') return json({ keys: await keysForPack(env, packId) });
    if (request.method === 'POST') return handleMintKey(request, env, bucket, packId);
    return json({ error: 'method not allowed' }, 405);
  }
  if (request.method !== 'PUT') return json({ error: 'method not allowed' }, 405);
  return handlePutPack(request, env, bucket, packId);
}

const worker = {
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
      // Licence-key unlock carries its own credentials (a licence key, or
      // the admin token), never a sync key.
      const unlocked = await routeUnlock(request, env, pathname);
      if (unlocked) return unlocked;
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

  /** The Cron Trigger in wrangler.toml: drop analytics rows past their
   *  retention, so the privacy page's promise keeps itself. */
  async scheduled(controller: { scheduledTime: number; cron: string }, env: Env): Promise<void> {
    const days = parseRetentionDays(env.ANALYTICS_RETENTION_DAYS);
    await env.DB.batch(bindAll(env, [purgeStatement(controller.scheduledTime, days)]));
  },
};

export default worker;
