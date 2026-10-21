# quizmill sync worker (Cloudflare Workers + D1)

The built-in cloud-sync backend: a tiny Cloudflare Worker in front of a
D1 (SQLite) database that mirrors each device's practice history.

**Why Cloudflare?** Its free tier has no inactivity lifecycle: Workers and
D1 databases stay up indefinitely — a practice app you pick up again after
the summer holidays still syncs — and the daily allowances (100,000
requests, 100,000 row writes, 5 GB storage) are orders of magnitude beyond
what practice apps generate. There is also no email/auth service to
configure — sign-in is a **sync key** the app generates locally (see
below).

## Setup (~2 minutes, free Cloudflare account)

```sh
cd cloudflare
npx wrangler login                    # first time only
npx wrangler d1 create quizmill-sync  # prints a database_id
#   → paste the id into wrangler.toml (database_id = "…")
npx wrangler d1 execute quizmill-sync --remote --file=schema.sql
npx wrangler deploy                   # prints https://quizmill-sync.<account>.workers.dev
```

Then build the app (or every pack app — one worker serves them all, rows
are partitioned per pack) with:

```sh
NEXT_PUBLIC_SYNC_URL=https://quizmill-sync.<account>.workers.dev npm run build
```

Opening the printed URL in a browser should answer
`{"service":"quizmill-sync","ok":true}`.

When `NEXT_PUBLIC_SYNC_URL` is unset the sync layer stays dormant and the
app is pure-local.

## Try it locally first (no Cloudflare account needed)

`wrangler dev` runs the real worker against a local SQLite-backed D1 —
nothing leaves your machine and no account is required:

```sh
cd cloudflare
# any placeholder database_id works for local dev
npx wrangler d1 execute quizmill-sync --local --file=schema.sql
npx wrangler dev --port 8787          # → http://127.0.0.1:8787
```

Then build the app against it and click around for real:

```sh
NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8787 npm run build
npx http-server out -p 3000 -s -c-1   # Settings → create a sync key
```

Peek at what synced with
`npx wrangler d1 execute quizmill-sync --local --command "SELECT tbl, id FROM rows"`.
When it looks right, the three deploy commands above take the same worker
to production.

## How sign-in works (sync keys)

There are no accounts and no email flow. In **Settings → Sync across
devices** the app generates a random key like

```
QM-H3KDA-P9RWX-T2MNQ-C7FGB
```

(~98 bits of entropy, ambiguous characters excluded). Entering the same
key on another device links the two — like a Wi-Fi password for your
practice history. Every request carries the key as a bearer token; the
worker stores only its SHA-256 as the row partition, never the key itself.

### Naming a key (whose history is this?)

