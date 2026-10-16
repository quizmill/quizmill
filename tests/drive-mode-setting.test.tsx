// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import { saveLevelFilter, loadLevelFilter, clearAll, KEY_PREFIX } from '@/lib/storage';
import { DRIVE_KEY, loadDriveModeEnabled, saveDriveModeEnabled } from '@/lib/drive';

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

describe('Drive Mode setting', () => {
  it('defaults to off and round-trips through storage', () => {
    expect(loadDriveModeEnabled()).toBe(false);
    saveDriveModeEnabled(true);
    expect(loadDriveModeEnabled()).toBe(true);
    saveDriveModeEnabled(false);
    expect(loadDriveModeEnabled()).toBe(false);
  });

  // A device-level opt-in like Coach and Paper (#192): an app-level key,
  // so a pack swap or "Reset all local progress" leaves it alone.
  it('is stored app-level and survives "Reset all local progress"', () => {
    saveDriveModeEnabled(true);
    expect(localStorage.getItem(DRIVE_KEY)).toBe('1');
    expect(DRIVE_KEY.startsWith(KEY_PREFIX)).toBe(false);
    clearAll();
    expect(loadDriveModeEnabled()).toBe(true);
  });

  it('promotes the old per-pack driveMode flag once, keeping other prefs', () => {
    const prefsKey = `${KEY_PREFIX}prefs.v1`;
    localStorage.setItem(prefsKey, JSON.stringify({ level: 'basics', driveMode: true }));
    expect(loadDriveModeEnabled()).toBe(true);
    expect(localStorage.getItem(DRIVE_KEY)).toBe('1');
    expect(JSON.parse(localStorage.getItem(prefsKey)!)).toEqual({ level: 'basics' });
    expect(loadLevelFilter()).toBe('basics');
  });

  it('keeps other prefs intact when toggled', () => {
    saveLevelFilter('basics');
    saveDriveModeEnabled(true);
    saveDriveModeEnabled(false);
    expect(loadLevelFilter()).toBe('basics');
  });

  it('hides the Home drive card by default', async () => {
    await render(<PackHome />);
    expect(
      container.querySelector('[data-testid="drive-card"]'),
    ).toBeNull();
  });

  it('shows the Home drive card once enabled', async () => {
    saveDriveModeEnabled(true);
    await render(<PackHome />);
    const card = container.querySelector('[data-testid="drive-card"]');
    expect(card).toBeTruthy();
    // Next's Link normalizes the trailing slash outside the static export.
    expect(card?.getAttribute('href')).toMatch(/^\/drive\/?$/);
  });

  it('Settings toggle switches the pref on and off', async () => {
    await render(<SettingsPage />);
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="drive-mode-toggle"]',
    );
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(loadDriveModeEnabled()).toBe(true);
    expect(toggle!.getAttribute('aria-checked')).toBe('true');
    // Enabled state surfaces a direct link too.
    expect(container.textContent).toContain('Open drive mode');

    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(loadDriveModeEnabled()).toBe(false);
  });
});
