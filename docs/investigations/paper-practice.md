# Investigation: practice on paper (print sheets, mark them back in)

*Researched 2026-09-22. Goal: let a child (the eleven-plus learner) do
sessions of ~10 questions **on paper**, then get the results back into
the app's progress — ideally by snapping a photo of the finished sheet —
so streaks, mistakes review, readiness and stickers keep tracking even
when practice didn't happen on a screen.*

## TL;DR

The engine is already shaped for this; no server changes are needed at
all. Attempts are plain denormalised records (`src/data/types.ts`) that
any code can write, the sync server is a dumb mirror with open CORS and
sync-key bearer auth (`docs/sync-protocol.md`), and every downstream
surface (stats, streak, mistakes queue, readiness, stickers, coach)
consumes attempts without caring how they were produced. So paper
practice decomposes into two independent halves:

1. **Print** — a `/paper` route in the app that composes a worksheet
   from the existing selection engine and prints it with a per-sheet
   **QR code that is a deep link back to a marking page**, carrying the
   question list in the URL fragment.
2. **Mark** — entering which letters the child wrote. The easiest
   reliable path is **tap-to-mark** (parent scans the QR, taps 10
   letters, ~20 seconds); the photo-snap path is best done as a
   **repo skill run in Claude** (same pattern as
   `generate-questions-from-notes`), which reads the photo, grades
   against the pack, and POSTs the rows straight to the sync server
   with the sync key — again zero engine/server changes.

Recommended ladder: **(A)** print route + tap-to-mark (all in-app,
one PR) → **(B)** `mark-paper-sheet` skill for photo marking →
**(C, maybe never)** in-app camera/OCR.

## What the codebase already gives us

- **Selection is pure and seedable.** `pickSessionQuestions`
  (`src/lib/selection.ts`) takes a bank + attempted-id history + rng and
  returns a session's questions. A print route can call exactly what
  `pickSessionFromBank` (`src/pack/runner.ts`) calls today, so paper
  sheets get the same unseen-biased, wrong-first-repeat behaviour as
  on-screen practice — and printing from any device signed in with the
  learner's sync key sees the learner's real history (pull-and-merge on
  every app load, `src/lib/sync.ts`).
- **Attempts/sessions are backend-agnostic rows.** An `Attempt` needs no
  question shape — id, sessionId, questionId, timestamp, selected,
  isCorrect, subject/topic/difficulty. Writing them through
  `storage.saveSession`/`saveAttempt` fires the mutation bus, which
  queues idempotent sync upserts automatically. Nothing downstream
  distinguishes "typed on screen" from "entered by a parent".
- **`timeTakenSeconds: 1` already means "unmeasured"** (documented on
  the type) — exactly right for paper attempts.
- **`mode` is an optional, closed union** (`SessionMode`). Adding
  `'paper'` is the schema-conventions-compliant move: absent still reads
  as `'practice'`, old rows unaffected. `SESSION_MODE_LABEL` in
  `src/lib/coachSessions.ts` is a `Record<SessionMode, string>`, so the
  compiler forces the one label addition; stats/readiness/streak don't
  branch on mode at all, so paper sessions flow into every aggregate
  unchanged (grep confirms: no `mode ===` filters in `stats.ts`,
  `readiness.ts`, `streak.ts`).
- **The sync protocol accepts third-party writers today.** `POST
  /v1/ops` with `Authorization: Bearer QM-…` upserts arbitrary
  session/attempt rows; CORS is `*`; ops are idempotent. A skill or
  external page holding the sync key can inject a marked paper session
  with no server change — this is the same trick
  `generate-questions-from-notes` already plays in the read direction.
- **The child's device picks changes up on next app open** —
  `startSync()` pulls the full snapshot on every load (via
  `getUserId()` → `handleSignedIn` → `pullAll`) and merges
  last-write-wins.
- **Coach mode is the template for a parent-facing surface**: a
  device-level opt-in key (`quizmill.coach.v1`, `src/lib/coach.ts`)
  that adds a Home card and a route. Paper mode should gate the same
  way (`quizmill.paper.v1`) so the child's normal UI stays untouched.

## Consequences that fall out for free (all desirable)

- **Streak** counts the paper day as a practice day (it's attempts by
  `answeredAt` date).
- **Mistakes review**: questions marked wrong enter the re-ask-until-
  rescued queue, so the child *reviews paper mistakes on the device* —
  arguably the best part of the loop.
- **Readiness**: a paper sheet is a genuine cold sitting; its first
  attempt per question is a textbook "cold look".
- **Coach mode** replays the paper session like any other, letting
  parent and child go through the explanations together.
- **Stickers/achievements** run off the same records.

One deliberate choice: stamp `answeredAt` with the **marking time**, not
a guessed sheet time. It's honest (we don't know when the child sat it),
keeps `lastAnsweredAt` ordering sane for selection, and only shifts the
streak day if marking happens after midnight — acceptable.

## Phase A — print + tap-to-mark (recommended first PR)

All in this repo, no schema-version bump (additive `mode` value only),
no server work.

### `/paper` route (opt-in via Settings, like Coach)

1. **Compose**: pick count (default 10 — comfortably one A4 side for
   text questions; image/non-verbal questions auto-paginate), optional
   category + level filter (the same filters practice has). Call the
   existing bank/selection helpers.
