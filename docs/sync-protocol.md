# quizmill sync — pluggable backends & the HTTP sync protocol

Cloud sync is a thin, swappable layer. The engine (`src/lib/sync.ts`)
owns a persisted queue of idempotent mutations and a last-write-wins
merge; everything cloud-specific sits behind one interface:

```ts
interface SyncBackend {
  getUserId(): Promise<string | null>;             // null = signed out
  onAuthChange(cb: (userId: string | null) => void): void;
  runOp(op: QueueOp, userId: string): Promise<void>;  // throw = retry later
  pullAll(userId: string): Promise<RemoteData>;       // full snapshot
}
```

Backends register as providers (`src/lib/syncBackend.ts`); the first
configured provider wins, or `NEXT_PUBLIC_SYNC_BACKEND=<kind>` picks one
explicitly. Ways to plug in, from least to most work:

| You want | Do this |
| --- | --- |
| Free hosted sync, 2-min setup | Deploy the Cloudflare Worker (`cloudflare/`), set `NEXT_PUBLIC_SYNC_URL` |
| Your own server (any language) | Implement the **HTTP protocol** below, set `NEXT_PUBLIC_SYNC_URL` to it |
| Supabase | Set the `NEXT_PUBLIC_SUPABASE_*` pair (see `supabase/`) |
| A different transport entirely | Implement `SyncBackend`, call `registerSyncBackendProvider()` + `registerSyncSettingsCard()` |
| No server at all | File export/import in Settings (`src/lib/transfer.ts`) — same data contract, JSON file transport |

## The HTTP protocol (what `NEXT_PUBLIC_SYNC_URL` speaks)

Two endpoints. The server is a *dumb mirror*: it stores opaque JSON rows
keyed by `(user, pack, table, id)` and never interprets row contents —
merge semantics live in the client. Any store works behind it (the
reference implementation uses one SQLite table — see
`cloudflare/schema.sql`).

### Authentication

Every request carries `Authorization: Bearer <sync key>`. Derive the
user id server-side and never store the key:

```
material = uppercase(strip non-alphanumerics from bearer token)
reject if length < 20
user_id  = hex(sha256(material))
```

Clients send canonical keys (`QM-XXXXX-XXXXX-XXXXX-XXXXX`, ~98 bits;
`src/lib/syncKey.ts`), so `material` is the 22-char `QM…` body. The
client derives the same hash locally — `hashSyncKey` and the server MUST
agree (tested in `tests/worker-sync.test.ts`). Respond `401` on a
missing/short key. Knowing a key is owning its data — capability-URL
trust, fine for quiz history; don't reuse for anything sensitive.

### `GET /v1/rows?pack=<packId>`

Return every row for this user + pack, grouped by table, `200`:

```json
{ "sessions": [...], "attempts": [...], "achievements": [...], "votes": [...], "notes": [...], "events": [...] }
```

Rows are returned exactly as uploaded (the client's local shapes — see
`src/data/types.ts` and `src/lib/storage.ts`). Missing arrays are
treated as empty.

### `GET /v1/profile` and `POST /v1/profile` (optional)

