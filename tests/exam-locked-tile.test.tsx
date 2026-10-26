// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { PackExamRunner } from '@/pack/ExamRunner';
import { saveExamShown } from '@/lib/examPref';

// The demo pack's sitting is its whole declared exam, so a sample pack —
// a band under the floor, the real 75-question exam declared — is
// simulated by swapping the derived sitting for the withheld one, and the
// upgrade block is toggled per test on the build-time config.
const state = vi.hoisted(() => ({
  upgrade: undefined as undefined | Record<string, string>,
}));

vi.mock('@/pack/exam', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/pack/exam')>();
  return {
    ...mod,
    EXAM_SITTING: null,
    EXAM_WITHHELD: { count: 75, durationSeconds: 180 * 60 },
  };
});

vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return {
    ...mod,
    APP_CONFIG: {
      ...mod.APP_CONFIG,
      get upgrade() {
        return state.upgrade;
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
  state.upgrade = undefined;
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

const UPGRADE = {
  title: 'Get the full pack',
  url: 'https://example.com/full',
  packId: 'solar-system-full',
};

describe('Home with a sample pack whose band is below the exam floor', () => {
  it('shows a locked exam tile at the full sitting that brings the upgrade card into view', async () => {
    state.upgrade = UPGRADE;
    await render(<PackHome />);
    expect(container.querySelector('[data-testid="exam-card"]')).toBeNull();
    const tile = container.querySelector<HTMLElement>('[data-testid="exam-locked-card"]');
    expect(tile).toBeTruthy();
    // In the exam's slot: inside the mode rail, before the Check.
    const rail = container.querySelector('[data-testid="mode-rail"]');
    expect(rail?.contains(tile)).toBe(true);
    const text = tile!.textContent ?? '';
    expect(text).toContain('Mock exam');
    expect(text).toContain('75 Qs · 3:00:00');
    expect(text).toContain('With the full pack');
    expect(tile!.querySelector('[data-testid="locked-icon"]')).toBeTruthy();

    const card = container.querySelector<HTMLElement>('[data-testid="upgrade-card-home"]');
    expect(card).toBeTruthy();
    const scrolled = vi.fn();
    card!.scrollIntoView = scrolled;
    await act(async () => {
      tile!.click();
    });
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('shows no exam tile at all without an upgrade block', async () => {
    await render(<PackHome />);
    expect(container.querySelector('[data-testid="exam-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="exam-locked-card"]')).toBeNull();
  });

  it('shows no exam tile when the upgrade names no fuller pack', async () => {
    state.upgrade = { title: UPGRADE.title, url: UPGRADE.url };
    await render(<PackHome />);
    expect(container.querySelector('[data-testid="exam-locked-card"]')).toBeNull();
  });

  it('shows no locked tile when this device has hidden timed exams', async () => {
    state.upgrade = UPGRADE;
    saveExamShown(false);
    await render(<PackHome />);
    expect(container.querySelector('[data-testid="exam-locked-card"]')).toBeNull();
  });

  it('keeps the exam route, in its no-sitting state', async () => {
    await render(<PackExamRunner />);
    expect(container.textContent).toContain('No timed exam in this pack');
    expect(container.querySelector('a[href="/"]')).toBeTruthy();
  });
});
