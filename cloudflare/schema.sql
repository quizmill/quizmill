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

-- Anonymous funnel analytics (POST /v1/analytics, src/analytics.ts): one
-- row per beacon a hosted app sends — an event from a closed list, the
-- pack, a random device id the learner can regenerate, the app build, the
-- client's timestamp and the server's receipt time (both unix ms; the
-- summary windows on received_at). Deliberately NOT joined to `rows` or
-- `profiles`: a device id never meets a sync key.
CREATE TABLE IF NOT EXISTS analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event       TEXT NOT NULL,
  pack_id     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  app_build   TEXT NOT NULL DEFAULT '',
  ts          INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);

-- The summary reads one pack over a time window.
CREATE INDEX IF NOT EXISTS analytics_by_pack
  ON analytics_events (pack_id, received_at);

-- Licence keys (GET /v1/unlock, src/unlock.ts): one row per key an author
-- minted for a pack. A key opens exactly ONE pack; a pack may have one
-- shared key (a private study set) or one per buyer (a paid bank). The
-- bundle itself lives in the BUNDLES R2 bucket under `<pack_id>.json`;
-- this table only says which keys open it. `uses` counts successful
-- unlocks (a device re-fetching counts again); `max_uses` NULL = no limit;
-- `revoked_at` set = 403 from then on. Keys are stored in clear — they are
-- the author's to list and revoke, unlike sync keys, which are hashed.
CREATE TABLE IF NOT EXISTS licence_keys (
  key        TEXT PRIMARY KEY,
  pack_id    TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  uses       INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

-- `share --list` reads one pack's keys.
CREATE INDEX IF NOT EXISTS licence_keys_by_pack
  ON licence_keys (pack_id);
