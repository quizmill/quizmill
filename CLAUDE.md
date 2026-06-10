# quizmill — project notes for Claude Code

Open-source practice-app engine: a **learning pack** (directory of
JSON: manifest + MCQ bank + optional scenarios) becomes a static,
installable, offline-first practice app. Packs are private by default
and typically authored by a local AI agent via the bundled
`create-learning-pack` skill. Tagline: *the mill that grinds questions
into knowledge* — the mill wheel = the practice loop (answer → review
→ retry).

## Architecture in one breath

`content/pack/` (gitignored) holds the ACTIVE pack; `scripts/
ensure-pack.ts` seeds it from the committed demo (`content/pack-demo/`,
solar system) via the `predev`/`prebuild`/`pretest` npm hooks, and
`npm run pack:use <dir | owner/repo | github URL>` swaps in a validated
real pack — remote sources are fetched by `scripts/remote-pack.ts`
(codeload tarball, then git-clone HTTPS/SSH fallback, so private repos
work). `tools/pack/registry.json` lists published packs
(`npm run pack:list`). `src/config`
builds the app identity from the pack manifest at build time (Next
inlines the JSON; fully static export to `out/`). The PWA icon +
webmanifest are generated from the manifest by `scripts/pack-assets.ts`
(gitignored in `public/`).

- `tools/pack/schema.ts` — Zod pack format (schemaVersion 1) +
  `validatePack` cross-file checks (unique ids, category/scenario refs,
  weights). The validator CLI is the agent contract: loop until clean.
- `src/lib/` — engine: `selection.ts` (unseen-biased pick, seedable),
  `mistakes.ts` (re-ask until rescued; packs use per-question rescue —
  topic = question id), `storage.ts` (localStorage, namespaced
  `quizmill.<packId>.*`), `sync.ts` (optional Supabase mirror, dormant
  without `NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY`), `useStorage.ts`
  (React hooks, event bus `quizmill:storage`).
- `src/pack/` — the app UI: Home, PracticeRunner, ReviewRunner,
  runner.ts (pure session logic), data.ts (typed pack loader),
  StickersPage + achievements{,-engine}.ts (sticker cabinet; mastery
  stickers generated per pack category), ProgressPage (CSS-only charts
  over `src/lib/stats.ts`), DownvoteBrowser (Settings extra).
  InstallPrompt (`src/components/`) covers Add-to-Home-Screen.
- Engine never imports question *shapes* — it sees only the
  denormalised `Attempt`/`Session` fields (`src/data/types.ts`).

## Commands

```
npm run dev                      # demo pack at localhost:3000
npm test                         # vitest unit (58 tests)
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

## Status (2026-06-09)

Locked in: GitHub org+repo `quizmill/quizmill`, npm org `@quizmill`
(no packages published yet — bare name `quizmill` still unclaimed on
npm), domain `quizmill.dev` registered (`.app`/`.io`/`.org` were
available, unregistered; `.com` is parked for sale on BrandBucket —
ignored). v0.1 committed; CI (`.github/workflows/ci.yml`: unit + build
+ E2E) runs on push.

Real packs published (ported from `~/code/personal/learning`):

- `quizmill/pack-claude-cert` (PUBLIC) — 635 CCA-F questions curated
  from MIT-licensed community banks (haytamAroui, Connectry-io), with
  per-question `sourceRef` attribution + NOTICE.md. 60 questions from
  `paullarionov/claude-certified-architect` were EXCLUDED (no upstream
  license) — don't re-add without a license appearing upstream.
- `quizmill/pack-eleven-plus` (PRIVATE — must stay private) — 300
  agent-authored english/maths/verbal questions, ids stable from the
  learning repo. Non-verbal (all image-based) and GL material
  (© GL Assessment, 5-option + images) deliberately not ported.

## Shipped (2026-06-10)

- **Engine** pushed to `quizmill/quizmill` (public); CI green on main.
- **Website** repo at `quizmill/website` (sibling checkout
  `../quizmill-website`), deployed to Cloudflare Pages: live at
  https://quizmill.pages.dev (project `quizmill`). Interactive single
  page: live practice loop in the hero, pack→app phone switcher, agent
  terminal animation. Brand defined in its README (mill-wheel mark,
  paper/ink/grain palette, Fraunces display).
- **Demo app** (solar-system pack static build) live at
  https://quizmill-try.pages.dev (project `quizmill-try`,
  `wrangler pages deploy out`).
- **CLI** in `cli/` — `npx quizmill new|validate|run|build|list|
  upgrade`, zero-dep wrapper that caches the engine in `~/.quizmill/
  engine` (override `QUIZMILL_ENGINE` for dev). Publish blocked only
  on an npm 2FA OTP (`npm publish --otp=<code>` from `cli/`; bare
  name `quizmill` confirmed free).
- Custom domain pending: quizmill.dev is registered but its zone is
  not yet in the Cloudflare account — add the site in the CF dashboard,
  point nameservers at the registrar, then attach quizmill.dev to the
  `quizmill` Pages project and try.quizmill.dev to `quizmill-try`.

## Roadmap (agreed, in order)

1. **npm 2FA publish** of the CLI, then add an "npx quizmill" card to
   the website + README.
2. **Domain cutover** — quizmill.dev zone into Cloudflare, custom
   domains on both Pages projects, CF API token secrets
   (`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`) into both repos
   for CI deploys.
3. **Auto-deployed pack gallery** — CI matrix over
   `tools/pack/registry.json`: every registry pack gets its own Pages
   deployment (`<pack-id>.quizmill.dev`), website gallery links them.
4. Later ideas: `quizmill deploy` (one-command CF Pages under the
   user's account), pack export/import bundle, FSRS-based spaced
   repetition (`ts-fsrs`), pack repo template (`quizmill/pack-template`
   with "Use this template"), hosted registry at registry.quizmill.dev,
   schema v2 (2–6 options + question images — unblocks porting the 11+
   non-verbal bank).

## Releases

Semver, label-driven (`.github/workflows/release.yml`). Merging a PR
into main bumps **patch** by default; label `release:minor` /
`release:major` for bigger bumps, `release:skip` for none. The
workflow bumps `package.json` + `cli/package.json` in lockstep,
commits, tags `vX.Y.Z`, creates a GitHub release with generated
notes, and npm-publishes `cli/` (requires the `NPM_TOKEN` repo
secret — a granular automation token with bypass-2FA; skips with a
notice until set). Direct pushes to main never release — use the
workflow's manual dispatch to release accumulated commits. The
in-app version is `package.json` verbatim; the SW cache key appends
the git SHA so updates are detected on every commit regardless.

## Conventions

- Tests accompany behaviour changes; E2E asserts against the demo pack
  (if a different pack is active locally, `rm -rf content/pack` and
  re-run to reseed before E2E).
- Question ids are immutable once published — attempt history points
  at them.
- Pack schema changes bump `schemaVersion` and must stay
  backward-readable.
