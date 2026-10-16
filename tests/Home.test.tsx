// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PackHome from '@/pack/Home';
import {
  ATTEMPTS_KEY,
  loadAchievements,
  saveLevelFilter,
} from '@/lib/storage';
import { saveDriveModeEnabled } from '@/lib/drive';
import { saveCoachModeEnabled } from '@/lib/coach';
import { savePaperModeEnabled } from '@/lib/paper';
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

describe('PackHome is the practice loop only (#188)', () => {
  it('carries no status card, stat tiles or install nudge — status lives on Progress', async () => {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(fullDay(0)));
    await render();
    // The level/streak card and the Answered/Readiness tiles moved to Progress.
    expect(container.querySelector('[data-testid="level-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="streak-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="exam-readiness-tile"]')).toBeNull();
    expect(container.textContent).not.toContain('Answered');
    // The install nudge is gone too (Settings keeps its install card).
    expect(container.querySelector('[data-testid="install-banner"]')).toBeNull();
  });

  it('keeps the four round header buttons for desktop, where there is no tab bar', async () => {
    await render();
    const nav = container.querySelector('header nav[aria-label="Pages"]');
    expect(nav).toBeTruthy();
    // Phones get the bottom tab bar instead, so the row is hidden below sm:.
    expect(nav!.className).toContain('hidden');
    expect(nav!.className).toContain('sm:flex');
    for (const [label, href] of [
      ['Progress', '/progress'],
      ['Sticker cabinet', '/stickers'],
      ['My notes', '/notes'],
      ['Settings', '/settings'],
    ]) {
      const link = nav!.querySelector(`a[aria-label="${label}"]`);
      expect(link, label).toBeTruthy();
      expect(link!.getAttribute('href'), label).toBe(href);
    }
  });

  it('puts Review mistakes and the categories before the mode rail', async () => {
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([attempt('demo-planets-001', 'planets', false)]),
    );
    await render();
    const text = container.textContent ?? '';
    const review = text.indexOf('Review 1 mistake');
    const categories = text.indexOf('Pick a category');
    const modes = text.indexOf('More ways to practise');
    expect(review).toBeGreaterThan(-1);
    expect(categories).toBeGreaterThan(review);
    expect(modes).toBeGreaterThan(categories);
  });
});

describe('PackHome streak chip', () => {
  it('is hidden until there is any streak signal', async () => {
    await render();
    expect(container.querySelector('[data-testid="streak-chip"]')).toBeNull();
  });

  it('counts down to today’s goal while it is unmet, and links to Progress', async () => {
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([attempt('demo-planets-001', 'planets', true)]),
    );
    await render();
    const chip = container.querySelector('[data-testid="streak-chip"]');
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain('9 more today');
    expect(chip!.getAttribute('href')).toBe('/progress');
  });

  it('shows the streak once the goal is met', async () => {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([...fullDay(0), ...fullDay(1)]));
    await render();
    const chip = container.querySelector('[data-testid="streak-chip"]');
    expect(chip!.textContent).toContain('2-day streak');
  });
});

describe('PackHome level-crossing backfill', () => {
  it('records levels earned by history that arrived outside a runner', async () => {
    // Imported / synced attempts never pass through a runner's hook; Home
    // is the landing route, so it persists the crossing — the invariant
    // that every attempt-producing path reaches recordLevelCrossings.
    // 10 first-time-correct answers today = 135 XP = level 3 on the demo ladder.
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(fullDay(0)));
    await render();
    const ids = loadAchievements().map((e) => e.id);
    expect(ids).toContain('level-2');
    expect(ids).toContain('level-3');
    expect(ids).not.toContain('level-4');
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

describe('PackHome timed exam tile', () => {
  it('links to the sitting with its size and clock (the demo declares 30 min)', async () => {
    await render();
    const card = container.querySelector('[data-testid="exam-card"]');
    expect(card).toBeTruthy();
    expect(card!.getAttribute('href')).toBe('/practice/exam');
    expect(card!.textContent).toContain('Mock exam');
    // 9 Advanced questions at 20-in-30-min pace = 13:30.
    expect(card!.textContent).toContain('9 Qs · 13:30');
  });

  it('is the only tile in the rail when no device mode is on', async () => {
    await render();
    const rail = container.querySelector('[data-testid="mode-rail"]');
    expect(rail).toBeTruthy();
    expect(rail!.querySelectorAll('a')).toHaveLength(1);
  });
});

describe('PackHome mode cards', () => {
  it('renders the Drive, Coach and Paper tiles and the Review card (markup pin)', async () => {
    // All four opt-in / conditional surfaces at once: each mode switched on,
    // plus one unresolved mistake so the Review card shows. The tiles share
    // one component and the Review card another — this snapshot pins both.
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
