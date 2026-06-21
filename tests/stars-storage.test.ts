import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// storage.ts is localStorage-backed and short-circuits without `window`
// (the test env is node). A tiny in-memory stub lets us exercise the real
// star functions — including the sync mutation bus — with no DOM dependency.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const win = globalThis as unknown as { window?: unknown };
const hadWindow = 'window' in globalThis;
const store = new MemoryStorage();
win.window = { localStorage: store };

afterAll(() => {
  if (!hadWindow) delete win.window;
});

// Import AFTER the window stub is in place (module load itself is window-free,
// but keep ordering obvious).
const storage = await import('@/lib/storage');

beforeEach(() => store.clear());

describe('star storage', () => {
  it('stars a question, reports it starred, and lists it', () => {
    storage.setStar('q1', true, 1000);
    expect(storage.isStarred('q1')).toBe(true);
    expect(storage.loadStars()).toEqual([{ questionId: 'q1', starredAt: 1000 }]);
  });

  it('unstars a question', () => {
    storage.setStar('q1', true);
    storage.setStar('q1', false);
    expect(storage.isStarred('q1')).toBe(false);
    expect(storage.loadStars()).toEqual([]);
  });

  it('is idempotent: re-starring keeps the original starredAt', () => {
    storage.setStar('q1', true, 1000);
    storage.setStar('q1', true, 9999);
    expect(storage.loadStars()).toEqual([{ questionId: 'q1', starredAt: 1000 }]);
  });

  it('unstarring something not starred is a no-op', () => {
    storage.setStar('ghost', false);
    expect(storage.loadStars()).toEqual([]);
  });

  it('emits an upsert mutation on star and a delete mutation on unstar', () => {
    const seen: unknown[] = [];
    const off = storage.onMutation((m) => seen.push(m));
    storage.setStar('q1', true, 1000);
    storage.setStar('q1', false);
    off();
    expect(seen).toEqual([
      { table: 'stars', row: { questionId: 'q1', starredAt: 1000 } },
      { table: 'stars', op: 'delete', questionId: 'q1' },
    ]);
  });

  it('does not emit when re-starring (no real change)', () => {
    storage.setStar('q1', true, 1000);
    const seen: unknown[] = [];
    const off = storage.onMutation((m) => seen.push(m));
    storage.setStar('q1', true, 2000); // already starred → no-op
    off();
    expect(seen).toEqual([]);
  });
});

describe('mergeRemote (stars)', () => {
  it('adds remote stars not present locally', () => {
    const changed = storage.mergeRemote({
      stars: [{ questionId: 'q1', starredAt: 1000 }],
    });
    expect(changed).toBe(true);
    expect(storage.loadStars()).toEqual([{ questionId: 'q1', starredAt: 1000 }]);
  });

  it('keeps the earliest starredAt when both sides have the question', () => {
    storage.setStar('q1', true, 5000);
    storage.mergeRemote({ stars: [{ questionId: 'q1', starredAt: 1000 }] });
    expect(storage.loadStars()).toEqual([{ questionId: 'q1', starredAt: 1000 }]);
  });

  it('ignores a later remote starredAt for an existing local star', () => {
    storage.setStar('q1', true, 1000);
    const changed = storage.mergeRemote({
      stars: [{ questionId: 'q1', starredAt: 9999 }],
    });
    expect(changed).toBe(false);
    expect(storage.loadStars()).toEqual([{ questionId: 'q1', starredAt: 1000 }]);
  });
});
