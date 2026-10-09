// @vitest-environment happy-dom
/**
 * The Settings surface of the funnel beacon: the "Usage analytics" card
 * appears only in a build that configures NEXT_PUBLIC_ANALYTICS_URL,
 * defaults to on, switches off, regenerates the device id, and links the
 * host's privacy page. Plus the upgrade card's upsell_seen / clicked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { SettingsPage } from '@/components/SettingsPage';
import { UpgradeCard } from '@/pack/UpgradeCard';
import {
  ANALYTICS_URL_ENV,
  DEVICE_ID_KEY,
  loadAnalyticsEnabled,
  loadDeviceId,
} from '@/lib/analytics';
import { loadEvents } from '@/lib/storage';

vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return {
    ...mod,
    APP_CONFIG: {
      ...mod.APP_CONFIG,
      upgrade: {
        title: 'Get the full course',
        url: 'https://example.com/course',
      },
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  process.env[ANALYTICS_URL_ENV] = 'https://sync.example/v1/analytics';
  process.env.NEXT_PUBLIC_PRIVACY_URL = 'https://example.com/privacy';
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  delete process.env[ANALYTICS_URL_ENV];
  delete process.env.NEXT_PUBLIC_PRIVACY_URL;
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

async function click(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Usage analytics card in Settings', () => {
  it('is absent in a build without an analytics endpoint', async () => {
    delete process.env[ANALYTICS_URL_ENV];
    await render(<SettingsPage />);
    expect(container.querySelector('[data-testid="analytics-toggle"]')).toBeNull();
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
  });

  it('defaults to on and switches off and on again', async () => {
    await render(<SettingsPage />);
    const toggle = container.querySelector('[data-testid="analytics-toggle"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    await click(toggle);
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(loadAnalyticsEnabled()).toBe(false);
    await click(toggle);
    expect(loadAnalyticsEnabled()).toBe(true);
  });

  it('shows the device id, regenerates it, and links the privacy page', async () => {
    await render(<SettingsPage />);
    const before = loadDeviceId();
    const idEl = container.querySelector('[data-testid="analytics-device-id"]');
    expect(idEl?.textContent).toContain(before.slice(0, 8));
    await click(container.querySelector('[data-testid="analytics-new-id"]'));
    const after = loadDeviceId();
    expect(after).not.toBe(before);
    expect(
      container.querySelector('[data-testid="analytics-device-id"]')?.textContent,
    ).toContain(after.slice(0, 8));

    const link = container.querySelector<HTMLAnchorElement>('[data-testid="analytics-privacy"]');
    expect(link?.getAttribute('href')).toBe('https://example.com/privacy');
  });

  it('omits the privacy link when the host configures none', async () => {
    delete process.env.NEXT_PUBLIC_PRIVACY_URL;
    await render(<SettingsPage />);
    expect(container.querySelector('[data-testid="analytics-toggle"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="analytics-privacy"]')).toBeNull();
  });
});

describe('UpgradeCard funnel events', () => {
  it('records upsell_seen once per placement and upsell_clicked on tap', async () => {
    await render(
      <>
        <UpgradeCard placement="home" />
        <UpgradeCard placement="home" />
      </>,
    );
    const seen = loadEvents().filter((e) => e.type === 'upsell_seen');
    expect(seen).toHaveLength(1);
    expect(seen[0].data).toEqual({ placement: 'home' });

    const card = container.querySelector('[data-testid="upgrade-card-home"]');
    await click(card);
    const clicked = loadEvents().filter((e) => e.type === 'upsell_clicked');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].data).toEqual({ placement: 'home' });
  });
});
