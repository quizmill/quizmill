// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QuestionMeta } from '@/pack/QuestionMeta';
import { packQuestions } from '@/pack/data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
}

describe('QuestionMeta paper chip (#194)', () => {
  it('names the paper (series · label) a question belongs to', async () => {
    const inPaper = packQuestions.find((q) => q.paperId === 'starter-paper-1')!;
    await render(<QuestionMeta question={inPaper} />);
    const chip = container.querySelector('[data-testid="paper-chip"]');
    expect(chip?.textContent).toBe('Starter papers · Paper 1');
  });

  it('renders no paper chip for a question outside any paper, or an undeclared one', async () => {
    const loose = packQuestions.find((q) => !q.paperId)!;
    await render(<QuestionMeta question={loose} />);
    expect(container.querySelector('[data-testid="paper-chip"]')).toBeNull();
    await act(async () => {
      root.render(<QuestionMeta question={{ ...loose, paperId: 'ghost-paper' }} />);
    });
    expect(container.querySelector('[data-testid="paper-chip"]')).toBeNull();
  });
});
