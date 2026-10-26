// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackReviewRunner } from '@/pack/ReviewRunner';
import { ATTEMPTS_KEY } from '@/lib/storage';
import { correctKeysOf, packQuestions } from '@/pack/data';
import { canShuffleOptions } from '@/pack/runner';
import { weakSpotClearAfterPref } from '@/lib/weakSpotPref';
import type { Attempt } from '@/data/types';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  window.location.hash = '';
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackReviewRunner />);
  });
  // Let the mount → pick-session effects settle.
  await act(async () => {});
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

/** A control button (Check answer / Next / See results / Review more) —
 *  Button renders without a type attribute; option buttons set
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

/** Answer every question of the round WRONGLY (so the mistakes stay
 *  queued for the next round) up to the results screen. */
async function finishRound() {
  for (let i = 0; i < 20; i++) {
    if (control('Review more')) return;
    const current = packQuestions.find((p) =>
      container.textContent?.includes(p.prompt),
    )!;
    const wrongKey = current.options
      .map((o) => o.key)
      .find((k) => !correctKeysOf(current).includes(k))!;
    const option = buttons().find(
      (b) =>
        b.type === 'button' &&
        !b.disabled &&
        (b.textContent ?? '').trim().startsWith(wrongKey),
    );
    expect(option, 'expected an answer option to be clickable').toBeTruthy();
    await click(option!);
    await click(control('Check answer')!);
    await click((control('Next question') ?? control('See results'))!);
  }
  throw new Error('round never reached the results screen');
}

/** The option buttons' key bubbles, in display order. */
function optionKeys(): string[] {
  return buttons()
    .filter((b) => b.type === 'button')
    .map((b) => b.querySelector('span')?.textContent ?? '')
    .filter((k) => /^[A-F]$/.test(k));
}

/** Tap the option with this pack key, then Check answer. */
async function answer(key: string) {
  const option = buttons().find(
    (b) => b.type === 'button' && (b.textContent ?? '').trim().startsWith(key),
  );
  await click(option!);
  await click(control('Check answer')!);
}

function wrong(
  questionId: string,
  sessionId: string,
  answeredAt: number,
  position: number,
): Attempt {
  const question = packQuestions.find((p) => p.id === questionId)!;
  return {
    id: `${sessionId}:a${position}`,
    sessionId,
    questionId,
    answeredAt,
    selectedAnswer: 'A',
    isCorrect: false,
    timeTakenSeconds: 1,
    subject: question.categoryKey,
    topic: questionId,
    difficulty: question.difficulty,
    position,
  };
}

/** Two stale mistakes from last week, then a paper sheet with one wrong. */
function seedOldMistakesAndASheet() {
  const [old1, old2, onSheet] = packQuestions;
  const attempts: Attempt[] = [
    wrong(old1.id, 'last-week', 1000, 1),
    wrong(old2.id, 'last-week', 2000, 2),
    { ...wrong(onSheet.id, 'sheet-1', 9000, 4), mode: 'paper' },
  ];
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  return { old1, old2, onSheet };
}

