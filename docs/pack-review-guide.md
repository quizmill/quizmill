# Pack review guide

Pack review is where generated questions become trustworthy learning material.
Use this checklist for each question.

## Correctness

- The correct option is unambiguously correct for the prompt.
- Every distractor is wrong in a specific way, not just less fashionable.
- If more than one option is correct, the prompt says `Select TWO.` or
  `Select all that apply.` and uses `correctKeys`.

## Teaching value

- The explanation states why the answer wins.
- It also explains at least one tempting near-miss.
- It names the architectural trade-off: cost, latency, RTO/RPO, blast radius,
  governance, operability, lock-in, or security boundary.

## Pack hygiene

- Stable `id`s; never renumber existing questions.
- `categoryKey`, `level`, `scenarioId`, and `conceptId` references validate.
- `sourceRef` is present when adapted from external material.
- `reviewStatus` is `draft` until actually reviewed.

## Badges worth earning

- `generated` — AI-authored first draft, not yet reviewed.
- `human-reviewed` — every question got a human pass.
- `source-backed` — explanations cite source material.
- `exam-aligned` — categories/weights map to a public exam blueprint.
- `extreme-mode` — includes a declared level for deliberately nasty scenarios.
