// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { SettingsPage } from '@/components/SettingsPage';
import { GAMES_REVEALED_KEY, gamesRevealedPref } from '@/lib/gamesReveal';

// The demo pack (the test build's active pack) switches games on, so the
// easter egg is live here; the only question is whether finding it sticks.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  gamesRevealedPref.resetForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.restoreAllMocks();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

async function unmount() {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
}

const egg = () => container.querySelector('[data-testid="games-easter-egg"]');

async function tapVersion(times: number) {
  const pill = container.querySelector<HTMLButtonElement>(
    '[data-testid="app-version"]',
  );
  if (!pill) throw new Error('no version pill');
  for (let i = 0; i < times; i++) {
    await act(async () => {
      pill.click();
    });
  }
}

describe('games easter egg', () => {
  it('stays hidden until the version pill has been tapped 7 times', async () => {
    await render(<SettingsPage />);
    expect(egg()).toBeNull();
    await tapVersion(6);
    expect(egg()).toBeNull();
    await tapVersion(1);
    expect(egg()).not.toBeNull();
    // (next/link drops the trailing slash outside a trailingSlash build.)
    expect(egg()?.querySelector('a[href^="/games"]')).not.toBeNull();
  });

  it('remembers the find on this device, so the arcade is there on the next visit', async () => {
    await render(<SettingsPage />);
    await tapVersion(7);
    expect(localStorage.getItem(GAMES_REVEALED_KEY)).toBe('1');

    await unmount();
    await render(<SettingsPage />);
    expect(egg()).not.toBeNull();
  });

  it('can be tucked away again from the card', async () => {
    localStorage.setItem(GAMES_REVEALED_KEY, '1');
    await render(<SettingsPage />);
    expect(egg()).not.toBeNull();

    const hide = Array.from(egg()!.querySelectorAll('button')).find((b) =>
      /hide/i.test(b.textContent ?? ''),
    );
    expect(hide).toBeDefined();
    await act(async () => {
      hide!.click();
    });
    expect(egg()).toBeNull();
    expect(localStorage.getItem(GAMES_REVEALED_KEY)).toBeNull();

    // Hidden means hidden: it takes the full 7 taps to find it again.
    await tapVersion(6);
    expect(egg()).toBeNull();
    await tapVersion(1);
    expect(egg()).not.toBeNull();
  });
});
