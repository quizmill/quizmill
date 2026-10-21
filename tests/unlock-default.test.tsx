// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { UnlockPage, resetUnlockPageForTests } from '@/components/UnlockPage';
import { PacksPage } from '@/components/PacksPage';
import { APP_CONFIG } from '@/config';
import { ACTIVE_PACK_ID_KEY } from '@/lib/packKeys';
import { DEFAULT_UNLOCK_URL, licenceKeyStorageKey, unlockConfig } from '@/lib/unlock';

/**
 * The DEFAULT case against the real demo config, which declares neither
 * `upgrade.packId` nor `upgrade.unlockUrl`: the route and the Packs card
 * exist in every build anyway, the request goes to the build's default
 * endpoint with the key alone (no `pack=`), and the pack that arrives is
 * whatever the bundle's manifest says — nothing about the active pack
 * gates any of it.
 */

vi.mock('@/lib/packRegistry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/packRegistry')>();
  return {
    ...mod,
    loadRegistry: vi.fn(async () => ({ source: 'builtin', listings: [] })),
  };
});
vi.mock('@/lib/packAssets', () => ({
  cachePackAssets: vi.fn(async () => ({ total: 0, cached: 0 })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const KEY = 'QL-PRIV-ATE1-PACK';

/** A private pack nobody's manifest points at — the key alone names it. */
function bundle() {
  return {
    manifest: {
      schemaVersion: 2,
      id: 'team-handbook',
      title: 'Team Handbook',
      description: 'A private pack reached by licence key only.',
      homeSubtitle: 'Three questions.',
      themeColor: '#123456',
      categories: [{ key: 'basics', label: 'Basics' }],
    },
    questions: [1, 2, 3].map((n) => ({
      id: `team-handbook-basics-00${n}`,
      categoryKey: 'basics',
      difficulty: 1,
      prompt: `Handbook question ${n}: which planet is the largest?`,
      options: [
        { key: 'A', text: 'Jupiter' },
        { key: 'B', text: 'Mars' },
      ],
      correctKey: 'A',
      explanation: 'Jupiter is the largest planet in the solar system by far.',
      source: 'original',
      reviewStatus: 'draft',
    })),
  };
}

let container: HTMLDivElement;
let root: Root | undefined;
let assign: ReturnType<typeof vi.fn>;
let fetched: string[];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetUnlockPageForTests();
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response(JSON.stringify(bundle()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/unlock/', search: '', hash: '', assign },
  });
  Object.defineProperty(window, 'history', {
    configurable: true,
    value: { ...window.history, replaceState: vi.fn() },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {});
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[data-testid="${id}"]`);
}

async function typeKey(value: string) {
  const input = byTestId<HTMLInputElement>('licence-key-input');
  if (!input) throw new Error('no licence key input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressUnlock() {
  const go = byTestId<HTMLButtonElement>('licence-key-go');
  if (!go) throw new Error('no Unlock button');
  await act(async () => {
    go.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {});
}

describe('a pack that declares no unlock fields (the demo pack)', () => {
  it('is the demo pack, and still resolves to the hosted default endpoint', () => {
    expect(APP_CONFIG.upgrade?.unlockUrl).toBeUndefined();
    expect(APP_CONFIG.upgrade?.packId).toBeUndefined();
    expect(unlockConfig()).toEqual({ unlockUrl: DEFAULT_UNLOCK_URL });
  });

  it('the build’s NEXT_PUBLIC_UNLOCK_URL replaces the default', () => {
    vi.stubEnv('NEXT_PUBLIC_UNLOCK_URL', 'https://unlock.build.test');
    expect(unlockConfig()).toEqual({ unlockUrl: 'https://unlock.build.test' });
  });

  it('/unlock offers the key entry and unlocks whatever pack the key opens', async () => {
    await render(<UnlockPage />);
    expect(byTestId('licence-key-form')).toBeTruthy();
    expect(container.textContent).not.toContain('does not take licence keys');

    await typeKey(KEY);
    await pressUnlock();
    // The key alone, to the default endpoint: no pack= in the request.
    expect(fetched).toEqual([`${DEFAULT_UNLOCK_URL}/v1/unlock?key=${KEY}`]);
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBe('team-handbook');
    expect(localStorage.getItem(licenceKeyStorageKey('team-handbook'))).toBe(KEY);
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('/packs shows the "Have a licence key?" card', async () => {
    await render(<PacksPage />);
    const card = byTestId('licence-key-card');
    expect(card?.textContent).toContain('Have a licence key?');
    expect(card?.querySelector('[data-testid="licence-key-input"]')).toBeTruthy();
  });
});
