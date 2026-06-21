-- ─────────────────────────────────────────────────────────────────────
-- quizmill — "starred questions" for the review-and-refine flow.
--
-- A learner can star a question to come back to it: study the material
-- around it and practise follow-up questions on the same topics. Mirrors
-- the localStorage `StarredQuestion` shape so the JS sync layer maps
-- one-to-one, with the same per-user Row Level Security as the rest.
--
-- HOW TO APPLY: run this in the project's SQL editor after 0001_initial.sql
-- (existing projects), or apply both in order on a fresh project.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.stars (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  question_id  text        not null,
  starred_at   timestamptz not null,
  primary key (user_id, question_id)
);

alter table public.stars enable row level security;

-- Write-once existence record: starred_at is preserved client-side, so the
-- client syncs with ON CONFLICT DO NOTHING (ignoreDuplicates) and there is
-- deliberately NO update policy — same reasoning as the achievements table.
create policy "stars: owner can read"   on public.stars for select using (auth.uid() = user_id);
create policy "stars: owner can insert" on public.stars for insert with check (auth.uid() = user_id);
create policy "stars: owner can delete" on public.stars for delete using (auth.uid() = user_id);
