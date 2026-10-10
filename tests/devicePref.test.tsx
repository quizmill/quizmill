// .tsx so this runs on happy-dom (the dom project in vitest.config.mts) —
// the factory needs window/localStorage and the hook needs a DOM to mount.
/**
 * The one load/save/notify engine behind every device-level preference
 * (theme, look, Levels & XP, Coach, Paper, analytics). The concrete
 * modules only supply a key, an event, how to read a stored string and
 * how to write one; everything about *storage* — the SSR guard, the
 * try/catch around localStorage, the change event, what happens when a
 * write is refused, the legacy-key promotion — lives here once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { devicePref, type DevicePref } from '@/lib/devicePref';
import { useDevicePref } from '@/lib/useDevicePref';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mode = 'auto' | 'on' | 'off';

/** A three-way pref like theme/look: 'auto' is the absent-key default. */
function modePref(): DevicePref<Mode> {
  return devicePref<Mode>({
    key: 'quizmill.test.mode.v1',
    event: 'quizmill:test-mode',
    fallback: 'auto',
    parse: (raw) => (raw === 'on' || raw === 'off' ? raw : undefined),
    serialise: (mode) => (mode === 'auto' ? null : mode),
  });
}

/** A boolean switch like Coach/Paper: '1' = on, absent = off. */
function switchPref(): DevicePref<boolean> {
  return devicePref<boolean>({
    key: 'quizmill.test.switch.v1',
    event: 'quizmill:test-switch',
    fallback: false,
    parse: (raw) => raw === '1',
    serialise: (on) => (on ? '1' : null),
  });
}

/**
 * Stand in a localStorage whose writes are refused (quota, storage
 * policy) but whose reads still work — the shape of a real quota error.
 * Replaces the window property rather than spying on the method: happy-dom
 * binds the Storage methods on first use, so a later prototype spy is
 * never reached. Returns the undo.
 */
function refuseWrites(): () => void {
  const real = window.localStorage;
  const desc = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const refusing = {
    getItem: (k: string) => real.getItem(k),
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => refusing });
  return () => {
    if (desc) Object.defineProperty(window, 'localStorage', desc);
    else delete (window as { localStorage?: unknown }).localStorage;
  };
}

let restoreStorage: (() => void) | null = null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  restoreStorage?.();
  restoreStorage = null;
  vi.restoreAllMocks();
});

describe('devicePref', () => {
  it('exposes the key, event and fallback it was built with', () => {
    const pref = modePref();
    expect(pref.key).toBe('quizmill.test.mode.v1');
    expect(pref.event).toBe('quizmill:test-mode');
    expect(pref.fallback).toBe('auto');
  });

  it('returns the fallback when nothing is stored', () => {
    expect(modePref().load()).toBe('auto');
    expect(switchPref().load()).toBe(false);
  });

  it('round-trips through parse/serialise and removes the key for the default', () => {
    const pref = modePref();
    pref.save('on');
    expect(window.localStorage.getItem(pref.key)).toBe('on');
    expect(pref.load()).toBe('on');
    pref.save('auto');
    expect(window.localStorage.getItem(pref.key)).toBeNull();
    expect(pref.load()).toBe('auto');
  });

  it('treats junk in storage as the fallback', () => {
    const pref = modePref();
    window.localStorage.setItem(pref.key, 'blorange');
    expect(pref.load()).toBe('auto');
  });

  it('notifies listeners on every save so mounted hooks re-read', () => {
    const pref = switchPref();
    const spy = vi.fn();
    window.addEventListener(pref.event, spy);
    pref.save(true);
    pref.save(false);
    window.removeEventListener(pref.event, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('survives a localStorage that throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(modePref().load()).toBe('auto');
    expect(switchPref().load()).toBe(false);
  });

  // The fix the analytics switch needed, now for every pref: without it
  // the toggle flips on screen and the next read says the old value.
  it('honours the choice for the rest of the page when storage refuses the write', () => {
    const pref = switchPref();
    restoreStorage = refuseWrites();
    const spy = vi.fn();
    window.addEventListener(pref.event, spy);
    expect(() => pref.save(true)).not.toThrow();
    expect(pref.load()).toBe(true);
    pref.save(false);
    expect(pref.load()).toBe(false);
    window.removeEventListener(pref.event, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('forgets the in-page choice once a write lands again', () => {
    const pref = modePref();
    const restore = refuseWrites();
    pref.save('on');
    expect(pref.load()).toBe('on');
    restore();
    pref.save('off');
    expect(window.localStorage.getItem(pref.key)).toBe('off');
    expect(pref.load()).toBe('off');
    // Storage holds the truth again: an edit from another tab wins.
    window.localStorage.setItem(pref.key, 'on');
    expect(pref.load()).toBe('on');
  });

  it('promotes a legacy key on first read, then forgets it', () => {
    const pref = devicePref<Mode>({
      key: 'quizmill.test.mode.v1',
      legacyKey: 'quizmill.old.mode.v1',
      event: 'quizmill:test-mode',
      fallback: 'auto',
      parse: (raw) => (raw === 'on' || raw === 'off' ? raw : undefined),
      serialise: (mode) => (mode === 'auto' ? null : mode),
    });
    window.localStorage.setItem('quizmill.old.mode.v1', 'on');
    expect(pref.load()).toBe('on');
    expect(window.localStorage.getItem(pref.key)).toBe('on');
    expect(window.localStorage.getItem('quizmill.old.mode.v1')).toBeNull();
    // The current key wins over a lingering legacy value.
    window.localStorage.setItem(pref.key, 'off');
    window.localStorage.setItem('quizmill.old.mode.v1', 'on');
    expect(pref.load()).toBe('off');
  });
});

describe('useDevicePref', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });

  const applied: Mode[] = [];
  const apply = (mode: Mode) => {
    applied.push(mode);
  };
  const pref = modePref();
  let latest: [Mode, (next: Mode) => void] | null = null;

  function Probe() {
    latest = useDevicePref(pref, apply);
    return <span data-testid="mode">{latest[0]}</span>;
  }

  async function mount() {
    applied.length = 0;
    root = createRoot(container);
    await act(async () => {
      root!.render(<Probe />);
    });
  }

  it('starts at the fallback, reads storage after mount and applies it', async () => {
    window.localStorage.setItem(pref.key, 'on');
    await mount();
    expect(container.textContent).toBe('on');
    expect(applied).toEqual(['on']);
  });

  it('saves, applies and re-renders on set', async () => {
    await mount();
    await act(async () => {
      latest![1]('off');
    });
    expect(container.textContent).toBe('off');
    expect(window.localStorage.getItem(pref.key)).toBe('off');
    expect(applied).toContain('off');
  });

  it('re-reads when the pref is saved elsewhere on the page', async () => {
    await mount();
    await act(async () => {
      pref.save('on');
    });
    expect(container.textContent).toBe('on');
  });

  it('re-reads on a storage event from another tab', async () => {
    await mount();
    window.localStorage.setItem(pref.key, 'off');
    await act(async () => {
      window.dispatchEvent(new Event('storage'));
    });
    expect(container.textContent).toBe('off');
  });
});
