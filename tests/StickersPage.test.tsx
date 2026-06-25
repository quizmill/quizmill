// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import StickersPage from '@/pack/StickersPage';
import { ACHIEVEMENTS } from '@/pack/achievements';
import * as storage from '@/lib/storage';

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

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<StickersPage />);
  });
  await act(async () => {});
}

function earnedTileCount(): number {
  return container.querySelectorAll('[data-earned="true"]').length;
}

function countText(): string {
  return container.querySelector('[data-testid="sticker-count"]')?.textContent ?? '';
}

describe('StickersPage sticker count', () => {
  it('counts only stickers that exist in the current pack', async () => {
    // Seed two real, earnable achievements plus a STALE id — one left over
    // from a different pack / older definitions that no longer maps to any
    // tile in the cabinet (e.g. a mastery sticker for a category the active
    // pack doesn't have).
    const real = ACHIEVEMENTS.slice(0, 2).map((a) => a.id);
    storage.saveAchievements(
      [...real, 'mastery-does-not-exist'].map((id) => ({ id, earnedAt: 1 })),
    );

    await render();

    // Two visible earned tiles…
    expect(earnedTileCount()).toBe(2);
    // …so the headline numerator must read 2, not 3 (the raw stored count).
    expect(countText()).toContain(`${2} / ${ACHIEVEMENTS.length}`);
  });
});
