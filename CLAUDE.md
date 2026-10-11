# quizmill — project notes for Claude Code

Open-source practice-app engine: a **learning pack** (directory of
JSON: manifest + MCQ bank + optional scenarios and concept cards, plus
an `assets/` dir for images) becomes a static, installable,
offline-first practice app. Packs are private by default and typically
authored by a local AI agent via the bundled `create-learning-pack`
skill. Tagline: *the mill that grinds questions into knowledge* — the
mill wheel = the practice loop (answer → review → retry).

This file holds only what you can't read off the code: boundaries,
invariants, workflow. Code and tests are the source of truth for how
things work. Don't add feature tours here; put rationale next to the
code or in `docs/investigations/`.

## Where things live

- `content/pack/` (gitignored) — the ACTIVE pack. `scripts/ensure-pack.ts`
  seeds it from the committed demo `content/pack-demo/` (solar system, a
  schema-v2 showcase) via the `predev`/`prebuild`/`pretest` hooks;
  `npm run pack:use <dir | owner/repo | URL>` swaps in a validated pack.
- `tools/pack/` — `schema.ts` (Zod pack format, schemaVersion 2 only, and
  `validatePack` cross-file checks; the validator CLI is the contract an
  authoring agent loops against), `registry.json` (published packs),
  `bundle.ts` (one-file pack export).
- `src/lib/` — the engine: pure derivations over attempts (selection,
  mistakes, readiness, stats, streak, XP), storage + sync + analytics,
  device prefs, browser seams (speech, install, pack assets).
- `src/pack/` — the app UI (Home, runners, Progress, Stickers, Notes,
  Coach, Paper, Games) and `runner.ts`/`data.ts`/`source.ts`/`runtime.ts`
  (pure session logic, typed pack loader, build-time vs runtime pack).
- `src/components/` — shared UI and Settings. `src/config` — app identity
  from the manifest at build time (fully static export to `out/`).
- `scripts/` — build hooks: pack icon/webmanifest, service-worker precache
  stamp, the one reader of the release tag (`app-version.ts`).
- `cloudflare/` — reference sync server (Worker + D1) behind
  sync.quizmill.dev; protocol in `docs/sync-protocol.md`.
- `cli/` — the zero-dep `quizmill` npm wrapper (caches the engine in
  `~/.quizmill/engine`; `QUIZMILL_ENGINE` overrides for dev).
- `.claude/skills/` — pack-authoring skills shipped with the engine.

## Invariants — don't break these

- **Question ids are immutable once published**; attempt history points
  at them.
- **The validator accepts exactly one `schemaVersion` (2) and is strict
  about it**; v1 was dropped, not kept readable. New manifest blocks are
  optional and additive so the number only moves when a shape has to
  change — and a bump must then keep reading 2.
- **Engine records too**: new `Attempt`/`Session`/`AppEvent` fields are
  optional and absent reads as *unknown*, never zero. Rows from older
  builds must flow through storage, merge, transfer and the backends
  untouched. The engine never imports question shapes — only the
  denormalised fields in `src/data/types.ts`.
- **Everything is derived from attempts.** XP, readiness, streaks, stats
  and sticker eligibility are pure functions over stored attempts —
  nothing extra is stored or synced, with ONE exception: the achievements
  store. Earned stickers and `level-N` level crossings persist as rows
  (synced like attempts) so celebrate-once and sync come free.
  `recordNewAchievements` (`src/pack/useAchievementUnlock.ts`) and
  `recordLevelCrossings` (`src/pack/useLevelUp.ts`) are the only
  recorders; EVERY attempt-producing path must reach `recordLevelCrossings`
  (runners via the hooks, Drive silently, imported/synced history via
  the ProgressCard effect), and every runner must call the sticker
  recorder too. Never bypass or remove that persistence.
- **Storage is per pack** (`quizmill.<packId>.*`); device-level switches
  are app-level keys (`quizmill.<name>.v1`) and go through
  `src/lib/devicePref.ts` + `useDevicePref` — a new switch declares
  key/event/parse/serialise/fallback and nothing else. Device opt-ins hide
  UI; they never stop recording.
- **Every route exists in every build** and gates on the ACTIVE pack at
  render time (the static export prerenders once; the pack library can
  swap a different pack in at runtime). No build-time `notFound()`.
- **Sync and analytics are dormant without their env vars**, and analytics
  rows are never joined to sync rows.
- **Mistakes are rescued per question id**, whatever topic label an
  attempt carries. Paper marking writes DETERMINISTIC attempt ids derived
  from the sheet id so re-marking upserts instead of double-counting.

## Commands

```
npm run dev                      # demo pack at localhost:3000
npm test                         # vitest unit
npm run test:watch               # same, in watch mode
npm run lint                     # eslint (flat config) — 0 errors required
npm run typecheck                # tsc --noEmit
npm run build                    # static export to out/ (+ postbuild SW stamp)
npm run test:e2e                 # build + Puppeteer vs demo pack
npm run pack:validate <dir>      # schema + cross-ref checks
npm run pack:use <dir|owner/repo># validate + activate a pack (local or GitHub)
npm run pack:list                # published packs from the registry
npm run sync:report -- --remote  # Markdown usage report over the sync D1 (wrangler login)
```