2. **Persist the sheet** locally at print time:
   `quizmill.<packId>.paperSheets.v1` → `{ sheetId, createdAt,
   questionIds[] }`, with a short human code (e.g. `P-7KQ4`, base32 from
   the sheetId). This is the source of truth for marking on the same
   device; it deliberately does NOT sync (no new table).
3. **Print layout**: a print stylesheet (`@media print`) — question
   number, prompt, options A–F, images via the existing `PackImage`
   resolution (build assets or `assetsBase`; they print fine), and a
   **write-in answer box** per question ("write the letter(s)") rather
   than circle-the-option. A letter in a box is dramatically easier for
   both a tired parent and a vision model to read than a circled option,
   and it handles multi-answer questions ("write all that apply" —
   graded all-or-nothing by set equality exactly like on-screen,
   `gradeSelection`).
4. **Header**: pack name, date, sheet code, and a **QR code** encoding
   `<app origin>/paper/mark#s=<base64url({v:1, pack, sheetId, qs:[ids]})>`.
   ~10 ids ≈ a few hundred bytes — trivial for QR. No answers in the
   payload (the marking device grades from its own pack bank), so
   nothing to "decode and cheat" beyond what the child could google
   anyway. QR generation is a tiny dependency (`qrcode` is
   zero-frills) or a ~150-line vendored generator, both fine for a
   static export.

### Marking screen (`/paper` list → sheet, or the QR deep link)

- Shows each question compactly (prompt + options), parent taps the
  letter(s) the child wrote; explicit "no answer / skipped" per row
  (skips simply produce no attempt, like abandoning mid-session).
- On save: build one `Session { mode: 'paper', subject: category or
  'paper' for mixed }` + one `Attempt` per answered question
  (`timeTakenSeconds: 1`, `position` = sheet order) through the normal
  storage API. Sync does the rest.
- Guard against double-marking: stamp the local sheet record
  `markedAt` + `sessionId`; re-opening a marked sheet shows the result
  read-only (re-mark = explicit "mark again" that upserts the same
  session/attempt ids, so it corrects rather than duplicates).
- The QR deep link makes **cross-device marking** work with zero sync
  machinery: the payload in the fragment carries the question list, so
  the parent's phone needs only (a) the same pack active and (b) the
  same sync key entered in Settings. Both are one-time setup a
  household with sync already has.

Why tap-to-mark first: 10 taps is genuinely faster than photograph →
upload → wait → verify, it works offline in the car/kitchen, and it
exercises 100% of the plumbing the photo path needs (sheet identity,
grading, upsert semantics). The photo path then only replaces the
input method.

### Effort

Roughly: `data/types.ts` one-line mode addition + label; a
`src/lib/paperSheets.ts` (pure: compose/encode/decode/grade — fully
unit-testable in node); `/paper` + `/paper/mark` routes and print CSS;
Settings toggle + Home card behind the opt-in. Comparable in size to
Coach mode. E2E: print route renders the demo pack; mark flow writes a
session (assert via localStorage), screenshots per the visuals
convention.

## Phase B — the snap: `mark-paper-sheet` skill

The "take a photo and it just uploads" wish needs vision + compute, and
quizmill is deliberately a static app with a dumb-mirror server. The
cheapest place vision already exists in this project's workflow is
**Claude itself**, and there's precedent: `generate-questions-from-notes`
already authenticates to the sync backend with the sync key from a
skill. So:

- New repo skill `mark-paper-sheet`: the parent drops photo(s) of
  finished sheets into a Claude (Code/Cowork) conversation and invokes
  the skill with the sync key + pack repo/dir.
- The skill decodes the QR from the photo (or falls back to the printed
  sheet code + question order against the sheet payload the parent can
  paste), reads the letter in each answer box, **echoes its reading
  back for confirmation** (child handwriting; a confirm step beats
  silent mis-grades), grades against the pack's `questions.json`, and
  POSTs `sessions` + `attempts` WireOps to `NEXT_PUBLIC_SYNC_URL`
  (`sync.quizmill.dev` for the family apps) with the bearer key.
- The child's app shows the results on next open, and wrong answers are
  already waiting in the review queue.

Zero changes to app or server — the protocol accepts these rows today;
Phase A's `mode: 'paper'` value is the only engine prerequisite. This is
also the path that scales to "photograph three sheets at once".

## Phase C — probably never

In-app camera capture + on-device OCR (or a user-supplied Claude API
key) could make marking fully self-contained, but handwriting OCR of a
9-year-old's letters without a confirm loop will mis-grade, an API key
in a static family app is a footgun, and Phase A marking is already a
20-second job. Revisit only if Phase B sees heavy use. If
`quizmill-cloud` ever wants this, it can host the vision step behind its
own funnel using the same WireOp injection.

## Open choices (deliberate defaults, cheap to change)

| Choice | Default | Why |
| --- | --- | --- |
| Sheet questions per page | 10, auto-paginate for images | matches a session; fits A4 for text banks |
| Answer capture on paper | write-in letter box | easiest to read (human + model); handles multi-answer |
| `answeredAt` | marking time | honest; ordering-safe |
| Sheet persistence | local only + QR self-describing | avoids a new synced table; QR covers cross-device |
| Duplicate marking | upsert same ids | idempotent, correctable |
| Feature gating | device opt-in like Coach (`quizmill.paper.v1`) | child's UI unchanged |
