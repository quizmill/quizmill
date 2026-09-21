# quizmill — project notes for Claude Code

Open-source practice-app engine: a **learning pack** (directory of
JSON: manifest + MCQ bank + optional scenarios and concept cards, plus
an `assets/` dir for images) becomes a static, installable,
offline-first practice app. Packs are private by default and typically
authored by a local AI agent via the bundled `create-learning-pack`
skill. Tagline: *the mill that grinds questions into knowledge* — the
mill wheel = the practice loop (answer → review → retry).

## Architecture in one breath

`content/pack/` (gitignored) holds the ACTIVE pack; `scripts/
ensure-pack.ts` seeds it from the committed demo (`content/pack-demo/`,
solar system — deliberately a schema-v2 showcase: levels, exam goal,
games, sources, concepts, images) via the `predev`/`prebuild`/`pretest`
npm hooks, and `npm run pack:use <dir | owner/repo | github URL>` swaps
in a validated real pack — remote sources are fetched by
`scripts/remote-pack.ts` (codeload tarball, then git-clone HTTPS/SSH
fallback, so private repos work). `tools/pack/registry.json` lists
published packs (`npm run pack:list`). `src/config` builds the app
identity from the pack manifest at build time (Next inlines the JSON;
fully static export to `out/`). The PWA icon + webmanifest are generated
from the manifest by `scripts/pack-assets.ts` (gitignored in `public/`),
and `scripts/finalise-build.ts` (the `postbuild` hook) stamps `out/sw.js`
with the cache key + full precache manifest so unvisited routes work
offline.

- `tools/pack/schema.ts` — Zod pack format (schemaVersion **1 or 2**) +
  `validatePack` cross-file checks (unique ids, category/level/scenario/
  concept refs, weights). The validator CLI is the agent contract: loop
  until clean. v1 = exactly 4 options A–D. **v2** relaxes that to 2–6
  options keyed A–F in order and adds: prompt/answer `image`s
  (pack-relative paths under `assets/`, served from `/pack-assets/`);
  optional `concepts.json` teaching cards a question links by
  `conceptId` (surfaced after a wrong answer); optional manifest
  `levels` + `levelsLabel` — a coarse band above `difficulty` that the
  pack names itself (Year, Grade, CEFR) and practice can filter by; and
  a `sources` legend rendered in Settings. v1 packs stay valid
  unchanged. Also additive across both versions: the optional `exam`
  block (readiness goal), `games` block, and `look` default.
  A question carries either `correctKey` (single answer) **or**
  `correctKeys` (2+ answers, "select all that apply"; graded by
  set-equality, all-or-nothing). The runner/UI normalise via
  `correctKeysOf`/`isMultiAnswer` (data.ts) and `gradeSelection`/
  `nextSelection` (runner.ts); attempts persist the choice as a sorted
  comma-joined string (`"A,C"`), so storage/sync/stats are unchanged.
