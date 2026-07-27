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
