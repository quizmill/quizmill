// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PackHome from '@/pack/Home';
import { ATTEMPTS_KEY, saveLevelFilter } from '@/lib/storage';
import type { Attempt } from '@/data/types';

// React needs this flag to allow act() outside @testing-library.
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
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function attempt(questionId: string, subject: string, isCorrect: boolean): Attempt {
  return {
    id: `attempt-${questionId}`,
    sessionId: 'session-1',
    questionId,
    answeredAt: Date.now(),
    selectedAnswer: 'A',
    isCorrect,
    timeTakenSeconds: 5,
    subject,
    topic: questionId,
    difficulty: 1,
  };
}

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackHome />);
  });
  // Let the mount → load-prefs effects settle.
  await act(async () => {});
}

/** The category card's "N/M answered" line for the given card label. */
function categoryStatLine(label: string): string {
  const card = Array.from(container.querySelectorAll('a')).find((a) =>
    (a.textContent ?? '').includes(label),
  );
  expect(card, `expected a category card for ${label}`).toBeTruthy();
  return card!.textContent ?? '';
}

describe('PackHome category stats', () => {
  it('counts only attempts within the active level filter', async () => {
    // Demo pack: planets has 4 basics + 7 advanced questions. One attempt in
    // each band; with the Basics filter on, only the basics attempt counts —
    // the answered numerator must use the same filter as the available
    // denominator (regression: it showed e.g. "74/16 answered").
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([
        attempt('demo-planets-001', 'planets', true),
        attempt('demo-planets-004', 'planets', false),
      ]),
    );
    saveLevelFilter('basics');

    await render();

    expect(categoryStatLine('Planets & Moons')).toContain('1/4 answered');
  });

  it('counts all attempts when no level filter is active', async () => {
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([
        attempt('demo-planets-001', 'planets', true),
        attempt('demo-planets-004', 'planets', false),
      ]),
    );

    await render();

    expect(categoryStatLine('Planets & Moons')).toContain('2/11 answered');
  });
});
