// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PacksPage } from '@/components/PacksPage';
import { ACTIVE_PACK_ID_KEY } from '@/lib/packKeys';

/**
 * Re-inserting a pack is its update path (a newer bundle of the same id
 * replaces the stored content, progress untouched). When that pack is the
 * one currently ACTIVE, "Make active" would be a no-op in the wrong
 * clothes — the running app still holds the old questions until a reload
 * — so the result panel offers Reload instead. The active pack is fixed at
 * module evaluation, so this case gets its own file with the config
 * widened to an inserted id.
 */
vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return { ...mod, APP_CONFIG: { ...mod.APP_CONFIG, packId: 'fixture-pack' } };
});
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function bundleJson(): string {
  const question = (n: number) => ({
    id: `fixture-pack-shapes-00${n}`,
    categoryKey: 'shapes',
    difficulty: 1,
    prompt: `Fixture question ${n}: which of these is a square?`,
    options: [
      { key: 'A', text: 'The one with four equal sides' },
      { key: 'B', text: 'The round one' },
    ],
    correctKey: 'A',
    explanation: 'A square has four equal sides and four right angles.',
    source: 'original',
    reviewStatus: 'draft',
  });
  return JSON.stringify({
    manifest: {
      schemaVersion: 2,
      id: 'fixture-pack',
      title: 'Fixture Pack',
      description: 'A fixture pack for the insert feedback tests.',
      homeSubtitle: 'Fixture.',
      themeColor: '#123456',
      categories: [{ key: 'shapes', label: 'Shapes' }],
    },
    questions: [question(1), question(2)],
  });
}

let container: HTMLDivElement;
let root: Root | undefined;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(ACTIVE_PACK_ID_KEY, 'fixture-pack');
  container = document.createElement('div');
  document.body.appendChild(container);
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/packs/', search: '', reload },
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

describe('PacksPage re-inserting the active pack', () => {
  it('offers Reload instead of Make active', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<PacksPage />);
    });
    await act(async () => {});

    const input = container.querySelector<HTMLInputElement>('[data-testid="insert-files"]')!;
    const file = new File(['-'], 'fixture.bundle.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => bundleJson() });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {});

    const result = container.querySelector<HTMLElement>('[data-testid="insert-result"]');
    expect(result).toBeTruthy();
    expect(result!.textContent).toContain('It is the active pack');
    expect(result!.querySelector('[data-testid="insert-result-activate"]')).toBeNull();
    const reloadButton = result!.querySelector<HTMLButtonElement>(
      '[data-testid="insert-result-reload"]',
    );
    expect(reloadButton).toBeTruthy();
    await act(async () => {
      reloadButton!.click();
    });
    expect(reload).toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBe('fixture-pack');
  });
});