The learner-facing half of a sync key: one optional human-readable **name**
per key ("Leo", "Dad's key"). Keys are unguessable noise by design, so a
household running two of them cannot otherwise tell which app is syncing
whose history. The name is stored against the same hashed user id — never
the key — and is **not** pack-scoped: one key names one learner across
every pack, and `clear-all` (which resets one pack's progress) leaves it
alone.

```
GET  /v1/profile            → 200 { "name": "Leo" }   // or { "name": null }
POST /v1/profile  { "name": "Leo" }
                            → 200 { "ok": true, "name": "Leo" }
```

An empty `name` clears it. Canonicalise before storing — control
characters to spaces, whitespace runs collapsed, trimmed, clamped to 40
code points (clamp by code point so a trailing emoji isn't split) — and
echo back what you stored; the client applies the identical rule
(`normalizeKeyName`, mirrored in `src/lib/syncKey.ts` and
`cloudflare/src/ops.ts`, asserted equal in `tests/worker-sync.test.ts`).
Reject a non-string or absurdly long (>1000 char) name with `400`.

The name is stored in the clear: it is a label its own key-holder chose,
readable only by someone who already holds the key. Treat it as a label,
not a secret.

**Servers may skip this pair.** The client degrades: it keeps the name on
the device, tells the user it hasn't reached their other devices, and
retries the push on later visits — so a worker that gains `/v1/profile`
later picks up names devices already hold.

### `POST /v1/ops`

Body: `{ "pack": "<packId>", "ops": [WireOp, ...] }`. Apply in order;
respond `200` on success, `400` on a malformed batch (all-or-nothing —
never half-apply), any `5xx`/failure → the client retries later with
backoff-ish pacing (ops are idempotent, so at-least-once is safe).

```ts
type WireOp =
  | { t: 'sessions'|'attempts'|'achievements'|'votes'|'notes'|'events';
      op: 'upsert'; id: string; ref?: string; data: object }
  | { t: 'votes'|'notes'; op: 'delete'; id: string }       // id = questionId
  | { t: 'clear-all'; op: 'delete' }                       // wipe user+pack
  | { t: 'clear-sessions'; op: 'delete'; sessionIds: string[] }
```

Required semantics:

- **upsert** — insert or replace by `(user, pack, t, id)`, EXCEPT
  `achievements`: insert-if-absent (write-once; the client keeps the
  earliest unlock time).
- **`ref`** — attempts carry their `sessionId` here; store it so
  `clear-sessions` can delete both the listed sessions AND every attempt
  whose `ref` is in the list.
- **`clear-all`** — delete all six tables for this user + pack only.
- **CORS** — the app is a static site on another origin: allow
  `GET, POST, OPTIONS` with `authorization, content-type` headers from
  `*` (bearer auth, no cookies).

Recommended sanity ceilings (the reference server enforces): ≤500 ops
per request, ≤32 KB per row, ≤200-char ids.

### Adding a table: deploy the server first

When a release adds a synced table (as `notes` and `events` did), upgrade the server
BEFORE shipping the client — redeploy the worker (`npx wrangler deploy`
from `cloudflare/`; the generic rows schema needs no migration) or run
the new Supabase migration. A client that races ahead gets its new-table
ops rejected with `400` ("Couldn't sync N · retry" in the UI) while every
other table keeps syncing. The engine retries each rejected op a few
times, then drops it AND clears its once-per-user bulk-push flag — so on
the first app start after the server is upgraded, the device re-seeds
the cloud from local storage (idempotent upserts) and no data is lost
(tested in `tests/sync-recovery.test.ts` /
`tests/sync-worker-e2e.test.ts`).

## Rolling your own client backend

For a transport HTTP-plus-sync-keys can't express (end-to-end
encryption, WebDAV, a proprietary API…), register a provider from module
scope so it's in place before `startSync()` runs (e.g. import your
module from `SyncBootstrap`):

```ts
import { registerSyncBackendProvider } from '@/lib/syncBackend';
import { registerSyncSettingsCard } from '@/components/SyncSettings';

registerSyncBackendProvider(
  { kind: 'my-backend', isConfigured: () => true, create: () => myBackend },
  { prepend: true },           // beat the built-ins when several configure
);
registerSyncSettingsCard('my-backend', MySignInCard);
```

Contract notes: `runOp` may be called for the same op more than once
(make ops idempotent); throwing marks the op for retry, and after 6
failed tries it is dropped loudly. `pullAll` returns local-shaped rows;
the engine merges them last-write-wins and never echoes merged rows back
into the queue. Emit `onAuthChange(userId)` whenever sign-in state
changes; the engine pulls + (first time per user) bulk-pushes on
sign-in.

## Which backend is an app using? Swapping backends

**Seeing it:** every sync-settings card carries a muted footer naming the
active backend and its target host — e.g. `Backend: Sync server ·
quizmill-sync.acme.workers.dev` or `Backend: Supabase · abcd.supabase.co`
— so any deployed app answers "where does my data go?" from Settings. No
sync card at all means the build has no backend configured (pure-local).
At build time, the env vars are the source of truth
(`syncBackendInfo()`/`syncBackendKind()` in code).

**Swapping:** the backend is a build-time choice, so a swap is: change
the env vars, rebuild, redeploy. The local-first design makes this safe
and automatic for data:

1. Each device keeps its full history in localStorage — the cloud is
   only a mirror, so nothing is lost by switching.
2. Sign-in state does not carry across backends: users sign in once on
   the new backend (create/enter a sync key, or the email code for
   Supabase).
3. On that first sign-in the engine pulls (empty on a fresh backend),
   then bulk-pushes the device's entire local history — the
   once-per-user migration flag is keyed by backend-specific user id, so
   the re-upload happens automatically per device. Multi-device users
   sign each device in with the same key/email and the merge unions
   their histories, exactly like a normal new-device link.
4. The old backend's rows just go stale (delete them whenever). Any
   queued-but-unsent writes drain to the new backend — ops are
   idempotent upserts of local rows, and the bulk push covers them
   regardless.

For retiring a device at the same time, Settings → Move progress
bridges with a file instead.

## File export/import

`src/lib/transfer.ts` + the Settings "Move progress" card write the same
five synced tables to a versioned JSON snapshot
(`{ format: 'quizmill-progress', version, packId, sessions, attempts,
achievements, votes, … }` — `buildSnapshot`/`parseSnapshot`/
`applySnapshot`) and import it through the same last-write-wins merge a
cloud pull uses — additive, idempotent, refuses files from a different
pack. Importing while signed in to a backend re-pushes everything so the
file's rows reach the cloud too (`useImportProgress` → `pushAllToCloud`).
No backend required.
