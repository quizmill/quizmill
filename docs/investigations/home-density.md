# Investigation: Home density when every option is switched on

*Written 2026-10-13 for issue #188. Goal: a Home screen that still puts
practising first on a phone when a pack declares an exam and progression,
the device has Drive, Coach and Paper practice switched on, the browser
offers installation, and there are mistakes to review.*

**Decision (2026-10-13): P3, built in full — see "As built" at the end.**
The proposals below are kept as the record of what was weighed.

## The problem, measured

Home is a single column that stacks, in order: header (title, subtitle,
four round nav buttons), the install banner, the progress card (level +
streak), two stat tiles (Answered, Readiness), a card per mode (Drive,
Coach, Paper, Exam), the Review-mistakes card, the level filter, and
finally the category cards — the thing a learner actually taps to
practise.

Each of those blocks is optional and was added one at a time, each
"above the categories" because it was the new thing. With all of them
on, the first category card sits at **1403 CSS px** on a 414×896 phone —
more than half a screen of scrolling before its top edge appears. Even
the Review card, the loop's best prompt, is at 1156 px, below the fold. The desktop screenshot in the issue is the
same list at a wider column, so it reads as "busy" rather than "buried".

Measured from the real static build (demo pack, `npm run build`, phone
viewport 414×896) with every option on. "first category" and "Review
card" are the y of the top edge of that card in CSS px from the top of
the page; "scroll to reach" is how far the learner has to scroll before
that top edge enters the viewport, `max(0, y − 896) / 896`, in viewports
— the same formula for every row (a card whose top edge is at 795 px is
visible without scrolling, though only its top edge):

| Layout                   | first category | Review card | page height | scroll to reach first category |
| ------------------------ | -------------: | ----------: | ----------: | -----------------------------: |
| today                    |           1403 |        1156 |        1767 |                            0.6 |
| P0 quick wins only       |           1109 |         862 |        1563 |                            0.2 |
| P1 practice first        |            350 |         127 |        1678 |                            0.0 |
| P2 compress              |            795 |         549 |        1249 |                            0.0 |
| P3 tab bar (mockup)      |            342 |          95 |         899 |                            0.0 |

The mockups are DOM rearrangements applied to the real page (same markup
and styles), captured by `docs/screenshots/home-density/capture.ts`
(gitignored, like all screenshots) and attached to the PR for #188.

## What is actually competing for the top of the screen

Three different kinds of thing share one column:

1. **Status** — level/XP, streak, answered, readiness. Motivating, but
   never something you tap to start.
2. **Ways to practise** — categories (the default loop), Review mistakes,
   the timed exam, Drive, Coach, Paper. Only categories and Review are
   things most learners use most days; the other four are occasional.
3. **App chrome** — the four nav buttons, the install banner, the
   upgrade pitch.

The fix is deciding which kind owns the fold. Every proposal below keeps
the same components and the same derived data; they differ only in
order, shape and where the chrome lives.

## P0 — quick wins only (no re-ordering)

Keep the order; trim what every proposal would trim anyway:

- Title at `text-2xl` on phones, subtitle clamped to one line. The demo
  subtitle alone costs four lines today.
- The install banner moves to the bottom of Home (the Settings card
  already explains installation; the banner is a nudge, not a gate).
- Answered + Readiness fold into the progress card as one small line,
  instead of two tiles with a dash in one of them.

**Cost:** an afternoon. **Trade-off:** the categories are still a full
screen down; this is a baseline, not an answer.

## P1 — practice first (re-order only)

Put the practice loop straight under the header: Review mistakes, the
level filter, the categories. Then a "Your progress" section (progress
card, stat tiles), then "More ways to practise" (Drive, Coach, Paper,
Exam cards unchanged), then the install banner.

**Pros:** smallest code change that fixes the fold; the first category
card lands at 350 px; nothing is redesigned, so the existing tests and
snapshots mostly hold.
**Cons:** the level and streak bars — the visible-progress loop the
progress card was built around — drop below the fold, which weakens the
daily-goal nudge ("3 more questions today to keep it alive") right where
it matters. The page is still 1678 px tall; it just scrolls in a better
order.

## P2 — compress (same order, half the height)

Keep the order but change the shape of the two biggest blocks:

- Stat tiles fold into the progress card (as P0).
- The four occasional modes (Drive, Coach, Paper, Exam) become a
  horizontal rail of square tiles — icon plus label, no blurb — under a
  "Modes" heading. Review mistakes stays a full-width card: it is the
  one mode that is a prompt, not a tool.
- Compact header (as P0), banner last.

