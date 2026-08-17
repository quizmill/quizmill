# Community packs

Quizmill packs are small JSON repos that turn into installable, offline-first
practice apps. The community loop is deliberately simple:

1. Request a pack.
2. Generate or write a first draft.
3. Validate it.
4. Review the questions.
5. Publish the pack repo and add it to the registry.
6. Keep improving it from learner feedback.

## Request a pack

Open a `Pack request` issue with:

- topic and audience
- target question count
- source material or exam blueprint links
- what would make the pack trustworthy

Good first public packs are usually 30–50 questions across 3–8 categories.
Large exam packs can grow later after the first review loop works.

## Create a pack

Scaffold locally:

```sh
npx quizmill new pack-my-topic
```

Then fill:

- `pack.json` — title, description, categories, optional levels/sources/exam metadata
- `questions.json` — the question bank
- `scenarios.json` — only when multiple questions share one narrative setup

Validate until clean:

```sh
npx quizmill validate pack-my-topic
```

Run it:

```sh
npx quizmill run pack-my-topic
```

## Review a pack

A useful review checks:

- Is the answer defensibly correct?
- Are distractors plausible rather than silly?
- Does the explanation teach the trade-off?
- Are multi-answer questions clearly marked, e.g. `Select TWO.`?
- Are external sources/licences credited?
- Is `reviewStatus` honest?

Question banks should start as `draft`. Move individual questions to
`reviewed` or `approved` only after a human pass.

## Publish a pack

Create a public repo such as `quizmill/pack-aws-arch-pro` with the pack files
at the repo root. Add a README with:

- what the pack covers
- how many questions it has
- review/source status
- any trademark or affiliation disclaimers

Then open a registry PR adding the repo to `tools/pack/registry.json`.
