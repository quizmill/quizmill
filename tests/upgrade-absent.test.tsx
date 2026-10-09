// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import { APP_CONFIG } from '@/config';

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

// The demo pack must never carry an upgrade block — it is the showcase,
// not a sampler for anything — so it doubles as the "absent" fixture.
describe('UpgradeCard with a pack that declares no upgrade', () => {
  it('the demo config carries no upgrade', () => {
    expect(APP_CONFIG.upgrade).toBeUndefined();
  });

  it('renders nothing on Home', async () => {
    await render(<PackHome />);
    expect(container.querySelector('[data-testid^="upgrade-card"]')).toBeNull();
  });

  it('renders nothing in Settings', async () => {
    await render(<SettingsPage />);
    expect(container.querySelector('[data-testid^="upgrade-card"]')).toBeNull();
  });
});
