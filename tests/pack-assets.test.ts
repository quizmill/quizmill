import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_ASSETS_CACHE,
  cachePackAssets,
  collectPackImageUrls,
  dropPackAssets,
} from '@/lib/packAssets';
import type { ActivePack } from '@/pack/runtime';

// Offline support for runtime-inserted packs: every image a pack references
// is prefetched into the PACK_ASSETS_CACHE at insert time (the service
// worker serves images from it cache-first), and dropped again on eject.

function pack(over: Partial<ActivePack> = {}): ActivePack {
  return {
    manifest: { id: 'mt' } as ActivePack['manifest'],
    questions: [
      {
        id: 'q1',
        image: 'note-g4.svg',
        options: [
          { key: 'A', text: 'a' },
          { key: 'B', text: 'b', image: 'rest-whole.svg' },
        ],
      },
      { id: 'q2', image: 'note-g4.svg', options: [] }, // duplicate image
      { id: 'q3', image: 'https://cdn.example.com/abs.png', options: [] },
      { id: 'q4', options: [] }, // no image
    ] as unknown as ActivePack['questions'],
    assetsBase: 'https://host.example.com/pack/assets',
    ...over,
  };
}

/** Minimal CacheStorage stub backed by a Map of url → true. */
function stubCaches() {
  const store = new Map<string, boolean>();
  const cache = {
    put: vi.fn(async (url: string) => void store.set(String(url), true)),
    delete: vi.fn(async (url: string) => store.delete(String(url))),
    match: vi.fn(async (url: string) => (store.has(String(url)) ? {} : undefined)),
  };
  const open = vi.fn(async (name: string) => {
    expect(name).toBe(PACK_ASSETS_CACHE);
    return cache;
  });
  vi.stubGlobal('caches', { open });
  return { cache, store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collectPackImageUrls', () => {
  it('resolves relative prompt and option images against assetsBase, deduped', () => {
    expect(collectPackImageUrls(pack())).toEqual([
      'https://host.example.com/pack/assets/note-g4.svg',
      'https://host.example.com/pack/assets/rest-whole.svg',
      'https://cdn.example.com/abs.png',
    ]);
  });

  it('keeps absolute urls but skips relative ones when there is no assetsBase', () => {
    expect(collectPackImageUrls(pack({ assetsBase: undefined }))).toEqual([
      'https://cdn.example.com/abs.png',
    ]);
  });
});

describe('cachePackAssets', () => {
  it('fetches every referenced image into the pack-assets cache', async () => {
    const { cache } = stubCaches();
    const fetchImpl = vi.fn(async () => new Response('svg', { status: 200 }));
    const out = await cachePackAssets(pack(), fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ total: 3, cached: 3, failed: 0 });
    expect(cache.put).toHaveBeenCalledTimes(3);
  });

  it('counts failures without throwing (offline images fall back to network)', async () => {
    stubCaches();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('abs.png')
        ? new Response('nope', { status: 404 })
        : new Response('svg', { status: 200 }),
    );
    const out = await cachePackAssets(pack(), fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ total: 3, cached: 2, failed: 1 });
  });

  it('is a safe no-op where the Cache API is unavailable', async () => {
    const out = await cachePackAssets(pack());
    expect(out).toEqual({ total: 3, cached: 0, failed: 3 });
  });
});

describe('dropPackAssets', () => {
  it('removes exactly the pack’s image urls from the cache', async () => {
    const { cache } = stubCaches();
    await dropPackAssets(pack());
    const deleted = cache.delete.mock.calls.map((c) => String(c[0]));
    expect(deleted).toEqual([
      'https://host.example.com/pack/assets/note-g4.svg',
      'https://host.example.com/pack/assets/rest-whole.svg',
      'https://cdn.example.com/abs.png',
    ]);
  });
});
