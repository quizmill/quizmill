/**
 * Pure logic for Drive Mode's voice loop: turning speech-recognition
 * transcripts into answers/commands, and turning questions into text
 * that reads well aloud. No browser APIs here — the Web Speech
 * wrappers live in src/lib/speech.ts; this module is fully unit-tested
 * in tests/voice.test.ts.
 */
import type { OptionKey, PackOption, PackQuestion } from '@/pack/data';

export type VoiceCommand = 'repeat' | 'pause';

/** Lowercase, strip punctuation (keep apostrophes for "it's"), collapse
 *  whitespace. Applied to every transcript before matching. */
export function normalizeSpeech(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words that carry no answer content — stripped before alias matching so
// "I think it's B" reduces to just "b". Deliberately does NOT include
// "a" (it's an answer key) or "or" ("b or c" must stay ambiguous).
const FILLER = new Set([
  'the', 'answer', 'is', 'it', "it's", 'its', 'i', 'think', 'option',
  'choice', 'letter', 'number', 'say', 'choose', 'pick', 'my', 'um',
  'uh', 'please', 'go', 'with', 'that', 'guess',
]);

// Option-key aliases: the letter itself plus how recognisers commonly
// mis-hear it. Cardinals double as keys by position ("two" → B), with
// their own homophones ("to", "too").
const LETTER_ALIASES: Record<string, number> = {
  a: 0, ay: 0, eh: 0,
  b: 1, be: 1, bee: 1,
  c: 2, see: 2, sea: 2, si: 2,
  d: 3, dee: 3, de: 3,
  e: 4,
  f: 5, ef: 5, eff: 5,
  '1': 0, one: 0, won: 0,
  '2': 1, two: 1, to: 1, too: 1,
  '3': 2, three: 2,
  '4': 3, four: 3, for: 3, fore: 3,
  '5': 4, five: 4,
  '6': 5, six: 5,
};

// Ordinals are matched first and on their own: "the second one" must
// mean B even though "one" is also an alias for A.
const ORDINAL_ALIASES: Record<string, number> = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, last: -1,
};

function fillerStripped(tokens: string[]): string[] {
  return tokens.filter((t) => !FILLER.has(t));
}

/**
 * Match a transcript to one of the question's options, or null when
 * nothing (or more than one thing) matches. Tried in order:
 *
 * 1. Ordinals — "second", "the third one" (exclusive: beats "one").
 * 2. Letters/cardinals — every non-filler token must be an alias and
 *    all aliases must agree, so "b" and "the answer is b" match but
 *    "b or c" and "I have to go" don't.
 * 3. Option text — the transcript equals/contains an option's text (or
 *    vice versa), uniquely.
 */
export function matchAnswer(
  transcript: string,
  options: PackOption[],
): OptionKey | null {
  const norm = normalizeSpeech(transcript);
  if (norm === '') return null;
  const tokens = fillerStripped(norm.split(' '));
  if (tokens.length === 0) return null;

  const byIndex = (i: number): OptionKey | null => {
    const idx = i === -1 ? options.length - 1 : i;
    return options[idx] ? options[idx].key : null;
  };

  // 1. Ordinals.
  const ordinals = new Set(
    tokens.filter((t) => t in ORDINAL_ALIASES).map((t) => ORDINAL_ALIASES[t]),
  );
  if (ordinals.size === 1) return byIndex([...ordinals][0]);
  if (ordinals.size > 1) return null;

  // 2. Letters / cardinals — only when the whole (filler-stripped)
  // utterance is aliases, to keep homophones like "to"/"for" from
  // firing inside unrelated speech.
  if (tokens.every((t) => t in LETTER_ALIASES)) {
    const keys = new Set(tokens.map((t) => LETTER_ALIASES[t]));
    if (keys.size === 1) return byIndex([...keys][0]);
    return null; // "b or c" → ambiguous
  }

  // 3. Option text.
  const said = tokens.join(' ');
  const hits = options.filter((o) => {
    const text = normalizeSpeech(stripForSpeech(o.text));
    if (text.length === 0) return false;
    if (text === said) return true;
    // Containment either way, but only for utterances long enough to
    // not match by accident.
    if (said.length >= 4 && (text.includes(said) || said.includes(text))) {
      return true;
    }
    return false;
  });
  return hits.length === 1 ? hits[0].key : null;
}

/** Voice commands understood during the answer window. Checked before
 *  matchAnswer. "stop" pauses rather than ends — in a car, a reversible
 *  action is the only safe reading. */
export function matchCommand(transcript: string): VoiceCommand | null {
  const tokens = normalizeSpeech(transcript).split(' ');
  if (tokens.some((t) => t === 'repeat' || t === 'again')) return 'repeat';
  if (tokens.some((t) => t === 'pause' || t === 'stop' || t === 'wait')) {
    return 'pause';
  }
  return null;
}

/**
 * Make MCQ markdown readable aloud: fenced code blocks become a spoken
 * placeholder, inline backticks unwrap, URLs drop (nobody wants a URL
 * read out character by character), whitespace collapses.
 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g, ' — see the code sample on screen — ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/https?:\/\/[^\s)\]]+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The full spoken script for one question: position, scenario stem if
 *  any, prompt, then each option by letter. */
export function speechForQuestion(
  question: PackQuestion,
  index: number,
  total: number,
  scenarioStem?: string,
): string {
  const parts = [`Question ${index + 1} of ${total}.`];
  if (scenarioStem) parts.push(stripForSpeech(scenarioStem));
  parts.push(stripForSpeech(question.prompt));
  for (const opt of question.options) {
    parts.push(`${opt.key}. ${stripForSpeech(opt.text)}.`);
  }
  return parts.join(' ');
}

/** Spoken feedback after an answer: verdict, correct option when wrong,
 *  then the explanation — that's the learning payload, always read. */
export function speechForFeedback(
  question: PackQuestion,
  selected: OptionKey,
): string {
  const explanation = stripForSpeech(question.explanation);
  if (selected === question.correctKey) {
    return `Correct! ${explanation}`;
  }
  const right = question.options.find((o) => o.key === question.correctKey);
  const rightText = right ? ` ${stripForSpeech(right.text)}.` : '';
  return `Not quite. The answer is ${question.correctKey}.${rightText} ${explanation}`;
}

/** Spoken wrap-up on the results screen. */
export function speechForResults(correct: number, total: number): string {
  const opener =
    correct === total
      ? 'Flawless round!'
      : correct >= Math.ceil(total * 0.7)
        ? 'Nice work.'
        : 'Good practice.';
  return `Session complete. ${opener} You scored ${correct} out of ${total}.`;
}

/** Re-prompt when nothing matched — names the letters that exist. */
export function repromptForOptions(options: PackOption[]): string {
  const letters = options.map((o) => o.key);
  const list =
    letters.length <= 1
      ? letters.join('')
      : `${letters.slice(0, -1).join(', ')}, or ${letters[letters.length - 1]}`;
  return `Say ${list}. You can also say repeat.`;
}
