// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { UnlockPage, resetUnlockPageForTests } from '@/components/UnlockPage';
import { UnlockedToast, resetUnlockedToastForTests } from '@/components/UnlockedToast';
import { PacksPage } from '@/components/PacksPage';
import { ACTIVE_PACK_ID_KEY } from '@/lib/packKeys';
import { UNLOCKED_TOAST_KEY, licenceKeyStorageKey } from '@/lib/unlock';
import { loadEvents } from '@/lib/storage';

/**
 * The licence-key unlock, end to end in the DOM: `/unlock#key=…` submits
 * the key for the learner and leaves for Home with the pack active, a
 * refusal stays on the page with the endpoint's words and the key entry,
 * the same entry sits on /packs, and Home shows the confirmation once.
 * The endpoint is a stubbed fetch; nothing here touches the network.
 */

// The demo pack declares no unlock endpoint; simulate a sampler that does.
vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return {
    ...mod,
    APP_CONFIG: {
      ...mod.APP_CONFIG,
      upgrade: {
        title: 'Get the full course',
        url: 'https://example.com/course',
        packId: 'solar-system-full',
        unlockUrl: 'https://unlock.example.com',
      },
    },
  };
});
// The registry browser fetches on mount and an insert prefetches images —
// neither is under test, neither may touch the network.
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

const GOOD = 'QM-GOOD-KEY';
const BAD = 'QM-BAD-KEY';

function bundle() {
  const question = (n: number) => ({
    id: `solar-system-full-planets-00${n}`,
    categoryKey: 'planets',
    difficulty: 1,
    prompt: `Unlocked question ${n}: which planet is the largest?`,
    options: [
      { key: 'A', text: 'Jupiter' },
      { key: 'B', text: 'Mars' },
    ],
    correctKey: 'A',
    explanation: 'Jupiter is the largest planet in the solar system by far.',
    source: 'original',
    reviewStatus: 'draft',
  });
  return {
    manifest: {
      schemaVersion: 2,
      id: 'solar-system-full',
      title: 'Solar System — Full Course',
      description: 'The fuller edition a licence key unlocks.',
      homeSubtitle: 'Every planet, every moon.',
      themeColor: '#123456',
      categories: [{ key: 'planets', label: 'Planets' }],
    },
    questions: [question(1), question(2), question(3)],
  };
}

let container: HTMLDivElement;
let root: Root | undefined;
let assign: ReturnType<typeof vi.fn>;
let replaceState: ReturnType<typeof vi.fn>;
let fetched: string[];

