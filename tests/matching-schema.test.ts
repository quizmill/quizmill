import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validatePack } from '../tools/pack/schema';

// Matching questions (#269): rows × one shared set of choices, one choice
// per row, keyed by `correctMatch`.

const DEMO = path.join(__dirname, '..', 'content', 'pack-demo');

function loadDemo() {
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(DEMO, 'pack.json'), 'utf8')),
    questions: JSON.parse(fs.readFileSync(path.join(DEMO, 'questions.json'), 'utf8')) as Record<
      string,
      unknown
    >[],
    scenarios: JSON.parse(fs.readFileSync(path.join(DEMO, 'scenarios.json'), 'utf8')),
    concepts: JSON.parse(fs.readFileSync(path.join(DEMO, 'concepts.json'), 'utf8')),
  };
}

/** A demo pack whose first question is turned into a Yes/No matching item. */
function withMatching(edit: (q: Record<string, unknown>) => void = () => {}) {
  const input = loadDemo();
  const q = input.questions[0];
  delete q.options;
  delete q.correctKey;
  delete q.correctKeys;
  q.rows = [
    { key: '1', text: 'Mercury is the closest planet to the Sun.' },
    { key: '2', text: 'Venus has a moon.', explanation: 'Venus has none.' },
    { key: '3', text: 'Mars is red.' },
  ];
  q.choices = [
    { key: 'yes', text: 'Yes' },
    { key: 'no', text: 'No' },
  ];
  q.correctMatch = { '1': 'yes', '2': 'no', '3': 'yes' };
  edit(q);
  return input;
}

describe('matching questions in the pack schema', () => {
  it('accepts a question with rows, choices and correctMatch', () => {
    const r = validatePack(withMatching());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts a classify item with four choices', () => {
    const r = validatePack(
      withMatching((q) => {
        q.choices = [
          { key: 'cost', text: 'Cost' },
          { key: 'latency', text: 'Latency' },
          { key: 'quality', text: 'Quality' },
          { key: 'risk', text: 'Risk' },
        ];
        q.correctMatch = { '1': 'risk', '2': 'cost', '3': 'cost' };
      }),
    );
    expect(r.errors).toEqual([]);
  });

  it('rejects a matching question that also carries options', () => {
    const r = validatePack(
      withMatching((q) => {
        q.options = [
          { key: 'A', text: 'One' },
          { key: 'B', text: 'Two' },
        ];
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/either options .* or rows/i);
  });

  it('rejects a matching question that also carries correctKey', () => {
    const r = validatePack(withMatching((q) => (q.correctKey = 'A')));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/correctKey/);
  });

  it('rejects rows without choices or correctMatch', () => {
    const r = validatePack(withMatching((q) => delete q.choices));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/choices/);
    const r2 = validatePack(withMatching((q) => delete q.correctMatch));
    expect(r2.ok).toBe(false);
    expect(r2.errors.join('\n')).toMatch(/correctMatch/);
  });

  it('rejects a question with neither options nor rows', () => {
    const r = validatePack(
      withMatching((q) => {
        delete q.rows;
        delete q.choices;
        delete q.correctMatch;
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('reports an unknown choice in the key', () => {
    const r = validatePack(withMatching((q) => (q.correctMatch = { '1': 'yes', '2': 'maybe', '3': 'no' })));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/correctMatch row "2": choice "maybe" is not one of the choices/);
  });

  it('reports a row with no key', () => {
    const r = validatePack(withMatching((q) => (q.correctMatch = { '1': 'yes', '2': 'no' })));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/row "3" has no answer in correctMatch/);
  });

  it('reports a key for a row that does not exist', () => {
    const r = validatePack(
      withMatching((q) => (q.correctMatch = { '1': 'yes', '2': 'no', '3': 'no', '4': 'yes' })),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/correctMatch names row "4", which is not one of the rows/);
  });

  it('reports duplicate row keys and duplicate choice keys', () => {
    const r = validatePack(
      withMatching((q) => {
        (q.rows as { key: string }[])[2].key = '1';
        q.correctMatch = { '1': 'yes', '2': 'no' };
      }),
    );
    expect(r.errors.join('\n')).toMatch(/row keys must be unique/);
    const r2 = validatePack(
      withMatching((q) => {
        (q.choices as { key: string }[])[1].key = 'yes';
        q.correctMatch = { '1': 'yes', '2': 'yes', '3': 'yes' };
      }),
    );
    expect(r2.errors.join('\n')).toMatch(/choice keys must be unique/);
  });

  it('bounds the shape: 2–10 rows, 2–6 choices, slug keys', () => {
    expect(validatePack(withMatching((q) => {
      q.rows = [{ key: '1', text: 'Only row' }];
      q.correctMatch = { '1': 'yes' };
    })).ok).toBe(false);
    expect(validatePack(withMatching((q) => {
      q.choices = [{ key: 'yes', text: 'Yes' }];
    })).ok).toBe(false);
    expect(validatePack(withMatching((q) => {
      (q.rows as { key: string }[])[0].key = '1=a';
    })).ok).toBe(false);
  });
});
