// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OptionButtons } from '@/pack/OptionButtons';
import type { OptionKey, PackOption } from '@/pack/data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const OPTIONS: PackOption[] = [
  { key: 'A', text: 'Alpha' },
  { key: 'B', text: 'Bravo' },
  { key: 'C', text: 'Charlie' },
  { key: 'D', text: 'Delta' },
];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderButtons(props: {
  selected: OptionKey[];
  stage: 'choosing' | 'feedback';
  correctKeys: OptionKey[];
  multi: boolean;
  options?: PackOption[];
}) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <OptionButtons
        options={OPTIONS}
        onSelect={() => {}}
        {...props}
      />,
    );
  });
}

/** Options where some (not all) carry an inline explanation. */
const EXPLAINED: PackOption[] = [
  { key: 'A', text: 'Alpha', explanation: 'Alpha is a near miss.' },
  { key: 'B', text: 'Bravo', explanation: 'Bravo is the one.' },
  { key: 'C', text: 'Charlie' },
  { key: 'D', text: 'Delta', explanation: 'Delta is a common mix-up.' },
];

function inlineExplanations(): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="option-explanation"]'),
    (el) => el.textContent ?? '',
  );
}

describe('OptionButtons multi-answer', () => {
  it('flags every correct key in feedback (marks all answers, not just one)', async () => {
    await renderButtons({
      selected: ['A', 'D'],
      stage: 'feedback',
      correctKeys: ['A', 'C'],
      multi: true,
    });
    // Two correct options → two check marks.
    expect(container.querySelectorAll('svg.lucide-check')).toHaveLength(2);
    // The one selected-but-wrong option (D) gets a cross.
    expect(container.querySelectorAll('svg.lucide-x')).toHaveLength(1);
  });

  it('uses a square (checkbox-style) key bubble in multi mode', async () => {
    await renderButtons({
      selected: [],
      stage: 'choosing',
      correctKeys: ['A', 'C'],
      multi: true,
    });
    // Multi mode signals "pick several" with rounded-square bubbles.
    expect(container.querySelector('.rounded-md')).toBeTruthy();
    expect(container.querySelector('.rounded-full')).toBeNull();
  });

  it('keeps round key bubbles in single-answer mode', async () => {
    await renderButtons({
      selected: [],
      stage: 'choosing',
      correctKeys: ['B'],
      multi: false,
    });
    expect(container.querySelector('.rounded-full')).toBeTruthy();
  });
});

describe('OptionButtons inline explanations', () => {
  it('hides per-option explanations while choosing (no spoilers)', async () => {
    await renderButtons({
      options: EXPLAINED,
      selected: ['A'],
      stage: 'choosing',
      correctKeys: ['B'],
      multi: false,
    });
    expect(inlineExplanations()).toEqual([]);
    expect(container.textContent).not.toContain('Bravo is the one.');
  });

  it('shows each option explanation under its option in feedback', async () => {
    await renderButtons({
      options: EXPLAINED,
      selected: ['A'],
      stage: 'feedback',
      correctKeys: ['B'],
      multi: false,
    });
    // One line per explained option, in option order; C has none.
    expect(inlineExplanations()).toEqual([
      'Alpha is a near miss.',
      'Bravo is the one.',
      'Delta is a common mix-up.',
    ]);
    // Each explanation sits inside its own option button.
    const [a, b, , d] = Array.from(container.querySelectorAll('button'));
    expect(a.textContent).toContain('Alpha is a near miss.');
    expect(b.textContent).toContain('Bravo is the one.');
    expect(d.textContent).toContain('Delta is a common mix-up.');
  });

  it('never nests a link inside the (disabled) option button', async () => {
    // McqMarkdown auto-linkifies bare URLs; an <a> inside a <button> is
    // invalid HTML and unreachable while the button is disabled, which is
    // exactly when the note is shown. The URL must come out as plain text.
    await renderButtons({
      options: [
        { key: 'A', text: 'Alpha', explanation: 'See https://example.org/why for why.' },
        { key: 'B', text: 'Bravo' },
      ],
      selected: ['A'],
      stage: 'feedback',
      correctKeys: ['B'],
      multi: false,
    });
    expect(container.querySelector('button a')).toBeNull();
    expect(inlineExplanations()).toEqual(['See https://example.org/why for why.']);
  });

  it('renders no explanation row when no option carries one', async () => {
    await renderButtons({
      selected: ['A'],
      stage: 'feedback',
      correctKeys: ['B'],
      multi: false,
    });
    expect(inlineExplanations()).toEqual([]);
  });
});
