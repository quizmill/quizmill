// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Attempt } from '@/data/types';
import { loadAchievements } from '@/lib/storage';
import { saveProgressionShown } from '@/lib/progressionPref';
import { recordedLevel, useLevelUp } from '@/pack/useLevelUp';
import { XP_DAILY_GOAL, XP_EFFORT, XP_FIRST_CORRECT } from '@/lib/xp';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('recordedLevel', () => {
  it('is 1 with no level records (everyone starts at Grain)', () => {
    expect(recordedLevel([])).toBe(1);
    expect(recordedLevel(['streak-5', 'volume-50'])).toBe(1);
  });

  it('finds the highest level-N record among other achievement ids', () => {
    expect(recordedLevel(['streak-5', 'level-2', 'level-4', 'level-3'])).toBe(4);
  });

  it('ignores malformed level ids', () => {
    expect(recordedLevel(['level-', 'level-x', 'level-2.5'])).toBe(1);
  });
});

// ——— the hook, driven through a minimal component ———

let container: HTMLDivElement;
let root: Root;
type Hook = ReturnType<typeof useLevelUp>;
const holder: { current: Hook | null } = { current: null };
const hook = () => holder.current!;

function Harness() {
  const h = useLevelUp();
  useEffect(() => {
    holder.current = h;
  });
  return h.nextLevelUp ? (
    <div data-testid="level-toast">{h.nextLevelUp.name}</div>
  ) : null;
}

beforeEach(async () => {
  localStorage.clear();
  holder.current = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<Harness />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

/** N distinct-question correct attempts on one day. */
function corrects(n: number): Attempt[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    sessionId: 's1',
    questionId: `q${i}`,
    answeredAt: Date.now(),
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'planets',
    topic: `q${i}`,
    difficulty: 1,
  }));
}

describe('useLevelUp', () => {
  it('records the crossing once and surfaces one celebration', () => {
    // 10 first corrects: 10×11 + 25 daily = 135 XP → level 2.
    const attempts = corrects(10);
    expect(
      10 * (XP_EFFORT + XP_FIRST_CORRECT) + XP_DAILY_GOAL,
    ).toBeGreaterThanOrEqual(100);

    let crossed = 0;
    act(() => {
      crossed = hook().checkNow(attempts);
    });
    expect(crossed).toBe(2);
    expect(loadAchievements().map((e) => e.id)).toContain('level-2');
    expect(container.textContent).toContain('Fresh Flour');

    // Same history again: the high-water mark stops a re-celebration.
    act(() => {
      crossed = hook().checkNow(attempts);
    });
    expect(crossed).toBe(0);
  });

  it('backfills skipped rungs but celebrates only the level reached', () => {
    // 39 first corrects: 39×11 + 25 = 454 XP → straight to level 4.
    let crossed = 0;
    act(() => {
      crossed = hook().checkNow(corrects(39));
    });
    expect(crossed).toBe(4);
    const ids = loadAchievements().map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['level-2', 'level-3', 'level-4']));
    expect(container.textContent).toContain('Apprentice Miller');
  });

  it('no-ops when the device pref hides Levels & XP', () => {
    saveProgressionShown(false);
    let crossed = 0;
    act(() => {
      crossed = hook().checkNow(corrects(10));
    });
    expect(crossed).toBe(0);
    expect(loadAchievements()).toEqual([]);
  });
});
