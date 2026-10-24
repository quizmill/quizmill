// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PackHome from '@/pack/Home';
import { ATTEMPTS_KEY, saveLevelFilter } from '@/lib/storage';
import type { Attempt } from '@/data/types';

// The pack's named papers on Home (#194): a list grouped by series — never
// a pill row, there may be dozens — each row a link to practise that paper
// whole, with the paper's own progress. Driven against the demo pack's two
// starter papers (planets 001–006; exploration 001–005).

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
  await act(async () => {});
}

function section(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="paper-list"]');
  if (!el) throw new Error('no paper list on Home');
  return el;
}

function row(key: string): HTMLAnchorElement {
  const el = section().querySelector<HTMLAnchorElement>(`[data-testid="paper-row-${key}"]`);
  if (!el) throw new Error(`no row for paper ${key}`);
  return el;
}

describe('PackHome papers list', () => {
  it('lists the pack’s papers under their series, each linking to practise that paper', async () => {
    await render();
    const text = section().textContent ?? '';
    // The manifest's papersLabel heads the section; the series groups it.
    expect(text).toContain('Papers');
    expect(text).toContain('Starter papers');
    // (next/link normalises the trailing slash outside the real app.)
    expect(row('starter-paper-1').getAttribute('href')).toMatch(
      /^\/practice\/?\?paper=starter-paper-1$/,
    );
    expect(row('starter-paper-2').getAttribute('href')).toMatch(
      /^\/practice\/?\?paper=starter-paper-2$/,
    );
    expect(row('starter-paper-1').textContent).toContain('Paper 1');
    expect(row('starter-paper-1').textContent).toContain('6 questions');
    expect(row('starter-paper-2').textContent).toContain('5 questions');
    // A paper owned by a category says which (two books can both be "Paper 1").
    expect(row('starter-paper-1').textContent).toContain('Planets');
    // Not a segmented pill row — the level filter is the only radiogroup.
    expect(section().querySelector('[role="radio"]')).toBeNull();
  });

  it('shows per-paper progress from the latest cold look at each question', async () => {
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([
        attempt('demo-planets-001', 'planets', true),
        attempt('demo-planets-002', 'planets', false),
        // Outside paper 1 — must not count toward it.
        attempt('demo-planets-007', 'planets', true),
      ]),
    );
    await render();
    expect(row('starter-paper-1').textContent).toContain('2/6 answered');
    expect(row('starter-paper-1').textContent).toContain('50%');
    expect(row('starter-paper-2').textContent).toContain('5 questions');
  });

  it('ignores the level filter — a paper is always the whole paper', async () => {
    // Paper 1 has 3 Basics + 3 Advanced questions.
    saveLevelFilter('basics');
    await render();
    expect(row('starter-paper-1').textContent).toContain('6 questions');
  });

  it('sits after the categories and before the mode rail', async () => {
    await render();
    const text = container.textContent ?? '';
    const categories = text.indexOf('Pick a category');
    const papers = text.indexOf('Starter papers');
    const modes = text.indexOf('More ways to practise');
    expect(categories).toBeGreaterThan(-1);
    expect(papers).toBeGreaterThan(categories);
    expect(modes).toBeGreaterThan(papers);
  });
});
