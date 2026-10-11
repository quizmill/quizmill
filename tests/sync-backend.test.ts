import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSyncBackend,
  registerSyncBackendProvider,
  syncBackendInfo,
  syncBackendKind,
  type SyncBackend,
} from '../src/lib/syncBackend';

/** Minimal do-nothing backend for registry tests. */
function stubBackend(): SyncBackend {
  return {
    getUserId: async () => null,
    onAuthChange: () => {},
    runOp: async () => {},
    pullAll: async () => ({
      sessions: [],
      attempts: [],
      achievements: [],
      votes: [],
      notes: [],
      events: [],
    }),
  };
}

const ENV_KEYS = ['NEXT_PUBLIC_SYNC_URL', 'NEXT_PUBLIC_SYNC_BACKEND'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('sync backend registry', () => {
  it('is dormant with nothing configured', () => {
    expect(syncBackendKind()).toBeNull();
    expect(getSyncBackend()).toBeNull();
  });

  it('selects http when a sync URL is set', () => {
    process.env.NEXT_PUBLIC_SYNC_URL = 'https://sync.example.dev';
    expect(syncBackendKind()).toBe('http');
    expect(getSyncBackend()).not.toBeNull();
  });

  it('honours an explicit NEXT_PUBLIC_SYNC_BACKEND pick', () => {
    process.env.NEXT_PUBLIC_SYNC_URL = 'https://sync.example.dev';
    process.env.NEXT_PUBLIC_SYNC_BACKEND = 'http';
    expect(syncBackendKind()).toBe('http');
  });

  it('treats a forced-but-unconfigured backend as dormant, never a fallback', () => {
    process.env.NEXT_PUBLIC_SYNC_BACKEND = 'http'; // no NEXT_PUBLIC_SYNC_URL
    expect(syncBackendKind()).toBeNull();
    expect(getSyncBackend()).toBeNull();
  });

  it('names the active backend with its target host (syncBackendInfo)', () => {
    expect(syncBackendInfo()).toBeNull(); // nothing configured
    process.env.NEXT_PUBLIC_SYNC_URL = 'https://quizmill-sync.acme.workers.dev';
    expect(syncBackendInfo()).toEqual({
      kind: 'http',
      label: 'Sync server · quizmill-sync.acme.workers.dev',
    });
  });

  // NOTE: keep this after the info test — the custom provider registered
  // here is always-configured and prepended, so it shadows the built-ins
  // for the rest of the file.
  it('lets a custom provider register, win via prepend, and caches its instance', () => {
    let created = 0;
    registerSyncBackendProvider(
      {
        kind: 'custom-test',
        isConfigured: () => true,
        create: () => {
          created += 1;
          return stubBackend();
        },
      },
      { prepend: true },
    );
    process.env.NEXT_PUBLIC_SYNC_URL = 'https://sync.example.dev';
    expect(syncBackendKind()).toBe('custom-test'); // prepended → beats http
    // No describe() on the provider → the info label falls back to the kind.
    expect(syncBackendInfo()).toEqual({ kind: 'custom-test', label: 'custom-test' });
    const a = getSyncBackend();
    const b = getSyncBackend();
    expect(a).toBe(b);
    expect(created).toBe(1);
    // …and an explicit pick can still select a built-in over it.
    process.env.NEXT_PUBLIC_SYNC_BACKEND = 'http';
    expect(syncBackendKind()).toBe('http');
  });

  it('rejects duplicate kinds loudly', () => {
    expect(() =>
      registerSyncBackendProvider({
        kind: 'http',
        isConfigured: () => false,
        create: stubBackend,
      }),
    ).toThrow(/already registered/);
  });
});
