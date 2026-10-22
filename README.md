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
it, so a pack is all you ever edit. Requires Node ≥ 26, git and npm.

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
| `bundle <dir> [--out file]` | validate + write one `<pack-id>.bundle.json` to hand over (see [Share a pack as one file](#share-a-pack-as-one-file)) |
| `share <dir>` | validate + bundle + upload behind a licence key; prints a one-tap install link (see [Share a private pack with a link](#share-a-private-pack-with-a-link)) |
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
never enter this repo. Only the demo pack ships with the engine, plus
the small starter pack the home app (app.quizmill.dev) is built from
(`content/pack-start/`: a few questions about using the app, and the
ways a pack gets in on its Home).

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

## Share a pack as one file

Not every pack wants to be a git repo. `bundle` validates a pack and
writes it as a single `.json` — the pack files verbatim, plus every
image from `assets/` embedded as a data URL, plus `schemaVersion`, the
pack id, a `bundledAt` stamp and (in a git checkout) the pack's
revision:

```
npx quizmill bundle my-topic                 # → my-topic.bundle.json
npx quizmill bundle my-topic --out ~/Desktop/topic.json
```

Any quizmill app inserts the file at `/packs` (pick it, or paste a URL
it's hosted at) — no CLI needed on the receiving end, and the pack
works offline there because its images travel inside the file. Browsers
keep an inserted pack in about 5 MiB of storage, so the bundler warns
when the images push a bundle past 4 MiB.

## Share a private pack with a link

Handing a file to a phone is the weak step. `share` does what `bundle`
does and then uploads the bundle to the **unlock service** (the sync
worker in `cloudflare/`, see its README) behind a **licence key**, and
prints a link to the home app that installs the pack in one tap:

```
npx quizmill share my-topic
Uploaded my-topic (150 questions, 612 KiB)
https://app.quizmill.dev/unlock#key=QL-7F3K-9Q2M-X4PD
```

Opening the link on a phone that has never seen the pack fetches the
bundle with the key, inserts it and makes it active — no Packs visit,
no file picker. The key rides in the URL fragment, which no server ever
sees, and the same key typed under Packs → "Have a licence key?" in an
installed app does the same. Run `share` again after editing the pack
and the link serves the new bundle; the keys stay as they were, and
(same pack id) learners keep their progress.

```
npx quizmill share my-topic --new-key "Leo"   # one more key (and link) for the pack
npx quizmill share my-topic --list            # every key, its uses, revoked or live
npx quizmill share --revoke QL-7F3K-9Q2M-X4PD # that link now opens nothing
```

`share` reads `~/.quizmill/config.json`:

```json
{ "unlock": { "endpoint": "https://sync.quizmill.dev",
              "app": "https://app.quizmill.dev", "token": "…" } }
```

`token` is the service's `UNLOCK_ADMIN_TOKEN`; `endpoint` and `app`
have those defaults and `--endpoint` / `--app` override them per run
(an author hosting their own worker, or a pack app with its own
origin). A key protects the download, not the content: anyone holding
it gets the whole bundle, and on a device the pack is readable — the
same caveat as a bundle file.

## Pack format

A pack is a directory of JSON, specified by the Zod schemas in
[`tools/pack/schema.ts`](tools/pack/schema.ts) (`schemaVersion: 2` — the
only version the validator accepts; a manifest still saying `1` just
needs the number changed, nothing else):

| File | What |
|---|---|
| `pack.json` | manifest — title, description, theme colour, categories, optional `levels`, `papers` + `sources`, optional `upgrade` |
| `questions.json` | the bank: multiple-choice (2–6 options keyed A–F), explanation, difficulty 1–5, provenance |
| `scenarios.json` | optional shared scenario stems for case-study style questions |
| `concepts.json` | optional concept cards surfaced in the answer panel (`conceptId` on a question) |
| `assets/` | optional images referenced by `image` on a question or option |

Beyond the required fields, all optional:

- **2–6 options** keyed `A`–`F` (a fixed 4 is just the common case)
- **images** — `image` on a question prompt and/or on individual
  options, resolved from the pack's `assets/` directory
- **per-option explanations** — a short `explanation` on an option
  shows inline under it once the answer is checked, so "why this one is
  wrong" sits next to the wrong one; the question's `explanation` keeps
  the full reasoning
- **concept cards** — a `concepts.json` of short explainers; a question
  points at one with `conceptId` and it shows in the answer panel
- **levels** — a second axis beside category: manifest `levels`
  (`[{key,label}]`) + `levelsLabel` (the axis name, e.g. "Year" or
  "Difficulty band") + a `level` on each question, exposed as a filter.
  A short ORDERED ladder, easiest first — the adaptive nudge suggests the
  next rung and the timed exam deals from the last; at most 8
- **papers** — named sets a learner sits whole: manifest `papers`
  (`[{key,label,series?,categoryKey?}]`) + `papersLabel` (the list's
  heading, e.g. "Papers" or "Practice exams") + a `paperId` on each
  question. Unordered and many (a published paper, a mock exam, one per
  `series` group), listed on Home to practise whole and offered in Paper
  practice to print as one sheet in bank order — so keep a paper's
  questions together in `questions.json`, in paper order (the validator
  warns otherwise). A paper owned by one category names it; one that
  spans categories omits `categoryKey`
- **source legend** — manifest `sources` (`[{label,name,blurb,url}]`)
  renders a "Question sources" card in Settings; questions reference an
  entry by `sourceRef`

- **timed exam** — manifest `exam` (`{passPct, questionCount?,
  durationMinutes?, scope?}`): `passPct` alone gives the exam-readiness
  estimate on Progress; add `durationMinutes` (the real exam's length)
  and the app offers a timed sitting from Home — `questionCount`
  questions drawn from the hardest level (`scope.level` or the last
  declared level), time pro-rated when fewer are available, pausable,
  no feedback until the end, then a pass verdict and a review of the
  sitting's mistakes. The pack decides whether the sitting exists; a
  device can only hide its Home tile (Settings → Timed exam). See
  [Ways to practise](#ways-to-practise)
- **default-on modes** — manifest `modes` (`{drive?, coach?, paper?}`):
  Drive, Coach and Paper are device opt-ins in Settings, off by default;
  a mode set `true` here starts on for a device that hasn't touched its
  switch, and the device's own choice wins either way (like `look`). See
  [Ways to practise](#ways-to-practise)
- **upgrade card** — manifest `upgrade` (`{title, url, price?, blurb?}`)
  for a free sampler pointing at its paid course or fuller bank: one
  card on Home (below the practice loop) and one in Settings, linking
  to the https `url` with `?ref=<packId>-home` / `-settings` appended
  so the destination can tell where the tap came from. The engine
  carries no shop or price of its own — the pack supplies the words.
- **licence unlock** — every build lets a learner who holds a licence
  key fetch the pack it opens in one tap: a link to `/unlock#key=<key>`
  (the key rides in the fragment, which never reaches a server) or the
  "Have a licence key?" entry on `/packs`. The key alone says which
  pack: the app calls `GET <unlockUrl>/v1/unlock?key=…`, expects a pack
  bundle (200), a refusal `{ "error": "…" }` it may show (403) or 404,
  and inserts the bundle under its own manifest id, makes it active and
  keeps the key under `quizmill.<packId>.licence`. Two optional manifest
  hints: `upgrade.packId` names the pack a key entered in THIS app is
  expected to open (a sampler and its full bank — sent as `&pack=`, and
  any other bundle is refused), and `upgrade.unlockUrl` points at the
  author's own endpoint instead of the build's (see `NEXT_PUBLIC_UNLOCK_URL`
  below). CORS `*`, no cookies; how keys are issued is the author's
  business.

The validator (`npx quizmill validate <dir>`) cross-checks ids,
category / scenario / concept / level / paper references, image paths, and
weights, and exits non-zero with per-question errors — agents loop on
it until the pack is clean, so malformed content can't reach the app.
It also warns about every referenced image that isn't a file under
`assets/`, so a misnamed figure is caught here rather than as a broken
image in the app or a refused bundle.

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
  Cloudflare Worker + D1 (sync-key auth), or any server speaking the
  same protocol; dormant unless configured (see below)
- **Static export** — `npx quizmill build` produces a plain static site,
  deployable to any static host (Cloudflare Pages, GitHub Pages,
  Netlify…)

## Ways to practise

The practice loop above is in every pack. Four more ways sit in a rail
under **More ways to practise** on Home, and one rule covers all of
them: **the pack says what it ships with; the device has the last word,
in Settings → This device.**

| Way | What it is | Who switches it on | Card in Settings → This device |
|---|---|---|---|
| **Timed exam** | one sitting at the real exam's pace — no feedback until the end, then a pass verdict and a review of the mistakes | **the pack**, by declaring `exam.durationMinutes` | **Timed exam** — shown by default; off only hides the tile |
| **Drive mode** | hands-free voice quiz for the car: questions read aloud, answers by voice | **the device**; a pack may start it on with `modes.drive` | **Drive mode** |
| **Coach mode** | a parent or tutor replays a past session with the learner, answers hidden until revealed; nothing is recorded | **the device**; `modes.coach` | **Coach mode** |
| **Paper practice** | print a worksheet (or write on it on a tablet), then mark the answers back in as a normal session | **the device**; `modes.paper` | **Paper practice** |

Drive, Coach and Paper resolve the same way: a device that has never
touched the switch follows the pack's `modes` block (absent means off).
Once someone flips the switch, that choice is pinned on the device,
either way — it survives installing another pack from the library and
"Reset all local progress", because it is about the device and who is
holding it, not about any pack. The timed exam is the other way round:
only the pack can create a sitting (it needs the exam's real length),
and the device may only hide the tile.

**Worked example — the home app at https://app.quizmill.dev.** It opens
on the bundled starter pack, which declares neither `exam` nor `modes`,
so a fresh phone sees no rail at all — the starter's job is to get a
pack in, not to quiz. Open Settings → This device there and switch
Paper practice on: a Paper tile appears, and it stays on that phone
for every pack installed after it. Insert a pack and the rail follows
that pack's manifest. The bundled solar-system demo pack (the one PR
previews and the E2E suite are built from) declares:

```json
"exam":  { "label": "Mock exam", "passPct": 70, "questionCount": 9, "durationMinutes": 15 },
"modes": { "drive": true, "coach": true, "paper": true }
```

So with the demo active, a fresh phone's rail shows all four tiles:
Drive, Coach, Paper and Mock exam ("9 Qs · 15:00" — the sitting deals
from the hardest level, Advanced, which holds exactly nine questions).
Settings → This device lists the four cards, all on. Switch Coach off
and its tile goes, and stays gone on that phone until it is switched
back on, even after installing a different pack. Switch Timed exam off
and the Mock exam tile goes too, but Progress still shows exam
readiness and `/practice/exam/` still answers. A certification pack
that declares `exam` and no `modes` starts with just its exam tile; a
kids' pack might declare `"modes": { "paper": true }` alone; a pack
with neither — the starter, say — shows no rail until the learner
opens Settings.

## Deploying a pack as its own app

```
npx quizmill build my-topic          # or: npx quizmill build owner/repo
# deploy the my-topic-app/ directory to any static host
```

Each deployment is one pack. The PWA name, icon, and theme colour are
generated from the pack manifest, so every pack gets its own
installable app identity.

**Browser floor.** The engine's stylesheet (Tailwind CSS 4) relies on
`color-mix()`, `@property` and cascade layers, so learners need Safari
16.4+ (iOS 16.4+), Chrome 111+ or Firefox 128+. On an older browser the
app still loads and works, but palette tints render transparent and
much of the layout loses its styling — an iPad stuck on iOS 15 or
16.0–16.3 is the device most likely to be affected.

Note that a static export embeds the questions in the served assets —
"private pack" means *not in a public repo*, not *unreadable by users
of the deployed app*.

## Cloud sync (optional)

One env var switches it on; without it, the sync layer stays dormant
and the app is pure-local. (Set env vars for an `npx` build by
exporting them in the same shell — the CLI passes your environment
through to the engine.)

**Cloudflare Worker + D1.** Deploy the tiny worker in `cloudflare/` to
a free Cloudflare account (~2 minutes, see `cloudflare/README.md`) and
build with:

```
NEXT_PUBLIC_SYNC_URL=https://quizmill-sync.<account>.workers.dev
```

No accounts or email: devices link by sharing a locally-generated
**sync key** (Settings → Sync across devices). Cloudflare's free tier
never pauses or deletes inactive Workers/D1 databases, so a practice
app you return to months later still syncs. One worker serves every
pack — rows are partitioned per pack and per key.

**Roll your own, or no server at all.** The backend layer is pluggable
(`docs/sync-protocol.md`): `NEXT_PUBLIC_SYNC_URL` speaks a tiny
two-endpoint protocol any server can implement — the Cloudflare Worker
is just the reference implementation — and entirely custom client
backends register in code via `registerSyncBackendProvider` (set
`NEXT_PUBLIC_SYNC_BACKEND` to pick one explicitly when several are
configured). Without any backend, Settings → "Move progress"
exports/imports progress as a JSON file for device moves and offline
backups.

### Licence unlock endpoint (optional)

The `/unlock` route and "Have a licence key?" fetch a pack bundle from
the hosted service at `https://sync.quizmill.dev` unless the build says
otherwise:

```
NEXT_PUBLIC_UNLOCK_URL=https://<your unlock service>
```

A pack's `upgrade.unlockUrl` overrides either for that pack. The
contract is the one under **licence unlock** above.

### Usage analytics (optional, anonymous)

A hosted app has no way of telling its author whether anyone opens it.
Build with

```
NEXT_PUBLIC_ANALYTICS_URL=https://<your sync worker>/v1/analytics
NEXT_PUBLIC_PRIVACY_URL=https://example.com/privacy   # optional, linked from Settings
```

and the app beacons a handful of funnel events — `app_open`,
`first_answer`, `session_10` (tenth completed session), `upsell_seen`,
`upsell_clicked`, `bundle_inserted`, `pack_unlocked`, `unlock_failed`,
`pack_updated` (an unlocked pack's daily check fetched a newer bundle) — as
`{ event, packId, deviceId, appBuild, ts }`; the last four add `pack`,
the id of the pack that arrived (or was refused), since `packId` is the
one that was active at the time. That is the whole payload: no answers,
no progress, no sync key, no licence key, no user agent. `deviceId` is a
random UUID the learner can regenerate (or switch the beacon off) in
Settings → Usage analytics; the card only exists in builds that set the
URL, and without it nothing leaves the device. The sync worker in
`cloudflare/` receives the beacons and answers
`GET /v1/analytics/summary?pack=<id>&days=30` with per-event totals,
distinct devices and a per-day series — see `cloudflare/README.md`.

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
npx playwright install chromium      # once, before the first E2E run
npm run test:e2e                     # build + drive the demo pack with Playwright
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
