// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { SettingsPage } from '@/components/SettingsPage';

// The About card answers "which build is this, and how old is it?":
// version, build tag and the date the build was made — plus a way to ask
// for a newer one instead of waiting for the browser to notice.

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
  vi.unstubAllEnvs();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

describe('Settings › About', () => {
  it('shows the build date next to the build tag', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_BUILD', 'abc1234');
    vi.stubEnv('NEXT_PUBLIC_APP_BUILD_DATE', '2026-10-21T03:14:15.000Z');
    await render(<SettingsPage />);
    expect(container.querySelector('[data-testid="app-build"]')?.textContent).toBe('abc1234');
    const date = container.querySelector<HTMLTimeElement>('[data-testid="app-build-date"]');
    expect(date?.textContent).toBe('21 Oct 2026');
    expect(date?.dateTime).toBe('2026-10-21T03:14:15.000Z');
  });

  it('offers a "Check for updates" button', async () => {
    await render(<SettingsPage />);
    expect(container.querySelector('[data-testid="check-updates"]')).not.toBeNull();
  });
});
