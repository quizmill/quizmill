# Investigation: the "More ways to practise" rail

*Written 2026-10-14 for issue #192. Three questions about the rail of
mode tiles that #188 put under the categories on Home: whether Drive,
Coach and Paper should be switched on in Settings the way they are;
whether the demo app should show every way of practising; and whether
it is clear that the timed exam is the pack's to switch on, not the
device's.*

## How the four modes are switched on today

| Mode | Switched on by | Stored as | Survives a pack swap | Survives "Reset all local progress" |
| --- | --- | --- | --- | --- |
| Drive | Settings → This device | per pack, inside `quizmill.<packId>.prefs.v1` (`driveMode`) | no | no |
| Coach | Settings → This device | app-level `quizmill.coach.v1` | yes | yes |
| Paper | Settings → This device | app-level `quizmill.paper.v1` | yes | yes |
| Timed exam | the pack: `exam.durationMinutes` in pack.json | not stored; derived once at module load from the ACTIVE manifest (`EXAM_SITTING` over `activeManifest`, so a runtime pack from the library or `quizmill.activePack` is honoured, and a pack swap reloads) | follows the new pack | n/a |

Measured on the real static build of the demo pack (414×896 phone,
nothing answered yet):

- Fresh device: the rail holds one tile, **Mock exam**. Drive, Coach and
  Paper exist only as three cards under Settings → This device, below
  Appearance.
