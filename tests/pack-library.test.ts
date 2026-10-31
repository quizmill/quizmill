import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  activatePack,
  ejectPack,
  getActivePackPointer,
  getInsertedPack,
  insertPack,
  listInsertedPacks,
  migrateInsertedPacks,
  packProgress,
} from '@/lib/packLibrary';
import {
  ACTIVE_PACK_ID_KEY,
  HANDOFF_PACK_KEY,
  LIBRARY_INDEX_KEY,
  insertedPackKey,
} from '@/lib/packKeys';

// The library binds no state at module load, so a per-test window stub is
// enough — no module resets needed.

const BUILD_PACK_ID = 'demo-build';

/** A minimal pack that passes full validatePack. */
function validPack(id = 'capitals-mini') {
  return {
    manifest: {
      schemaVersion: 2,
      id,
      title: 'Capitals Mini',
      description: 'A tiny world-capitals practice pack used by unit tests.',
      homeSubtitle: 'Spin the globe.',
      themeColor: '#1e3a5f',
      categories: [{ key: 'europe', label: 'Europe' }],
    },
    questions: [
      {
        id: `${id}-europe-001`,
        categoryKey: 'europe',
        difficulty: 2,
        prompt: 'What is the capital of France?',
        options: [
          { key: 'A', text: 'Paris' },
          { key: 'B', text: 'Lyon' },
        ],
        correctKey: 'A',
        explanation:
          'Paris has been the capital of France for over a millennium; Lyon is its third-largest city.',
        source: 'original',
        reviewStatus: 'draft',
      },
    ],
  };
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('insertPack', () => {
  it('stores a valid pack and lists it with metadata', async () => {
    const result = await insertPack(validPack(), {
      origin: 'unit-test',
      buildPackId: BUILD_PACK_ID,
    });
    expect(result.ok).toBe(true);

    const entries = listInsertedPacks();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'capitals-mini',
      title: 'Capitals Mini',
      questionCount: 1,
      categoryCount: 1,
      origin: 'unit-test',
    });
    expect((await getInsertedPack('capitals-mini'))?.manifest.id).toBe('capitals-mini');
  });

  it('rejects an invalid pack with validator errors and stores nothing', async () => {
    const bad = validPack();
    bad.questions[0].categoryKey = 'not-declared';
    const result = await insertPack(bad, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('not-declared');
    }
    expect(listInsertedPacks()).toHaveLength(0);
    expect(await getInsertedPack('capitals-mini')).toBeNull();
  });

  it('rejects non-pack JSON with a friendly error', async () => {
    const result = await insertPack([1, 2, 3], { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('not a pack');
  });

  it('refuses the pack that is built into the app', async () => {
    const result = await insertPack(validPack(BUILD_PACK_ID), {
      buildPackId: BUILD_PACK_ID,
    });
    expect(result.ok).toBe(false);
    expect(listInsertedPacks()).toHaveLength(0);
  });

  it('re-inserting an id replaces the pack (update) without duplicating it', async () => {
    await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    const updated = validPack();
    updated.questions.push({
      ...updated.questions[0],
      id: 'capitals-mini-europe-002',
    });
    const result = await insertPack(updated, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(true);

    const entries = listInsertedPacks();
    expect(entries).toHaveLength(1);
    expect(entries[0].questionCount).toBe(2);
    expect((await getInsertedPack('capitals-mini'))?.questions).toHaveLength(2);
  });

  it('keeps the bundle’s packVersion (and an explicit one wins) so an update check can compare it', async () => {
    // A bundle envelope (quizmill bundle) carries packVersion next to the content.
    await insertPack(
      { ...validPack(), format: 'quizmill-pack-bundle', packVersion: 'abc1234' },
      { buildPackId: BUILD_PACK_ID },
    );
    expect(listInsertedPacks()[0].packVersion).toBe('abc1234');
    // The unlock path knows better: the endpoint's ETag is the version it compares.
    await insertPack(
      { ...validPack(), packVersion: 'abc1234-dirty' },
      { buildPackId: BUILD_PACK_ID, packVersion: 'etag-hash', unlockUrl: 'https://unlock.test' },
    );
    expect(listInsertedPacks()[0]).toMatchObject({
      packVersion: 'etag-hash',
      unlockUrl: 'https://unlock.test',
    });
    // Picked pack files have no version — the field is simply absent.
    await insertPack(validPack('other-pack'), { buildPackId: BUILD_PACK_ID });
    expect(listInsertedPacks().find((e) => e.id === 'other-pack')).not.toHaveProperty('packVersion');
  });
});

describe('activatePack', () => {
  it('points the app at an inserted pack and clears the external handoff blob', async () => {
    await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    store.set(HANDOFF_PACK_KEY, '{"stale":"handoff"}');

    expect(await activatePack('capitals-mini')).toEqual({ ok: true });
    expect(getActivePackPointer()).toBe('capitals-mini');
    expect(store.has(HANDOFF_PACK_KEY)).toBe(false);
  });

  it('refuses to point at a pack that is not in the library', async () => {
    expect((await activatePack('missing')).ok).toBe(false);
    expect(getActivePackPointer()).toBeNull();
  });

  it('null switches back to the build-time pack', async () => {
    await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    await activatePack('capitals-mini');
    expect(await activatePack(null)).toEqual({ ok: true });
    expect(getActivePackPointer()).toBeNull();
  });
});

describe('ejectPack', () => {
  it('removes the pack but KEEPS its progress', async () => {
    await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    store.set('quizmill.capitals-mini.sessions.v1', JSON.stringify([{ startedAt: 111 }]));
    store.set('quizmill.capitals-mini.attempts.v1', JSON.stringify([{}, {}]));

    const { wasActive } = await ejectPack('capitals-mini');

    expect(wasActive).toBe(false);
    expect(listInsertedPacks()).toHaveLength(0);
    expect(store.has(insertedPackKey('capitals-mini'))).toBe(false);
    // Progress survives the eject — re-inserting the pack restores it.
    expect(store.get('quizmill.capitals-mini.attempts.v1')).toBeDefined();
    expect(packProgress('capitals-mini')).toMatchObject({ sessions: 1, attempts: 2 });
  });

  it('ejecting the ACTIVE pack clears the pointer (fall back to built-in)', async () => {
    await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    await activatePack('capitals-mini');

    const { wasActive } = await ejectPack('capitals-mini');

    expect(wasActive).toBe(true);
    expect(store.has(ACTIVE_PACK_ID_KEY)).toBe(false);
  });
});

describe('packProgress', () => {
  it('summarises any pack id from its namespaced stores', () => {
    store.set(
      'quizmill.other-pack.sessions.v1',
      JSON.stringify([{ startedAt: 100 }, { startedAt: 300 }]),
    );
    store.set('quizmill.other-pack.attempts.v1', JSON.stringify([{}, {}, {}]));

    expect(packProgress('other-pack')).toEqual({
      sessions: 2,
      attempts: 3,
      lastPractisedAt: 300,
    });
  });

  it('returns an empty summary for an unknown pack or corrupt store', () => {
    expect(packProgress('never-seen')).toEqual({
      sessions: 0,
      attempts: 0,
      lastPractisedAt: null,
    });
    store.set('quizmill.corrupt.sessions.v1', 'not json {');
    expect(packProgress('corrupt').sessions).toBe(0);
  });
});

describe('insertPack — image assetsBase', () => {
  it('persists assetsBase so a re-read pack can resolve its images', async () => {
    const pack = { ...validPack(), assetsBase: 'https://example.com/mt/assets' };
    const result = await insertPack(pack, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(true);
    expect((await getInsertedPack('capitals-mini'))?.assetsBase).toBe('https://example.com/mt/assets');
  });

  it('drops a non-http(s) assetsBase instead of storing junk', async () => {
    const pack = { ...validPack(), assetsBase: 'javascript:alert(1)' };
    const result = await insertPack(pack, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(true);
    expect((await getInsertedPack('capitals-mini'))?.assetsBase).toBeUndefined();
  });
});

describe('insertPack — embedded bundle assets', () => {
  it('keeps the assets map a bundle carries so images render offline', async () => {
    const assets = { 'note.svg': 'data:image/svg+xml;base64,PHN2Zy8+' };
    const result = await insertPack({ ...validPack(), assets }, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(true);
    expect((await getInsertedPack('capitals-mini'))?.assets).toEqual(assets);
  });

  it('keeps only data:image/… entries under plain relative paths', async () => {
    const assets = {
      'ok.svg': 'data:image/svg+xml;base64,PHN2Zy8+',
      'script.svg': 'javascript:alert(1)',
      'remote.png': 'https://example.com/x.png',
      '../escape.svg': 'data:image/svg+xml;base64,PHN2Zy8+',
      'text.svg': 'data:text/html;base64,PHN2Zy8+',
    };
    const result = await insertPack({ ...validPack(), assets }, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(true);
    expect((await getInsertedPack('capitals-mini'))?.assets).toEqual({
      'ok.svg': 'data:image/svg+xml;base64,PHN2Zy8+',
    });
  });

  it('stores no assets key at all when the map is empty or junk', async () => {
    expect((await insertPack({ ...validPack(), assets: {} }, { buildPackId: BUILD_PACK_ID })).ok).toBe(true);
    expect((await getInsertedPack('capitals-mini'))?.assets).toBeUndefined();
    expect((await insertPack({ ...validPack(), assets: 'nope' }, { buildPackId: BUILD_PACK_ID })).ok).toBe(true);
    expect((await getInsertedPack('capitals-mini'))?.assets).toBeUndefined();
  });
});

describe('ejectPack — cached image cleanup', () => {
  it('drops the pack’s cached images along with the pack', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      open: async () => ({
        delete: async (url: string) => (deleted.push(String(url)), true),
      }),
    });
    const pack = { ...validPack(), assetsBase: 'https://example.com/mt/assets' };
    pack.questions[0] = { ...pack.questions[0], image: 'note.svg' } as (typeof pack.questions)[0];
    expect((await insertPack(pack, { buildPackId: BUILD_PACK_ID })).ok).toBe(true);

    await ejectPack('capitals-mini');
    await vi.waitFor(() => expect(deleted).toEqual(['https://example.com/mt/assets/note.svg']));
  });
});

/** A pack whose JSON is about `kb` kilobytes — one long explanation. */
function bulkyPack(id: string, kb: number) {
  const pack = validPack(id);
  pack.questions[0].explanation += ' ' + 'x'.repeat(kb * 1024);
  return pack;
}

/** localStorage that refuses writes past `capKb` kilobytes, counting two
 *  bytes per character like the browsers do. */
function cappedStorage(capKb: number) {
  const size = () => [...store].reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0);
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const prev = store.get(k);
      store.set(k, v);
      if (size() > capKb * 1024) {
        if (prev === undefined) store.delete(k);
        else store.set(k, prev);
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
    },
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('inserted packs live in IndexedDB', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('window', { localStorage: cappedStorage(600), dispatchEvent: () => true });
  });

  it('holds more packs than localStorage could — none of them is written there', async () => {
    // Three ~150 KB packs ≈ 900 KB in UTF-16: more than the 600 KB cap.
    for (const id of ['pack-a', 'pack-b', 'pack-c']) {
      expect(await insertPack(bulkyPack(id, 150), { buildPackId: BUILD_PACK_ID })).toMatchObject({ ok: true });
    }
    expect(listInsertedPacks().map((e) => e.id).sort()).toEqual(['pack-a', 'pack-b', 'pack-c']);
    expect([...store.keys()].filter((k) => k.startsWith('quizmill.packLibrary.pack.'))).toEqual([]);
    expect((await getInsertedPack('pack-b'))?.manifest.id).toBe('pack-b');
  });

  it('mirrors only the ACTIVE pack into localStorage, for the synchronous boot', async () => {
    await insertPack(bulkyPack('pack-a', 150), { buildPackId: BUILD_PACK_ID });
    await insertPack(bulkyPack('pack-b', 150), { buildPackId: BUILD_PACK_ID });

    expect(await activatePack('pack-a')).toEqual({ ok: true });
    expect(store.has(insertedPackKey('pack-a'))).toBe(true);

    // Switching moves the mirror: the previous pack's copy goes first, so
    // two big packs never have to fit side by side.
    expect(await activatePack('pack-b')).toEqual({ ok: true });
    expect(store.has(insertedPackKey('pack-a'))).toBe(false);
    expect(JSON.parse(store.get(insertedPackKey('pack-b'))!).manifest.id).toBe('pack-b');
    expect((await getInsertedPack('pack-a'))?.manifest.id).toBe('pack-a');

    expect(await activatePack(null)).toEqual({ ok: true });
    expect(store.has(insertedPackKey('pack-b'))).toBe(false);
    expect((await getInsertedPack('pack-b'))?.manifest.id).toBe('pack-b');
  });

  it('re-inserting the active pack refreshes its mirror too', async () => {
    await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    await activatePack('capitals-mini');
    const updated = validPack();
    updated.questions.push({ ...updated.questions[0], id: 'capitals-mini-europe-002' });
    await insertPack(updated, { buildPackId: BUILD_PACK_ID });
    expect(JSON.parse(store.get(insertedPackKey('capitals-mini'))!).questions).toHaveLength(2);
  });

  it('activating a pack too big for what is left of localStorage says so and keeps the old one', async () => {
    await insertPack(bulkyPack('small', 50), { buildPackId: BUILD_PACK_ID });
    await insertPack(bulkyPack('huge', 400), { buildPackId: BUILD_PACK_ID });
    await activatePack('small');
    store.set('quizmill.small.attempts.v1', 'y'.repeat(150 * 1024)); // progress fills the rest

    const result = await activatePack('huge');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not enough storage space');
    expect(getActivePackPointer()).toBe('small');
    expect(store.has(insertedPackKey('small'))).toBe(true);
  });

  it('eject drops the pack from IndexedDB and the mirror', async () => {
    await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    await activatePack('capitals-mini');
    expect(await ejectPack('capitals-mini')).toEqual({ wasActive: true });
    expect(await getInsertedPack('capitals-mini')).toBeNull();
    expect(store.has(insertedPackKey('capitals-mini'))).toBe(false);
  });

  it('moves packs inserted into localStorage by older builds over, keeping the active mirror', async () => {
    const entry = (id: string) => ({ id, title: id, description: '', themeColor: '#000', questionCount: 1, categoryCount: 1, insertedAt: 1 });
    store.set(LIBRARY_INDEX_KEY, JSON.stringify([entry('old-a'), entry('old-b')]));
    store.set(insertedPackKey('old-a'), JSON.stringify(validPack('old-a')));
    store.set(insertedPackKey('old-b'), JSON.stringify(validPack('old-b')));
    store.set(ACTIVE_PACK_ID_KEY, 'old-b');

    await migrateInsertedPacks();

    expect(store.has(insertedPackKey('old-a'))).toBe(false); // freed
    expect(store.has(insertedPackKey('old-b'))).toBe(true); // the boot still needs it
    expect((await getInsertedPack('old-a'))?.manifest.id).toBe('old-a');
    expect((await getInsertedPack('old-b'))?.manifest.id).toBe('old-b');
    // Idempotent: a second run changes nothing and loses nothing.
    await migrateInsertedPacks();
    expect((await getInsertedPack('old-a'))?.manifest.id).toBe('old-a');
  });
});

