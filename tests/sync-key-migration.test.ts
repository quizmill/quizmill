import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredSyncKey } from '@/lib/backends/httpBackend';
import { KEY_PREFIX } from '@/lib/storage';

// The sync key identifies the learner, not the pack — it moved from the
// per-pack namespace to the app-level 'quizmill.syncKey.v1' when the pack
// library landed (one key serves every pack; the server partitions rows by
// (user, pack) anyway). Old installs' per-pack key is promoted on read.

const APP_KEY = 'quizmill.syncKey.v1';
const LEGACY_KEY = `${KEY_PREFIX}syncKey.v1`;

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('sync key storage', () => {
  it('reads the app-level key', () => {
    store.set(APP_KEY, 'QM-AAAA-BBBB-CCCC-DDDD');
    expect(getStoredSyncKey()).toBe('QM-AAAA-BBBB-CCCC-DDDD');
  });

  it('migrates a legacy per-pack key to the app-level key', () => {
    store.set(LEGACY_KEY, 'QM-AAAA-BBBB-CCCC-DDDD');
    expect(getStoredSyncKey()).toBe('QM-AAAA-BBBB-CCCC-DDDD');
    expect(store.get(APP_KEY)).toBe('QM-AAAA-BBBB-CCCC-DDDD');
    expect(store.has(LEGACY_KEY)).toBe(false);
  });

  it('prefers the app-level key over a lingering legacy one', () => {
    store.set(APP_KEY, 'QM-NEWK-NEWK-NEWK-NEWK');
    store.set(LEGACY_KEY, 'QM-OLDK-OLDK-OLDK-OLDK');
    expect(getStoredSyncKey()).toBe('QM-NEWK-NEWK-NEWK-NEWK');
  });

  it('returns null when no key is stored anywhere', () => {
    expect(getStoredSyncKey()).toBeNull();
  });
});