## Lineage & boundaries

Extracted (fresh history) from a private multi-variant practice
platform at `~/code/personal/learning`. That repo stays private — it
contains licensed third-party exam content and must never be merged or
mirrored here. Don't copy files from it without checking provenance.

Pack repos carry their own licensing rules; two to keep in view:

- `quizmill/pack-claude-cert` (public) — curated from MIT-licensed
  community banks with per-question `sourceRef` + NOTICE.md. Questions
  from `paullarionov/claude-certified-architect` are EXCLUDED (no
  upstream license) — don't re-add unless a license appears upstream.
- `quizmill/pack-eleven-plus` (PRIVATE — must stay private). GL material
  (© GL Assessment) is deliberately out.

## Surfaces

Engine at `quizmill/quizmill`; CLI on npm as `quizmill`; domain
`quizmill.dev` on Cloudflare. Website = repo `quizmill/website`
(quizmill.dev, incl. the `/packs` directory and `/api/registry`);
demo app at try.quizmill.dev; sync server at sync.quizmill.dev; each
published pack at `<pack-id>.quizmill.dev`. Adjacent, private:
`quizmill/quizmill-cloud` generates a pack and hands it to the engine via
the `quizmill.activePack` localStorage blob.

Deploys are automated: `deploy-apps.yml` rebuilds the engine's own
showcase apps on the latest published engine; every other pack app
deploys **from its own repo** via the reusable `deploy-pack.yml`, so
per-app secrets and private-pack credentials stay there — don't move a
secret-bearing or private pack into `deploy-apps.yml`. `pr-preview.yml`
deploys a Cloudflare Pages preview of the demo app for every PR.

Roadmap and backlog live in GitHub issues and the project board, not
here.

## Releases

Semver, label-driven, **tag-only** (`.github/workflows/release.yml`).
Merging a PR into main bumps **patch** by default; label
`release:minor` / `release:major` for bigger bumps, `release:skip` for
none. Versions live in git tags (`vX.Y.Z`); the package.json files carry
a permanent `0.0.0-dev` sentinel and releases NEVER commit to main. The
workflow waits for CI of that exact main commit to pass (two green
branches can merge into a red main — fix, then dispatch manually),
publishes `cli/` via npm trusted publishing (OIDC; no token to expire),
tags, creates the GitHub release and dispatches `engine-update` to the
pack repos. Direct pushes to main never release — use the manual
dispatch. The in-app version comes from `git describe` at build time
(`NEXT_PUBLIC_APP_VERSION` overrides).

## Conventions

- Run `npm run lint` and `npm run typecheck` before pushing — both run
  in CI (after the unit tests) and a lint **error** or a type error
  fails the build. Lint **warnings** are allowed (the newer react-hooks
  rules are warn-level on purpose); don't reach for `eslint-disable` to
  silence a real error without a one-line reason.
- **Node is pinned once, in `.nvmrc`**. The root and `cli/` `engines`
  fields and every workflow's setup-node step follow it (the reusable
  `deploy-pack.yml` spells the major out); `tests/node-version.test.ts`
  fails if any of these drift, so bump them together.
- Tests accompany behaviour changes; E2E asserts against the demo pack
  (if a different pack is active locally, `rm -rf content/pack` and
  re-run to reseed). E2E specs live in `tests/e2e-pack/` and run under
  `vitest.e2e.config.mts`.
- **Bug fixes are red→green**: first write a failing test that
  reproduces the bug (confirm it's red), then fix until it's green.
  React component bugs can be exercised with happy-dom render tests
  under `tests/*.test.tsx`; pure logic stays in node `tests/*.test.ts`.
- **Always open a PR** for a finished change (`gh`/GitHub MCP) —
  unconditionally, without being asked: push the branch (so a preview
  env is created), then create the PR.
- **New user-facing features ship with visuals.** Any change that adds or
  alters UI must include screenshots in the PR (and surfaced in chat).
  Capture them from the real static build against the demo pack: `npm run
  build`, serve `out/` (`npx http-server out -p <port> -s -c-1`), then drive
  Puppeteer at a phone viewport (414×896, `deviceScaleFactor: 2`) seeding
  `localStorage` for the state you want — same harness as `tests/e2e/`.
  Show each meaningful state (e.g. empty / in-progress / complete), not
  just one. Screenshots are **never committed**: `docs/screenshots/` is
  gitignored (write the PNGs there locally if convenient) and the images
  go on the PR itself — drag them into the PR description so GitHub hosts
  them. GitHub has no API for that upload, so an unattended session that
  cannot attach an image instead links the PR's Cloudflare preview (the
  `pr-preview` bot comment), names the routes and the localStorage state
  to seed, and says so in the PR body.
- **Keep this file short.** Add a line only for a boundary, an invariant
  or a workflow rule an agent can't infer from the code; append to the
  relevant section rather than reflowing neighbours (several PRs edit
  this file in parallel). Don't record counts, versions, dates or
  per-module tours.
