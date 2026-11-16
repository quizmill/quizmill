// @vitest-environment happy-dom
/**
 * History that is wider than the content on screen. With one pack id for
 * two editions, a device can hold attempts on questions its edition does
 * not contain: a second device with the same sync key that has not
 * unlocked yet (sync is keyed by pack id, so the whole history arrives),
 * or a device where the unlocked edition was removed. Those rows must stay
 * in storage untouched — they count again the moment the fuller edition
 * is back — but nothing on screen may count, list or queue a question the
 * app cannot show: no "40/14 answered", no weak spot that is a bare id,
 * no review tile that opens on nothing.
 *
 * The demo pack plays the edition with fewer questions; `demo-planets-9xx`
 * are questions only the fuller edition has.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import ProgressPage from '@/pack/ProgressPage';
import { PackReviewRunner } from '@/pack/ReviewRunner';
import { ATTEMPTS_KEY } from '@/lib/storage';
import { examInScope, hasPackQuestion, packQuestions } from '@/pack/data';
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
  window.location.hash = '';
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

let seq = 0;
function attempt(questionId: string, isCorrect: boolean, sessionId: string, answeredAt: number): Attempt {
  return {
    id: `a${++seq}`,
    sessionId,
    questionId,
    answeredAt,
    selectedAnswer: 'A',
    isCorrect,
    timeTakenSeconds: 5,
    subject: 'planets',
    topic: questionId,
    difficulty: 1,
  };
}

/** Questions only the fuller edition has: `n` of them, each answered
 *  wrong twice, long ago — unresolved mistakes and weak spots there. */
function fullerEditionHistory(n: number): Attempt[] {
  return Array.from({ length: n }, (_, i) => `demo-planets-9${String(i).padStart(2, '0')}`).flatMap(
    (id, i) => [attempt(id, false, 'elsewhere-1', 100 + i), attempt(id, false, 'elsewhere-2', 500 + i)],
  );
}

/** This edition's own history: one right, one wrong twice. */
function ownHistory(): Attempt[] {
  return [
    attempt('demo-planets-001', true, 'here-1', 10_000),
    attempt('demo-planets-002', false, 'here-1', 10_001),
    attempt('demo-planets-002', false, 'here-2', 10_002),
  ];
}

function seed(attempts: Attempt[]) {
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
}

describe('attempts on questions this edition does not contain', () => {
  it('are out of scope for readiness, and known as such', () => {
    expect(hasPackQuestion('demo-planets-001')).toBe(true);
    expect(hasPackQuestion('demo-planets-900')).toBe(false);
    expect(examInScope('demo-planets-900')).toBe(false);
  });

  it('Home counts only the questions it has, and the review tile only mistakes it can show', async () => {
    seed([...fullerEditionHistory(30), ...ownHistory()]);
    await render(<PackHome />);
    const card = Array.from(container.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Planets & Moons'),
    );
    expect(card?.textContent).toContain('2/14 answered');
    expect(container.textContent).toContain('Review 1 mistake');
    expect(container.textContent).not.toContain('Review 31 mistakes');
  });

  it('Home shows no review tile when every open mistake is on a question it lacks', async () => {
    seed(fullerEditionHistory(3));
    await render(<PackHome />);
    expect(container.textContent).not.toContain('Review 3 mistakes');
    expect(container.querySelector('a[href="/practice/review/"]')).toBeNull();
  });

  it('the review queue reaches this edition’s mistake past older ones it cannot show', async () => {
    // Thirty older mistakes would fill the batch on their own.
    seed([...fullerEditionHistory(30), ...ownHistory()]);
    await render(<PackReviewRunner />);
    const q = packQuestions.find((p) => p.id === 'demo-planets-002')!;
    expect(container.textContent).toContain(q.prompt);
  });

  it('Progress totals and weak spots leave them out', async () => {
    seed([...fullerEditionHistory(30), ...ownHistory()]);
    await render(<ProgressPage />);
    const line = container.querySelector('[data-testid="totals-line"]');
    expect(line?.textContent).toContain(`2 of ${packQuestions.length} questions answered`);
    expect(container.textContent).not.toContain('demo-planets-9');
    const q = packQuestions.find((p) => p.id === 'demo-planets-002')!;
    expect(container.textContent).toContain(q.prompt.slice(0, 20));
  });

  it('nothing is dropped from storage: the rows are there for the edition that has them', async () => {
    const all = [...fullerEditionHistory(30), ...ownHistory()];
    seed(all);
    await render(<PackHome />);
    await render(<ProgressPage />);
    expect(JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? '[]')).toHaveLength(all.length);
  });
});
