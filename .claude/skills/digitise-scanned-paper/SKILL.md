---
name: digitise-scanned-paper
description: >
  Turn photos of a printed practice paper (and its answer booklet) into
  questions in a quizmill learning pack. Use when the user hands over
  phone photos or scans of an exam / practice paper and says "digitise
  these", "add this paper to the pack", "here are the answers", or similar.
  Transcribes every question verbatim and in paper order, keys and
  explains them from the booklet word for word, redraws figures as clean
  SVGs, gives the paper its own level so it can be practised or printed
  on its own, validates, and ships.
---

# Digitise a scanned practice paper

The user photographs a paper someone sat (often with pencil working on
it) plus the matching answer-booklet pages, and wants it in their pack
exactly as printed so a learner can redo it on screen or on a printed
sheet. Fidelity beats polish: **copy, don't author.**

## Ground rules

- **Verbatim, everywhere.** Question wording, option text, numbers,
  units, punctuation, the paper's own line breaks. When the answer
  booklet is supplied, the explanation is the booklet's text word for
  word — never your own summary. Only deviate where the schema forces it
  (see step 6) and tell the user each place you did.
- **Keep the paper's order and numbering.** Questions go into
  `questions.json` contiguously in Q1…Qn order (the in-order print sheet
  relies on bank order), and each carries its paper number.
- **Ignore the pencil.** Circled letters, crossings-out and working on
  the photos are the learner's attempt, not the key. Key only from the
  booklet. Mentioning where the attempt differed is useful feedback.
- **Ask, don't guess, about missing pages.** Check the scans cover every
  question number before writing anything. If a page is missing or a
  photo belongs to a different paper, say which and wait.
- **Don't name the publisher in generic places** (this skill, engine
  code). In the pack itself, keep whatever attribution the user asks for
  (`sourceRef`, the manifest `sources` legend).

## 1. Prepare the photos

Phone photos are usually HEIC. Work on copies in a scratch directory:

```sh
sips -s format jpeg -Z 1600 IMG_x.HEIC --out o_x.jpg          # overview to read
sips -s format jpeg -Z 5700 IMG_x.HEIC --out big_x.jpg        # full-res for crops
convert big_x.jpg -auto-orient big_x.jpg                      # sips leaves EXIF rotation
convert big_x.jpg -crop WxH+X+Y +repage -resize 1300x c_q7.jpg  # zoom on a figure
```

Read each overview, note the printed page number and paper name in the
footer, and map photo → question range. Zoom into every figure, table
and small print (exponents, fractions, signs, decimal points) before
transcribing — misreads hide there.

## 2. Pick conventions (once per paper series)

Look at how earlier papers in the same pack were done and mirror them.
Typical shape:

- `id`: `<series>-paper<N>-NNN` (zero-padded paper number).
- `level`: one level per paper (e.g. `<series>N`, label "<Series> N") so
  the learner can practise or print just that paper. The engine allows at
  most **8 levels** per pack — warn the user before you run out.
- `sourceRef`: `"<Series>-paper<N>, Q<n>"`.
- `tags`: `[<topic>, <series tag>, "Q<n>"]` — the `Q<n>` tag makes the
  paper number visible as a chip (the app doesn't display `sourceRef`).
- `source: "curated"`; `reviewStatus: "reviewed"` once keyed from the
  booklet, `"draft"` if the booklet hasn't been scanned yet.
- `difficulty` 1–5: your judgement (1 one-step recall … 4–5 multi-step
  reasoning) — papers don't grade their questions.
- Add the paper's level to `pack.json` `levels`, and a `sources` legend
  entry for the series if it isn't there.

## 3. Redraw the figures

Never ship a crop of the photo — it carries the learner's working and
camera skew. Redraw each figure as an SVG in `assets/<series>-paper<N>/`
with a small Python generator (keep it in your scratch dir, re-run it as
you fix things):

- Reproduce what the question needs to be answerable: every label,
  axis tick, value, unit, angle mark, dashed hidden edge, key/legend.
  Read values off the original carefully (bar heights, plotted points,
  dial pointers); if the booklet quotes a value (e.g. "the graph shows
  110 miles"), make the figure agree with it.
- Tables, menus and timetables: draw them as SVG tables, or put them in
  the prompt as text if they're simple.
- Image-answer questions (pick the correct reflection / net / shape):
  give every option an `image` plus alt `text`; the schema requires all
  options or none to have images.
- White background, black strokes, `font-family='Helvetica, Arial,
  sans-serif'`, sized so text stays readable on a phone.

**Look at every figure before shipping.** Render a contact sheet in
headless Chrome (ImageMagick mis-renders clip paths and some text):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --allow-file-access-from-files --window-size=1900,1600 \
  --screenshot=sheet.png file:///path/to/sheet.html   # sheet.html = <img> per SVG
```

Check against the originals for clipped labels, overlapping text,
wrong draw order in 3D sketches, and mis-placed points — then fix and
re-render.

## 4. Transcribe the questions

Write the 1…n questions as data (one tuple per question: number,
difficulty, topic tag, prompt, image, options, key, explanation) in a
script that rewrites `questions.json` idempotently (drop the paper's ids,
re-append) so you can re-run it after every correction.

- Prompt: the paper's stem, with tables that aren't drawn rendered as
  text and line breaks where the paper breaks. No `**bold**`/`*italic*`
  — markdown emphasis shows literally.
- Options: exactly the printed A–E text, in printed order.
- Use proper symbols: − (minus), ×, ÷, °, ², ½ ¼ ¾ ⅓ ⅔ ⅕ ⅖ ⅗ ⅛ ⅜ etc.,
  otherwise `a/b`.

## 5. Key and explain from the booklet

The booklet often runs papers back to back, so one paper's answers can
span several pages. For each question copy the booklet's answer and
explanation verbatim, then map its answer to the option letter.
Cross-check: if the booklet's answer doesn't match any option, or your
own working disagrees, re-read both the question photo and the booklet
before changing anything — and if your figure caused the disagreement,
fix the figure. Booklet text that refers to a worked diagram ("shown on
the diagram") stays as printed; tell the user which ones.

If the booklet isn't available yet, write short placeholder
explanations, mark the questions `draft`, and replace them verbatim when
the pages arrive.

## 6. Validate

```sh
npx quizmill@latest validate .        # or: npm run pack:validate <dir>
```

Explanations must be ≥ 40 characters. When a booklet explanation is
shorter, append the smallest neutral line (e.g. "The answer is 21.") and
list those questions for the user. Re-run until clean.

## 7. Ship and report

Commit (the paper as one commit: questions, figures, manifest), push the
way the pack repo deploys, and watch the deploy finish before saying it
is live. Then report briefly: the new level, any figures or keys you had
to reconstruct, schema-forced deviations, questions where the learner's
marked answer differed from the key, and which papers are still left.

To sit the paper on paper: Print sheet → pick the paper's level →
**All** — the sheet keeps the questions in pack order, numbered 1…n, and
the marking page uses the same order.
