// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { SettingsPage } from '@/components/SettingsPage';
import { EarnedGameCard } from '@/pack/EarnedGameCard';
import GamesPage from '@/pack/GamesPage';
import {
  GAMES_KEY,
  gamesShownPref,
  loadGamesShown,
  saveGamesShown,
} from '@/lib/gamesPref';
import { GAMES_REVEALED_KEY, gamesRevealedPref } from '@/lib/gamesReveal';
import { clearAll } from '@/lib/storage';

// The PACK switches games on (its `games` block — the demo pack, the
// test build's active pack, has one); this device may hide them wholesale:
// the earned game on the results screen, the arcade, the easter egg. The
// Timed exam / Levels & XP pattern.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  gamesShownPref.resetForTests();
  gamesRevealedPref.resetForTests();
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

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function tapVersion(times: number) {
  const pill = byTestId('app-version');
  if (!pill) throw new Error('no version pill');
  for (let i = 0; i < times; i++) await click(pill);
}

describe('Games device switch', () => {
  it('is shown by default and stored app-level once hidden', () => {
    expect(loadGamesShown()).toBe(true);
    saveGamesShown(false);
    expect(localStorage.getItem(GAMES_KEY)).toBe('1');
    // "Reset all local progress" is about the pack's data, not this device.
    clearAll();
    expect(loadGamesShown()).toBe(false);
    saveGamesShown(true);
    expect(localStorage.getItem(GAMES_KEY)).toBeNull();
  });

  it('Settings has a Games card under "This device" that flips the pref', async () => {
    await render(<SettingsPage />);
    const card = byTestId('games-setting');
    expect(card).toBeTruthy();
    expect(card!.textContent).toMatch(/hide/i);
    const toggle = card!.querySelector<HTMLButtonElement>('[data-testid="games-toggle"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(loadGamesShown()).toBe(false);
    await click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(loadGamesShown()).toBe(true);
  });

  it('hiding takes the earned game off the results screen', async () => {
    saveGamesShown(false);
    await render(<EarnedGameCard correct={10} total={10} />);
    expect(byTestId('earned-game')).toBeNull();
  });

  it('hiding answers the arcade route with a "hidden on this device" card, not the grid', async () => {
    saveGamesShown(false);
    await render(<GamesPage />);
    expect(byTestId('games-grid')).toBeNull();
    expect(byTestId('games-none')).toBeNull();
    const hidden = byTestId('games-hidden');
    expect(hidden).not.toBeNull();
    // The way back on is the switch, so point at it.
    expect(hidden!.querySelector('a[href^="/settings"]')).not.toBeNull();
  });

  it('hiding puts the easter egg away too, even once found', async () => {
    localStorage.setItem(GAMES_REVEALED_KEY, '1');
    saveGamesShown(false);
    await render(<SettingsPage />);
    expect(byTestId('games-easter-egg')).toBeNull();
    // ...and the version pill reveals nothing while games are hidden.
    await tapVersion(7);
    expect(byTestId('games-easter-egg')).toBeNull();
  });

  it('switching back on brings a remembered find straight back', async () => {
    localStorage.setItem(GAMES_REVEALED_KEY, '1');
    saveGamesShown(false);
    await render(<SettingsPage />);
    expect(byTestId('games-easter-egg')).toBeNull();
    await click(byTestId('games-toggle')!);
    expect(byTestId('games-easter-egg')).not.toBeNull();
  });
});
