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

  it('names the right choice for assistive tech in feedback, not by colour alone', async () => {
    await render(['1=yes', '2=yes'], 'feedback');
    const second = groups()[1];
    expect(radios(second)[1].getAttribute('aria-label')).toBe('No (correct answer)');
    expect(radios(second)[0].getAttribute('aria-label')).toBe('Yes');
  });

  it('gives each instance its own row ids, so two questions on one page never collide', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <>
          <MatchRows question={Q} selected={[]} stage="choosing" onSelect={() => {}} />
          <MatchRows question={Q} selected={[]} stage="choosing" onSelect={() => {}} />
        </>,
      );
    });
    const ids = groups().map((g) => g.getAttribute('aria-labelledby')!);
    expect(new Set(ids).size).toBe(4);
    for (const [i, id] of ids.entries()) {
      const label = container.querySelector(`[id="${id}"]`);
      expect(label?.closest('[role="radiogroup"]')).toBe(groups()[i]);
    }
  });

  it('is one tab stop per row, and arrow keys move the pick within the row', async () => {
    const picks: AnswerKey[] = [];
    await render(['2=no'], 'choosing', (k) => picks.push(k));
    const [first, second] = groups();
    // Nothing picked: the first choice is the tab stop. Picked: that choice.
    expect(radios(first).map((b) => b.tabIndex)).toEqual([0, -1]);
    expect(radios(second).map((b) => b.tabIndex)).toEqual([-1, 0]);

    const key = (el: HTMLElement, k: string) =>
      act(async () => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      });
    await key(radios(first)[0], 'ArrowRight');
    expect(picks).toEqual(['1=no']);
    expect(document.activeElement).toBe(radios(first)[1]);
    // Wraps around at either end.
    await key(radios(second)[1], 'ArrowDown');
    expect(picks.at(-1)).toBe('2=yes');
    await key(radios(second)[0], 'ArrowLeft');
    expect(picks.at(-1)).toBe('2=no');
  });
});
