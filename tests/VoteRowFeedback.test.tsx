// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VoteRow } from '@/components/VoteRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderVoteRow(questionId: string) {
  await act(async () => {
    root = createRoot(container);
    root.render(<VoteRow questionId={questionId} />);
  });
}

describe('VoteRow feedback link', () => {
  it('shows a prefilled report link after a downvote when the pack declares feedbackUrl', async () => {
    await renderVoteRow('solar-basics-001');

    const down = container.querySelector('[data-testid="vote-down"]') as HTMLButtonElement;
    expect(down).toBeTruthy();
    await act(async () => down.click());

    const link = Array.from(container.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Report this question'),
    ) as HTMLAnchorElement | undefined;
    expect(link).toBeTruthy();
    expect(link!.href).toContain('https://github.com/quizmill/quizmill/issues/new');
    expect(link!.href).toContain('question=solar-basics-001');
    expect(link!.href).toContain('title=Question+feedback%3A+solar-basics-001');
  });
});
