// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { STARTER_PACK_ID } from '@/pack/starter';

// The unit tests run against the demo pack, so "the starter pack is the
// active one" is simulated by widening the build-time config to its id —
// the one thing the card gates on. (The absent case — no card on the demo
// pack — is asserted in Home.test.tsx against the real config.)
// (The factory is hoisted above the imports, so the id is spelt out here
// and pinned to the constant in the first test.)
vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return {
    ...mod,
    APP_CONFIG: {
      ...mod.APP_CONFIG,
      packId: 'quizmill-start',
      title: 'quizmill',
      homeSubtitle: 'Insert a pack, unlock one with a key, or pick one from the registry.',
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

describe('Home when the starter pack is active', () => {
  it('simulates the starter by its real id', () => {
    expect(STARTER_PACK_ID).toBe('quizmill-start');
  });

  it('offers insert / registry and the licence key within one tap, above the practice loop', async () => {
    await render(<PackHome />);
    const card = container.querySelector('[data-testid="starter-card"]');
    expect(card).toBeTruthy();

    // One tap to the shelf (insert a file or URL, browse the registry)…
    const packs = card!.querySelector<HTMLAnchorElement>('[data-testid="starter-packs-link"]');
    expect(packs).toBeTruthy();
    expect(packs!.getAttribute('href')).toBe('/packs');
    expect(card!.textContent).toMatch(/registry/i);

    // …and the licence-key entry inline — the same form as /unlock and /packs.
    expect(card!.querySelector('[data-testid="licence-key-input"]')).toBeTruthy();
    expect(card!.querySelector('[data-testid="licence-key-go"]')).toBeTruthy();

    // Prominent: before the first category card, not below the practice loop.
    const firstCategory = container.querySelector('a[href*="subject="]');
    expect(firstCategory).toBeTruthy();
    expect(
      card!.compareDocumentPosition(firstCategory!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('still lets the learner practise the starter questions', async () => {
    await render(<PackHome />);
    expect(container.textContent).toContain('Pick a category');
    expect(container.querySelector('a[href*="subject="]')).toBeTruthy();
  });
});
