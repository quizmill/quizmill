// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import WeakSpotsPage from '@/pack/WeakSpotsPage';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import { ATTEMPTS_KEY } from '@/lib/storage';
import { weakSpotClearAfterPref } from '@/lib/weakSpotPref';
import { packQuestions } from '@/pack/data';
import type { Attempt } from '@/data/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

function att(questionId: string, isCorrect: boolean, answeredAt: number): Attempt {
  const q = packQuestions.find((p) => p.id === questionId)!;
  return {
    id: `${questionId}-${answeredAt}`,
    sessionId: 's',
    questionId,
    answeredAt,
    selectedAnswer: 'A',
    isCorrect,
    timeTakenSeconds: 1,
    subject: q.categoryKey,
    topic: questionId,
    difficulty: q.difficulty,
  };
}

/** q1 missed then right once, q2 missed, q3 missed then right twice. */
function seed() {
  const [q1, q2, q3] = packQuestions;
  localStorage.setItem(
    ATTEMPTS_KEY,
    JSON.stringify([
      att(q1.id, false, 100),
      att(q2.id, false, 200),
      att(q3.id, false, 300),
      att(q1.id, true, 400),
      att(q3.id, true, 500),
      att(q3.id, true, 600),
    ]),
  );
  return { q1, q2, q3 };
}

const rows = () => Array.from(container.querySelectorAll('[data-testid="weak-spot"]'));

describe('WeakSpotsPage', () => {
  it('lists missed questions with their streak, oldest mistake first', async () => {
    const { q1, q2, q3 } = seed();
    await render(<WeakSpotsPage />);
    const listed = rows();
    expect(listed).toHaveLength(2);
    expect(listed[0].textContent).toContain(q1.prompt);
    expect(listed[0].textContent).toContain('1 of 2');
    expect(listed[1].textContent).toContain(q2.prompt);
    expect(listed[1].textContent).toContain('0 of 2');
    expect(container.textContent).not.toContain(q3.prompt);
    // The derived "clear" rule, made visible.
    expect(container.querySelector('[data-testid="weak-spots-cleared"]')!.textContent).toContain(
      '1 question cleared — answered right 2 times in a row',
    );
    const cta = container.querySelector('[data-testid="weak-spots-practise"]')!;
    expect(cta.closest('a')!.getAttribute('href')).toBe('/practice/review');
  });

  it('follows the device setting: N = 1 drops a question after one right answer', async () => {
    weakSpotClearAfterPref.save(1);
    const { q2 } = seed();
    await render(<WeakSpotsPage />);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain(q2.prompt);
    expect(container.querySelector('[data-testid="weak-spot-streak"]')).toBeNull();
  });

  it('says so when there are no weak spots', async () => {
    await render(<WeakSpotsPage />);
    expect(container.querySelector('[data-testid="weak-spots-empty"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="weak-spots-practise"]')).toBeNull();
  });
});

describe('Weak spots setting', () => {
  it('defaults to 2 and stores another choice app-level', async () => {
    await render(<SettingsPage />);
    const card = container.querySelector('[data-testid="weak-spot-setting"]')!;
    const two = card.querySelector('[data-testid="weak-spot-clear-2"]')!;
    const three = card.querySelector('[data-testid="weak-spot-clear-3"]')!;
    expect(two.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      three.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(three.getAttribute('aria-checked')).toBe('true');
    expect(weakSpotClearAfterPref.load()).toBe(3);
    expect(localStorage.getItem(weakSpotClearAfterPref.key)).toBe('3');
  });

  it('reads junk as the default', () => {
    localStorage.setItem(weakSpotClearAfterPref.key, '7');
    expect(weakSpotClearAfterPref.load()).toBe(2);
  });
});

describe('Home weak-spot card', () => {
  it('counts the list under the device setting and opens it', async () => {
    seed();
    await render(<PackHome />);
    const card = container.querySelector('[data-testid="weak-spots-card"]')!;
    expect(card.textContent).toContain('Review 2 mistakes');
    expect(card.getAttribute('href')).toBe('/weak-spots');
  });

  it('shows one when a single right answer clears', async () => {
    weakSpotClearAfterPref.save(1);
    seed();
    await render(<PackHome />);
    expect(container.querySelector('[data-testid="weak-spots-card"]')!.textContent).toContain(
      'Review 1 mistake',
    );
  });
});
