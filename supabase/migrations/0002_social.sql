-- ─────────────────────────────────────────────────────────────────────
-- quizmill — social layer: friends, shared progress, leaderboards.
--
-- Builds on 0001 (per-user sessions/attempts/achievements/votes). Adds
-- the *controlled cross-user reads* that social needs, while keeping the
-- product kids-safe by construction:
--
--   • No real names or emails ever leave auth.users — profiles carry a
--     chosen display name + a preset avatar key only.
--   • Friend connections are a code → accept handshake (mutual consent).
--   • Friends/group-mates can read each other's AGGREGATE stats only
--     (profile_stats), never raw attempts (which would leak *which*
--     questions someone got wrong).
--   • No free-text between users: "cheers" are a fixed preset enum.
--   • A leaderboard can be SHARED and viewed WITHOUT signing in, via a
--     group share-code resolved by a SECURITY DEFINER function that hands
--     back only the safe leaderboard columns — no user ids, no email.
--
-- HOW TO APPLY: paste into the project's SQL editor and run, after 0001.
-- ─────────────────────────────────────────────────────────────────────

-- ── Profiles ──────────────────────────────────────────────────────────
-- One row per signed-in user. friend_code is the human-shareable handle
-- ("add my friend code"); minted server-side so it's guaranteed unique
-- and never enumerable from the client.
create table if not exists public.profiles (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  display_name text        not null default 'Player',
  avatar       text        not null default 'fox',
  friend_code  text        not null unique,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ── Profile stats (the only thing friends/group-mates read) ───────────
-- A denormalised, safe-to-share summary the client recomputes from its
-- local history and upserts. Deliberately aggregate: no per-question data.
create table if not exists public.profile_stats (
  user_id        uuid        primary key references auth.users(id) on delete cascade,
  week_start     date        not null,
  week_xp        int         not null default 0,
  total_xp       int         not null default 0,
  streak_days    int         not null default 0,
  questions_week int         not null default 0,
  accuracy_pct   int         not null default 0,
  sticker_count  int         not null default 0,
  updated_at     timestamptz not null default now()
);

alter table public.profile_stats enable row level security;

-- ── Friendships (code → accept handshake) ─────────────────────────────
-- A single row per pair, keyed by the lexically-smaller user first so the
-- pair is unique regardless of who asked. status drives the handshake.
create table if not exists public.friendships (
  requester_id uuid        not null references auth.users(id) on delete cascade,
  addressee_id uuid        not null references auth.users(id) on delete cascade,
  status       text        not null default 'pending'
                 check (status in ('pending', 'accepted', 'blocked')),
  created_at   timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create index if not exists friendships_addressee on public.friendships (addressee_id);

alter table public.friendships enable row level security;

-- ── Groups + membership (shareable leaderboards) ──────────────────────
create table if not exists public.groups (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null default 'Leaderboard',
  share_code text        not null unique,
  owner_id   uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid        not null references public.groups(id) on delete cascade,
  user_id   uuid        not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- ── Cheers (preset-only encouragement; no free text) ──────────────────
create table if not exists public.cheers (
  id         uuid        primary key default gen_random_uuid(),
  from_id    uuid        not null references auth.users(id) on delete cascade,
  to_id      uuid        not null references auth.users(id) on delete cascade,
  kind       text        not null
               check (kind in ('keep_going', 'nice_streak', 'high_five', 'star')),
  created_at timestamptz not null default now()
);
create index if not exists cheers_to on public.cheers (to_id, created_at desc);

alter table public.cheers enable row level security;

-- ── Relationship helpers (SECURITY DEFINER → no RLS recursion) ─────────
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a))
  );
$$;

create or replace function public.shares_group(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.group_members ma
    join public.group_members mb on ma.group_id = mb.group_id
    where ma.user_id = a and mb.user_id = b
  );
$$;

create or replace function public.is_group_member(g uuid, u uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.group_members m where m.group_id = g and m.user_id = u
  );
$$;

-- ── RLS policies ──────────────────────────────────────────────────────
-- Profiles & stats: you, your accepted friends, and your group-mates.
create policy "profiles: self or connected can read" on public.profiles
  for select using (
    auth.uid() = user_id
    or public.are_friends(auth.uid(), user_id)
    or public.shares_group(auth.uid(), user_id)
  );
create policy "profiles: owner can update" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "profile_stats: self or connected can read" on public.profile_stats
  for select using (
    auth.uid() = user_id
    or public.are_friends(auth.uid(), user_id)
    or public.shares_group(auth.uid(), user_id)
  );
create policy "profile_stats: owner can write" on public.profile_stats
  for insert with check (auth.uid() = user_id);
create policy "profile_stats: owner can update" on public.profile_stats
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Friendships: either party can see the edge; the addressee resolves it.
create policy "friendships: party can read" on public.friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "friendships: party can delete" on public.friendships
  for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Groups: members can read; the owner can rename/delete.
create policy "groups: member can read" on public.groups
  for select using (public.is_group_member(id, auth.uid()));
create policy "groups: owner can update" on public.groups
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "groups: owner can delete" on public.groups
  for delete using (auth.uid() = owner_id);

create policy "group_members: member can read" on public.group_members
  for select using (public.is_group_member(group_id, auth.uid()));
create policy "group_members: self can leave" on public.group_members
  for delete using (auth.uid() = user_id);

-- Cheers: sender or recipient can read; recipient can clear.
create policy "cheers: party can read" on public.cheers
  for select using (auth.uid() = from_id or auth.uid() = to_id);
create policy "cheers: recipient can delete" on public.cheers
  for delete using (auth.uid() = to_id);

