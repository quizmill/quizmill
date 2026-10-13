// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PackHome from '@/pack/Home';
import { ATTEMPTS_KEY, saveDriveModeEnabled, saveLevelFilter } from '@/lib/storage';
import { saveCoachModeEnabled } from '@/lib/coach';
import { savePaperModeEnabled } from '@/lib/paper';
import { saveProgressionShown } from '@/lib/progressionPref';
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

const DAY = 24 * 3600_000;

/** N distinct-question correct attempts, `offset` days ago. */
function fullDay(offset: number, n = 10): Attempt[] {
  return Array.from({ length: n }, (_, i) => ({
    ...attempt(`demo-planets-${offset}-${i}`, 'planets', true),
    id: `d${offset}-a${i}`,
    answeredAt: Date.now() - offset * DAY,
  }));
}

describe('PackHome level card (progression)', () => {
  it('shows Level 1 · Grain before any practice', async () => {
    await render();
    const card = container.querySelector('[data-testid="level-card"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('Level 1 · Grain');
  });

  it('derives the level and XP retroactively from history', async () => {
    // 10 first-time-correct answers today: 10×(1+10) + 25 daily = 135 XP.
    // Demo ladder (18-question bank → the 1000 XP floor): level 3 at 80,
    // level 4 at 150.
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(fullDay(0)));
    await render();
    const card = container.querySelector('[data-testid="level-card"]');
    expect(card!.textContent).toContain('Level 3 · Mill Hand');
    expect(card!.textContent).toContain('135 XP');
    expect(card!.textContent).toContain('15 XP to Apprentice Miller');
  });

  it('is hidden when the device pref turns Levels & XP off', async () => {
    saveProgressionShown(false);
    await render();
    expect(container.querySelector('[data-testid="level-card"]')).toBeNull();
  });
});

describe('PackHome best-ever streak', () => {
  it('shows the record when the live streak has lapsed', async () => {
    // A 3-day run three weeks ago, nothing since: current streak 0, but
    // the record survives — that is the anti-loss-aversion point.
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([...fullDay(20), ...fullDay(21), ...fullDay(22)]),
    );
    await render();
    const best = container.querySelector('[data-testid="best-streak"]');
    expect(best).toBeTruthy();
    expect(best!.textContent).toContain('Best: 3 days');
  });
});

describe('PackHome category stats', () => {
  it('counts only attempts within the active level filter', async () => {
    // Demo pack: planets has 6 basics + 7 advanced questions. One attempt in
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

    expect(categoryStatLine('Planets & Moons')).toContain('1/6 answered');
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

    expect(categoryStatLine('Planets & Moons')).toContain('2/13 answered');
  });

  it('counts a re-answered question once, not per attempt (regression: "8/4")', async () => {
    // The same question answered in two sessions (wrong, then rescued).
    // The numerator must be distinct questions — never more than available.
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([
        { ...attempt('demo-planets-001', 'planets', false), id: 'a1', sessionId: 's1', answeredAt: 1000 },
        { ...attempt('demo-planets-001', 'planets', true), id: 'a2', sessionId: 's2', answeredAt: 2000 },
      ]),
    );

    await render();

    const line = categoryStatLine('Planets & Moons');
    // One distinct question answered, not two attempts.
    expect(line).toContain('1/13 answered');
    // Accuracy reflects the latest cold look (rescued → correct), and can
    // never read above 100%.
    expect(line).toContain('100% accuracy');
  });
});

describe('PackHome timed exam card', () => {
  it('links to the sitting with its size and clock (the demo declares 30 min)', async () => {
    await render();
    const card = container.querySelector('[data-testid="exam-card"]');
    expect(card).toBeTruthy();
    expect(card!.getAttribute('href')).toBe('/practice/exam');
    expect(card!.textContent).toContain('Mock exam');
    // 9 Advanced questions at 20-in-30-min pace = 13:30.
    expect(card!.textContent).toContain('9 questions in 13:30');
  });
});

describe('PackHome mode cards', () => {
  it('renders the Drive, Coach, Paper and Review cards exactly as before (markup pin)', async () => {
    // All four opt-in / conditional cards at once: each mode switched on,
    // plus one unresolved mistake so the Review card shows. The cards share
    // one component — this snapshot is the proof that extracting it moved
    // the markup without changing it.
    saveDriveModeEnabled(true);
    saveCoachModeEnabled(true);
    savePaperModeEnabled(true);
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([attempt('demo-planets-001', 'planets', false)]),
    );
    await render();

    const cards = [
      container.querySelector('[data-testid="drive-card"]'),
      container.querySelector('[data-testid="coach-card"]'),
      container.querySelector('[data-testid="paper-card"]'),
      Array.from(container.querySelectorAll('a')).find((a) =>
        (a.textContent ?? '').includes('Review 1 mistake'),
      ),
    ];
    cards.forEach((card, i) => expect(card, `card ${i}`).toBeTruthy());
    await expect(cards.map((c) => c!.outerHTML).join('\n')).toMatchFileSnapshot(
      './__snapshots__/home-mode-cards.html',
    );
  });
});
