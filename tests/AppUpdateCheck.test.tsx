// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppUpdateCheck } from '@/components/AppUpdateCheck';
import * as appUpdate from '@/lib/appUpdate';

// The About card's "Check for updates" button: one tap asks the browser
// for a newer build and says what it found, in words a learner can act
// on. The check itself is covered in app-update.test.ts; here it's
// stubbed so each outcome's wording and the refresh affordance are pinned.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  appUpdate.resetUpdateReadyForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

const button = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="check-updates"]');
const status = () => container.querySelector('[data-testid="update-status"]');

async function check() {
  await act(async () => {
    button()!.click();
  });
  await act(async () => {});
}

describe('AppUpdateCheck', () => {
  it('shows the button and no status until tapped', async () => {
    await render(<AppUpdateCheck />);
    expect(button()).not.toBeNull();
    expect(button()!.disabled).toBe(false);
    expect(status()).toBeNull();
  });

  it('says so when the app is already current', async () => {
    vi.spyOn(appUpdate, 'checkForAppUpdate').mockResolvedValue('up-to-date');
    await render(<AppUpdateCheck />);
    await check();
    expect(status()?.textContent).toMatch(/up to date/i);
    expect(container.querySelector('[data-testid="update-refresh"]')).toBeNull();
  });

  it('offers a refresh once a new version has installed', async () => {
    vi.spyOn(appUpdate, 'checkForAppUpdate').mockResolvedValue('update-ready');
    const reload = vi.fn();
    vi.spyOn(appUpdate, 'reloadApp').mockImplementation(reload);
    await render(<AppUpdateCheck />);
    await check();
    expect(status()?.textContent).toMatch(/new version/i);
    const refresh = container.querySelector<HTMLButtonElement>(
      '[data-testid="update-refresh"]',
    );
    expect(refresh).not.toBeNull();
    await act(async () => {
      refresh!.click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Once the page knows a new build has landed (this button, or the
  // foreground re-check in UpdateNotifier), only a reload fixes it. The
  // Refresh stays whatever a later check says — the worker has activated
  // by then and a re-fetch of sw.js would find it unchanged.
  it('keeps offering Refresh once an update is known, whatever a later check says', async () => {
    vi.spyOn(appUpdate, 'checkForAppUpdate').mockResolvedValue('up-to-date');
    await render(<AppUpdateCheck />);
    expect(container.querySelector('[data-testid="update-refresh"]')).toBeNull();

    await act(async () => {
      appUpdate.markUpdateReady();
    });
    expect(status()?.textContent).toMatch(/new version/i);
    expect(container.querySelector('[data-testid="update-refresh"]')).not.toBeNull();

    await check();
    expect(status()?.textContent).toMatch(/new version/i);
    expect(container.querySelector('[data-testid="update-refresh"]')).not.toBeNull();
  });

  it('explains an offline check and a browser that cannot check', async () => {
    const spy = vi.spyOn(appUpdate, 'checkForAppUpdate').mockResolvedValue('offline');
    await render(<AppUpdateCheck />);
    await check();
    expect(status()?.textContent).toMatch(/online/i);

    spy.mockResolvedValue('unsupported');
    await check();
    expect(status()?.textContent).toMatch(/browser/i);
  });

  it('disables the button while a check is in flight', async () => {
    let resolve!: (r: appUpdate.AppUpdateResult) => void;
    vi.spyOn(appUpdate, 'checkForAppUpdate').mockReturnValue(
      new Promise<appUpdate.AppUpdateResult>((r) => {
        resolve = r;
      }),
    );
    await render(<AppUpdateCheck />);
    await act(async () => {
      button()!.click();
    });
    expect(button()!.disabled).toBe(true);
    expect(status()?.textContent).toMatch(/checking/i);
    await act(async () => {
      resolve('up-to-date');
    });
    expect(button()!.disabled).toBe(false);
  });
});
