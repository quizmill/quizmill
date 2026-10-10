// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackPracticeRunner } from '@/pack/PracticeRunner';
import { ATTEMPTS_KEY, saveAchievements } from '@/lib/storage';
import { STREAK_MIN_QUESTIONS_PER_DAY } from '@/lib/stats';
import { ACHIEVEMENTS } from '@/pack/achievements';
import type { Attempt } from '@/data/types';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// happy-dom doesn't ship crypto.randomUUID; the runner mints session and
// attempt ids with it. Borrow Node's Web Crypto.
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

/** A control button (Check answer / Next / See results / Another round)
 *  — Button renders without a type attribute; option buttons set
 *  type="button". */
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
    root.render(<PackPracticeRunner categoryKey="space-exploration" />);
  });
  // Let the mount → pick-session effects settle.
  await act(async () => {});
}

/** Answer every question in the round until the results screen appears. */
async function finishRound() {
  // The space-exploration bank has 5 questions; cap the loop well above
  // that so a stuck runner fails fast instead of looping forever.
  for (let i = 0; i < 20; i++) {
    if (control('Another round')) return;
    // Answer options render their key letter (A–F) first; this skips the
    // Scratchpad toggle, which also has type="button".
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

function seedAttempts(questionIds: string[]) {
  const attempts: Attempt[] = questionIds.map((questionId, i) => ({
    id: `seed-${questionId}`,
    sessionId: 'seed-session',
    questionId,
    answeredAt: 1000 + i,
    selectedAnswer: 'A',
    isCorrect: i % 2 === 0,
    timeTakenSeconds: 5,
    subject: 'space-exploration',
    topic: questionId,
    difficulty: 1,
  }));
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
}

describe('PackPracticeRunner', () => {
  it('explains repeat rounds once the whole set has been answered', async () => {
    // All 5 space-exploration questions already attempted — the dealt round
    // is repeats by necessity, and the runner must say so instead of
    // silently re-serving answered questions.
    seedAttempts([
      'demo-explore-001',
      'demo-explore-002',
      'demo-explore-003',
      'demo-explore-004',
      'demo-explore-005',
    ]);
    await render();
    expect(container.textContent).toContain('answered every question');
  });

  it('shows no repeat-round notice while unseen questions remain', async () => {
    seedAttempts(['demo-explore-001']);
    await render();
    expect(container.textContent).not.toContain('answered every question');
  });

  it('starts a fresh round when "Another round" is clicked', async () => {
    await render();
    await finishRound();

    // On the results screen.
    expect(control('Another round')).toBeTruthy();

    await click(control('Another round')!);

    // Regression: the restart used to leave the runner stuck on the
    // "Loading…" placeholder because the pick-session effect never
    // re-ran. A new round must show answer options again.
    expect(container.textContent).not.toContain('Loading');
    const freshOptions = buttons().filter(
      (b) => b.type === 'button' && /^[A-F]/.test((b.textContent ?? '').trim()),
    );
    expect(freshOptions.length).toBeGreaterThan(0);
  });

  it('does not carry the streak toast onto the results screen', async () => {
    // Every sticker and level already earned, so the streak nod is the only
    // celebration that can fire; and today's goal is set to cross on the
    // round's LAST answer (5 seeded today + 5 in the round = the goal).
    saveAchievements([
      ...ACHIEVEMENTS.map((a) => ({ id: a.id, earnedAt: 1 })),
      { id: 'level-999', earnedAt: 1 },
    ]);
    const roundSize = 5;
    const now = Date.now();
    const seeded: Attempt[] = Array.from(
      { length: STREAK_MIN_QUESTIONS_PER_DAY - roundSize },
      (_, i) => ({
        id: `today-${i}`,
        sessionId: 'today-session',
        questionId: `demo-planet-00${i + 1}`,
        answeredAt: now - 60_000 + i,
        selectedAnswer: 'A',
        isCorrect: true,
        timeTakenSeconds: 5,
        subject: 'planets',
        topic: `demo-planet-00${i + 1}`,
        difficulty: 1,
      }),
    );
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(seeded));
    await render();

    for (let i = 0; i < roundSize; i++) {
      const option = buttons().find(
        (b) =>
          b.type === 'button' &&
          !b.disabled &&
          /^[A-F]/.test((b.textContent ?? '').trim()),
      );
      await click(option!);
      await click(control('Check answer')!);
      if (i < roundSize - 1) await click(control('Next question')!);
    }

    // The crossing happened on the last answer: the toast is up with the
    // feedback, as before…
    expect(container.querySelector('[data-testid="celebration"]')?.textContent).toContain(
      'day streak',
    );
    await click(control('See results')!);

    // …but the results screen only ever showed sticker / level-up toasts.
    expect(control('Another round')).toBeTruthy();
    expect(container.querySelector('[data-testid="celebration"]')).toBeNull();
  });
});