describe('insertPack — reporting a failed write', () => {
  function failingStorage(error: unknown) {
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => {
        throw error;
      },
      removeItem: (k: string) => void store.delete(k),
    };
  }

  it('calls a quota error "not enough storage space"', async () => {
    vi.stubGlobal('window', {
      localStorage: failingStorage(new DOMException('full', 'QuotaExceededError')),
      dispatchEvent: () => true,
    });
    const result = await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    expect(result).toEqual({
      ok: false,
      errors: ['not enough storage space on this device — eject a pack you no longer use and try again'],
    });
  });

  it('recognises Firefox’s NS_ERROR_DOM_QUOTA_REACHED as a quota error too', async () => {
    vi.stubGlobal('window', {
      localStorage: failingStorage(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED')),
      dispatchEvent: () => true,
    });
    const result = await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('not enough storage space');
  });

  it('reports any other failure with the real error, not as a full device', async () => {
    vi.stubGlobal('window', {
      localStorage: failingStorage(new DOMException('The operation is insecure.', 'SecurityError')),
      dispatchEvent: () => true,
    });
    const result = await insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).not.toContain('storage space');
      expect(result.errors[0]).toContain('SecurityError: The operation is insecure.');
    }
    expect(listInsertedPacks()).toEqual([]);
  });
});
