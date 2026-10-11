// @vitest-environment happy-dom
//
// The shell every sync-settings card shares — heading + cloud icon,
// loading state, status/error lines, backend footer — so a custom backend
// registering its own card (registerSyncSettingsCard) gets the same
// chrome as the built-in key card without copying it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SyncCard } from '@/components/SyncStatusLine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
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

async function render(ui: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
}

function byTestId(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe('SyncCard', () => {
  it('carries the heading and renders its body once loaded', async () => {
    await render(
      <SyncCard connected={false} loading={false}>
        <p data-testid="body">sign-in form</p>
      </SyncCard>,
    );
    expect(container.querySelector('h3')?.textContent).toBe('Sync across devices');
    expect(byTestId('body')?.textContent).toBe('sign-in form');
    expect(container.textContent).not.toContain('Loading…');
  });

  it('shows "Loading…" instead of the body until the card knows its state', async () => {
    await render(
      <SyncCard connected={false} loading>
        <p data-testid="body">sign-in form</p>
      </SyncCard>,
    );
    expect(container.textContent).toContain('Loading…');
    expect(byTestId('body')).toBeNull();
  });

  it('marks the heading connected or not', async () => {
    await render(<SyncCard connected loading={false} />);
    expect(byTestId('sync-card')?.dataset.connected).toBe('true');
    await act(async () => {
      root?.unmount();
    });
    await render(<SyncCard connected={false} loading={false} />);
    expect(byTestId('sync-card')?.dataset.connected).toBe('false');
  });

  it('renders status and error lines below the body, only when given', async () => {
    await render(
      <SyncCard connected loading={false} status="Linked!" error="Could not store the key.">
        <p data-testid="body">key</p>
      </SyncCard>,
    );
    expect(byTestId('sync-card-status')?.textContent).toBe('Linked!');
    expect(byTestId('sync-card-error')?.textContent).toBe('Could not store the key.');
    // The body comes first, then status, then error.
    const order = Array.from(container.querySelectorAll('[data-testid]')).map(
      (el) => (el as HTMLElement).dataset.testid,
    );
    expect(order.indexOf('body')).toBeLessThan(order.indexOf('sync-card-status'));
    expect(order.indexOf('sync-card-status')).toBeLessThan(order.indexOf('sync-card-error'));

    await act(async () => {
      root?.unmount();
    });
    await render(<SyncCard connected loading={false} />);
    expect(byTestId('sync-card-status')).toBeNull();
    expect(byTestId('sync-card-error')).toBeNull();
  });
});