A key is unguessable noise, which is what you want for auth and exactly
what you don't want when the house holds two of them. In the same card,
**Name this key** labels it — "Leo", "Dad's key" — and the name is stored
next to the key's hash on the worker, so it appears on every device that
enters the key (and in the "Email me this key" subject line, so the two
keys don't look alike in your inbox). Renaming on one device renames it
everywhere; clearing the name clears it everywhere.

The name is stored in the clear — it's a label its holder chose, readable
only by someone who already has the key. Don't put anything secret in it.

**Upgrading an existing deployment.** Key names live in a `profiles`
table added after the first release. `schema.sql` is idempotent, so:

```sh
npx wrangler d1 execute quizmill-sync --remote --file=schema.sql
npx wrangler deploy
```

The `analytics_events.target_pack_id` column was likewise added later;
a database created before it needs `migrations/0001-target-pack-id.sql`
applied **once** (an `ALTER TABLE`, so it is not idempotent) before the
worker that writes it is deployed — see the comment in that file.

Until that runs, the app keeps names on the device and says they haven't
reached the other devices yet; it pushes them up by itself on the first
visit after the upgrade.

Anyone who knows a key can read and write the history behind it, so treat
it like a password. That capability-URL trust model is a deliberate fit
for the data mirrored here (quiz attempts, stickers, question votes) —
don't reuse this worker for anything sensitive.

**Losing the key.** The card offers "Email me this key" — it opens the
user's OWN mail app with the key pre-filled, addressed to themselves, so
recovery is just searching your inbox (no server, ours included, ever
sees the email or the key). On phones there's also the system share
sheet (Notes, a password manager, a self-chat). If every copy is truly
gone, the cloud rows are orphaned but the data still lives on the
devices — Settings → Move progress exports it, and creating a new
key re-uploads it.

## API

This worker is the **reference implementation** of the quizmill HTTP
sync protocol — the full wire spec (for implementing your own server in
any language) lives in `docs/sync-protocol.md`.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /` | none | liveness probe |
| `GET /v1/rows?pack=<id>` | Bearer sync key | pull all rows for user+pack |
| `POST /v1/ops` | Bearer sync key | apply `{ pack, ops: [...] }` idempotent mutations |
| `GET /v1/profile` | Bearer sync key | this key's name, `{ name }` (`null` when unnamed) |
| `POST /v1/profile` | Bearer sync key | name this key, `{ name }` (empty string clears it) |
| `POST /v1/analytics` | none | one anonymous funnel beacon, `{ event, packId, deviceId, appBuild, ts, pack? }` → 204 |
| `GET /v1/analytics/summary?pack=<id>&days=<n>` | Bearer `ANALYTICS_READ_TOKEN` if set | per-event totals + distinct devices, per-day series |

Rows are opaque JSON keyed by `(user_id, pack_id, tbl, id)` — the worker
never interprets them; merge semantics live in the client
(`src/lib/storage.ts` `mergeRemote`). The client half of the protocol is
`src/lib/backends/httpBackend.ts`; the validation/SQL rules are pure and
unit-tested (`tests/worker-sync.test.ts`).

## Usage analytics (anonymous funnel beacons)

The same worker can receive the app's optional usage analytics — a
separate table, a separate trust model. A hosted app built with

```sh
NEXT_PUBLIC_ANALYTICS_URL=https://sync.quizmill.dev/v1/analytics   # or your own worker
NEXT_PUBLIC_PRIVACY_URL=https://example.com/privacy                 # optional
```

sends `navigator.sendBeacon` posts for eight funnel events (`app_open`,
`first_answer`, `session_10`, `upsell_seen`, `upsell_clicked`,
`bundle_inserted`, `pack_unlocked`, `unlock_failed`) carrying exactly
`{ event, packId, deviceId, appBuild, ts }` — plus `pack`, the ARRIVING
pack's id, on the last three (`packId` is the pack that was active when
it arrived; stored as `target_pack_id`, never a licence key). There is
deliberately no auth on the ingest route — devices hold
no credential, and a sync key must never travel with a beacon — so the
worker refuses any body over 1 KiB before parsing it (413; a real beacon
is ~170 bytes), validates the rest against a closed event list and
per-field length limits, stores it in `analytics_events`, and never
looks at the request's IP or user agent. `deviceId` is a random UUID the
learner can regenerate or switch off in Settings; nothing joins it to
the `rows` or `profiles` tables.

The ingest route is not rate-limited in the worker: the counts are
aggregate and advisory, each accepted beacon costs one D1 row write
inside the free tier's daily quota, and a limiter keyed on the client
address would have the worker reading IPs. If an app ever draws abuse,
put a Cloudflare rate-limiting rule on `/v1/analytics` at the zone (no
worker change needed) — it drops the excess before the worker runs.

Read it back with

```sh
curl 'https://sync.quizmill.dev/v1/analytics/summary?pack=solar-system-demo&days=30'
# {"pack":"solar-system-demo","days":30,"since":"…",
#  "events":{"app_open":{"count":42,"devices":17},"first_answer":{…},…},
#  "daily":[{"day":"2026-10-09","event":"app_open","devices":5},…]}
```

A pack's summary covers the events that happened in it (`packId`) and
the ones about it (`pack`, the arriving pack of an insert / unlock): a
sampler keeps its whole funnel through `pack_unlocked`, and the pack a
key unlocked sees its own arrivals.

The summary is aggregate counts only, so it is open by default; to gate
it, `npx wrangler secret put ANALYTICS_READ_TOKEN` and send the value as
a bearer token. **Upgrading an existing deployment:** the table lives in
`schema.sql` (idempotent) — re-run it, then `npx wrangler deploy`. Until
the worker is redeployed the apps' beacons simply 404 and nothing is
lost that matters (they are fire-and-forget).

## Usage report (read-only, Markdown)

Every learner with a sync key mirrors their sessions, attempts and app
events here, so the database can answer "is this pack being used?"
without anyone building a dashboard. From the engine repo:

```sh
npm run sync:report -- --remote                 # production, via your wrangler login
npm run sync:report -- --local                  # the `wrangler dev` database
npm run sync:report -- --remote --out report.md
```

prints, per pack: learners, active learners (last 7 / 30 days), sessions,
attempts, mistakes rescued and still open (the engine's own rescue rule),
and events by type — with the definitions at the foot of the report.
Nothing leaves your machine: it is `wrangler d1 execute --json` running
one `SELECT` (`npm run sync:report -- --sql` prints it; save its output
and replay it with `--from rows.json`) and a pure aggregation
(`src/report.ts`, unit-tested in `tests/events-report.test.ts`). The
output is aggregate only — no user ids, hashed or otherwise — and there
is deliberately **no endpoint** for it: the rows are learners' practice
histories and stay behind wrangler's login.

Workers that also receive the anonymous funnel beacons (previous section)
get a "Funnel" table per pack from `GET /v1/analytics/summary`:

```sh
ANALYTICS_READ_TOKEN=… npm run sync:report -- --remote --analytics https://sync.quizmill.dev
```

On a worker without that route the section says "not available" rather
than showing zeros.

## Licence-key unlock (private packs behind a link)

The same worker is the **unlock service** behind `quizmill share` and
the app's `/unlock` route: one R2 bucket of pack bundles (`BUNDLES`,
one object per pack id) and a `licence_keys` table saying which key
opens which pack. `share` mints `QL-XXXX-XXXX-XXXX` (Crockford base32,
60 bits; typed input folds case, separators and the i/l/o confusables)
— visibly not a `QM-` sync key, and a different trust model: it is the
capability to *download one pack*, never anyone's practice history. The
stored key is **opaque**, though: the routes match it exactly as given
first (so a key in another provider's format, written straight to the
table, unlocks and revokes as-is) and fall back to the folded QL form
for typed keys; only empty and over-long (> 128 chars) input is refused
outright.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /v1/unlock?key=<key>[&pack=<id>]` | the key | 200 the bundle, `ETag: "<version>"`; 304 on a matching `If-None-Match`; 403 `{ error }` unknown / revoked / spent; 404 `pack` passed and the key opens another |
| `PUT /v1/packs/:id` | Bearer `UNLOCK_ADMIN_TOKEN` | store or replace the bundle; mints the first key when the pack has none → `{ keys }` |
| `POST /v1/packs/:id/keys` | Bearer `UNLOCK_ADMIN_TOKEN` | mint `{ label?, maxUses? }` → `{ key }` |
| `GET /v1/packs/:id/keys` | Bearer `UNLOCK_ADMIN_TOKEN` | `{ keys: [{ key, packId, label, uses, maxUses, createdAt, revokedAt }] }` |
| `DELETE /v1/keys/:key` | Bearer `UNLOCK_ADMIN_TOKEN` | revoke (the row stays, so it still lists) |

The service never lists packs and never serves one without a live key.
A missing, malformed or unknown key gets the **same** 403 text, with or
without a `pack=`, so nothing in a reply says whether a pack exists;
the pack-mismatch 404 only follows a key that itself passed. A 200
counts as a use (`maxUses` is per key; `null` = unlimited); a 304 does
not. The use is claimed with one conditional `UPDATE` once the bundle
is in hand, so two devices racing for a key's last use, or a download
overlapping a revocation, get exactly one 200. The ETag is the pack's git revision when the bundle was built from
a clean checkout, otherwise a hash of the bundle — so a re-share always
reads as new to a device holding the previous one. Keys are stored in
clear (the author lists and revokes them). CORS `*`, no cookies, and
`ETag` is exposed to the app.

Setup, on top of the sync worker:

```sh
npx wrangler r2 bucket create quizmill-bundles       # the BUNDLES binding in wrangler.toml
npx wrangler d1 execute quizmill-sync --remote --file=schema.sql   # adds licence_keys (idempotent)
npx wrangler secret put UNLOCK_ADMIN_TOKEN           # what `quizmill share` sends
npx wrangler deploy
```

Without the bucket binding the routes are simply absent, so a fork that
only wants sync changes nothing. Locally, `wrangler dev` serves the
bucket from disk too:

```sh
npx wrangler d1 execute quizmill-sync --local --file=schema.sql
echo 'UNLOCK_ADMIN_TOKEN=dev' > .dev.vars      # wrangler dev reads secrets from here (untracked)
npx wrangler dev --port 8787
npx quizmill share my-topic --endpoint http://127.0.0.1:8787 --app http://localhost:3000
```

(with `"token": "dev"` in `~/.quizmill/config.json`, and the app served
from a build with `NEXT_PUBLIC_UNLOCK_URL=http://127.0.0.1:8787`). The
rules are pure and unit-tested in `tests/worker-unlock.test.ts`; the
CLI round trip in `tests/cli-share.test.ts` runs the real CLI against
the real worker over HTTP.
