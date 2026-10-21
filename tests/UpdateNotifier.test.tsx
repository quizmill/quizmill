// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UpdateNotifier } from '@/components/UpdateNotifier';
import { isUpdateReady, markUpdateReady, resetUpdateReadyForTests } from '@/lib/appUpdate';

// An installed app seldom navigates, so the browser's own once-a-day
// service-worker check rarely fires: a pushed update can sit unseen for
// weeks. The notifier therefore re-asks for sw.js every time the app comes
// back to the foreground, and the banner appears when a new worker lands
// (whether a check found it or the browser did).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class FakeRegistration extends EventTarget {
  installing: EventTarget & { state: string } = Object.assign(new EventTarget(), {
    state: 'installing',
  });
  waiting = null;
  update = vi.fn(async () => {});
}

let container: HTMLDivElement;
let root: Root | undefined;
let reg: FakeRegistration;
let visibility: DocumentVisibilityState;

beforeEach(() => {
  resetUpdateReadyForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  reg = new FakeRegistration();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: {},
      register: vi.fn(async () => reg),
    },
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<UpdateNotifier />);
  });
  await act(async () => {});
}

async function visibilityChange(to: DocumentVisibilityState) {
  visibility = to;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('UpdateNotifier', () => {
  it('re-checks for a new worker when the app returns to the foreground', async () => {
    await render();
    expect(reg.update).not.toHaveBeenCalled();

    await visibilityChange('hidden');
    expect(reg.update).not.toHaveBeenCalled();

    await visibilityChange('visible');
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unmounted', async () => {
    await render();
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    await visibilityChange('hidden');
    await visibilityChange('visible');
    expect(reg.update).not.toHaveBeenCalled();
  });

  it('shows the banner once a found worker has installed behind a live page', async () => {
    await render();
    expect(container.textContent).not.toMatch(/new version/i);
    await act(async () => {
      reg.dispatchEvent(new Event('updatefound'));
    });
    await act(async () => {
      reg.installing.state = 'installed';
      reg.installing.dispatchEvent(new Event('statechange'));
    });
    expect(container.textContent).toMatch(/new version/i);
    // …and the Settings check now answers from the same page-lifetime
    // flag, so it can't contradict the banner once the worker activates.
    expect(isUpdateReady()).toBe(true);
  });

  it('shows the banner when the Settings check found the update', async () => {
    await render();
    expect(container.textContent).not.toMatch(/new version/i);
    await act(async () => {
      markUpdateReady();
    });
    expect(container.textContent).toMatch(/new version/i);
  });
});
