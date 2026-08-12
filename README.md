# quizmill

**The mill that grinds questions into knowledge.**

Quizmill is an open-source practice-app engine. You bring (or have your
AI agent write) a **learning pack** — a small directory of JSON
describing a question bank — and quizmill turns it into a fast,
installable, offline-first practice app for that topic: practice
sessions biased toward unseen questions, a mistakes queue that re-asks
what you got wrong until you get it right, per-question feedback, and
optional cross-device sync.

Like a mill, it works by going around: answer, review, retry. The
engine is the wheel; packs are the grist.

## Quick start

You don't clone this repo to use quizmill — you run it with `npx`. The
CLI keeps the engine in `~/.quizmill/engine` for you and shells out to
it, so a pack is all you ever edit. Requires Node ≥ 18, git and npm.

```
npx quizmill new my-topic        # scaffold a pack (or have your AI agent fill it)
npx quizmill run my-topic        # practice at localhost:3000
npx quizmill build my-topic      # static app in my-topic-app/ — deploy anywhere
```

| Command | What |
|---|---|
| `new [dir]` | scaffold a learning pack with an agent-ready README |
| `validate <dir>` | schema + cross-reference checks (agents loop on this) |
| `run [dir\|owner/repo]` | activate a pack and start the app |
| `build [dir\|owner/repo]` | emit a deployable static app in `<pack-id>-app/` |
| `list` | published packs you can install |
| `upgrade` | re-align the cached engine (see [Upgrading](#upgrading)) |

## Install a published pack

Packs can live in their own GitHub repos. `run` and `build` accept a
repo reference and install it straight from there — public repos
anonymously, private repos through your own `git clone` credentials:

```
npx quizmill list                            # the published-pack registry
npx quizmill run quizmill/pack-claude-cert   # install + run one
```

| Pack | What | |
|---|---|---|
| [pack-claude-cert](https://github.com/quizmill/pack-claude-cert) | Unofficial Claude Certified Architect (Foundations) practice — 635 questions across the five exam domains, curated from MIT-licensed community banks with per-question attribution | public |
| `your-name/your-pack` | Private repos install exactly the same way (family packs, exam prep, team material) — anyone whose `git clone` works can run it | private |

`owner/repo`, `owner/repo#branch`, full GitHub URLs and SSH remotes all
work.

## Build a pack about anything

The intended authoring path is your local AI agent. With
[Claude Code](https://claude.com/claude-code), the bundled
`create-learning-pack` skill means you can just say:

> "Make me a learning pack about Kubernetes networking"

and the agent will scope it with you, write the pack, loop on the
validator until it's clean, activate it, and start the app.

Manual authoring works the same way — scaffold, edit, validate, run:

```
npx quizmill new my-topic            # writes pack.json + questions.json + a README
# edit pack.json + questions.json
npx quizmill validate my-topic       # schema + cross-reference checks
npx quizmill run my-topic            # activate + start the app
```

Packs are **private by default** — they live wherever you put them and
never enter this repo. Only the demo pack ships with the engine.

## Publish a pack

A pack repo is just the pack directory pushed to GitHub — `pack.json`,
`questions.json`, optional `scenarios.json` / `concepts.json` / `assets/`,
plus a README (see [pack-claude-cert](https://github.com/quizmill/pack-claude-cert)
for the shape). Once pushed, anyone can install it:

```
npx quizmill run your-name/your-pack-repo
```

Keep it private and it still works for everyone with repo access. If
the pack is public and you want it listed in `npx quizmill list`, PR an
entry into [`tools/pack/registry.json`](tools/pack/registry.json).

If your questions build on someone else's bank, keep the upstream
license, record provenance in each question's `sourceRef` (the app
links to it in the answer panel), and reproduce upstream notices —
again, pack-claude-cert is the worked example.

## Pack format

A pack is a directory of JSON, specified by the Zod schemas in
[`tools/pack/schema.ts`](tools/pack/schema.ts) (`schemaVersion: 2`;
v1 packs still load unchanged):

| File | What |
|---|---|
| `pack.json` | manifest — title, description, theme colour, categories, optional `levels` + `sources` |
| `questions.json` | the bank: multiple-choice (2–6 options keyed A–F), explanation, difficulty 1–5, provenance |
| `scenarios.json` | optional shared scenario stems for case-study style questions |
| `concepts.json` | optional concept cards surfaced in the answer panel (`conceptId` on a question) |
| `assets/` | optional images referenced by `image` on a question or option |

Schema v2 adds, all optional and backward-compatible:

- **2–6 options** keyed `A`–`F` (v1's fixed 4 is just the common case)
- **images** — `image` on a question prompt and/or on individual
  options, resolved from the pack's `assets/` directory
- **concept cards** — a `concepts.json` of short explainers; a question
  points at one with `conceptId` and it shows in the answer panel
- **levels** — a second axis beside category: manifest `levels`
  (`[{key,label}]`) + `levelsLabel` (the axis name, e.g. "Year" or
  "Difficulty band") + a `level` on each question, exposed as a filter
- **source legend** — manifest `sources` (`[{label,name,blurb,url}]`)
  renders a "Question sources" card in Settings; questions reference an
  entry by `sourceRef`

The validator (`npx quizmill validate <dir>`) cross-checks ids,
category / scenario / concept / level references, image paths, and
weights, and exits non-zero with per-question errors — agents loop on
it until the pack is clean, so malformed content can't reach the app.

## What the engine gives every pack

- **Practice sessions** — weighted random selection biased toward
  unseen questions (`src/lib/selection.ts`)
- **Mistakes review** — wrong answers queue up and are re-asked until
  answered correctly (`src/lib/mistakes.ts`)
- **Question feedback** — thumbs up/down with comments, surfaced in
  Settings so pack authors can curate
- **Local-first storage** — everything in localStorage, namespaced per
  pack; works fully offline (PWA with a versioned service worker)
- **Optional cloud sync** — a retry-on-reconnect queue mirroring to a
  Cloudflare Worker + D1 (sync-key auth) or Supabase (email OTP);
  dormant unless configured (see below)
- **Static export** — `npx quizmill build` produces a plain static site,
  deployable to any static host (Cloudflare Pages, GitHub Pages,
  Netlify…)

## Deploying a pack as its own app

```
npx quizmill build my-topic          # or: npx quizmill build owner/repo
# deploy the my-topic-app/ directory to any static host
```

Each deployment is one pack. The PWA name, icon, and theme colour are
generated from the pack manifest, so every pack gets its own
installable app identity.

Note that a static export embeds the questions in the served assets —
"private pack" means *not in a public repo*, not *unreadable by users
of the deployed app*.

## Cloud sync (optional)

Two interchangeable backends; with neither configured, the sync layer
stays dormant and the app is pure-local. (Set env vars for an `npx`
build by exporting them in the same shell — the CLI passes your
environment through to the engine.)

**Cloudflare Worker + D1 (recommended).** Deploy the tiny worker in
`cloudflare/` to a free Cloudflare account (~2 minutes, see
`cloudflare/README.md`) and build with:

```
NEXT_PUBLIC_SYNC_URL=https://quizmill-sync.<account>.workers.dev
```

No accounts or email: devices link by sharing a locally-generated
**sync key** (Settings → Sync across devices). Cloudflare's free tier
never pauses or deletes inactive Workers/D1 databases, so a practice
app you return to months later still syncs. One worker serves every
pack — rows are partitioned per pack and per key.

**Supabase.** The original backend (email-OTP sign-in, Row Level
Security). Run the migration in `supabase/migrations/` against your
own free-tier project and build with:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Note that Supabase pauses free-tier projects after ~a week of
inactivity (and eventually deletes them) — fine for daily-driver apps,
frustrating for occasional ones. If both backends are configured,
`NEXT_PUBLIC_SYNC_URL` wins.

## Upgrading

The CLI pins the cached engine to its own version, so the simplest
upgrade is to ask npx for the latest CLI — it re-aligns the engine to
match on the next command:

```
npx quizmill@latest build my-topic   # fetches the latest CLI + matching engine
npx quizmill upgrade                  # re-align the cache without building
```

`npx quizmill@latest …` is the path you almost always want: it pulls
the newest published CLI, which in turn pins the matching engine, so a
fresh build always rides the latest engine features. `quizmill upgrade`
just re-runs that alignment without building anything.

To develop against a local engine checkout instead of the cached one,
point `QUIZMILL_ENGINE` at it (see below) — the CLI then uses your
working tree as-is and skips version pinning.

## Developing the engine

You only need this if you're hacking on quizmill itself, not to author
or run packs. Clone the repo and use the npm scripts directly:

```
git clone https://github.com/quizmill/quizmill
cd quizmill
npm install
npm run dev                          # demo pack at localhost:3000

npm run pack:use <dir|owner/repo>    # validate + activate a pack
npm run pack:validate <dir>          # schema + cross-reference checks
npm run pack:list                    # published packs from the registry
npm run build                        # static export in out/

npm test                             # unit tests (vitest)
npm run test:e2e                     # build + drive the demo pack with Puppeteer
```

To point the `npx quizmill` CLI at your checkout (so `run`/`build` use
your working tree, version-pinning disabled):

```
export QUIZMILL_ENGINE=$(pwd)
npx quizmill run ../my-topic
```

## License

The engine is [MIT](LICENSE). Packs you author are yours — the engine
imposes no license on content. The bundled demo pack is MIT along with
the rest of this repo.