/** A stub endpoint: GOOD → the bundle, anything else → 403 with a reason. */
function stubEndpoint() {
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      const key = new URL(url).searchParams.get('key');
      if (key === GOOD) {
        return new Response(JSON.stringify(bundle()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'That key has been revoked.' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function setLocation(hash: string, pathname = '/unlock/') {
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname, search: '', hash, assign, reload: vi.fn() },
  });
  replaceState = vi.fn();
  Object.defineProperty(window, 'history', {
    configurable: true,
    value: { ...window.history, replaceState },
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetUnlockPageForTests();
  resetUnlockedToastForTests();
  stubEndpoint();
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
  vi.restoreAllMocks();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  // Let the submitted fetch + insert settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {});
}

function text(): string {
  return container.textContent ?? '';
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

describe('/unlock#key=…', () => {
  it('a good key: fragment wiped, pack fetched + inserted + active, key kept, off to Home', async () => {
    setLocation(`#key=${GOOD}`);
    await render(<UnlockPage />);

    // The key left the URL before anything else happened.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/unlock/');
    // One request, to the contract's URL, with the key.
    expect(fetched).toEqual([
      `https://unlock.example.com/v1/unlock?key=${GOOD}&pack=solar-system-full`,
    ]);
    // Inserted and active, key under the unlocked pack.
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBe('solar-system-full');
    expect(localStorage.getItem(licenceKeyStorageKey('solar-system-full'))).toBe(GOOD);
    // The confirmation is waiting for Home, and we are on our way there.
    expect(JSON.parse(sessionStorage.getItem(UNLOCKED_TOAST_KEY) ?? 'null')).toEqual({
      title: 'Solar System — Full Course',
      count: 3,
    });
    expect(assign).toHaveBeenCalledWith('/');
    expect(byTestId('licence-key-done')?.textContent).toContain('Solar System — Full Course');
    // The key is on screen with its Copy button and the steps to the app.
    expect(byTestId('unlock-key-value')?.textContent).toBe(GOOD);
    expect(byTestId('unlock-key-copy')).toBeTruthy();
    expect(text()).toContain('Packs → Have a licence key? → paste');
    // And in no event.
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['pack_unlocked', { pack: 'solar-system-full' }],
    ]);
    expect(JSON.stringify(loadEvents())).not.toContain(GOOD);
  });

  it('a refused key: the endpoint’s words, the file fallback, the key entry — nothing stored', async () => {
    setLocation(`#key=${BAD}`);
    await render(<UnlockPage />);

    expect(replaceState).toHaveBeenCalledWith(null, '', '/unlock/');
    const error = byTestId('licence-key-error');
    expect(error?.textContent).toContain('That key has been revoked.');
    expect(error?.textContent).toContain('You can also insert the file under Packs.');
    // The entry is prefilled with the key from the link, ready to correct.
    expect(byTestId<HTMLInputElement>('licence-key-input')?.value).toBe(BAD);
    expect(byTestId('unlock-key-value')?.textContent).toBe(BAD);
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBeNull();
    expect(localStorage.getItem(licenceKeyStorageKey('solar-system-full'))).toBeNull();
    expect(sessionStorage.getItem(UNLOCKED_TOAST_KEY)).toBeNull();
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['unlock_failed', { pack: 'solar-system-full', reason: 'denied' }],
    ]);

    // Correct the key in place: same handler, same outcome as the link.
    await typeKey(GOOD);
    await pressUnlock();
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBe('solar-system-full');
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('no key in the URL: just the entry, no key panel, nothing fetched', async () => {
    setLocation('');
    await render(<UnlockPage />);
    expect(fetched).toEqual([]);
    expect(replaceState).not.toHaveBeenCalled();
    expect(byTestId('unlock-key')).toBeNull();
    expect(byTestId('licence-key-input')).toBeTruthy();
    expect(byTestId<HTMLButtonElement>('licence-key-go')?.disabled).toBe(true);
  });

  it('a second link while the page is open (fragment-only navigation) is picked up too', async () => {
    setLocation('');
    await render(<UnlockPage />);
    expect(fetched).toEqual([]);

    window.location.hash = `#key=${GOOD}`;
    await act(async () => {
      window.dispatchEvent(new Event('hashchange'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {});
    expect(replaceState).toHaveBeenCalledWith(null, '', '/unlock/');
    expect(fetched).toHaveLength(1);
    expect(byTestId('unlock-key-value')?.textContent).toBe(GOOD);
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBe('solar-system-full');
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('a key in the QUERY string is not honoured — but is scrubbed from the address bar', async () => {
    setLocation('');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, search: `?key=${GOOD}`, hash: '' },
    });
    await render(<UnlockPage />);
    expect(fetched).toEqual([]);
    expect(byTestId('unlock-key')).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/unlock/');
  });

  it('a second link while the first is still being answered: only the latest key counts', async () => {
    // GOOD answers only when told to; BAD is refused at once.
    let releaseGood: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        const key = new URL(url).searchParams.get('key');
        if (key === GOOD) {
          await new Promise<void>((r) => {
            releaseGood = r;
          });
          return new Response(JSON.stringify(bundle()), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'That key has been revoked.' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    setLocation(`#key=${GOOD}`);
    await render(<UnlockPage />);
    expect(fetched).toHaveLength(1);

    window.location.hash = `#key=${BAD}`;
    await act(async () => {
      window.dispatchEvent(new Event('hashchange'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // Now the slow GOOD answer lands — after the learner moved on to BAD.
    releaseGood?.();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {});

    expect(fetched).toHaveLength(2);
    expect(byTestId('licence-key-error')?.textContent).toContain('That key has been revoked.');
    expect(byTestId<HTMLInputElement>('licence-key-input')?.value).toBe(BAD);
    // The stale GOOD request changed nothing: no pack, no key, no navigation.
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBeNull();
    expect(localStorage.getItem(licenceKeyStorageKey('solar-system-full'))).toBeNull();
    expect(sessionStorage.getItem(UNLOCKED_TOAST_KEY)).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['unlock_failed', { pack: 'solar-system-full', reason: 'denied' }],
    ]);
  });
});

/** Stub the display mode: installed app (standalone) or a plain browser tab. */
function setStandalone(standalone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('/unlock#key=… by display mode', () => {
  it('in a browser tab: the copy-your-key steps lead, above the unlock form', async () => {
    setStandalone(false);
    setLocation(`#key=${BAD}`);
    await render(<UnlockPage />);

    const steps = byTestId('unlock-key-steps');
    expect(steps).toBeTruthy();
    const items = [...steps!.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('Copy your key');
    expect(items[1]).toContain('home screen');
    expect(items[2]).toContain('Packs → Have a licence key? → paste');
    // The Copy button sits in the first step.
    expect(steps!.querySelector('li')?.querySelector('[data-testid="unlock-key-copy"]')).toBeTruthy();
    expect(text()).toContain('already unlocked here');
    // The key block comes before the form.
    const form = byTestId('licence-key-input')!;
    expect(
      byTestId('unlock-key')!.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The browser still unlocks on its own.
    expect(fetched).toHaveLength(1);
  });

  it('in the installed app: no steps, the key with its hint as before', async () => {
    setStandalone(true);
    setLocation(`#key=${BAD}`);
    await render(<UnlockPage />);

    expect(byTestId('unlock-key-steps')).toBeNull();
    expect(byTestId('unlock-key-value')?.textContent).toBe(BAD);
    expect(text()).toContain('Installed the app on your home screen?');
    expect(text()).toContain('Packs → Have a licence key?');
    expect(text()).not.toContain('Enter a licence key.');
    expect(fetched).toHaveLength(1);
  });

  it('iOS’s navigator.standalone counts as the installed app too', async () => {
    setStandalone(false);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { standalone: true }));
    setLocation(`#key=${BAD}`);
    await render(<UnlockPage />);
    expect(byTestId('unlock-key-steps')).toBeNull();
    expect(byTestId('unlock-key-value')?.textContent).toBe(BAD);
  });
});

describe('Packs → Have a licence key?', () => {
  it('unlocks with the same handler: fetched, active, key kept, off to Home', async () => {
    setLocation('', '/packs/');
    await render(<PacksPage />);
    const card = byTestId('licence-key-card');
    expect(card?.textContent).toContain('Have a licence key?');

    await typeKey(` ${GOOD} `);
    await pressUnlock();
    expect(fetched).toEqual([
      `https://unlock.example.com/v1/unlock?key=${GOOD}&pack=solar-system-full`,
    ]);
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBe('solar-system-full');
    expect(localStorage.getItem(licenceKeyStorageKey('solar-system-full'))).toBe(GOOD);
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('shows a refusal inside the card, where the learner is', async () => {
    setLocation('', '/packs/');
    await render(<PacksPage />);
    await typeKey(BAD);
    await pressUnlock();
    const error = byTestId('licence-key-error');
    expect(error).toBeTruthy();
    expect(byTestId('licence-key-card')?.contains(error)).toBe(true);
    expect(error?.textContent).toContain('That key has been revoked.');
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('Home after an unlock', () => {
  it('shows "Unlocked: N questions" once, then never again', async () => {
    sessionStorage.setItem(
      UNLOCKED_TOAST_KEY,
      JSON.stringify({ title: 'Solar System — Full Course', count: 3 }),
    );
    await render(<UnlockedToast />);
    const toast = byTestId('unlocked-toast');
    expect(toast?.textContent).toContain('Unlocked: 3 questions');
    expect(toast?.textContent).toContain('Solar System — Full Course');
    expect(sessionStorage.getItem(UNLOCKED_TOAST_KEY)).toBeNull();

    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    resetUnlockedToastForTests();
    await render(<UnlockedToast />);
    expect(byTestId('unlocked-toast')).toBeNull();
  });
});
