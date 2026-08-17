# Pack registry

The public pack registry lives at `tools/pack/registry.json` and powers
`npm run pack:list`, the in-app pack browser (`/packs`), and the website's
`quizmill.dev/api/registry`.

Each entry requires:

- `id` — short stable slug, also the pack's Pages project and subdomain
- `title`
- `description`
- `repo` — GitHub `owner/repo` containing a valid pack at the repo root

Optional community metadata:

- `status`: `draft`, `reviewed`, or `maintained`
- `questionCount`
- `demoUrl`
- `badges`

## How the metadata is decided

The fields describe what a reader can verify, so they are derived from the
pack rather than asserted:

- `status` is `draft` until a human has actually reviewed the questions —
  i.e. until the pack's questions stop being `reviewStatus: "draft"`.
  Every pack listed today is still `draft`; the point is to make review
  status visible, not to pretend every public pack is equally vetted.
- `questionCount` is the length of the pack's `questions.json`.
- `demoUrl` is the pack's canonical `https://<id>.quizmill.dev`, and only
  for packs that actually have a deployment.
- `badges` are mechanical:
  - `exam-pack` — the manifest declares an `exam` block
  - `source-backed` — every question carries a `sourceRef`
  - `extreme-mode` — the manifest declares an `extreme` level
  - `live-demo` — the entry has a `demoUrl`
  - `human-reviewed` — every question is `reviewed`/`approved`
  - `exam-aligned` — categories/weights map to a published exam blueprint

A pack can be listed while still `draft`.

## Validation

`tools/pack/registrySchema.ts` is the registry's schema, and every reader
runs it: `npm run pack:list` exits non-zero on a bad registry, and
`tests/registry.test.ts` checks the committed file in CI.

It enforces shape (unknown fields are rejected, so a `demoURL` typo fails
loudly) and, more importantly, the cross-entry rules git cannot see: **ids
and repos must be unique.** Two branches that each append an entry for the
same pack merge without a conflict and leave that pack listed twice — a
conflict-free merge is not a correct one. The app-side loader
(`src/lib/packRegistry.ts`) also collapses duplicate ids at runtime, since
it fetches the registry from the network.

## Adding a pack

Open a PR adding one entry. If your branch has been open a while, rebase on
`main` before merging and re-run `npm run pack:list` — that is exactly the
case the uniqueness check is guarding.
