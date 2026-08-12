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
 */
import { parseOpsRequest, statementsForOp, userIdFromKey, TABLES } from './ops';
import type { TableName } from './ops';

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

    const userId = await authenticate(request);
    if (!userId) return json({ error: 'missing or invalid sync key' }, 401);

    try {
      if (pathname === '/v1/rows' && request.method === 'GET') {
        return await handlePull(request, env, userId);
      }
      if (pathname === '/v1/ops' && request.method === 'POST') {
        return await handleOps(request, env, userId);
      }
    } catch (err) {
      console.error('[quizmill-sync]', err);
      return json({ error: 'internal error' }, 500);
    }
    return json({ error: 'not found' }, 404);
  },
};
