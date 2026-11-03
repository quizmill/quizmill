// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MatchRows } from '@/pack/MatchRows';
import type { AnswerKey, PackQuestion } from '@/pack/data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const Q: Pick<PackQuestion, 'rows' | 'choices' | 'correctMatch'> = {
  rows: [
    { key: '1', text: 'Mercury is closest to the Sun', explanation: 'It orbits at 0.39 AU.' },
    { key: '2', text: 'Venus has a moon', explanation: 'Venus has none.' },
  ],
  choices: [
    { key: 'yes', text: 'Yes' },
    { key: 'no', text: 'No' },
  ],
  correctMatch: { '1': 'yes', '2': 'no' },
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(
  selected: AnswerKey[],
  stage: 'choosing' | 'feedback',
  onSelect: (k: AnswerKey) => void = () => {},
) {
  await act(async () => {
    root = createRoot(container);
    root.render(<MatchRows question={Q} selected={selected} stage={stage} onSelect={onSelect} />);
  });
}

const groups = () => [...container.querySelectorAll('[role="radiogroup"]')];
const radios = (g: Element) => [...g.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];

describe('MatchRows', () => {
  it('renders each row as a group of the shared choices', async () => {
    await render([], 'choosing');
    expect(groups()).toHaveLength(2);
    expect(groups()[0].textContent).toContain('Mercury is closest to the Sun');
    expect(radios(groups()[1]).map((b) => b.textContent)).toEqual(['Yes', 'No']);
    // No answers or row explanations while choosing.
    expect(container.textContent).not.toContain('Venus has none.');
  });

  it('sends a row=choice pick and marks the picked choice', async () => {
    const picks: AnswerKey[] = [];
    await render(['1=yes'], 'choosing', (k) => picks.push(k));
    expect(radios(groups()[0])[0].getAttribute('aria-checked')).toBe('true');
    expect(radios(groups()[1])[0].getAttribute('aria-checked')).toBe('false');
    await act(async () => radios(groups()[1])[1].click());
    expect(picks).toEqual(['2=no']);
  });

  it('marks each row right or wrong in feedback and shows its explanation', async () => {
    await render(['1=yes', '2=yes'], 'feedback');
    const [first, second] = groups();
    expect(first.getAttribute('data-row-correct')).toBe('true');
    expect(second.getAttribute('data-row-correct')).toBe('false');
    expect(container.textContent).toContain('It orbits at 0.39 AU.');
    expect(container.textContent).toContain('Venus has none.');
    // The right choice of the missed row is flagged, buttons are locked.
    expect(radios(second)[1].getAttribute('data-answer')).toBe('true');
    expect(radios(second).every((b) => b.disabled)).toBe(true);
  });
});
