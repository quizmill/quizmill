## Pack submission checklist

If this PR adds or updates a public pack registry entry, please confirm:

- [ ] The pack repo contains `pack.json`, `questions.json`, and optional `scenarios.json`.
- [ ] `npm run pack:validate <pack>` passes locally.
- [ ] Every question has exactly one defensible answer, or a deliberate `correctKeys` multi-answer set.
- [ ] Explanations teach why the answer is right and why tempting distractors are wrong.
- [ ] `reviewStatus` reflects reality (`draft` until human reviewed).
- [ ] Sources/licences are documented if questions are adapted from external material.
- [ ] The registry entry includes a live demo URL when available.

## Reviewer notes

What should reviewers focus on?
