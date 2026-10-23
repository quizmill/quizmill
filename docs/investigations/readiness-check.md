# Readiness check: one sitting that says whether to sit the exam, or where to study first

*Written 2026-10-22 for issue #215, alongside the first implementation.
The question: someone with years of hands-on experience opens an exam
pack and wants two answers in one sitting, before any practice history
exists — could I pass today, and if not, which domains first? Today's
readiness (`src/lib/readiness.ts`) is coverage-gated, so a new learner
sees "needs more data" everywhere for days.*

## What was built

A **readiness check** mode (`/practice/check/`, a tile under *More ways
to practise*) for any pack with an `exam` block. Pure logic in
`src/lib/readinessCheck.ts`, the pack glue in `src/pack/check.ts`, the
runner and result page in `src/pack/CheckRunner.tsx` /
`CheckResult.tsx`.

- **A stratified sample inside a time box the learner picks.** The
  intro offers ten, twenty or thirty minutes (`CHECK_BUDGETS_MINUTES`;
  the last is the ceiling and there is no longer option), opening on
  the shortest that affords three questions per domain at the exam's
  pace. The plan converts the budget into questions at **the real
  exam's pace** (`durationMinutes / questionCount`; a minute a question
  when the pack declares no pace), capped at the in-scope bank. Every
  domain (= pack category) gets a floor of three so it can be judged at
  all; when the budget can't afford that the floor drops uniformly —
  two, then one, then none, in which case the heaviest domains get the
  look — and anything above the floor follows the blueprint weights
  (bank size when the pack declares none — the fallback readiness
  already uses). Water-filling: each domain takes `level × share`
  clamped to [floor, bank] and the level rises until the total meets
  the count, so a domain pinned at either bound is reconsidered as the
  level moves and the plan is always exactly the advertised length.
- **Dealt in rounds, under a clock, as long as the time allows.** The
  deck is the whole in-scope bank, ordered: the planned hand first, in
  rounds — one question from every domain with a planned question
  left, the domains shuffled within each round — so a sitting the clock
  cuts short still spans the blueprint evenly; then the rest of the
  bank apportioned by blueprint share (highest averages), for a learner
  quicker than the exam's pace. Within a domain unseen questions come
  first. After each answer the runner deals another only while the time
  left holds one at the learner's own pace so far (answer plus
  feedback), so the sitting ends cleanly with every answered question
  counted; and the clock ends it outright when the budget is spent,
  dropping the question on screen. Nothing ever asks for more time.
  The session records the questions actually answered, so a cut-off
  sitting reads back honestly.
- **Feedback per question, as in practice.** The key, the explanation,
  the per-option verdicts, the concept card. What keeps it a cold look
  is that every question is asked exactly once — so each attempt is a
  first attempt and readiness's *latest cold look* rule counts the
  sitting as ordinary history afterwards.
- **A result page built for planning.** The verdict and band against
  the pass line (readiness's own gauge and pills, computed over the
  sitting at the check floor); a **study order** of the weak domains
  ranked by blueprint share × points below the pass line, each a tap
  into practice restricted to that domain, with the missed questions
  and the concepts behind them; every domain's standing (solid / weak /
  thin); and, after *sit it again*, the change since the previous
  check overall and per domain.
