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

- **A stratified sample, capped at thirty minutes.** Every domain
  (= pack category) gets a floor of three questions so it can be judged
  at all. The budget is the larger of *domains × floor* and *a third of
  `exam.questionCount`*, capped at the in-scope bank and at **thirty
  minutes of the real exam's pace** (`durationMinutes / questionCount`;
  a minute a question when the pack declares no pace). When the cap
  can't afford three per domain the floor drops uniformly — two, then
  one — so the sitting still spans the whole blueprint; anything above
  the floor follows the blueprint weights (bank size when the pack
  declares none — the fallback readiness already uses). Water-filling:
  each domain takes `level × share` clamped to [floor, bank] and the
  level rises until the total meets the count, so a domain pinned at
  either bound is reconsidered as the level moves and the sitting is
  always exactly the advertised length. Unseen questions first, then
  the hand is shuffled so domains are mixed as on the real exam.
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
(`CHECK_DOMAIN_FLOOR`) if it proves too blunt.

**How long is "about 30 minutes".** Thirty minutes is the hard limit,
measured at the real exam's pace (`durationMinutes / questionCount`,
or a minute a question when the pack declares no pace), and the plan
sizes the sitting down to fit: 6 questions / 10 min on the demo; on a
ten-domain pack whose exam allows 2.4 minutes a question, 12 questions
(one or two per domain) in about 29 min — the first version quoted 30
questions at 72 min there, which was the full floor but not a
temperature check. The check stays untimed and sized in questions; the
intro quotes the minutes honestly and notes practice is usually
quicker. The cap is one constant (`CHECK_MAX_MINUTES`); the other
lever, if 12 questions over ten domains reads too thin, is to budget
at a practice pace rather than the exam's.

**Do the check's attempts feed normal readiness?** Yes, unchanged:
they are first attempts with the real category, so the Progress panel
moves on from them (the E2E spec asserts it), the mistakes queue picks
up the misses, and XP and stickers see them like any practice.

**A pack without weights.** Offered, with bank size as the weight —
readiness's own fallback, and what the validator already warns about.
On a sampler with equal banks the study order then ranks by shortfall
alone.

## Not built, deliberately

- **The adaptive second pass** (spend remaining budget on domains
  whose band straddles the line). The fixed sample should be judged
  first; the deal is one pure function, so a second pass is additive.
- **A device switch to hide the tile.** The timed exam has one; the
  check does not yet. One more `devicePref` if wanted.
- **Blueprint weights on exam packs that lack them.** Content, not
  engine: the result page is only as good as the weights the pack
  declares.
