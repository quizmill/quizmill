// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackPracticeRunner } from '@/pack/PracticeRunner';
import { loadAttempts, loadSessions, saveLevelFilter } from '@/lib/storage';
import { packQuestions } from '@/pack/data';

// Practising a named paper (#194): the runner deals from that paper's
// questions — the whole paper, whatever the level filter says — records
// each attempt under its question's real category, and the results
// screen names the paper. Driven against the demo pack's starter papers.

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

async function finishRound() {
  for (let i = 0; i < 20; i++) {
    if (control('Another round')) return;
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

const PAPER_2 = packQuestions.filter((q) => q.paperId === 'starter-paper-2');

describe('PackPracticeRunner for a named paper', () => {
  it('deals the whole paper, ignoring the level filter, and records real categories', async () => {
    // Paper 2 mixes Basics and Advanced questions; a saved Basics filter
    // must not shrink a paper — a paper is sat whole.
    saveLevelFilter('basics');
    expect(PAPER_2.length).toBe(5);
    expect(new Set(PAPER_2.map((q) => q.level)).size).toBe(2);

    await render('starter-paper-2');
    expect(container.textContent).toMatch(/1\s*\/\s*5/);
    await finishRound();

    const attempts = loadAttempts();
    expect(attempts).toHaveLength(5);
    expect(new Set(attempts.map((a) => a.questionId))).toEqual(
      new Set(PAPER_2.map((q) => q.id)),
    );
    // Attempts carry the question's category, never the paper key.
    expect(attempts.every((a) => a.subject === 'space-exploration')).toBe(true);
    // A paper owned by one category gives its session that category.
    const sessions = loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].subject).toBe('space-exploration');
    expect(sessions[0].mode).toBe('practice');
  });

  it('names the paper on the results screen', async () => {
    await render('starter-paper-2');
    await finishRound();
    expect(container.textContent).toContain('Practice complete');
    expect(container.textContent).toContain('Paper 2');
  });

  it('explains an empty (unknown) paper instead of hanging on Loading', async () => {
    await render('ghost-paper');
    expect(container.textContent).not.toContain('Loading');
    expect(container.textContent).toContain('no questions');
  });
});
