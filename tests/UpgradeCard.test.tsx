// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import { readClaims } from '@/lib/upgradeClaim';

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

  it('each tap leaves with a fresh claim next to the ref; none is minted on render', async () => {
    await render(<PackHome />);
    expect(readClaims('solar-system-demo').claims).toEqual([]);
    const card = container.querySelector<HTMLAnchorElement>('[data-testid="upgrade-card-home"]')!;
    // Keep the test page where it is: stop the navigation, not React.
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener('click', stay, true);
    const hrefs: string[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        await act(async () => card.click());
        hrefs.push(card.href);
      }
    } finally {
      document.removeEventListener('click', stay, true);
    }
    const claims = hrefs.map((h) => new URL(h).searchParams.get('claim'));
    expect(claims[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(claims[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(claims[0]).not.toBe(claims[1]);
    for (const h of hrefs) {
      const u = new URL(h);
      expect(u.searchParams.get('ref')).toBe('solar-system-demo-home');
      expect(u.searchParams.get('utm_source')).toBe('app');
    }
    expect(readClaims('solar-system-demo').claims.map((c) => c.claim)).toEqual(claims);
    // The claim never rides in an event.
    expect(localStorage.getItem('quizmill.solar-system-demo.events.v1') ?? '').not.toContain(
      claims[0]!,
    );
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
