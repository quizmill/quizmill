// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PackHome from '@/pack/Home';
import ExamReadiness from '@/pack/ExamReadiness';
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

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

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

describe('PackHome readiness-check tile', () => {
  it('offers the check next to the timed exam, sized from the pack', async () => {
    await render(<PackHome />);
    const card = container.querySelector('[data-testid="check-card"]');
    expect(card).toBeTruthy();
    expect(card!.getAttribute('href')).toBe('/practice/check');
    // A one-word label: five tiles in the rail leave no room for "Readiness".
    expect(card!.textContent).toContain('Check');
    expect(card!.textContent).toContain('Readiness · 6 Qs');
    // Last in the rail, after the exam tile.
    const tiles = Array.from(container.querySelectorAll('[data-testid="mode-rail"] a')).map((a) =>
      a.getAttribute('data-testid'),
    );
    expect(tiles.indexOf('check-card')).toBe(tiles.length - 1);
    expect(tiles.indexOf('exam-card')).toBe(tiles.length - 2);
  });
});

describe('ExamReadiness → readiness check', () => {
  it('links to the check while the blueprint is not yet covered', async () => {
    await render(<ExamReadiness attempts={[attempt('demo-planets-001', 'planets', true)]} />);
    const link = container.querySelector('[data-testid="readiness-check-link"]');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/practice/check');
    expect(link!.textContent).toContain('6 questions across every domain');
  });

  it('drops the link once enough history gives a real verdict', async () => {
    // Twelve first attempts in the 60%-weight domain clear the judged gate.
    const attempts = Array.from({ length: 12 }, (_, i) =>
      attempt(`demo-planets-${i}`, 'planets', true),
    );
    await render(<ExamReadiness attempts={attempts} />);
    const verdict = container.querySelector('[data-testid="readiness-verdict"]');
    expect(verdict!.getAttribute('data-verdict')).not.toBe('no-data');
    expect(container.querySelector('[data-testid="readiness-check-link"]')).toBeNull();
  });
});
