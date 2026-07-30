-- ─────────────────────────────────────────────────────────────────────
-- quizmill — 0002: scope cloud-sync rows by pack.
--
-- Context: multiple learning packs (claude-cert, claude-architect-pro, …)
-- now share ONE Supabase project to stay inside the free-tier project cap.
-- The 0001 schema keyed every row on `user_id` alone, so a user signed in
-- to two packs saw the two packs' history commingled — and, because the
-- achievement catalogue is shared by the engine, an achievement earned in
-- one pack showed up as earned in the other.
--
-- Fix: add a `pack_id` partition column to every table and fold it into the
-- achievement/vote primary keys. The client (src/lib/sync.ts) stamps every
-- write with `APP_CONFIG.packId` and filters every read by it.
--
-- Existing data: at the time of writing every row belongs to the basic
-- "claude-cert" pack, so we backfill that value before enforcing NOT NULL.
--
-- ROLLOUT SAFETY — the transitional default:
--   We set `default 'claude-cert'` on pack_id. This is deliberately a
--   *transitional* default. When this migration runs, the live claude-cert
--   app is still serving the OLD engine bundle, whose inserts don't send a
--   pack_id yet. NOT NULL with no default would reject every one of those
--   inserts until the new bundle deploys. The default keeps them landing
--   under 'claude-cert' — which is exactly right for that pack — so there is
--   zero write breakage during the rollout window.
--   Once BOTH packs serve the pack_id-aware engine, drop the default so a
--   future write that forgets pack_id fails loud instead of being mislabeled
--   (see the DROP DEFAULT block at the very bottom — run it after deploy).
--
-- HOW TO APPLY:
--   1. Open the project's SQL editor (the ONE shared project).
--   2. Paste this whole file (minus the final DROP DEFAULT block) and run it.
--      It is idempotent — safe to re-run.
--   3. Deploy the new engine to BOTH packs (claude-cert + claude-architect-pro).
--   4. Run the DROP DEFAULT block at the bottom.
-- ─────────────────────────────────────────────────────────────────────

-- ── sessions ──────────────────────────────────────────────────────────
alter table public.sessions add column if not exists pack_id text;
update public.sessions set pack_id = 'claude-cert' where pack_id is null;
alter table public.sessions alter column pack_id set default 'claude-cert';
alter table public.sessions alter column pack_id set not null;
create index if not exists sessions_pack_user_started
  on public.sessions (pack_id, user_id, started_at desc);

-- ── attempts ──────────────────────────────────────────────────────────
alter table public.attempts add column if not exists pack_id text;
update public.attempts set pack_id = 'claude-cert' where pack_id is null;
alter table public.attempts alter column pack_id set default 'claude-cert';
alter table public.attempts alter column pack_id set not null;
create index if not exists attempts_pack_user_answered
  on public.attempts (pack_id, user_id, answered_at desc);

-- ── achievements — pack_id joins the primary key ─────────────────────
-- Same achievement_id (shared engine catalogue) can now be earned once per
-- pack, so the PK widens from (user_id, achievement_id) to include pack_id.
alter table public.achievements add column if not exists pack_id text;
update public.achievements set pack_id = 'claude-cert' where pack_id is null;
alter table public.achievements alter column pack_id set default 'claude-cert';
alter table public.achievements alter column pack_id set not null;
alter table public.achievements drop constraint if exists achievements_pkey;
alter table public.achievements
  add constraint achievements_pkey primary key (user_id, pack_id, achievement_id);

-- ── votes — pack_id joins the primary key ────────────────────────────
-- question_id is already pack-prefixed, but scoping the PK keeps the model
-- consistent and lets the onConflict target match.
alter table public.votes add column if not exists pack_id text;
update public.votes set pack_id = 'claude-cert' where pack_id is null;
alter table public.votes alter column pack_id set default 'claude-cert';
alter table public.votes alter column pack_id set not null;
alter table public.votes drop constraint if exists votes_pkey;
alter table public.votes
  add constraint votes_pkey primary key (user_id, pack_id, question_id);

-- ─────────────────────────────────────────────────────────────────────
-- DROP DEFAULT — run ONLY after both packs serve the pack_id-aware engine.
-- Until then the default above shields old-bundle writes; after, we want a
-- forgotten pack_id to fail loudly rather than be silently mislabeled.
-- ─────────────────────────────────────────────────────────────────────
-- alter table public.sessions     alter column pack_id drop default;
-- alter table public.attempts     alter column pack_id drop default;
-- alter table public.achievements alter column pack_id drop default;
-- alter table public.votes        alter column pack_id drop default;
