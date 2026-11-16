// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackReviewRunner } from '@/pack/ReviewRunner';
import { ATTEMPTS_KEY, loadAttempts } from '@/lib/storage';
import { packQuestions } from '@/pack/data';
import { answerMatching } from './helpers/answer-matching';
import type { Attempt } from '@/data/types';

// A matching question (#269) through a real runner: the demo pack's
// classify item, queued as a mistake so Review deals it first.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const ITEM = packQuestions.find((q) => q.id === 'demo-planets-014')!;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  const missed: Attempt = {
    id: 'old:a1',
    sessionId: 'old',
    questionId: ITEM.id,
    answeredAt: 1000,
    selectedAnswer: '1=rocky,2=gas-giant,3=gas-giant,4=rocky,5=ice-giant,6=gas-giant',
    isCorrect: false,
    timeTakenSeconds: 20,
    subject: ITEM.categoryKey,
    topic: ITEM.id,
    difficulty: ITEM.difficulty,
  };
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([missed]));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackReviewRunner />);
  });
  await act(async () => {});
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function control(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.type !== 'button' && (b.textContent ?? '').includes(text),
  );
}

describe('a matching question in a runner', () => {
  it('needs every row before Check, then marks rows and records one attempt', async () => {
    await render();
    expect(container.textContent).toContain(ITEM.prompt);
    expect(container.textContent).toContain('Choose one answer for each row');
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(6);

    // One row picked: not enough to check.
    const firstRow = container.querySelector('[role="radiogroup"]')!;
    await click(firstRow.querySelector('[role="radio"]')!);
    expect(control('Check answer')!.disabled).toBe(true);

    await answerMatching(container, ITEM, false, click);
    expect(control('Check answer')!.disabled).toBe(false);
    await click(control('Check answer')!);

    // All-or-nothing: five of six rows right is a wrong answer.
    expect(container.textContent).toContain('5 of 6');
    const verdicts = [...container.querySelectorAll('[role="radiogroup"]')].map((g) =>
      g.getAttribute('data-row-correct'),
    );
    expect(verdicts).toEqual(['false', 'true', 'true', 'true', 'true', 'true']);
    expect(container.querySelectorAll('[data-testid="row-explanation"]')).toHaveLength(6);

    const recorded = loadAttempts().filter((a) => a.sessionId !== 'old');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      questionId: ITEM.id,
      isCorrect: false,
      mode: 'review',
      selectedAnswer: '1=gas-giant,2=gas-giant,3=ice-giant,4=rocky,5=ice-giant,6=gas-giant',
    });
  });

  it('counts the question right, and the mistake rescued, when every row is', async () => {
    await render();
    await answerMatching(container, ITEM, true, click);
    await click(control('Check answer')!);
    expect(container.querySelectorAll('[data-row-correct="true"]')).toHaveLength(6);
    const recorded = loadAttempts().filter((a) => a.sessionId !== 'old');
    expect(recorded[0]).toMatchObject({ isCorrect: true });
    await click(control('See results')!);
    expect(container.textContent).toContain('1/1');
  });
});
