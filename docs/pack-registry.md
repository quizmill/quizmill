# Pack registry

The public pack registry lives at `tools/pack/registry.json` and powers
`npm run pack:list`.

Each entry requires:

- `id` — short stable slug
- `title`
- `description`
- `repo` — GitHub `owner/repo` containing a valid pack at the repo root

Optional community metadata:

- `status`: `draft`, `reviewed`, or `maintained`
- `questionCount`
- `demoUrl`
- `badges`

Suggested badges:

- `generated`
- `human-reviewed`
- `source-backed`
- `exam-pack`
- `exam-aligned`
- `extreme-mode`
- `live-demo`

A pack can be listed while still `draft`; the point is to make review status
visible rather than pretend every public pack is equally vetted.
