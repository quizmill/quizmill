-- analytics_events.target_pack_id — the pack an insert / unlock event is
-- ABOUT (see schema.sql). schema.sql creates the column for a fresh
-- database; a database created before it existed needs this once:
--
--   npx wrangler d1 execute quizmill-sync --remote --file=migrations/0001-target-pack-id.sql
--
-- NOT idempotent (SQLite's ADD COLUMN fails if the column exists) — run
-- it exactly once, then keep applying schema.sql as before (which adds
-- the index on the new column; it is idempotent and repeated here so a
-- single command brings an old database fully up to date).
ALTER TABLE analytics_events ADD COLUMN target_pack_id TEXT;
CREATE INDEX IF NOT EXISTS analytics_by_target
  ON analytics_events (target_pack_id, received_at);
