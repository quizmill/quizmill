// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackPracticeRunner } from '@/pack/PracticeRunner';
import { MIXED_SUBJECT } from '@/pack/runner';
import { loadAttempts, loadSessions, saveLevelFilter } from '@/lib/storage';
import { packQuestions } from '@/pack/data';

// A mixed round (#232): when each category holds only a few questions, a
// category round is three or five long — the mixed round deals the usual
// ten from the WHOLE pack (honouring the level filter), records each
// attempt under its question's real category, and the session carries
// the `mixed` pseudo-subject. Driven against the demo pack, whose
// space-exploration category has just five questions.

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

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackPracticeRunner mixed />);
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

describe('PackPracticeRunner mixed round', () => {
  it('deals ten questions from the whole pack, not one category', async () => {
    // Fresh learner: the unseen bias plus ten of eighteen means the round
    // cannot fit in either category alone only by chance — so assert the
    // length, and that a category of five never caps it.
    expect(packQuestions.filter((q) => q.categoryKey === 'space-exploration')).toHaveLength(5);

    await render();
    expect(container.textContent).toMatch(/1\s*\/\s*10/);
    await finishRound();

    const attempts = loadAttempts();
    expect(attempts).toHaveLength(10);
    // Attempts keep their question's own category, never the pseudo-subject.
    const byId = new Map(packQuestions.map((q) => [q.id, q.categoryKey]));
    for (const a of attempts) expect(a.subject).toBe(byId.get(a.questionId));
    const sessions = loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].subject).toBe(MIXED_SUBJECT);
    expect(sessions[0].mode).toBe('practice');
    expect(sessions[0].questionCount).toBe(10);
  });

  it('serves the unseen questions of every category before repeats', async () => {
    // Two rounds of ten over eighteen questions: the second round must
    // pick up the eight the first left unseen, whichever category they
    // belong to — so across both, every question has been served.
    await render();
    await finishRound();
    await click(control('Another round')!);
    await act(async () => {});
    await finishRound();
    expect(new Set(loadAttempts().map((a) => a.questionId))).toEqual(
      new Set(packQuestions.map((q) => q.id)),
    );
  });

  it('honours the level filter', async () => {
    // Basics = 6 planets + 3 space-exploration: a round of all nine.
    saveLevelFilter('basics');
    const basics = packQuestions.filter((q) => q.level === 'basics');
    expect(basics).toHaveLength(9);

    await render();
    expect(container.textContent).toMatch(/1\s*\/\s*9/);
    await finishRound();
    expect(new Set(loadAttempts().map((a) => a.questionId))).toEqual(
      new Set(basics.map((q) => q.id)),
    );
  });

  it('names the round on the results screen', async () => {
    await render();
    await finishRound();
    expect(container.textContent).toContain('Practice complete');
    expect(container.textContent).toContain('All categories');
  });
});
