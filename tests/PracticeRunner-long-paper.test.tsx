// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import type { PackPaper, PackQuestion } from '@/pack/data';

// A paper is sat WHOLE: a 75-question practice exam is 75 questions on
// screen, not the runner's ten-question default round. The demo pack's
// starter papers are shorter than a round, so this swaps in a pack whose
// paper is longer than one — the only way the cap can show.

// Hoisted so the (also hoisted) mock factory can read them at import time.
const { LONG_PAPER, LONG_PAPER_SIZE } = vi.hoisted(() => ({
  LONG_PAPER: {
    key: 'long-paper',
    label: 'Practice exam 1',
    series: 'Mocks',
    categoryKey: 'planets',
  } as PackPaper,
  LONG_PAPER_SIZE: 14,
}));

vi.mock('@/pack/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pack/data')>();
  // The demo's first planets question, cloned under new ids — the shape
  // is real, only the count matters here.
  const template = actual.packQuestions.find((q) => q.categoryKey === 'planets')!;
  const questions: PackQuestion[] = Array.from({ length: LONG_PAPER_SIZE }, (_, i) => ({
    ...template,
    id: `long-${String(i + 1).padStart(3, '0')}`,
    paperId: 'long-paper',
    tags: [],
  }));
  return {
    ...actual,
    packQuestions: [...actual.packQuestions, ...questions],
    PACK_PAPER_BY_KEY: { ...actual.PACK_PAPER_BY_KEY, 'long-paper': LONG_PAPER },
  };
});

import { PackPracticeRunner } from '@/pack/PracticeRunner';
import { loadAttempts, loadSessions } from '@/lib/storage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

function control(text: string): HTMLButtonElement | undefined {
  return buttons().find(
    (b) => b.type !== 'button' && (b.textContent ?? '').includes(text),
  );
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function render(paperKey: string) {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackPracticeRunner paperKey={paperKey} />);
  });
  await act(async () => {});
}

/** Answer until the results screen; returns how many questions were sat. */
async function finishRound(): Promise<number> {
  for (let answered = 0; answered < 40; answered++) {
    if (control('Another round')) return answered;
    const option = buttons().find(
      (b) =>
        b.type === 'button' &&
        !b.disabled &&
        /^[A-F]/.test((b.textContent ?? '').trim()),
    );
    expect(option, 'expected an answer option to be clickable').toBeTruthy();
    await click(option!);
    await click(control('Check answer')!);
    await click((control('Next question') ?? control('See results'))!);
  }
  throw new Error('round never reached the results screen');
}

describe('PackPracticeRunner for a paper longer than a round', () => {
  it('sits every question of the paper, not the ten-question default', async () => {
    await render('long-paper');
    expect(container.textContent).toMatch(new RegExp(`1\\s*/\\s*${LONG_PAPER_SIZE}`));
    const answered = await finishRound();
    expect(answered).toBe(LONG_PAPER_SIZE);

    const attempts = loadAttempts();
    expect(attempts).toHaveLength(LONG_PAPER_SIZE);
    expect(new Set(attempts.map((a) => a.questionId)).size).toBe(LONG_PAPER_SIZE);
    const [session] = loadSessions();
    expect(session.questionCount).toBe(LONG_PAPER_SIZE);
    expect(session.subject).toBe('planets');
  });
});
