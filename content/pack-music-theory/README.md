# music-theory — a visual quizmill learning pack

102 multiple-choice questions on music theory, across five categories
(Staff & Notation 🎼, Rhythm & Meter 🥁, Scales & Keys 🎹, Intervals 📏,
Chords & Harmony 🎵) and three levels (Beginner → Intermediate →
Advanced).

This pack is deliberately **visual**: 84 of the 102 questions carry an
image — a staff to read, a key signature to name, a keyboard diagram, a
chord to identify, the circle of fifths — and four questions answer with
images (schema v2 image options).

## Images are generated, not drawn

Every SVG in `assets/` is rendered by `tools/generate-assets.mjs` from a
declarative spec (pitch names, key-signature counts, keyboard
highlights…), so a diagram can never drift from its answer key: the same
pitch spec that places the notehead on the staff is the one the question
text was written against.

```
node tools/generate-assets.mjs   # regenerate assets/ (zero deps)
```

The style is line-art ink on a warm paper card, so images stay legible
on both the light and dark app themes.

## Use it

From a quizmill engine checkout:

```
npm run pack:use content/pack-music-theory
npm run dev
```

All questions are `reviewStatus: "draft"` — authored by an AI agent and
awaiting human review. Question ids are stable; never renumber them.
