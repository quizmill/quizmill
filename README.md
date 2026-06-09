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

```
npm install
npm run dev          # runs the bundled demo pack (solar system)
```

## Install a published pack

Packs can live in their own GitHub repos. `pack:use` installs straight
from a repo reference — public repos anonymously, private repos through
your own `git clone` credentials:

```
npm run pack:list                            # the published-pack registry
npm run pack:use quizmill/pack-claude-cert   # install one
npm run dev
```

| Pack | What | |
|---|---|---|
| [pack-claude-cert](https://github.com/quizmill/pack-claude-cert) | Unofficial Claude Certified Architect (Foundations) practice — 635 questions across the five exam domains, curated from MIT-licensed community banks with per-question attribution | public |
| `your-name/your-pack` | Private repos install exactly the same way (family packs, exam prep, team material) — anyone whose `git clone` works can run it | private |

`owner/repo`, `owner/repo#branch`, full GitHub URLs and SSH remotes all
work. Re-running `pack:use` refreshes the pack; switching back is
`rm -rf content/pack && npm run dev` (reseeds the demo).

## Build a pack about anything

Packs are **private by default** — they live in the gitignored `packs/`
workspace (or your own private repo) and never enter this repo's
history. Only the demo pack is committed.

The intended authoring path is your local AI agent. With
[Claude Code](https://claude.com/claude-code), the bundled
`create-learning-pack` skill (`.claude/skills/`) means you can just
say:

> "Make me a learning pack about Kubernetes networking"

and the agent will scope it with you, write the pack, loop on the
validator until it's clean, activate it, and start the app.

Manual authoring works the same way:

```
cp -r content/pack-demo packs/my-topic    # start from the demo
# edit pack.json + questions.json
npm run pack:validate packs/my-topic      # schema + cross-reference checks
npm run pack:use packs/my-topic           # activate
npm run dev
```

## Publish a pack

A pack repo is just the pack directory pushed to GitHub — `pack.json`,
`questions.json`, optional `scenarios.json`, plus a README (see
[pack-claude-cert](https://github.com/quizmill/pack-claude-cert) for
the shape). Once pushed, anyone can install it:

```
npm run pack:use your-name/your-pack-repo
```

Keep it private and it still works for everyone with repo access. If
the pack is public and you want it listed in `npm run pack:list`, PR an
entry into [`tools/pack/registry.json`](tools/pack/registry.json).

If your questions build on someone else's bank, keep the upstream
license, record provenance in each question's `sourceRef` (the app
links to it in the answer panel), and reproduce upstream notices —
again, pack-claude-cert is the worked example.

## Pack format

A pack is three JSON files, specified by the Zod schemas in
[`tools/pack/schema.ts`](tools/pack/schema.ts) (`schemaVersion: 1`):

| File | What |
|---|---|
| `pack.json` | manifest — title, description, theme colour, categories |
| `questions.json` | the bank: multiple-choice, 4 options, explanation, difficulty 1–5, provenance |
| `scenarios.json` | optional shared scenario stems for case-study style questions |

The validator (`npm run pack:validate`) cross-checks ids, category
references, scenario references, and weights, and exits non-zero with
per-question errors — agents loop on it until the pack is clean, so
malformed content can't reach the app.

## What the engine gives every pack

- **Practice sessions** — weighted random selection biased toward
  unseen questions (`src/lib/selection.ts`)
- **Mistakes review** — wrong answers queue up and are re-asked until
  answered correctly (`src/lib/mistakes.ts`)
- **Question feedback** — thumbs up/down with comments, surfaced in
  Settings so pack authors can curate
- **Local-first storage** — everything in localStorage, namespaced per
  pack; works fully offline (PWA with a versioned service worker)
- **Optional cloud sync** — magic-link auth + Supabase mirroring with a
  retry-on-reconnect queue; dormant unless configured (see below)
- **Static export** — `npm run build` produces a plain static site in
  `out/`, deployable to any static host (Cloudflare Pages, GitHub
  Pages, Netlify…)

## Deploying a pack as its own app

```
npm run pack:use packs/my-topic
NEXT_PUBLIC_BASE_PATH= npm run build
# deploy out/ anywhere static
```

Each deployment is one pack. The PWA name, icon, and theme colour are
generated from the pack manifest, so every pack gets its own
installable app identity.

Note that a static export embeds the questions in the served assets —
"private pack" means *not in a public repo*, not *unreadable by users
of the deployed app*.

## Cloud sync (optional)

Set two env vars at build time and run the migration in
`supabase/migrations/` against your own (free-tier) Supabase project:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Absent these, the sync layer stays dormant and the app is pure-local.
Row Level Security scopes every row to the signed-in user.

## Development

```
npm test             # unit tests (vitest)
npm run test:e2e     # build + drive the demo pack with Puppeteer
```

## License

The engine is [MIT](LICENSE). Packs you author are yours — the engine
imposes no license on content. The bundled demo pack is MIT along with
the rest of this repo.
