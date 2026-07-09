import { describe, expect, it } from 'vitest';
import {
  matchAnswer,
  matchCommand,
  normalizeSpeech,
  repromptForOptions,
  speechForFeedback,
  speechForQuestion,
  speechForResults,
  stripForSpeech,
} from '@/lib/voice';
import type { PackOption, PackQuestion } from '@/pack/data';

const OPTIONS: PackOption[] = [
  { key: 'A', text: 'Mercury' },
  { key: 'B', text: 'Venus' },
  { key: 'C', text: 'Earth' },
  { key: 'D', text: 'Mars' },
];

describe('normalizeSpeech', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeSpeech('  The Answer... is B!  ')).toBe('the answer is b');
  });

  it('keeps apostrophes so "it\'s" survives filler matching', () => {
    expect(normalizeSpeech("It's C.")).toBe("it's c");
  });
});

describe('matchAnswer — letters and homophones', () => {
  it.each([
    ['b', 'B'],
    ['B.', 'B'],
    ['bee', 'B'],
    ['be', 'B'],
    ['see', 'C'],
    ['sea', 'C'],
    ['dee', 'D'],
    ['a', 'A'],
  ])('matches %j → %s', (heard, key) => {
    expect(matchAnswer(heard, OPTIONS)).toBe(key);
  });

  it('strips filler: "the answer is b" → B', () => {
    expect(matchAnswer('the answer is b', OPTIONS)).toBe('B');
  });

  it('strips filler: "I think it\'s C" → C', () => {
    expect(matchAnswer("I think it's C", OPTIONS)).toBe('C');
  });

  it('strips filler: "option d please" → D', () => {
    expect(matchAnswer('option d please', OPTIONS)).toBe('D');
  });

  it('rejects ambiguity: "b or c" → null', () => {
    expect(matchAnswer('b or c', OPTIONS)).toBeNull();
  });

  it('does not fire homophones inside unrelated speech', () => {
    // "to" aliases 2/B, "for" aliases 4/D — but only when the whole
    // utterance is answer-shaped.
    expect(matchAnswer('I have to leave', OPTIONS)).toBeNull();
    expect(matchAnswer('wait for me', OPTIONS)).toBeNull();
  });
});

describe('matchAnswer — numbers and ordinals', () => {
  it.each([
    ['one', 'A'],
    ['two', 'B'],
    ['to', 'B'],
    ['number three', 'C'],
    ['four', 'D'],
    ['for', 'D'],
    ['first', 'A'],
    ['the second one', 'B'], // ordinal beats the "one" cardinal
    ['third', 'C'],
    ['the last one', 'D'],
  ])('matches %j → %s', (heard, key) => {
    expect(matchAnswer(heard, OPTIONS)).toBe(key);
  });

  it('ignores numbers beyond the option count', () => {
    expect(matchAnswer('five', OPTIONS.slice(0, 2))).toBeNull();
  });
});

describe('matchAnswer — option text', () => {
  it('matches an option said by its text', () => {
    expect(matchAnswer('mars', OPTIONS)).toBe('D');
    expect(matchAnswer('Mercury', OPTIONS)).toBe('A');
  });

  it('matches text wrapped in filler', () => {
    expect(matchAnswer("I think it's mars", OPTIONS)).toBe('D');
  });

  it('rejects text matching several options', () => {
    const opts: PackOption[] = [
      { key: 'A', text: 'North Korea' },
      { key: 'B', text: 'South Korea' },
    ];
    expect(matchAnswer('korea', opts)).toBeNull();
    expect(matchAnswer('south korea', opts)).toBe('B');
  });

  it('returns null for silence and gibberish', () => {
    expect(matchAnswer('', OPTIONS)).toBeNull();
    expect(matchAnswer('what was that', OPTIONS)).toBeNull();
  });
});

describe('matchCommand', () => {
  it.each([
    ['repeat', 'repeat'],
    ['say that again', 'repeat'],
    ['repeat the question', 'repeat'],
    ['pause', 'pause'],
    ['stop', 'pause'],
    ['wait', 'pause'],
  ] as const)('%j → %s', (heard, cmd) => {
    expect(matchCommand(heard)).toBe(cmd);
  });

  it('returns null for answers and chatter', () => {
    expect(matchCommand('b')).toBeNull();
    expect(matchCommand('mars')).toBeNull();
  });
});

describe('stripForSpeech', () => {
  it('replaces fenced code blocks with a spoken placeholder', () => {
    const md = 'Run this:\n```bash\nnpm test\n```\nthen check.';
    expect(stripForSpeech(md)).toBe(
      'Run this: — see the code sample on screen — then check.',
    );
  });

  it('unwraps inline code and drops URLs', () => {
    expect(stripForSpeech('Use `claude.md` — see https://docs.example.com/x')).toBe(
      'Use claude.md — see a link',
    );
  });
});

function question(over: Partial<PackQuestion> = {}): PackQuestion {
  return {
    id: 'q1',
    categoryKey: 'planets',
    difficulty: 2,
    prompt: 'Which planet is closest to the sun?',
    options: OPTIONS,
    correctKey: 'A',
    explanation: 'Mercury orbits nearest the sun.',
    source: 'original',
    reviewStatus: 'approved',
    ...over,
  };
}

describe('speech scripts', () => {
  it('speechForQuestion reads position, prompt, and every option', () => {
    const s = speechForQuestion(question(), 2, 10);
    expect(s).toContain('Question 3 of 10.');
    expect(s).toContain('Which planet is closest to the sun?');
    expect(s).toContain('A. Mercury.');
    expect(s).toContain('D. Mars.');
  });

  it('speechForQuestion includes the scenario stem when given', () => {
    const s = speechForQuestion(question(), 0, 5, 'You are stargazing.');
    expect(s).toContain('You are stargazing.');
  });

  it('speechForFeedback on a correct answer celebrates + explains', () => {
    const s = speechForFeedback(question(), 'A');
    expect(s).toMatch(/^Correct!/);
    expect(s).toContain('Mercury orbits nearest the sun.');
  });

  it('speechForFeedback on a wrong answer names the right option', () => {
    const s = speechForFeedback(question(), 'C');
    expect(s).toMatch(/^Not quite\./);
    expect(s).toContain('The answer is A.');
    expect(s).toContain('Mercury.');
    expect(s).toContain('Mercury orbits nearest the sun.');
  });

  it('speechForResults reads the score', () => {
    expect(speechForResults(7, 10)).toContain('7 out of 10');
    expect(speechForResults(10, 10)).toContain('Flawless');
  });

  it('repromptForOptions names the letters that exist', () => {
    expect(repromptForOptions(OPTIONS)).toBe(
      'Say A, B, C, or D. You can also say repeat.',
    );
    expect(repromptForOptions(OPTIONS.slice(0, 2))).toBe(
      'Say A, or B. You can also say repeat.',
    );
  });
});
