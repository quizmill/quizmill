# Social layer — friends, leaderboards, cheers

Optional, opt-in social features layered on top of the existing cloud-sync
plumbing. **Dormant unless a Supabase project is configured** (same switch as
sync: the `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
env vars). Pure-local builds are completely unchanged — the Friends nav entry
and pages don't even render.

## What it does

- **Friend code → accept handshake.** Each player gets a memorable code
  (`BRAVE-OTTER-42`). "Add a friend" by code creates a pending request the
  other player accepts. Swapping codes both ways auto-connects.
- **Shared progress + weekly leaderboard.** Friends see each other's
  *aggregate* stats only (XP, streak, questions this week, accuracy, sticker
  count) — never raw answers. Ranked by **weekly XP**, which **resets every
  Monday** so nobody is permanently buried.
- **Effort-weighted XP.** Points for answering (`+10`) with a correctness
  bonus (`+5`), so practising hard keeps you competitive with a naturally
  strong player — better for kids' motivation.
- **Shareable leaderboard (no sign-in to view).** A "group" has a 6-char
  share code; `/leaderboard?code=XXXXXX` renders the standings for *anyone*
  with the link, resolved through a `security definer` RPC that returns
  name + avatar + aggregate numbers only (no user id, no email).
- **Cheers.** Preset-only encouragement (🔥 ⚡ 🙌 ⭐) — no free text, so there's
  no moderation/safety surface. Kids-safe by construction.

## Architecture

- `supabase/migrations/0002_social.sql` — tables (`profiles`,
  `profile_stats`, `friendships`, `groups`, `group_members`, `cheers`), RLS
  (you + accepted friends + group-mates can read aggregate stats), and the
  `security definer` RPCs that are the *only* way the client mutates the
  social graph (so an accepted edge can't be forged client-side).
- `src/lib/friend-code.ts` — normalise/validate typed codes (server mints the
  canonical ones).
- `src/lib/social-stats.ts` — pure XP / streak / weekly summary from local
  history (the `profile_stats` payload).
- `src/lib/leaderboard.ts` — pure ranking (weekly XP, tie-break streak→name).
- `src/lib/social.ts` — dormant-safe client wrapper over the RPCs.
- `src/components/SocialBootstrap.tsx` — mirrors a signed-in player's stats
  up shortly after local writes settle, so friends' boards stay fresh.
- `src/pack/FriendsPage.tsx` (`/friends`) and `src/pack/LeaderboardPage.tsx`
  (`/leaderboard`, public).

## Turning it on (manual — needs dashboard access)

1. **Supabase project.** Create one (or reuse the sync project). Apply
   `0001_initial.sql` then `0002_social.sql` in the SQL editor.
2. **Auth redirect URLs.** In Auth → URL Configuration, add the app origins
   that should be able to sign in (e.g. `https://try.quizmill.dev` and the
   branch preview URL `https://<branch>.quizmill-try.pages.dev`).
3. **Repo secrets** (Settings → Secrets and variables → Actions):
   - `TRY_SUPABASE_URL` — the project URL.
   - `TRY_SUPABASE_PUBLISHABLE_KEY` — the publishable (anon) key. Safe to
     expose; it's the browser key, locked down by RLS.
   - `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — already used by
     `deploy-apps.yml`; the preview workflow reuses them.
4. **Deploy.**
   - Production try app: `deploy-apps.yml` now builds the `try` matrix row
     with the Supabase env, so the next run lights social up on
     try.quizmill.dev.
   - Branch preview: `deploy-preview.yml` builds *this branch's* tree and
     deploys it to a Cloudflare preview URL on every push to `claude/**`.
