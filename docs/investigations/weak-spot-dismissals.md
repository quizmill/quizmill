# Investigation: removing a question from the weak-spot list by hand

*Written 2026-10-26 for issue #237. Goal: say what the cheapest design is
for letting a learner drop a question from the weak-spot list ("I know
this one, stop asking") without breaking the engine invariants, and what
it would cost, so a follow-up ticket can be filed. Not built.*

## Why it needs storage

The weak-spot list is derived from attempts (`weakSpots` in
`src/lib/mistakes.ts`): a question is listed when it has a wrong attempt
and fewer than N right answers in a row since. A hand removal is a user
decision that no attempt records, so it has to be stored somewhere. The
only options that respect "everything is derived from attempts" are:

1. **Record an attempt.** Writing a synthetic correct attempt would clear
   the question, but it pollutes XP, readiness, streaks, stats and
   sticker eligibility with an answer that was never given. Rejected.
2. **A device pref.** App-level, unsynced, survives reset. But the list is
   per pack and per learner: a dismissal would not follow the learner to
   another device, would be lost from progress export, and would outlive
   "Reset all local progress". Rejected.
3. **A per-pack synced table.** The right shape. See below.

## Closest precedent: votes, not achievements

The issue names the achievements store as the only stored record. It is
the only stored *derived* record, but **votes and notes are already
user-action tables** keyed by question id, and they are a closer fit than
achievements:

| | achievements | votes / notes | dismissals (proposed) |
|---|---|---|---|
| key | achievement id | question id | question id |
| written by | the engine (recorders) | the learner | the learner |
| server op | insert-if-absent | upsert + delete | upsert + delete |
| merge | earliest wins | latest `…At` wins | latest `dismissedAt` wins |

So a dismissals table is "one more votes", not a new kind of thing.

## Proposed design

- **Row:** `{ questionId: string; dismissedAt: number }` under
  `quizmill.<packId>.weakSpotDismissals.v1`.
- **Rule:** `weakSpots` drops a question when `dismissedAt` is later than
  its latest wrong attempt. A new mistake after the dismissal puts it
  straight back, so there is no "undismiss" to build and a stale row is
  harmless; a fresh dismissal is an upsert.
- **Everything else stays derived.** XP, readiness and stickers never
  read the table; only the list (Home count, list page, review queue)
  does.
- **UI:** a small "I know this — remove" on each row of the list page.
  Nothing on the question screen.

## What it touches

Following the path votes take today:

- `src/lib/storage.ts` — key, load/save, `notify` change, `clearAll`,
  the remote-merge step (latest `dismissedAt` wins), plus the hook in
  `src/lib/useStorage.ts`.
- `src/lib/sync.ts`, `src/lib/syncBackend.ts`,
  `src/lib/backends/httpBackend.ts` — the queue op, bulk push and pull
  types.
- `src/lib/transfer.ts` — snapshot build/parse/counts so export/import
  carries it.
- `cloudflare/src/ops.ts` (`TABLES`) and the pull shape in
  `cloudflare/src/worker.ts` — add the table name. The
  generic `rows` schema needs **no D1 migration**, but the server must be
  deployed before the client ("Adding a table: deploy the server first"
  in `docs/sync-protocol.md`).
- `docs/sync-protocol.md` — the table list and the delete op.
- Tests next to each: `storage-merge`, `transfer`, `sync`,
  `worker-sync`, `sync-worker-e2e`, `mistakes`, and the list page.

Roughly the footprint of the `notes` table: a day's work, one server
deploy, no data migration. Rows from older builds have no dismissals and
read as "nothing dismissed".

## Open question for the follow-up

Is it still wanted now that the clear count is a setting? Turning N down
to 1 and answering once already clears a question the learner knows. If
the request is mostly "one lucky guess shouldn't clear it", N = 2 covers
it and the table can wait for a second ask.
