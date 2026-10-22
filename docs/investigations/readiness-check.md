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

- **A stratified sample.** Every domain (= pack category) gets a floor
  of three questions so it can be judged at all. The budget is the
  larger of *domains × floor* and *a third of `exam.questionCount`*,
  capped at the in-scope bank; anything above the floor follows the
  blueprint weights (bank size when the pack declares none — the
  fallback readiness already uses). Water-filling, so a small domain
  pinned at its bank size hands its share to the others. Unseen
  questions first, then the hand is shuffled so domains are mixed as on
  the real exam.
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

**Minimum sample per domain.** Three. Readiness's twelve would make a
ten-domain check 120 questions. Three is enough to notice a domain is
weak (one miss is 67%, under most pass lines) and far too few for a
tight band, so the result page says so in words ("a quick read, not a
verdict") and the study order ranks by point estimate, not by band.
The overall verdict is honest at this size because it is weighted
across the whole sitting: on the demo (6 questions) a 3/6 reads
*borderline*, not *not ready*, because the band still reaches the
line. Measured on the demo's two domains and on a ten-domain
certification sampler (30 questions, three per domain). The floor is
one constant (`CHECK_DOMAIN_FLOOR`) if it proves too blunt.

**How long is "about 30 minutes".** The check is sized in questions,
not minutes, and untimed. The intro quotes the time at the real exam's
pace when the pack declares `durationMinutes` and `questionCount`: 10
min on the demo; 72 min on a ten-domain pack whose exam allows 2.4
minutes a question. That is the honest number — a thirty-minute budget
at that pace would be twelve questions over ten domains, which judges
nothing — and practice is usually faster than exam pace. If 72 minutes
is too long for the cold-look use, the lever is the floor, not the
pace.

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