**Pros:** the page shrinks from 1767 to 1249 px; the progress bars stay
on top; the first category's top edge is at 795 px, so it just makes the
fold on an 896-px phone; on desktop the rail reads as a toolbar rather
than a stack of banners.
**Cons:** only the top edge of the first category shows without a
scroll on an 896-px phone (a taller one shows more); the tiles lose their
one-line blurbs, so a first-time visitor learns less about what Coach or
Paper practice is; a rail with five or more tiles scrolls sideways,
which is easy to miss.

## P3 — split: a bottom tab bar, Home keeps only the practice loop

Give the app a bottom tab bar — Home, Progress, Stickers, Notes,
Settings — and let Home be nothing but ways to practise:

- Header: title, subtitle, and a single streak chip ("🔥 3-day streak"
  or "3 more today") in place of the four nav buttons.
- Review mistakes, level filter, categories.
- "More ways to practise": the mode rail from P2 (Drive, Coach, Paper,
  Exam).
- The progress card (level + streak bars, answered, readiness) moves to
  the Progress tab, which already shows the streak and readiness panel;
  the install banner goes with it to Settings (its card is already
  there) or becomes a one-time toast.

**Pros:** the whole of Home fits in one phone screen (899 px, nothing
to scroll); the fold problem cannot come back as packs opt into more
blocks; four icon buttons become labelled tabs, which is the convention
learners already know from every other app; the nav is reachable from
every route, not just Home.
**Cons:** the biggest change: a layout-level component shown on every
route, hidden during a runner (a session should not have a tab bar
under it) and in the full-screen paper/scratchpad views; it must share
the bottom edge with the update notifier and the layout's bottom
padding; on desktop a bottom bar looks wrong, so it is a phone-only
affordance and `sm:` and up keep the nav the app always had (Home's
header buttons, "← Home" on each page). The level bar leaves Home; a
learner sees it on the Progress tab and in the level-up celebration
instead.

## Recommendation

**P3, built in two steps.** Step one is P2 (compact header, folded
stats, mode rail, banner last) — every piece of it survives into P3 and
it is a visible win on its own. Step two adds the tab bar and moves the
progress card to the Progress tab. If the tab bar is too much change for
now, stop after step one and take P1's re-ordering on top of it (Review,
filter, categories above the progress card), which gets the categories
above the fold without any new chrome.

Things to settle before step two: whether the streak chip in the header
is enough visible progress on Home (the daily-goal line would only be on
the Progress tab), and whether Games (currently reached from Settings)
earns a tab or a tile in the mode rail.

## As built (P3, this PR)

Peter picked P3 and asked for it in full, so it shipped in one step
rather than the two above:

- **Tab bar** (`src/components/TabBar.tsx`, mounted once in the root
  layout): Home · Progress · Stickers · Notes · Settings. Fixed to the
  bottom on phones (safe-area padded; the update notifier lifts above
  it via a `data-tab-bar` flag on `<html>`), and **phones only** — from
  `sm:` up it is hidden and the app keeps the navigation it had before:
  the four round page buttons in Home's header and a "← Home" link at
  the top of Progress, Stickers, Notes and Settings. (A first cut
  rendered the bar as a top row on desktop and dropped the back links;
  review found that inconsistent with the rest of the app and the
  Home → Settings → Home round trip felt wrong, so desktop is unchanged
  from before this PR.) It shows only on the tab routes and Settings'
  `/packs` sub-page — never under a runner, Drive, Coach, Paper or
  Games — so a session has nothing to tap away to.
- **Home** is the practice loop only: compact header (title, subtitle
  clamped to two lines, a streak chip that reads "N-day streak" or
  "N more today" and opens Progress, plus the page buttons from `sm:`
  up), Review mistakes, the level filter
  and nudge, the categories, then "More ways to practise" — Drive,
  Coach, Paper and the timed exam as a rail of equal-width tiles (icon,
  label, a few-word caption). The upgrade card stays last.
- **Progress** opens with the level/streak card, now carrying one line
  of totals ("10 of 18 questions answered · 50% accuracy") in place of
  Home's two stat tiles; the exam-readiness tile is gone (the full
  readiness panel sits directly under the card).
- **Install banner** removed; Settings' install card is the one place
  that explains installation and offers the browser's install prompt.
- **Invariant kept:** Home still runs the `recordLevelCrossings`
  backfill on every attempts change (and ProgressCard does too), so
  imported or synced history is credited without visiting a runner.

Measured as above (414×896, everything on, 10 answers today, 5 wrong):

| Layout         | first category | Review card | mode rail | page height |
| -------------- | -------------: | ----------: | --------: | ----------: |
| P3 as built    |            363 |         116 |       570 |         896 |
| P3, no history |            256 |           — |       464 |         896 |

The whole page fits the viewport in both states: nothing to scroll. The
two open questions from the recommendation were settled as: the streak
chip is Home's only status (the daily-goal line lives on Progress), and
Games stays an easter egg reached from Settings — no tab, no tile.