- Everything on: four equal-width tiles (Drive · Coach · Paper · Mock
  exam), each about 88 CSS px wide. The captions still fit ("Print &
  mark", "9 Qs · 13:30"); a fifth tile would not.

## Q1 — does switching Drive, Coach and Paper on in Settings make sense?

**Yes, for all three.** Each one is about the device and who is holding
it, not about the pack: Drive needs a car and the speech APIs, Coach is
for the parent or tutor's phone and records nothing, Paper needs a
printer or a pencil on a tablet. None of them is something a learner
practising on their own phone wants in the rail by default, and the rail
has room for exactly four tiles, so opt-in is the right default. The
"Open … " link that appears under a switched-on card also means a
learner never has to go back to Home to find the mode they just enabled.

Two things are off, though:

1. **Drive is the odd one out in storage.** Settings presents all three
   under "This device", and `paper.ts`/`coach.ts` both say "a device-level
   opt-in, NOT a pack pref", but Drive predates `devicePref` and still
   lives in the pack's prefs blob. The visible effects: switching packs
   in the library turns Drive off again (Coach and Paper stay on), and
   "Reset all local progress" wipes the Drive switch along with the
   history (Coach and Paper survive, as the reset's own doc says device
   prefs should). CLAUDE.md's invariant — device-level switches are
   app-level keys through `devicePref` — already says where it belongs.
   Moving it is a one-file change plus a one-time promotion of the old
   `driveMode` flag out of the prefs blob, so nobody's switch flips off.
2. **The blurbs still say "Adds a card to the home screen."** Since #188
   a switched-on mode is a tile under "More ways to practise". Wording
   only.

## Q2 — should the demo app show every way of practising?

**Today it shows one of four.** A visitor to the demo sees the Mock exam
tile and nothing else; Drive, Coach and Paper are invisible unless they
open Settings and scroll past Appearance. The website does not mention
any of the three either (a code search of `quizmill/website` for "drive
mode", "coach mode" and "paper practice" finds nothing). For a pack
whose stated purpose is to be the schema showcase, three of the engine's
four occasional modes are undiscoverable.

Three ways to fix it, in increasing size:

- **A. Keep the device switches, add a pack default.** A new optional
  manifest block, e.g. `modes: { drive: true, coach: true, paper: true }`,
  following the `look` precedent exactly: the pack says what it ships
  with, the device switch overrides either way, and an untouched device
  follows the pack (the stored key is absent → read the manifest). The
  demo declares all three; a kids' pack could ship Paper on; a
  certification pack ships none. Additive, so the schema stays at 2.
  Needs Drive moved to a device pref first (Q1.1) so all three resolve
  the same way. Roughly a day with tests.
- **B. A demo-only build flag.** `NEXT_PUBLIC_…` read by Home. Cheapest,
  but the demo stops being a representative build of the engine, and
  every other pack still cannot show a mode by default.
- **C. Make the switches discoverable from Home instead.** When at least
  one of the three is off, a trailing ghost tile ("More…") in the rail
  links to Settings → This device. No manifest change and it helps every
  pack, but it puts chrome back on Home right after #188 took it out,
  and it only tells the visitor *that* there is more, not what.

**Recommendation: A.** It is the same shape as `look`, it answers the
question for every pack rather than just the demo, and the demo's
pack.json then documents the feature for authors by example.

## Q3 — is it clear that the timed exam is the pack's to switch on?

**For a pack author, yes. For a learner, no.**

- Author side: the README's "timed exam" bullet and the schema comment on
  `exam.durationMinutes` both say that setting the length switches on
  the timed sitting; the demo pack declares `exam: { label, passPct,
  questionCount, durationMinutes }` as the worked example. The
  `create-learning-pack` skill reads the same schema. Clear enough.
- Learner side: the Mock exam tile sits in the same rail, under the same
  heading, as three tiles that each have a switch in Settings — and
  Settings → This device says nothing about it. A parent who wants to
  hide the timed exam from a nervous eleven-year-old, or a learner who
  wonders why the fourth tile has no switch, finds no answer in the app.

The engine already has the pattern for "the pack declares it, the device
may hide it": **Levels & XP**. `progression` in the manifest switches the
ladder on; Settings shows a "Levels & XP" card only for packs that
declare it, and the switch hides the display on that device without
losing anything. The timed exam fits that pattern exactly:

- Pack declares `exam.durationMinutes` → the tile shows (as today).
- Settings → This device gets a **Timed exam** card, shown only for packs
  that declare one, on by default, with the pack's own numbers in the
  blurb ("Mock exam: 20 questions in 30 minutes, set by this pack").
  Switching it off hides the tile on this device; the route still exists
  (every route exists in every build) and readiness on Progress is
  unaffected.

That card is also the in-app sentence that answers the question: the
exam comes from the pack, the device only chooses whether to show it.
Half a day with tests.

A side note from the measurement: on the demo the tile reads
**"9 Qs · 13:30"** because the sitting deals from the last declared level
(Advanced, 9 questions) and pro-rates the declared 20-question,
30-minute exam. That is the documented behaviour, but on the showcase it
looks like a bug. Either the demo's Advanced level needs more questions
or its `exam` block should declare a scope or a count the bank can
honour.

## Summary of recommendations

| # | Change | Size |
| --- | --- | --- |
| 1 | Move the Drive switch to an app-level `devicePref` with a one-time promotion of the old per-pack flag | small |
| 2 | Reword the three Settings blurbs ("a tile under More ways to practise") | trivial |
| 3 | Optional `modes` manifest block as pack defaults for Drive/Coach/Paper; the demo declares all three | medium |
| 4 | "Timed exam" device card in Settings for packs that declare one, on by default, hides the tile when off | small |
| 5 | Make the demo's exam block match its Advanced bank (or vice versa) | trivial |

1, 2 and 5 are housekeeping; 3 and 4 are the two product choices in the
issue and are worth a word from the maintainer before they are built.

## Outcome

All five accepted (2026-10-16) and built on the same branch:

1. Drive is `quizmill.drive.v1` (`src/lib/drive.ts`); `devicePref` gained
   a `legacy` hook that promotes the old `driveMode` out of the pack's
   prefs blob on first read.
2. The blurbs say "Adds a tile under “More ways to practise” on Home."
3. `modes: { drive?, coach?, paper? }` in pack.json
   (`src/lib/practiceModes.ts`). The three switches store '1' / '0';
   an absent key follows the pack. A Coach or Paper switch saved as
   '1' before this change keeps working. A switch someone turned off
   earlier left no key, so it now follows the pack, and that is still
   off unless the pack says otherwise.
4. Settings → This device → **Timed exam** (`src/lib/examPref.ts`,
   `quizmill.examHidden.v1`), only for packs with a sitting.
5. The demo's exam declares 9 questions in 15 minutes: exactly its
   Advanced band, so nothing is pro-rated.

How the four ways now fit together — who switches each on, and what a
fresh phone sees on the home app at app.quizmill.dev (the starter
pack, since #213: no rail until a pack is in or a switch is flipped)
and on the demo — is written up for authors and learners in the
README's "Ways to practise" section (2026-10-21).

Review follow-up (2026-10-21): the rail's tiles had kept the tones of
the full-width cards they replaced (Drive dark, Coach brand-tinted,
the rest neutral), so Coach looked selected. Every tile now wears the
same neutral tone.
