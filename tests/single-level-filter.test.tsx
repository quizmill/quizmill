// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import type { PackLevel } from '@/pack/data';

// The level axis is read from the active pack at build time. Swap the
// manifest's level list per test: a two-level pack (the demo's shape) and a
// one-level pack — an exam-prep bank where every question sits in one tier.
// The Zod types stay the demo's; only the level list and its label move.
// Hoisted so the (also hoisted) mock factory can read it at import time.
const { TWO_LEVELS, ONE_LEVEL, state } = vi.hoisted(() => {
  const TWO_LEVELS = [
    { key: 'basics', label: 'Basics' },
    { key: 'advanced', label: 'Advanced' },
  ];
  const ONE_LEVEL = [{ key: 'hard', label: 'Hard' }];
  return { TWO_LEVELS, ONE_LEVEL, state: { levels: TWO_LEVELS as PackLevel[] } };
});

vi.mock('@/pack/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pack/data')>();
  return {
    ...actual,
    get packManifest() {
      return { ...actual.packManifest, levels: state.levels, levelsLabel: 'Tier' };
    },
    get packLevels() {
      return state.levels;
    },
    get packLevelKeys() {
      return state.levels.map((l) => l.key);
    },
  };
});

import PackHome from '@/pack/Home';
import { PaperPage } from '@/pack/PaperPage';
import { ATTEMPTS_KEY, saveLevelFilter } from '@/lib/storage';
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
  state.levels = TWO_LEVELS;
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

async function render(el: ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  // Let the mount → load-prefs effects settle.
  await act(async () => {});
}

function radioLabels(group: Element): string[] {
  return Array.from(group.querySelectorAll('[role="radio"]')).map(
    (b) => b.textContent ?? '',
  );
}

/** N correct attempts at the demo's advanced planets questions (ids 004–010). */
function strongRun(n: number): Attempt[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    sessionId: 's1',
    questionId: `demo-planets-00${4 + i}`,
    answeredAt: Date.now() - i * 1000,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'planets',
    topic: 'planets',
    difficulty: 1,
  }));
}

describe('Home level filter with a single-level pack (#201)', () => {
  it('still offers All plus every level when the pack has two', async () => {
    await render(<PackHome />);
    const group = container.querySelector('[role="radiogroup"][aria-label="Filter by Tier"]');
    expect(group).toBeTruthy();
    expect(radioLabels(group!)).toEqual(['All', 'Basics', 'Advanced']);
  });

  it('renders no filter row when the pack has exactly one level', async () => {
    // "Tier: All | Hard" would be two buttons selecting the same questions.
    state.levels = ONE_LEVEL;
    await render(<PackHome />);
    expect(container.querySelector('[role="radiogroup"][aria-label="Filter by Tier"]')).toBeNull();
    expect(container.textContent).not.toContain('Tier');
  });

  it('shows no level nudge for a single-level pack, even with a strong run at that level', async () => {
    // One level means nothing adjacent to suggest. The pref may still name
    // the level (set before the pack shrank, or by a #level= link) — the
    // nudge must stay quiet rather than reason about a one-rung ladder.
    state.levels = ONE_LEVEL;
    saveLevelFilter('hard');
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(strongRun(8)));
    await render(<PackHome />);
    expect(container.textContent).not.toContain('Ready for');
    expect(container.textContent).not.toContain('flying through');
  });
});

describe('a saved level the pack no longer has (#260)', () => {
  function available(): string[] {
    return (container.textContent ?? '').match(/\d+ questions available/g) ?? [];
  }

  it('reads as "All" on Home, so the bank is not filtered to nothing', async () => {
    // The pack dropped the learner's level; Home hides the row for a single
    // level, so a stale pref would leave no way back to a non-empty bank.
    await render(<PackHome />);
    const all = available();
    await act(async () => {
      root?.unmount();
    });
    state.levels = [{ key: 'basics', label: 'Basics' }];
    saveLevelFilter('exam');
    root = undefined;
    await render(<PackHome />);
    expect(all.length).toBeGreaterThan(0);
    expect(available()).toEqual(all);
  });

  it('selects "All" in a multi-level row', async () => {
    saveLevelFilter('exam');
    await render(<PackHome />);
    const all = container.querySelector('[role="radiogroup"][aria-label="Filter by Tier"] [role="radio"]');
    expect(all?.textContent).toBe('All');
    expect(all?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Paper level filter with a single-level pack (#201)', () => {
  it('still offers All plus every level when the pack has two', async () => {
    await render(<PaperPage />);
    const group = container.querySelector('[role="radiogroup"][aria-label="Tier"]');
    expect(group).toBeTruthy();
    expect(radioLabels(group!)).toEqual(['All', 'Basics', 'Advanced']);
  });

  it('renders no filter row when the pack has exactly one level', async () => {
    state.levels = ONE_LEVEL;
    await render(<PaperPage />);
    expect(container.querySelector('[role="radiogroup"][aria-label="Tier"]')).toBeNull();
    // The other compose controls are untouched.
    expect(container.querySelector('[role="radiogroup"][aria-label="Question count"]')).toBeTruthy();
  });

  it('offers the whole bank ("All") without a saved level filter when the pack has one level', async () => {
    // "All" prints a whole level in pack order and used to need a level
    // picked in the row above. With the row gone, a one-level pack's only
    // level IS the whole bank — otherwise a fresh learner could never print
    // the complete paper (Copilot review on #205).
    state.levels = ONE_LEVEL;
    await render(<PaperPage />);
    const counts = container.querySelector('[role="radiogroup"][aria-label="Question count"]');
    expect(radioLabels(counts!)).toEqual(['5', '10', '15', '20', 'All']);
  });

  it('still needs a level picked before offering "All" when the pack has two', async () => {
    // Two levels, filter on All: the bank spans both levels, which is not
    // "a paper as written" — the count stays numeric until a level is chosen.
    await render(<PaperPage />);
    const counts = container.querySelector('[role="radiogroup"][aria-label="Question count"]');
    expect(radioLabels(counts!)).toEqual(['5', '10', '15', '20']);
  });
});