describe('PackReviewRunner', () => {
  it('reviews the whole queue, oldest mistake first, without a scope', async () => {
    const { old1 } = seedOldMistakesAndASheet();
    await render();
    expect(container.textContent).toContain('Q 1 / 3');
    expect(container.textContent).toContain(old1.prompt);
  });

  it("reviews only one session's mistakes when opened with #session=", async () => {
    // Regression: "Review the mistakes together" on a just-marked paper
    // sheet opened the global queue, so the review started on older,
    // unrelated mistakes instead of the question the sheet got wrong.
    const { old1, onSheet } = seedOldMistakesAndASheet();
    window.location.hash = '#session=sheet-1';
    await render();
    expect(container.textContent).toContain('Q 1 / 1');
    expect(container.textContent).toContain(onSheet.prompt);
    expect(container.textContent).not.toContain(old1.prompt);
  });

  it('says so when a scoped session has nothing left to review', async () => {
    seedOldMistakesAndASheet();
    window.location.hash = '#session=some-other-sheet';
    await render();
    expect(container.textContent).toContain('Nothing to review');
    // The rest of the queue is still there — don't claim it's empty.
    expect(container.textContent).not.toContain("haven't got any unresolved mistakes");
  });

  it('starts another round when "Review more" is clicked', async () => {
    // Regression: "Review more" linked to the page it was already on, so
    // nothing remounted and the results screen just sat there.
    seedOldMistakesAndASheet();
    await render();
    await finishRound();
    await click(control('Review more')!);
    expect(control('Review more')).toBeUndefined();
    expect(container.textContent).toContain('Q 1 / 3');
  });

  it('keeps a question dealt until it is right N times in a row (default 2)', async () => {
    const [q1] = packQuestions;
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([wrong(q1.id, 'old', 1000, 1)]));
    await render();
    expect(container.textContent).toContain('Q 1 / 1');
    await answer(correctKeysOf(q1)[0]);
    expect(container.textContent).toContain('Right — 1 of 2 to clear it.');
    await click(control('See results')!);
    await click(control('Review more')!);
    // Still a weak spot: dealt again, and the second right answer clears it.
    expect(container.textContent).toContain(q1.prompt);
    await answer(correctKeysOf(q1)[0]);
    expect(container.textContent).toContain('Rescued.');
    await click(control('See results')!);
    await click(control('Review more')!);
    expect(container.textContent).toContain('Nothing to review');
  });

  it('one right answer clears it when the device is set to 1', async () => {
    weakSpotClearAfterPref.save(1);
    const [q1] = packQuestions;
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([wrong(q1.id, 'old', 1000, 1)]));
    await render();
    await answer(correctKeysOf(q1)[0]);
    expect(container.textContent).toContain('Rescued.');
  });

  it('shuffles the options of a re-asked question but records the pack key', async () => {
    const q = packQuestions.find((p) => canShuffleOptions(p) && p.options.length > 2)!;
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([wrong(q.id, 'old', 1000, 1)]));
    // Fisher–Yates with random() = 0 rotates the bank order left by one.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    await render();
    spy.mockRestore();
    const bankKeys = q.options.map((o) => o.key);
    expect(optionKeys()).toEqual([...bankKeys.slice(1), bankKeys[0]]);
    const key = correctKeysOf(q)[0];
    await answer(key);
    const attempts = JSON.parse(localStorage.getItem(ATTEMPTS_KEY)!) as Attempt[];
    expect(attempts.at(-1)).toMatchObject({ questionId: q.id, selectedAnswer: key, isCorrect: true });
  });

  it("keeps a paper sheet's review in printed order", async () => {
    const { onSheet } = seedOldMistakesAndASheet();
    window.location.hash = '#session=sheet-1';
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    await render();
    spy.mockRestore();
    expect(optionKeys()).toEqual(onSheet.options.map((o) => o.key));
  });

  it('"Review more" after a scoped session moves on to the rest of the queue', async () => {
    seedOldMistakesAndASheet();
    window.location.hash = '#session=sheet-1';
    await render();
    expect(container.textContent).toContain('Q 1 / 1');
    await finishRound();
    await click(control('Review more')!);
    // The whole queue is next, oldest first — not the one-question scope
    // again.
    expect(container.textContent).toContain('Q 1 / 3');
    expect(window.location.hash).toBe('');
  });
});

describe('PackReviewRunner results screen', () => {
  it('renders the results card exactly as before (markup pin)', async () => {
    // finishRound answers everything wrongly → a deterministic 0/3 score.
    // One right answer clearing a question is the behaviour this pins.
    weakSpotClearAfterPref.save(1);
    seedOldMistakesAndASheet();
    await render();
    await finishRound();
    const card = Array.from(container.querySelectorAll('main > div')).find((d) =>
      (d.textContent ?? '').includes('Review complete'),
    );
    expect(card).toBeTruthy();
    await expect(card!.outerHTML).toMatchFileSnapshot(
      './__snapshots__/review-results.html',
    );
  });
});
