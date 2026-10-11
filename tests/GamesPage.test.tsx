// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The arcade is gated by the ACTIVE pack at render time, not by the pack
// the deployment was built from: one installed app plays many packs (the
// pack library), so the prerendered route must exist for every build and
// decide in the browser. Mock the pack seam so one test file covers both
// kinds of pack; `gamesEnabled` flips per test via this holder.
const pack: { games: { include?: string[] } | undefined } = { games: {} };
vi.mock('@/pack/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pack/data')>();
  return {
    ...actual,
    get packGames() {
      return pack.games;
    },
    get gamesEnabled() {
      return pack.games !== undefined;
    },
  };
});

import GamesPage from '@/pack/GamesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
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

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

describe('GamesPage gating by the active pack', () => {
  it('shows the full grid for a pack with an empty games block', async () => {
    pack.games = {};
    await render(<GamesPage />);
    expect(byTestId('games-grid')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="game-card-"]')).toHaveLength(6);
    expect(byTestId('games-none')).toBeNull();
  });

  it('narrows the grid to the pack’s include list', async () => {
    pack.games = { include: ['pong', 'snake'] };
    await render(<GamesPage />);
    const cards = Array.from(
      container.querySelectorAll('[data-testid^="game-card-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(cards).toEqual(['game-card-snake', 'game-card-pong']);
  });

  it('tells a pack without games that there is nothing here, with a way home', async () => {
    pack.games = undefined;
    await render(<GamesPage />);
    expect(byTestId('games-grid')).toBeNull();
    const none = byTestId('games-none');
    expect(none).not.toBeNull();
    expect(none?.textContent).toMatch(/no games/i);
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
  });
});
