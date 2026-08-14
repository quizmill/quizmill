-- ─────────────────────────────────────────────────────────────────────
-- quizmill — 0003: per-question study notes.
--
-- A note is the learner's own annotation on a question ("review this
-- later", "I want more questions like this") — distinct from a downvote
-- comment, which is feedback about question quality. One note per
-- (user, pack, question); editing replaces it, so the client syncs it as
-- a plain upsert with last-write-wins on updated_at.
--
-- Pack-scoped from birth (post-0002 world), so pack_id is in the primary
-- key with no transitional default.
--
-- HOW TO APPLY: paste into the shared project's SQL editor and run.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.notes (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  pack_id      text        not null,
  question_id  text        not null,
  text         text        not null,
  updated_at   timestamptz not null,
  primary key (user_id, pack_id, question_id)
);

alter table public.notes enable row level security;

create policy "notes: owner can read"   on public.notes for select using (auth.uid() = user_id);
create policy "notes: owner can insert" on public.notes for insert with check (auth.uid() = user_id);
create policy "notes: owner can update" on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes: owner can delete" on public.notes for delete using (auth.uid() = user_id);
