-- ─────────────────────────────────────────────────────────────────────
-- quizmill sync worker — D1 schema.
--
-- One generic table. The worker is a dumb mirror of the client's
-- localStorage: each row is opaque JSON (`data`) keyed by
-- (user_id, pack_id, tbl, id). `ref` is a secondary key used only for
-- grouped deletes — attempts store their sessionId there so
-- "clear these sessions" can also remove the attempts inside them.
--
-- user_id is SHA-256(sync key) — the worker never sees or stores keys
-- beyond hashing the bearer token per request.
--
-- Apply with:
--   npx wrangler d1 execute quizmill-sync --remote --file=schema.sql
-- (idempotent — safe to re-run)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rows (
  user_id    TEXT NOT NULL,
  pack_id    TEXT NOT NULL,
  tbl        TEXT NOT NULL,
  id         TEXT NOT NULL,
  ref        TEXT NOT NULL DEFAULT '',
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, pack_id, tbl, id)
);

-- Grouped deletes: attempts are looked up by their owning session id.
CREATE INDEX IF NOT EXISTS rows_by_ref
  ON rows (user_id, pack_id, tbl, ref);

-- Key names: one optional human-readable label per sync key ("Leo",
-- "Dad's key"), so a family holding several keys can tell them apart.
-- Keyed by the same hashed user id, so the name travels with the key to
-- any device that enters it. Absent row = unnamed key.
CREATE TABLE IF NOT EXISTS profiles (
  user_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
