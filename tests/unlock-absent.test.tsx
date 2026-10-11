// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnlockPage, resetUnlockPageForTests } from '@/components/UnlockPage';
import { PacksPage } from '@/components/PacksPage';
import { APP_CONFIG } from '@/config';

/**
 * The ABSENT case against the real demo config, which declares no unlock
 * endpoint: /unlock exists (every route exists in every build) but says
 * so plainly, and /packs shows no licence-key card — the shelf is exactly
 * as before.
 */

vi.mock('@/lib/packRegistry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/packRegistry')>();
  return {
    ...mod,
    loadRegistry: vi.fn(async () => ({ source: 'builtin', listings: [] })),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  resetUnlockPageForTests();
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

describe('a pack with no unlock endpoint', () => {
  it('is the demo pack', () => {
    expect(APP_CONFIG.upgrade?.unlockUrl).toBeUndefined();
  });

  it('/unlock explains itself instead of offering a key entry', async () => {
    await render(<UnlockPage />);
    expect(container.querySelector('[data-testid="unlock-unavailable"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="licence-key-form"]')).toBeNull();
    expect(container.querySelector('[data-testid="unlock-key"]')).toBeNull();
  });

  it('/packs shows no licence-key card', async () => {
    await render(<PacksPage />);
    expect(container.querySelector('[data-testid="licence-key-card"]')).toBeNull();
    expect(container.textContent).not.toContain('Have a licence key?');
  });
});
