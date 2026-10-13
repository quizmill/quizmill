# Investigation: Home density when every option is switched on

*Written 2026-10-13 for issue #188. Goal: a Home screen that still puts
practising first on a phone when a pack declares an exam and progression,
the device has Drive, Coach and Paper practice switched on, the browser
offers installation, and there are mistakes to review.*

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
more than one and a half screens down. Even the Review card, the loop's
best prompt, is at 1156 px. The desktop screenshot in the issue is the
same list at a wider column, so it reads as "busy" rather than "buried".

Measured from the real static build (demo pack, `npm run build`, phone
viewport 414×896) with every option on; `firstCategoryTop` is the y of
the first category card, `reviewTop` the Review-mistakes card:

| Layout                   | first category | Review card | page height | screens to scroll |
| ------------------------ | -------------: | ----------: | ----------: | ----------------: |
| today                    |           1403 |        1156 |        1767 |               1.6 |
| P0 quick wins only       |           1109 |         862 |        1563 |               1.2 |
| P1 practice first        |            350 |         127 |        1678 |               0.0 |
| P2 compress              |            795 |         549 |        1249 |               0.9 |
| P3 tab bar               |            342 |          95 |         899 |               0.0 |

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
on top; the categories are at 795 px, just under one screen; on desktop
the rail reads as a toolbar rather than a stack of banners.
**Cons:** the categories are still not visible without a scroll on a
896-px phone (they would be on a taller one); the tiles lose their
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
padding; on desktop a bottom bar looks wrong, so `sm:` and up render it
as a top nav. The level bar leaves Home; a learner sees it on the
Progress tab and in the level-up celebration instead.

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
