import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activatePack,
  ejectPack,
  getActivePackPointer,
  getInsertedPack,
  insertPack,
  listInsertedPacks,
  packProgress,
} from '@/lib/packLibrary';
import {
  ACTIVE_PACK_ID_KEY,
  HANDOFF_PACK_KEY,
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
  it('stores a valid pack and lists it with metadata', () => {
    const result = insertPack(validPack(), {
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
    expect(getInsertedPack('capitals-mini')?.manifest.id).toBe('capitals-mini');
  });

  it('rejects an invalid pack with validator errors and stores nothing', () => {
    const bad = validPack();
    bad.questions[0].categoryKey = 'not-declared';
    const result = insertPack(bad, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('not-declared');
    }
    expect(listInsertedPacks()).toHaveLength(0);
    expect(getInsertedPack('capitals-mini')).toBeNull();
  });

  it('rejects non-pack JSON with a friendly error', () => {
    const result = insertPack([1, 2, 3], { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('not a pack');
  });

  it('refuses the pack that is built into the app', () => {
    const result = insertPack(validPack(BUILD_PACK_ID), {
      buildPackId: BUILD_PACK_ID,
    });
    expect(result.ok).toBe(false);
    expect(listInsertedPacks()).toHaveLength(0);
  });

  it('re-inserting an id replaces the pack (update) without duplicating it', () => {
    insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    const updated = validPack();
    updated.questions.push({
      ...updated.questions[0],
      id: 'capitals-mini-europe-002',
    });
    const result = insertPack(updated, { buildPackId: BUILD_PACK_ID });
    expect(result.ok).toBe(true);

    const entries = listInsertedPacks();
    expect(entries).toHaveLength(1);
    expect(entries[0].questionCount).toBe(2);
    expect(getInsertedPack('capitals-mini')?.questions).toHaveLength(2);
  });
});

describe('activatePack', () => {
  it('points the app at an inserted pack and clears the external handoff blob', () => {
    insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    store.set(HANDOFF_PACK_KEY, '{"stale":"handoff"}');

    expect(activatePack('capitals-mini')).toBe(true);
    expect(getActivePackPointer()).toBe('capitals-mini');
    expect(store.has(HANDOFF_PACK_KEY)).toBe(false);
  });

  it('refuses to point at a pack that is not in the library', () => {
    expect(activatePack('missing')).toBe(false);
    expect(getActivePackPointer()).toBeNull();
  });

  it('null switches back to the build-time pack', () => {
    insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    activatePack('capitals-mini');
    expect(activatePack(null)).toBe(true);
    expect(getActivePackPointer()).toBeNull();
  });
});

describe('ejectPack', () => {
  it('removes the pack but KEEPS its progress', () => {
    insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    store.set('quizmill.capitals-mini.sessions.v1', JSON.stringify([{ startedAt: 111 }]));
    store.set('quizmill.capitals-mini.attempts.v1', JSON.stringify([{}, {}]));

    const { wasActive } = ejectPack('capitals-mini');

    expect(wasActive).toBe(false);
    expect(listInsertedPacks()).toHaveLength(0);
    expect(store.has(insertedPackKey('capitals-mini'))).toBe(false);
    // Progress survives the eject — re-inserting the pack restores it.
    expect(store.get('quizmill.capitals-mini.attempts.v1')).toBeDefined();
    expect(packProgress('capitals-mini')).toMatchObject({ sessions: 1, attempts: 2 });
  });

  it('ejecting the ACTIVE pack clears the pointer (fall back to built-in)', () => {
    insertPack(validPack(), { buildPackId: BUILD_PACK_ID });
    activatePack('capitals-mini');

    const { wasActive } = ejectPack('capitals-mini');

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
