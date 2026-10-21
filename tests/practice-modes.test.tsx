// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import { APP_CONFIG } from '@/config';
import { clearAll } from '@/lib/storage';
import { DRIVE_KEY, loadDriveModeEnabled, saveDriveModeEnabled } from '@/lib/drive';
import { COACH_KEY, loadCoachModeEnabled, saveCoachModeEnabled } from '@/lib/coach';
import { PAPER_KEY, loadPaperModeEnabled } from '@/lib/paper';

// The pack's `modes` block is a DEFAULT for Drive, Coach and Paper, the
// way `look` is for the style: an untouched device follows the pack, a
// device that has flipped a switch keeps its own choice either way.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const demoModes = APP_CONFIG.modes;
let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  APP_CONFIG.modes = demoModes;
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

describe('pack mode defaults', () => {
  it('an untouched device follows the pack', () => {
    APP_CONFIG.modes = { coach: true };
    expect(loadCoachModeEnabled()).toBe(true);
    expect(loadDriveModeEnabled()).toBe(false);
    expect(loadPaperModeEnabled()).toBe(false);
    APP_CONFIG.modes = undefined;
    expect(loadCoachModeEnabled()).toBe(false);
  });

  it("the device's own choice wins either way", () => {
    APP_CONFIG.modes = { coach: true };
    saveCoachModeEnabled(false);
    expect(localStorage.getItem(COACH_KEY)).toBe('0');
    expect(loadCoachModeEnabled()).toBe(false);

    APP_CONFIG.modes = undefined;
    saveDriveModeEnabled(true);
    expect(localStorage.getItem(DRIVE_KEY)).toBe('1');
    expect(loadDriveModeEnabled()).toBe(true);
  });

  it('a pinned choice survives "Reset all local progress"', () => {
    APP_CONFIG.modes = { drive: true };
    saveDriveModeEnabled(false);
    clearAll();
    expect(loadDriveModeEnabled()).toBe(false);
  });

  it('the demo pack shows every mode tile on a fresh device', async () => {
    expect(localStorage.getItem(PAPER_KEY)).toBeNull();
    await render(<PackHome />);
    for (const id of ['drive-card', 'coach-card', 'paper-card']) {
      expect(container.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    }
  });

  it('Settings shows the pack default as on, and switching off pins it', async () => {
    await render(<SettingsPage />);
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="paper-mode-toggle"]',
    )!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(PAPER_KEY)).toBe('0');
    expect(loadPaperModeEnabled()).toBe(false);
  });
});