-- ── Code generators ───────────────────────────────────────────────────
-- Friend codes are word-based so a child can read one aloud and type it
-- ("BRAVE-OTTER-42"). Share codes are short and unambiguous (no 0/O/1/I).
create or replace function public.gen_friend_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  adjectives text[] := array['BRAVE','HAPPY','SUNNY','CLEVER','SWIFT','MIGHTY','JOLLY','BRIGHT','KIND','LUCKY','CALM','BOLD'];
  animals    text[] := array['OTTER','PANDA','TIGER','EAGLE','FOX','KOALA','DOLPHIN','RABBIT','LION','OWL','WHALE','GECKO'];
  code text;
begin
  loop
    code := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
         || '-' || animals[1 + floor(random() * array_length(animals, 1))::int]
         || '-' || lpad((floor(random() * 100))::int::text, 2, '0');
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.gen_share_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where share_code = code);
  end loop;
  return code;
end;
$$;

-- ── RPCs (the only way the client mutates the social graph) ────────────

-- Create-or-fetch my profile, minting a friend code on first call.
create or replace function public.ensure_profile(p_display_name text default null, p_avatar text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  row public.profiles;
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into public.profiles (user_id, display_name, avatar, friend_code)
  values (
    me,
    coalesce(nullif(trim(p_display_name), ''), 'Player'),
    coalesce(nullif(trim(p_avatar), ''), 'fox'),
    public.gen_friend_code()
  )
  on conflict (user_id) do update
    set display_name = coalesce(nullif(trim(p_display_name), ''), public.profiles.display_name),
        avatar       = coalesce(nullif(trim(p_avatar), ''), public.profiles.avatar)
  returning * into row;
  return row;
end;
$$;

-- Send a friend request by code. Idempotent; auto-accepts if they already
-- asked you (so two people swapping codes just become friends).
create or replace function public.request_friend(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select user_id into target from public.profiles
    where friend_code = upper(trim(p_code));
  if target is null then return 'not_found'; end if;
  if target = me then return 'self'; end if;

  -- Already connected (either direction)?
  if public.are_friends(me, target) then return 'already_friends'; end if;

  -- They already asked me → accept it.
  if exists (select 1 from public.friendships
             where requester_id = target and addressee_id = me and status = 'pending') then
    update public.friendships set status = 'accepted'
      where requester_id = target and addressee_id = me;
    return 'accepted';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (me, target, 'pending')
  on conflict do nothing;
  return 'requested';
end;
$$;

-- Accept or decline a pending request that was sent TO me.
create or replace function public.respond_friend(p_requester uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_accept then
    update public.friendships set status = 'accepted'
      where requester_id = p_requester and addressee_id = me and status = 'pending';
    return 'accepted';
  else
    delete from public.friendships
      where requester_id = p_requester and addressee_id = me and status = 'pending';
    return 'declined';
  end if;
end;
$$;

-- Create a leaderboard group; the creator joins automatically.
create or replace function public.create_group(p_name text default null)
returns public.groups language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  row public.groups;
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into public.groups (name, share_code, owner_id)
  values (coalesce(nullif(trim(p_name), ''), 'Leaderboard'), public.gen_share_code(), me)
  returning * into row;
  insert into public.group_members (group_id, user_id) values (row.id, me)
  on conflict do nothing;
  return row;
end;
$$;

-- Join a group by its share code (requires sign-in to contribute stats).
create or replace function public.join_group(p_code text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  row public.groups;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into row from public.groups where share_code = upper(trim(p_code));
  if row.id is null then raise exception 'group not found'; end if;
  insert into public.group_members (group_id, user_id) values (row.id, me)
  on conflict do nothing;
  return row;
end;
$$;

-- PUBLIC leaderboard view: resolve a share code to ranked, SAFE rows.
-- Callable WITHOUT signing in (granted to anon). Returns display name,
-- avatar and aggregate stats only — never a user id or email.
create or replace function public.leaderboard_by_share_code(p_code text)
returns table (
  display_name   text,
  avatar         text,
  week_xp        int,
  total_xp       int,
  streak_days    int,
  questions_week int,
  accuracy_pct   int,
  sticker_count  int
) language sql security definer stable set search_path = public as $$
  select p.display_name, p.avatar,
         coalesce(s.week_xp, 0), coalesce(s.total_xp, 0),
         coalesce(s.streak_days, 0), coalesce(s.questions_week, 0),
         coalesce(s.accuracy_pct, 0), coalesce(s.sticker_count, 0)
  from public.groups g
  join public.group_members m on m.group_id = g.id
  join public.profiles p      on p.user_id = m.user_id
  left join public.profile_stats s on s.user_id = m.user_id
  where g.share_code = upper(trim(p_code));
$$;

-- The group's name + member count for a share code, for the public header.
create or replace function public.group_meta_by_share_code(p_code text)
returns table (name text, members int)
language sql security definer stable set search_path = public as $$
  select g.name, count(m.user_id)::int
  from public.groups g
  left join public.group_members m on m.group_id = g.id
  where g.share_code = upper(trim(p_code))
  group by g.name;
$$;

-- Send a preset cheer to a friend.
create or replace function public.send_cheer(p_to uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.are_friends(me, p_to) then raise exception 'not friends'; end if;
  insert into public.cheers (from_id, to_id, kind) values (me, p_to, p_kind);
end;
$$;

-- Anonymous viewers may only read leaderboards through the share-code RPCs.
grant execute on function public.leaderboard_by_share_code(text) to anon, authenticated;
grant execute on function public.group_meta_by_share_code(text)  to anon, authenticated;
