// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TabBar, activeTab } from '@/components/TabBar';

// The bar reads the route from next/navigation; the static export has no
// router in a unit test, so the pathname is stubbed per test.
const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(pathname: string) {
  nav.pathname = pathname;
  await act(async () => {
    root = createRoot(container);
    root.render(<TabBar />);
  });
  await act(async () => {});
}

function tabs(): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('nav[aria-label="Main"] a'));
}

describe('TabBar', () => {
  it('offers the five tab routes, Home first', async () => {
    await render('/');
    expect(tabs().map((a) => a.textContent)).toEqual([
      'Home',
      'Progress',
      'Stickers',
      'Notes',
      'Settings',
    ]);
    // (next/link normalises the trailing slash per the build config; the
    // unit env has none, the static export adds it back.)
    expect(tabs().map((a) => a.getAttribute('href')?.replace(/\/$/, '') || '/')).toEqual([
      '/',
      '/progress',
      '/stickers',
      '/notes',
      '/settings',
    ]);
  });

  it('marks the current tab, tolerating the export’s trailing slash', async () => {
    await render('/progress/');
    const current = tabs().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Progress']);
  });

  it('highlights Settings on its sub-page, the pack library', async () => {
    await render('/packs/');
    const current = tabs().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Settings']);
  });

  it('flags <html> while showing so other bottom UI can lift above it', async () => {
    await render('/');
    expect(document.documentElement.hasAttribute('data-tab-bar')).toBe(true);
    await act(async () => {
      root.unmount();
    });
    expect(document.documentElement.hasAttribute('data-tab-bar')).toBe(false);
    // afterEach unmounts again — make that a no-op.
    root = createRoot(document.createElement('div'));
  });

  it.each(['/practice/', '/practice/review/', '/practice/exam/', '/drive/', '/coach/', '/paper/', '/paper/mark/', '/games/'])(
    'stays out of a session or full-screen mode (%s)',
    async (path) => {
      await render(path);
      expect(container.querySelector('nav')).toBeNull();
      expect(document.documentElement.hasAttribute('data-tab-bar')).toBe(false);
    },
  );
});

describe('activeTab', () => {
  it('maps every tab route, with or without the trailing slash', () => {
    expect(activeTab('/')?.label).toBe('Home');
    expect(activeTab('/notes')?.label).toBe('Notes');
    expect(activeTab('/notes/')?.label).toBe('Notes');
    expect(activeTab('/stickers/')?.label).toBe('Stickers');
    expect(activeTab('/settings')?.label).toBe('Settings');
    expect(activeTab('/packs/')?.label).toBe('Settings');
    expect(activeTab('/practice/')).toBeNull();
  });
});
