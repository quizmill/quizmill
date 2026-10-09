// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';

// The demo pack deliberately carries no upgrade block, so a pack WITH one
// is simulated by widening the build-time config. (The absent case — no
// card, no layout change — lives in upgrade-absent.test.tsx against the
// real demo config.)
vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return {
    ...mod,
    APP_CONFIG: {
      ...mod.APP_CONFIG,
      upgrade: {
        title: 'Get the full course',
        url: 'https://example.com/course?utm_source=app',
        price: '£15',
        blurb: '600 more questions and timed mock papers.',
      },
    },
  };
});

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

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

describe('UpgradeCard with a pack that declares an upgrade', () => {
  it('renders on Home below the practice loop, linking out with ref=<packId>-home', async () => {
    await render(<PackHome />);
    const card = container.querySelector<HTMLAnchorElement>(
      '[data-testid="upgrade-card-home"]',
    );
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('Get the full course');
    expect(card!.textContent).toContain('£15');
    expect(card!.textContent).toContain('600 more questions');
    expect(card!.getAttribute('href')).toBe(
      'https://example.com/course?utm_source=app&ref=solar-system-demo-home',
    );
    // Leaves the app: new tab, no opener.
    expect(card!.getAttribute('target')).toBe('_blank');
    expect(card!.getAttribute('rel')).toContain('noopener');

    // Below the practice loop — after the category cards, never above them.
    const lastCategory = Array.from(container.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Space Exploration'),
    );
    expect(lastCategory).toBeTruthy();
    expect(
      lastCategory!.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders in Settings with ref=<packId>-settings', async () => {
    await render(<SettingsPage />);
    const card = container.querySelector<HTMLAnchorElement>(
      '[data-testid="upgrade-card-settings"]',
    );
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('Get the full course');
    expect(card!.getAttribute('href')).toBe(
      'https://example.com/course?utm_source=app&ref=solar-system-demo-settings',
    );
  });
});
