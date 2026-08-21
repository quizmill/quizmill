// @vitest-environment happy-dom
//
// The "Sync across devices" card, driven the way a parent drives it:
// create a key, give it a name, come back and see whose key this is.
// The sync server is stubbed at fetch, so these tests cover the card's
// behaviour (and its honesty when the server can't be reached) — the
// wire/SQL half lives in tests/sync-worker-e2e.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { SyncKeySettings } from '@/components/SyncKeySettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;
/** Name the stubbed server currently holds for the key (null = unnamed). */
let serverName: string | null;
/** When true the server 404s /v1/profile, like a pre-names deployment. */
let serverKnowsNames: boolean;

beforeEach(() => {
  localStorage.clear();
  serverName = null;
  serverKnowsNames = true;
  container = document.createElement('div');
  document.body.appendChild(container);

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/v1/profile')) return new Response('{}', { status: 200 });
    if (!serverKnowsNames) return new Response('{}', { status: 404 });
    if (init?.method === 'POST') {
      serverName = (JSON.parse(String(init.body)) as { name: string }).name || null;
      return new Response(JSON.stringify({ ok: true, name: serverName }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: serverName }), { status: 200 });
  }) as typeof fetch;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

/** Let React settle: the card's handlers await real async work (hashing
 *  the key, the profile round trip), which outlives a microtask flush. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<SyncKeySettings />);
  });
  await settle();
}

function byTestId<T extends HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[data-testid="${id}"]`);
}

function buttonLabelled(text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!match) throw new Error(`no button labelled "${text}"`);
  return match as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Create a key and name it, the way the card is used the first time. */
async function createAndName(name: string) {
  await click(buttonLabelled('Create a sync key'));
  const input = byTestId<HTMLInputElement>('sync-key-name-input');
  expect(input).not.toBeNull();
  await type(input as HTMLInputElement, name);
  await click(buttonLabelled('Save name'));
}

describe('naming a sync key', () => {
  it('offers the name field as soon as a key is created', async () => {
    await render();
    await click(buttonLabelled('Create a sync key'));
    expect(byTestId('sync-key-name-input')).not.toBeNull();
  });

  it('shows the name once saved, and remembers it on the next visit', async () => {
    await render();
    await createAndName('Leo');
    expect(byTestId('sync-key-name')?.textContent).toContain('Leo');
    expect(serverName).toBe('Leo');

    // Re-open Settings: the name is there before the network answers.
    await act(async () => {
      root?.unmount();
    });
    await render();
    expect(byTestId('sync-key-name')?.textContent).toContain('Leo');
  });

  it('says an unnamed key is unnamed, and offers to name it', async () => {
    await render();
    await click(buttonLabelled('Create a sync key'));
    await click(buttonLabelled('Cancel'));
    expect(byTestId('sync-key-name')).toBeNull();
    expect(container.textContent).toContain("This key isn't named yet");
    expect(byTestId('sync-key-name-edit')?.textContent).toBe('Name this key');
  });

  it('renames a key, replacing the old name everywhere on the card', async () => {
    await render();
    await createAndName('Leo');
    await click(byTestId('sync-key-name-edit') as HTMLElement);
    const input = byTestId<HTMLInputElement>('sync-key-name-input');
    expect(input?.value).toBe('Leo'); // starts from the current name
    await type(input as HTMLInputElement, 'Leo (year 6)');
    await click(buttonLabelled('Save name'));
    expect(byTestId('sync-key-name')?.textContent).toContain('Leo (year 6)');
    expect(container.textContent).not.toContain('“Leo”'); // no stale name left
    expect(serverName).toBe('Leo (year 6)');
  });

  it('clears the name when it is emptied', async () => {
    await render();
    await createAndName('Leo');
    await click(byTestId('sync-key-name-edit') as HTMLElement);
    await type(byTestId<HTMLInputElement>('sync-key-name-input') as HTMLInputElement, '   ');
    await click(buttonLabelled('Save name'));
    expect(byTestId('sync-key-name')).toBeNull();
    expect(serverName).toBeNull();
  });

  it('names the key in the self-email, so two keys are told apart in the inbox', async () => {
    await render();
    await createAndName('Leo');
    const mailto = container.querySelector('a[href^="mailto:"]')?.getAttribute('href') ?? '';
    expect(decodeURIComponent(mailto)).toContain('sync key for Leo');
  });

  it('picks up a name given on another device when this one links the key', async () => {
    serverName = 'Leo';
    await render();
    await type(
      byTestId<HTMLInputElement>('sync-key-input') as HTMLInputElement,
      'QM-ABCDE-FGHJK-MNPQR-STVWX',
    );
    await click(buttonLabelled('Link this device'));
    expect(byTestId('sync-key-name')?.textContent).toContain('Leo');
    expect(container.textContent).toContain('Linked to “Leo”');
  });

  it("drops the old key's name when a different key is linked", async () => {
    await render();
    await createAndName('Leo');
    await click(buttonLabelled('Turn off sync on this device'));
    serverName = null;
    await type(
      byTestId<HTMLInputElement>('sync-key-input') as HTMLInputElement,
      'QM-ABCDE-FGHJK-MNPQR-STVWX',
    );
    await click(buttonLabelled('Link this device'));
    expect(byTestId('sync-key-name')).toBeNull();
  });

  it('is honest when the server would not take the name', async () => {
    serverKnowsNames = false;
    await render();
    await createAndName('Leo');
    // Kept here — the app is local-first — but the user is told it hasn't
    // reached the other devices.
    expect(byTestId('sync-key-name')?.textContent).toContain('Leo');
    expect(container.textContent).toContain("couldn't reach the sync server");
  });
});
