# quizmill architecture tour

*Moved out of `CLAUDE.md` on 2026-10-11 so the instructions file could
stay short. This is a snapshot of the per-module design rationale as it
stood then and is **not** maintained line by line — the code and tests
are the source of truth for current behaviour. If you change a decision
recorded here, fix or delete the paragraph; don't add new feature tours
— put rationale in a comment next to the code or in a
`docs/investigations/` note.*

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
offline (`scripts/app-version.ts` is the one reader of the release tag
and short SHA that next.config.ts, finalise-build and the bundler share).

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
  block (readiness goal), `games` block, `progression` block (opt-in
  XP/levels — see `xp.ts` below), and `look` default.
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
  nudge), `streak.ts` (consecutive practice days — deliberately
  forgiving: one missed day per 7 is bridged by an automatic grace day,
  and `longestStreak` keeps a best-ever record a lapse can't erase;
  anti-loss-aversion choices for kids, not growth hacks), `xp.ts` +
  `progressionPref.ts` (XP/levels for packs with a manifest
  `progression` block — XP is a pure derivation over attempts like
  everything else: nothing stored/synced, retroactive credit,
  mastery-weighted so re-answering known questions pays only a token
  point, a BOUNDED mill-themed ladder scaled to the bank (top rank ≈
  first-correcting the bank; auxiliary XP means it lands near ~80%
  coverage, deliberately a touch generous), and deliberately no
  notifications, no randomness, no spendable currency; level crossings
  persist as opaque `level-N` rows in the achievements store so sync +
  celebrate-once come free — `recordLevelCrossings` in
  `src/pack/useLevelUp.ts` is the single recorder and EVERY
  attempt-producing path must reach it (visual runners via the hook,
  Drive silently, imported/synced history via the ProgressCard effect);
  `progressionPref` is the device-level parent off-switch in Settings →
  Levels & XP, which hides UI but never stops recording), `storage.ts`
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
  /v1/profile` so a household with several keys knows which is which;
  `npm run sync:report` — `cloudflare/scripts/events-report.ts` over the
  pure `cloudflare/src/report.ts` — is the operator's read-only Markdown
  view of that database: per pack learners, 7d/30d active, sessions,
  attempts, mistakes rescued/open, events by type, plus the funnel
  summary where the analytics route is deployed; runs through
  `wrangler d1 execute`, aggregate-only output, deliberately no endpoint)
  and `supabase` (`NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY`,
  email-OTP auth — `otp.ts`); `NEXT_PUBLIC_SYNC_BACKEND` picks
  explicitly; dormant without any. Sessions, attempts, achievements,
  votes, notes and events all mirror. `transfer.ts` = serverless file
  export/import of the same data), `analytics.ts` (anonymous first-party
  FUNNEL beacon — `navigator.sendBeacon` of `{event, packId, deviceId,
  appBuild, ts}` to `NEXT_PUBLIC_ANALYTICS_URL`, dormant without it like
  sync; one more subscriber on the storage mutation bus, so it beacons
  the closed `FUNNEL_EVENTS` subset of whatever `recordEvent` captures
  and DERIVES `first_answer`/`session_10` from attempts/sessions rows —
  every answer-producing path counts without instrumentation; `upsell_*`
  come from UpgradeCard, `bundle_inserted` from PacksPage. `deviceId` is
  an app-level UUID (`quizmill.deviceId.v1`), regenerable via the
  Settings → Usage analytics card which also holds the off switch
  (`quizmill.analytics.v1`, default on) and links
  `NEXT_PUBLIC_PRIVACY_URL`; the card only renders in configured builds.
  Receiver = `POST /v1/analytics` + `GET /v1/analytics/summary` on the
  sync worker, `cloudflare/src/analytics.ts` + the `analytics_events`
  table — never joined to sync rows), `useStorage.ts` (React hooks, event
  bus `quizmill:storage`), `theme.ts`/`look.ts` (device appearance:
  colour scheme as a `dark` class, visual style as `data-look="poster"`
  — the quizmill.dev campaign look, palette-remapped via the CSS
  variables in globals.css; packs default it with `look` in pack.json,
  Settings → Style overrides), `speech.ts`/`voice.ts` (Drive Mode — see
  below), `packAssets.ts` (offline images for runtime-inserted packs),
  `install.ts` (Add-to-Home-Screen surface detection), `devicePref.ts`
  (the one load/save/notify engine behind every device-level switch —
  theme, look, progressionPref, coach, paper, the analytics off switch:
  SSR guard, try/catch, change event, legacy-key promotion, and a refused
  write honoured in memory for the rest of the page; a new switch
  declares key/event/parse/serialise/fallback and nothing else, and its
  hook is `useDevicePref(pref, apply?)` from `useDevicePref.ts`, which
  `useTheme`/`useLook` share).
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
  CoachPage (`/coach`: parent/tutor replay of any past session — or a
  whole day across its sessions (`#day=`) — question by question with
  the learner's pick, timing, explanation and the history of earlier
  attempts at that question hidden behind a per-question or all-at-once
  reveal; a Mistakes-only filter; options are tappable so you can answer
  again together but NOTHING is recorded. Device-level
  opt-in `quizmill.coach.v1` via Settings → Coach mode, which also adds a
  Home card; pure grouping/replay logic in `src/lib/coachSessions.ts`),
  PaperPage + PaperMarkPage + paper.ts (`/paper`: print-a-worksheet
  practice — a sheet composed by the normal selection engine, printed
  (or saved as PDF from the same dialog) with write-in answer boxes and
  a QR deep-linking to `/paper/mark` with the whole question list in the
  fragment, so any device with the pack active can tap-to-mark it back
  in; marking writes a `mode: 'paper'` session + attempts with
  DETERMINISTIC ids derived from the sheet id, so re-marking upserts
  instead of double-counting, and streak/mistakes/readiness/stickers
  pick it up untouched. A sheet can be marked in BATCHES (a few
  questions today, the rest tomorrow): re-opening shows rows the sheet
  already has as settled "Answered previously" cards (no letters to tap
  until "Change"; a stored answer can be corrected but never blanked),
  read LIVE from storage so a batch entered on another device appears
  when sync pulls it — `savedMarksForSheet`/`markStatus` in paper.ts.
  Save writes only new + corrected rows (the button counts just those)
  and rows from an earlier batch keep their own `answeredAt`, so streak
  credit never moves. `SaveDestination` (+ `useSyncIdentity`) says whose
  progress the answers land in — the key's name, "not linked" with a
  deep link to `/settings/#sync`, or "this device only" — because the
  QR opens in whatever browser the camera picks, which may not hold the
  learner's sync key. The session is dated by its earliest
  ANSWER (marking time), never the print time — a sheet printed Tuesday
  and sat Sunday is Sunday's practice — and `questionCount` is the
  answers actually marked, so Coach/Progress/streaks agree on the
  score. The saved screen's "Review the mistakes together" opens the
  review runner SCOPED to the sheet (`/practice/review/#session=<sheet
  id>`, `sessionMistakeIds`: that session's unresolved mistakes in sheet
  order — the plain queue is oldest-first across all history and would
  open on unrelated questions). The sheet screen also prints a coach's
  ANSWER KEY (same numbering, correct letters, explanations, linked
  concept cards; no QR) as a separate printout. Sheets live locally
  (`quizmill.<packId>.paperSheets.v1`, deliberately not synced — the QR
  payload IS the cross-device transport: `/paper/#s=<payload>` and
  `/paper/mark/#s=<payload>` both ADOPT the sheet into the opening
  device's list via `adoptPaperSheet`, so one scan is enough to mark,
  re-mark and print the answer key there); device
  opt-in `quizmill.paper.v1` like Coach; print CSS gated on
  `body[data-paper-print]` in globals.css; design notes in
  `docs/investigations/paper-practice.md`). No printer: `/paper/#write=
  <sheet id>` (PaperWriteView + paperInk.ts) shows the same sheet as one
  long page to WRITE on with a pencil or finger — a roomier `variant=
  "screen"` of the print layout under a free-ink SVG overlay (not a
  canvas: a long page blows iOS's canvas size limit), laid out at ONE
  fixed width pinned by the first stroke and scaled to the viewport, so
  ink stays on its question through rotation/reload. A stylus always
  writes; a finger writes or scrolls per a toolbar toggle that the first
  stylus contact flips to "scrolls" (two fingers scroll while fingers
  write; touches are ignored while the stylus is down). Ink is vector
  strokes per sheet in localStorage (`quizmill.<packId>.paperInk.v1.
  <sheet id>`, NOT synced — whoever enters the answers looks at this
  screen, as with a printout) and the foot of the page carries the same
  marking QR.
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
  and live only in the /games route chunk. The route exists in EVERY
  build and GamesPage gates on the ACTIVE pack's `games` block at render
  time (a pack without games gets a "No games in this pack" card) — the
  static export prerenders once, so a build-time `notFound()` left the
  route dead for a pack with games swapped in at runtime via the pack
  library. Games are ephemeral (don't touch stats/stickers),
  free to play, and a deliberately HIDDEN easter egg — nothing on Home;
  reached by tapping the version pill in Settings 7× (`GAMES_REVEAL_TAPS`),
  which reveals a panel linking to `/games`; the find is remembered on the
  device (`quizmill.gamesRevealed.v1`, `src/lib/gamesReveal.ts`, with a
  "Hide again" on the panel) so the arcade is there on the next visit.
  Pong's serve angle, like snake's food and the puzzle shuffle, comes from
  an injected `rng` (default `Math.random`) so tests can pin it. Ported from
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
  build-time pack. Every route is still PRERENDERED from the build-time
  pack, so when a runtime pack wins (`isRuntimePack` in `source.ts`)
  `RuntimePackBoundary` (wrapped around the layout's children) adopts the
  prerendered markup verbatim for the hydration pass and swaps the live
  tree in before paint — otherwise every hard load of a pack-scoped page
  logged React #418. Progress is per pack (`quizmill.<packId>.*`) so
  swapping is free, and EJECT deliberately keeps progress (re-insert to
  resume). Pack-scoped pages (Progress, Stickers, Notes) carry a
  `PackChip` eyebrow naming the active pack, linking to `/packs`.
  Device-level prefs are app-level keys: theme
  `quizmill.theme.v1`, http sync key `quizmill.syncKey.v1` (one learner
  key serves all packs — the server partitions by (user, pack)); legacy
  per-pack values migrate on first read.
