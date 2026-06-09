---
name: create-learning-pack
description: >
  Generate a private learning pack (a multiple-choice question bank +
  manifest) for this quizmill app. Use when the user
  wants practice questions about any topic — "make me a pack about X",
  "I want to learn / revise / get quizzed on Y", "turn these notes into
  practice questions".
---

# Create a learning pack

A learning pack is a directory of three JSON files that turns this app
into a practice app for any topic. Packs are **private by default** —
they live in the gitignored `packs/` workspace and never get committed.

The format is specified by the Zod schemas in `tools/pack/schema.ts`
(read it before writing files — it is the source of truth). The
committed demo pack at `content/pack-demo/` is a complete worked
example.

## Workflow

1. **Scope the pack with the user.** You need: the topic, the audience
   /level (beginner? practitioner? exam-prep?), roughly how many
   questions (default 30–50), and 2–6 categories that partition the
   topic. If the user gave a document/notes/URL, ground questions in it
   and put the reference in each question's `sourceRef`.

2. **Write the pack** to `packs/<pack-id>/`:
   - `pack.json` — manifest: `schemaVersion: 1`, `id`, `title`,
     `description`, `homeSubtitle`, `themeColor` (hex), `categories`
     (key/label/shortLabel/optional weight). Keys are kebab-case slugs.
   - `questions.json` — array of questions: slug `id` (unique,
     prefix with the pack id), `categoryKey` (must match a manifest
     category), `difficulty` 1–5, `prompt` (≥20 chars), exactly 4
     `options` keyed A–D, `correctKey`, `explanation` (≥40 chars),
     `source` (`"generated"` for LLM-authored), optional `sourceRef`,
     `reviewStatus` (`"draft"` until a human has checked it), optional
     `tags`.
   - `scenarios.json` — optional; only when several questions genuinely
     share a narrative setup (give them a `scenarioId`). Otherwise `[]`
     or omit.

3. **Quality bar** (this is the point — don't skimp):
   - Every question must have exactly one defensibly correct answer.
     If you are not certain an answer is correct, verify it (search,
     read the source doc) or drop the question.
   - Distractors must be *plausible* — common misconceptions,
     near-misses, true-but-irrelevant statements. Never joke options.
   - The explanation teaches: why the answer is right AND why the
     tempting distractor is wrong. Markdown backticks/code blocks and
     bare URLs render properly.
   - Spread difficulty: ~20% level 1–2, ~60% level 3, ~20% level 4–5.
   - Shuffle which letter is correct — do not let "C" dominate.

4. **Validate, fix, repeat** until clean:
   ```
   npm run pack:validate packs/<pack-id>
   ```
   It cross-checks ids, category references, scenario references, and
   weights, and exits non-zero with per-question errors.

5. **Activate and show it**:
   ```
   npm run pack:use packs/<pack-id>
   npm run dev
   ```
   The app at http://localhost:3000 is now the user's practice app for
   that topic. (`pack:use` snapshots the pack into the gitignored
   `content/pack/`; the original under `packs/` remains the editable
   source.)

6. **Remind the user**: packs are private (gitignored). To keep one
   long-term, store the `packs/<pack-id>/` directory somewhere safe
   (e.g. a private repo). To deploy it as its own app, run `pack:use`
   then `npm run build` and host the static `out/` anywhere — see the
   README's "Deploying a pack" section.

## Iterating on an existing pack

Edit the files under `packs/<pack-id>/`, re-run `pack:validate`, then
`pack:use` again. Adding questions later is normal — ids must stay
stable so the user's attempt history keeps pointing at the right
questions, so never renumber existing questions.
