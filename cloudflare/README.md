# quizmill sync worker (Cloudflare Workers + D1)

The recommended cloud-sync backend: a tiny Cloudflare Worker in front of a
D1 (SQLite) database that mirrors each device's practice history.

**Why this over Supabase?** Supabase free-tier projects are paused after ~a
week of inactivity and eventually deleted — a practice app you pick up
again after the summer holidays comes back to a dead backend. Cloudflare's
free tier has no inactivity lifecycle: Workers and D1 databases stay up
indefinitely, and the daily allowances (100,000 requests, 100,000 row
writes, 5 GB storage) are orders of magnitude beyond what practice apps
generate. There is also no email/auth service to configure — sign-in is a
**sync key** the app generates locally (see below).

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

When `NEXT_PUBLIC_SYNC_URL` is set it takes precedence over the Supabase
env vars; when neither is set the sync layer stays dormant and the app is
pure-local.

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

Rows are opaque JSON keyed by `(user_id, pack_id, tbl, id)` — the worker
never interprets them; merge semantics live in the client
(`src/lib/storage.ts` `mergeRemote`). The client half of the protocol is
`src/lib/backends/httpBackend.ts`; the validation/SQL rules are pure and
unit-tested (`tests/worker-sync.test.ts`).
