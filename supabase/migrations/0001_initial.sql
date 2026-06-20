-- ─────────────────────────────────────────────────────────────────────
-- quizmill — initial schema for cloud sync.
--
-- Mirrors the localStorage shapes used by the client so the JS sync
-- layer can map one-to-one. Each row has a `user_id` column that
-- references `auth.users(id)` and is locked down by Row Level Security
-- so a signed-in user only ever sees their own rows.
--
-- HOW TO APPLY:
--   1. Create a new Supabase project at https://supabase.com/dashboard
--   2. Open the project's SQL editor
--   3. Paste this whole file and run it.
--   4. Project Settings → API: copy "Project URL" and the publishable
--      key into .env.local as NEXT_PUBLIC_SUPABASE_URL and
--      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see README).
-- ─────────────────────────────────────────────────────────────────────

-- ── Sessions ──────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id              uuid        primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  subject         text        not null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  question_count  int         not null,
  correct_count   int         not null,
  mode            text        not null default 'practice' check (mode in ('practice','review'))
);
create index if not exists sessions_user_started
  on public.sessions (user_id, started_at desc);

alter table public.sessions enable row level security;

create policy "sessions: owner can read"   on public.sessions for select using (auth.uid() = user_id);
create policy "sessions: owner can insert" on public.sessions for insert with check (auth.uid() = user_id);
create policy "sessions: owner can update" on public.sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "sessions: owner can delete" on public.sessions for delete using (auth.uid() = user_id);

-- ── Attempts ──────────────────────────────────────────────────────────
create table if not exists public.attempts (
  id                   uuid        primary key,
  user_id              uuid        not null references auth.users(id) on delete cascade,
  session_id           uuid        not null,
  question_id          text        not null,
  answered_at          timestamptz not null,
  selected_answer      text        not null,
  is_correct           boolean     not null,
  time_taken_seconds   int         not null,
  subject              text        not null,
  topic                text        not null,
  difficulty           int         not null
);
create index if not exists attempts_user_answered
  on public.attempts (user_id, answered_at desc);
create index if not exists attempts_session
  on public.attempts (session_id);

alter table public.attempts enable row level security;

create policy "attempts: owner can read"   on public.attempts for select using (auth.uid() = user_id);
create policy "attempts: owner can insert" on public.attempts for insert with check (auth.uid() = user_id);
create policy "attempts: owner can update" on public.attempts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "attempts: owner can delete" on public.attempts for delete using (auth.uid() = user_id);

-- ── Achievements (earned stickers) ────────────────────────────────────
create table if not exists public.achievements (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  achievement_id  text        not null,
  earned_at       timestamptz not null,
  primary key (user_id, achievement_id)
);

alter table public.achievements enable row level security;

-- Write-once by design: an achievement's earned_at never changes, so the
-- client syncs it with ON CONFLICT DO NOTHING (ignoreDuplicates) and there is
-- deliberately NO update policy. Don't add one — an upsert-as-update would be
-- the only thing that needs it, and that path is intentionally avoided.
create policy "achievements: owner can read"   on public.achievements for select using (auth.uid() = user_id);
create policy "achievements: owner can insert" on public.achievements for insert with check (auth.uid() = user_id);
create policy "achievements: owner can delete" on public.achievements for delete using (auth.uid() = user_id);

-- ── Per-question votes ────────────────────────────────────────────────
create table if not exists public.votes (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  question_id  text        not null,
  vote         text        not null check (vote in ('up','down')),
  comment      text,
  voted_at     timestamptz not null,
  primary key (user_id, question_id)
);

alter table public.votes enable row level security;

create policy "votes: owner can read"   on public.votes for select using (auth.uid() = user_id);
create policy "votes: owner can insert" on public.votes for insert with check (auth.uid() = user_id);
create policy "votes: owner can update" on public.votes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "votes: owner can delete" on public.votes for delete using (auth.uid() = user_id);