- **Attempts are the only record.** Mode `'check'` on the session and
  its attempts, the real category key on each attempt, the `check`
  pseudo-subject on the session (the timed exam's pattern). A past
  check reads back from its session id; nothing new is stored or
  synced.
- **It syncs because of that.** The sync engine mirrors the sessions
  and attempts stores as they are, and neither it nor the worker looks
  at `mode` or `subject`, so a sitting rides the same two tables as
  practice and reads back as a check on every device holding the key:
  the last-check card, the comparison and Progress's readiness all
  follow it across devices, and the Home card retires everywhere once a
  check exists anywhere. The only piece that stays on the device is the
  Home card's *Not interested* close, a local pref like the level filter.
  `tests/sync-worker-e2e.test.ts` pins this against the real worker and
  schema. Nothing on the server changes; the usage report counts a
  check's rows as sessions and attempts like any other.

## The open questions, answered for now

**Minimum sample per domain.** Three, when the time cap allows it.
Readiness's twelve would make a ten-domain check 120 questions. Three
is enough to notice a domain is weak (one miss is 67%, under most pass
lines) and far too few for a tight band, so the result page says so in
words ("a temperature check, not a verdict") and the study order ranks
by point estimate, not by band. The overall verdict is honest at this
size because it is weighted across the whole sitting: on the demo (6
questions) a 3/6 reads *borderline*, not *not ready*, because the band
still reaches the line. Under the time cap the floor can drop to one:
then a domain's standing is one answer, the study order is a pointer
rather than a ranking, and the result page's footnote says how many
questions each domain got. The floor is one constant
(`CHECK_DOMAIN_FLOOR`) if it proves too blunt. A result is judged at the
floor *its own size* could afford (`checkFloorFor` over the questions
answered, at least one), not at the recommended plan's: a learner who
picked ten minutes where twenty would have bought three a domain is
read at two, with the misses ranked, rather than told every domain is
thin.

**The headline band.** Readiness sums each domain's Wilson band — fine
over a dozen first attempts a domain, meaningless over one: ten
domains at one question each span nearly 0–100 and called 2/9 "right
on the line". The check is one stratified sample, so its band is the
Wilson interval of the weighted estimate at the sitting's judged
sample size (2/9 → 6–55%, *not ready yet*; 3/6 on the demo → 19–81%,
still *right on the line*), and the verdict reads off it on
readiness's own tiers (`verdictFor`). Per-domain standings are
untouched.

**How long is "about 30 minutes".** It is up to the learner, up to
thirty: the intro offers ten, twenty or thirty minutes and the sitting
runs under that clock. Thirty is the hard limit and there is no longer
option; the clock never asks for more time, it ends the sitting. The
budget is converted into an advertised question count at the real
exam's pace (`durationMinutes / questionCount`, or a minute a question
when the pack declares no pace): 6 questions for ten minutes on the
demo (18, the whole in-scope bank, for thirty); on a ten-domain pack
whose exam allows 2.4 minutes a question, 12 questions (one or two per
domain) for thirty — the first version quoted 30 questions at 72 min
there, which was the full floor but not a temperature check. The
count is an estimate, not a contract: a learner quicker than the
exam's pace is dealt more (the deck continues by blueprint share), a
slower one fewer, and because the deck is dealt in rounds across the
domains either way still spans the blueprint. The budgets are one
constant (`CHECK_BUDGETS_MINUTES`).

**Do the check's attempts feed normal readiness?** Yes, unchanged:
they are first attempts with the real category, so the Progress panel
moves on from them (the E2E spec asserts it), the mistakes queue picks
up the misses, and XP and stickers see them like any practice.

**A pack without weights.** Offered, with bank size as the weight —
readiness's own fallback, and what the validator already warns about.
On a sampler with equal banks the study order then ranks by shortfall
alone.

**Where the check is offered.** An exam pack's Home asks "could you
pass today?" in a card above the practice loop — something to see and
do, or see and close — rather than a tile the learner has to find or a
switch in Settings. The card retires once a check has been sat (the
result lives on the check page, reached from the rail's tile and the
Progress panel) or when the learner says "not interested", which is
remembered per pack in the pack's local prefs. The tile in *More ways
to practise* stays either way.

## Not built, deliberately

- **The adaptive second pass** (spend remaining budget on domains
  whose band straddles the line). The extension past the plan follows
  blueprint share, not the live result; a second pass that targets
  straddling domains is additive, since the deal is one pure function.
- **A device switch to hide the tile.** The timed exam has one; the
  check does not. Home's prompt card has its own close, which is the
  opt-out that was asked for.
- **Blueprint weights on exam packs that lack them.** Content, not
  engine: the result page is only as good as the weights the pack
  declares.