- `src/lib/` — engine: `selection.ts` (unseen-biased pick, seedable,
  ranks repeats rather than re-serving at random), `mistakes.ts` (re-ask
  until rescued; packs use per-question rescue — topic = question id; a
  later correct answer to the SAME question id also rescues, whatever
  topic label either attempt carries, so attempts migrated from older
  engines can't pin themselves to the review queue),
  `readiness.ts` (exam-readiness estimate — latest *cold look* per
  question, coverage-gated, Wilson band, blueprint-weighted by category
  `weight`; drives `ExamReadiness.tsx` on Home + Progress, dormant
  without a pack `exam` block), `stats.ts` (progress aggregates, level
  nudge), `streak.ts` (consecutive practice days), `storage.ts`
  (localStorage, namespaced `quizmill.<packId>.*`; also the analytics
  capture surface — `recordEvent`/`loadEvents`/`amendAttempt`),
  `sync.ts` (backend-agnostic mirror engine; pluggable provider registry
  in `syncBackend.ts` + impls in `src/lib/backends/` — see
  `docs/sync-protocol.md`. Built-ins: `http` (any server speaking the
  sync protocol, sync-key auth — `QM-XXXXX-…`, ~98 bits, partitioned by
  SHA-256(key), see `syncKey.ts`; selected by `NEXT_PUBLIC_SYNC_URL`;
  reference server = Cloudflare Worker+D1 in `cloudflare/`, whose
  canonical deployment answers on **sync.quizmill.dev** and is shared by
  the personal pack apps; a key can carry an optional readable name —
  "Leo", "Dad's key" — mirrored per hashed user id via `GET/POST
  /v1/profile` so a household with several keys knows which is which)
  and `supabase` (`NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY`,
  email-OTP auth — `otp.ts`); `NEXT_PUBLIC_SYNC_BACKEND` picks
  explicitly; dormant without any. Sessions, attempts, achievements,
  votes, notes and events all mirror. `transfer.ts` = serverless file
  export/import of the same data), `useStorage.ts` (React hooks, event
  bus `quizmill:storage`), `theme.ts`/`look.ts` (device appearance:
  colour scheme as a `dark` class, visual style as `data-look="poster"`
  — the quizmill.dev campaign look, palette-remapped via the CSS
  variables in globals.css; packs default it with `look` in pack.json,
  Settings → Style overrides), `speech.ts`/`voice.ts` (Drive Mode — see
  below), `packAssets.ts` (offline images for runtime-inserted packs),
  `install.ts` (Add-to-Home-Screen surface detection).
- `src/pack/` — the app UI: Home, PracticeRunner, ReviewRunner,
  DriveRunner, NotesRunner, runner.ts (pure session logic), data.ts
  (typed pack loader), source.ts (resolves build-time vs runtime pack),
  StickersPage + achievements{,-engine}.ts (sticker cabinet; mastery
  stickers generated per pack category), ProgressPage (CSS-only charts
  over `src/lib/stats.ts`, plus the session dashboard),
  ExamReadiness.tsx, ConceptCard/PackImage/QuestionMeta/category-icon
  (the v2 surfaces), DownvoteBrowser (Settings extra),
  NotesPage (`/notes`: per-question study notes left via NoteRow in the
  answer panel; synced like votes and included in the progress export.
  The `generate-questions-from-notes` skill pulls them from the sync
  backend and authors follow-up questions stamped with the optional
  `generatedFrom {questionId, note}` schema field — shown as a NoteOrigin
  chip in the answer panel, counted as follow-ups on the note cards, and
  practised together at `/practice/notes` via `notes-practice.ts`),
  GamesPage + games/ (reward mini-games — see below),
  CoachPage (`/coach`: parent/tutor replay of any past session, question
  by question with the learner's pick, timing and explanation hidden
  behind a per-question or all-at-once reveal; options are tappable so
  you can answer again together but NOTHING is recorded. Device-level
  opt-in `quizmill.coach.v1` via Settings → Coach mode, which also adds a
  Home card; pure grouping/replay logic in `src/lib/coachSessions.ts`).
  In `src/components/`: InstallPrompt (Add-to-Home-Screen), Scratchpad
  (a collapsible Write/Draw working space in the runners — textarea +
  freehand canvas, expandable full-screen; one pad per pack, kept in
  localStorage and deliberately NOT synced).
- **Drive Mode** (`/drive`, opt-in per device in Settings) — hands-free
  voice practice for the car. `voice.ts` is the pure half (transcript →
  answer/command matching, question → text that reads well aloud),
  `speech.ts` the browser seam over the Web Speech API (mocked wholesale
  in DriveRunner tests). TTS is universal; STT is Chrome/Edge + Safari
  iOS in a *tab only* (dead inside an installed PWA, and network-bound),
  so the runner falls back to tap-to-answer when it's missing. Drive
  sessions carry `mode: 'drive'`; see `docs/investigations/
  carplay-voice-options.md` for why CarPlay itself is out of reach.
- Reward mini-games (opt-in): a pack adds a `games` block to its manifest
  (`{ include? }`, mirrors the optional `exam` block — presence enables;
  `include` narrows the set). Registry `src/lib/games/registry.ts` (id ↔
  `GAME_IDS` in schema.ts), pure logic `src/lib/games/{snake,tilePuzzle,
  pong}.ts`, components `src/pack/games/` (GameShell/HowToPlay/GameModal +
  6 games), route `/games`. The heavy game components are
  `next/dynamic`-imported in GamesPage (loaded only when a game is opened)
  and live only in the /games route chunk — packs without games 404 the
  route and pay nothing. Games are ephemeral (don't touch stats/stickers),
  free to play, and a deliberately HIDDEN easter egg — nothing on Home;
  reached by tapping the version pill in Settings 7× (`GAMES_REVEAL_TAPS`),
  which reveals a panel linking to `/games`. Ported from
  `~/code/personal/learning` (original engine code, not exam content).
- Engine never imports question *shapes* — it sees only the
  denormalised `Attempt`/`Session` fields (`src/data/types.ts`). Those
  now carry optional analytics context (`position`, `firstSelected`,
  `mode`, `scenarioId`, `feedbackSeconds`, `appBuild`; sessions add
  `display`/`platform`) plus a closed-list `AppEvent` type. Every field
  is optional and every consumer reads absent as *unknown*, never zero —
  rows written by pre-analytics builds must keep flowing through
  storage, merge, transfer and the backends untouched.
- **Pack library (insert/eject/swap)** — one installed app plays many
  packs, one active at a time. `/packs` (PacksPage) inserts a pack at
  runtime from files, a bundle `.json`, or a URL (GitHub repo URLs are
  rewritten to raw; validated client-side by the same `validatePack`),
  stores it wholesale in localStorage (`src/lib/packLibrary.ts`, keys in
  `src/lib/packKeys.ts`), and activates it by writing only the
  `quizmill.activePackId` pointer + reloading. An inserted pack records
  an `assetsBase` (its origin's `assets/` dir) so v2 images resolve, and
  `packAssets.ts` prefetches every referenced image into a
  deploy-independent CacheStorage bucket the SW serves cache-first, so
  images survive offline and app updates; packs inserted before v0.3.22
  get an `assetsBase` backfilled on load (`runtime.ts`). `/packs` also
  browses the published-pack registry in-app (`src/lib/packRegistry.ts`
  — website API quizmill.dev/api/registry → raw registry.json on GitHub
  → the copy baked into the build, so it degrades offline). The inline
  bootstrap in `layout.tsx` and `src/pack/runtime.ts` resolve the active
  pack before the engine bundle evaluates — precedence: `#pack=` hash >
  `quizmill.activePack` handoff blob (quizmill-cloud) > library pointer >
  build-time pack. Progress is per pack (`quizmill.<packId>.*`) so
  swapping is free, and EJECT deliberately keeps progress (re-insert to
  resume). Pack-scoped pages (Progress, Stickers, Notes) carry a
  `PackChip` eyebrow naming the active pack, linking to `/packs`.
  Device-level prefs are app-level keys: theme
  `quizmill.theme.v1`, http sync key `quizmill.syncKey.v1` (one learner
  key serves all packs — the server partitions by (user, pack)); legacy
  per-pack values migrate on first read.

## Commands

```
npm run dev                      # demo pack at localhost:3000
npm test                         # vitest unit (507 tests, 44 files)
npm run test:watch               # same, in watch mode
npm run lint                     # eslint (flat config) — 0 errors required
npm run typecheck                # tsc --noEmit
npm run build                    # static export to out/ (+ postbuild SW stamp)
npm run test:e2e                 # build + Puppeteer vs demo pack
npm run pack:validate <dir>      # schema + cross-ref checks
npm run pack:use <dir|owner/repo># validate + activate a pack (local or GitHub)
npm run pack:list                # published packs from the registry
```

## Lineage & boundaries

Extracted (fresh history) from a private multi-variant practice
platform at `~/code/personal/learning` (branch
`feature/learning-packs-poc` was the POC). That repo stays private —
it contains licensed third-party exam content and must never be merged
or mirrored here. Don't copy files from it without checking provenance.

## Status (2026-09-15)

Engine public at `quizmill/quizmill`; CI (`.github/workflows/ci.yml`:
unit → lint → typecheck → build → E2E) green on main. **CLI published**:
`npx quizmill new|validate|run|build|list|upgrade` is live on npm at the
bare name `quizmill` (0.3.27 as of writing, 62 released tags); it's a
zero-dep wrapper in `cli/` that caches the engine in `~/.quizmill/engine`
(override `QUIZMILL_ENGINE` for dev). The npm org `@quizmill` is held but
unused. Domain `quizmill.dev` is delegated to Cloudflare and every
surface runs on it.

Live:

| URL | What | Project |
|---|---|---|
| quizmill.dev | website (repo `quizmill/website`, sibling checkout `../website`) | `quizmill` |
| try.quizmill.dev | demo app, solar-system pack | `quizmill-try` |
| sync.quizmill.dev | the Cloudflare Worker+D1 sync server (`cloudflare/`) | worker |
| claude-cert / claude-cert-pro / aws-arch-pro / aws-genai / world-capitals `.quizmill.dev` | pack apps | one Pages project each |

The website's home is an interactive single page (live practice loop in
the hero, pack→app phone switcher, agent terminal animation);
`/packs` is the pack directory, built live from this repo's
`registry.json` and enriched with each pack's own manifest; and
`/api/registry` serves the registry the app itself browses. Brand is
defined in its README (mill-wheel mark, paper/ink/grain palette,
Fraunces display).

**Deploys are automated.** `.github/workflows/deploy-apps.yml` rebuilds
the engine's own showcase apps (try + world-capitals) on the latest
*published* engine — after every Release, daily at 06:17 UTC, or on
dispatch — pinning the exact version from the newest tag and waiting out
npm propagation. Every other pack app deploys **from its own repo** via
the reusable `.github/workflows/deploy-pack.yml`, so per-app secrets
(Cloudflare, Supabase/sync URL) and private-pack clone credentials stay
in the pack repo; Release fans out a `repository_dispatch` carrying the
new version, and per-repo failures are tolerated (a repo that misses it
rebuilds on its own cron). Don't move a secret-bearing or private pack
into `deploy-apps.yml`. `pr-preview.yml` deploys a Cloudflare Pages
preview of the demo app for every PR.

Real packs — seven public ones in `tools/pack/registry.json`
(`claude-cert`, `claude-cert-pro`, `aws-arch-pro`, `aws-genai`,
`music-theory`, `running-theory`, `world-capitals`), plus one private.
Two carry rules worth keeping in view:

- `quizmill/pack-claude-cert` (PUBLIC) — ~695 CCA-F questions curated
  from MIT-licensed community banks (haytamAroui, Connectry-io) plus a
  later 60-question Purcell practice set and a handful hand-authored
  from Anthropic docs; per-question `sourceRef` attribution + NOTICE.md.
  60 questions from `paullarionov/claude-certified-architect` remain
  EXCLUDED (no upstream license) — don't re-add without a license
  appearing upstream.
- `quizmill/pack-eleven-plus` (PRIVATE — must stay private) — ~1120
  agent-authored english/maths/verbal/**nonverbal** questions across
  four year levels, ids stable from the learning repo. Schema v2
  unblocked the image-based non-verbal bank, which is now ported; GL
  material (© GL Assessment) is still deliberately out.

## Roadmap (agreed, in order)

1. **Finish the pack gallery.** The directory at quizmill.dev/packs
   lists every registry pack, but it only offers the repo + install
   command — and `music-theory` and `running-theory` have no
   `<pack-id>.quizmill.dev` deployment at all. Deploy those two, then
   have the directory link straight to each pack's hosted app.
2. **Pack bundle export.** Import already accepts a single bundle
   `.json` (`packInsert.ts`); there's no tool that *produces* one — add
   it to the CLI so a pack can be handed over as one file.
3. Later ideas: `quizmill deploy` (one-command CF Pages under the
   user's account), FSRS-based spaced repetition (`ts-fsrs`), pack repo
   template (`quizmill/pack-template` with "Use this template"), hosted
   registry at registry.quizmill.dev.

Adjacent, not in this repo: `quizmill/quizmill-cloud` (private) — the
hosted "type a topic → practice app" funnel that generates a pack with
Claude and hands it to the engine through the `quizmill.activePack`
localStorage blob.

## Releases

Semver, label-driven, **tag-only** (`.github/workflows/release.yml`).
Merging a PR into main bumps **patch** by default; label
`release:minor` / `release:major` for bigger bumps, `release:skip`
for none. Versions live in git tags (`vX.Y.Z`) — the package.json
files carry a permanent `0.0.0-dev` sentinel and releases NEVER
commit to main: the workflow computes the next version from the
latest tag, npm-publishes `cli/` at it (version stamped in the CI
workspace only; requires the `NPM_TOKEN` secret — granular automation
token with bypass-2FA), waits for the version to be visible on npm,
tags the merge commit, creates a GitHub release with generated notes,
and fans out an `engine-update` dispatch to the pack repos
(`PACK_DISPATCH_TOKEN`). Direct pushes to main never release —
use the workflow's manual dispatch to release accumulated commits.
The in-app version comes from `git describe` at build time
(NEXT_PUBLIC_APP_VERSION overrides; package.json sentinel as the
last-ditch fallback); the SW cache key appends the git SHA so updates
are detected on every commit regardless.

## Conventions

- Run `npm run lint` and `npm run typecheck` before pushing — both run
  in CI (after the unit tests) and a lint **error** or a type error
  fails the build. Lint **warnings** are allowed (the newer react-hooks
  rules are warn-level on purpose); don't reach for `eslint-disable` to
  silence a real error without a one-line reason. ESLint config lives in
  `eslint.config.mjs` (flat config).
- Tests accompany behaviour changes; E2E asserts against the demo pack
  (if a different pack is active locally, `rm -rf content/pack` and
  re-run to reseed before E2E). E2E specs live in `tests/e2e-pack/`
  and run under `vitest.e2e.config.ts`.
- **Bug fixes are red→green**: first write a failing test that
  reproduces the bug (confirm it's red), then fix until it's green —
  don't fix first and add a test after. React component bugs (effects,
  state) can be exercised with happy-dom render tests under
  `tests/*.test.tsx`; pure logic stays in node `tests/*.test.ts`.
- **Always open a PR** for a finished change (`gh`/GitHub MCP) —
  unconditionally, without being asked: push the branch, then create the
  PR.
- **New user-facing features ship with visuals.** Any change that adds or
  alters UI must include screenshots in the PR (and surfaced in chat).
  Capture them from the real static build against the demo pack: `npm run
  build`, serve `out/` (`npx http-server out -p <port> -s -c-1`), then drive
  Puppeteer at a phone viewport (414×896, `deviceScaleFactor: 2`) seeding
  `localStorage` for the state you want — same harness as `tests/e2e/`.
  Commit the PNGs under `docs/screenshots/<feature>/` and embed them in the
  PR via `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. Show each
  meaningful state (e.g. empty / in-progress / complete), not just one.
- Question ids are immutable once published — attempt history points
  at them.
- Pack schema changes bump `schemaVersion` and must stay
  backward-readable. The same applies to engine records: new
  `Attempt`/`Session`/`AppEvent` fields are optional, and absent must
  read as *unknown*, never as zero.
- Always open a PR and push the branch up (so a preview env is
  created) when finishing a session's work, unless the user explicitly
  says not to.
