import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkForAppUpdate,
  formatBuildDate,
  isUpdateReady,
  markUpdateReady,
  resetUpdateReadyForTests,
} from '@/lib/appUpdate';

// The "Check for updates" button asks the browser for the service-worker
// registration, tells it to re-fetch sw.js, and reports what came of it.
// The browser side is faked here so each outcome is pinned without a real
// worker: no registration, a byte-identical script, a fresh script that
// installs, a fresh script whose install fails, and no network at all.

type State = ServiceWorker['state'];

class FakeWorker extends EventTarget {
  state: State;
  constructor(state: State) {
    super();
    this.state = state;
  }
  moveTo(state: State) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

interface FakeRegistrationInit {
  installing?: FakeWorker | null;
  waiting?: FakeWorker | null;
  /** What `update()` does: resolve (optionally setting `installing`
   *  first, as the browser does once a new script is being installed),
   *  or reject (the fetch failed — offline). */
  update?: (reg: FakeRegistration) => Promise<void>;
}

class FakeRegistration {
  installing: FakeWorker | null;
  waiting: FakeWorker | null;
  updates = 0;
  private readonly onUpdate: (reg: FakeRegistration) => Promise<void>;
  constructor(init: FakeRegistrationInit = {}) {
    this.installing = init.installing ?? null;
    this.waiting = init.waiting ?? null;
    this.onUpdate = init.update ?? (async () => {});
  }
  async update() {
    this.updates += 1;
    await this.onUpdate(this);
  }
}

function container(reg: FakeRegistration | undefined) {
  return {
    getRegistration: async () => reg as unknown as ServiceWorkerRegistration | undefined,
  };
}

describe('checkForAppUpdate', () => {
  beforeEach(() => {
    resetUpdateReadyForTests();
  });

  it('is unsupported without a service-worker container or registration', async () => {
    expect(await checkForAppUpdate(undefined)).toBe('unsupported');
    expect(await checkForAppUpdate(container(undefined))).toBe('unsupported');
  });

  it('reports up-to-date when the re-fetched script is unchanged', async () => {
    const reg = new FakeRegistration();
    expect(await checkForAppUpdate(container(reg))).toBe('up-to-date');
    expect(reg.updates).toBe(1);
  });

  it('reports offline when the script could not be fetched', async () => {
    const reg = new FakeRegistration({
      update: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await checkForAppUpdate(container(reg))).toBe('offline');
  });

  it('waits for a freshly found worker to install, then reports update-ready', async () => {
    const worker = new FakeWorker('installing');
    const reg = new FakeRegistration({
      update: async (r) => {
        r.installing = worker;
      },
    });
    const result = checkForAppUpdate(container(reg));
    // Not settled while the new worker is still installing.
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    worker.moveTo('installed');
    expect(await result).toBe('update-ready');
  });

  it('reports offline when the fresh worker fails to install (goes redundant)', async () => {
    const worker = new FakeWorker('installing');
    const reg = new FakeRegistration({
      update: async (r) => {
        r.installing = worker;
      },
    });
    const result = checkForAppUpdate(container(reg));
    worker.moveTo('redundant');
    expect(await result).toBe('offline');
  });

  it('reports update-ready straight away when a worker is already waiting', async () => {
    const reg = new FakeRegistration({ waiting: new FakeWorker('installed') });
    expect(await checkForAppUpdate(container(reg))).toBe('update-ready');
    // No need to ask the server again — the update is already here.
    expect(reg.updates).toBe(0);
  });

  // sw.js skips waiting and claims the page, so a found worker ACTIVATES
  // and both registration slots empty while the page still runs the old
  // build. The page remembers the find for its lifetime: a later check
  // must not re-fetch an (unchanged, now-current) sw.js and say "up to
  // date" when only a reload fixes it.
  it('stays update-ready after the found worker activates and the slots empty', async () => {
    const worker = new FakeWorker('installing');
    const reg = new FakeRegistration({
      update: async (r) => {
        r.installing = worker;
      },
    });
    const first = checkForAppUpdate(container(reg));
    worker.moveTo('installed');
    expect(await first).toBe('update-ready');
    expect(isUpdateReady()).toBe(true);

    // The browser activates it and clears the slots — no reload happened.
    reg.installing = null;
    reg.waiting = null;
    worker.moveTo('activated');

    expect(await checkForAppUpdate(container(reg))).toBe('update-ready');
    expect(reg.updates).toBe(1);
  });

  it('reports update-ready when the foreground re-check already found one', async () => {
    // UpdateNotifier saw a worker install behind the live page and marked
    // it; the Settings check answers from that without asking the server.
    markUpdateReady();
    const reg = new FakeRegistration();
    expect(await checkForAppUpdate(container(reg))).toBe('update-ready');
    expect(reg.updates).toBe(0);
  });

  it('does not mark the page when the fresh worker fails to install', async () => {
    const worker = new FakeWorker('installing');
    const reg = new FakeRegistration({
      update: async (r) => {
        r.installing = worker;
      },
    });
    const result = checkForAppUpdate(container(reg));
    worker.moveTo('redundant');
    expect(await result).toBe('offline');
    expect(isUpdateReady()).toBe(false);
  });
});

describe('formatBuildDate', () => {
  it('renders the stamped ISO timestamp as a short, locale-fixed date', () => {
    expect(formatBuildDate('2026-10-21T03:14:15.000Z')).toBe('21 Oct 2026');
  });

  it('is empty for an unstamped or malformed value', () => {
    expect(formatBuildDate(undefined)).toBe('');
    expect(formatBuildDate('')).toBe('');
    expect(formatBuildDate('yesterday')).toBe('');
  });
});
