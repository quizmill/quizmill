import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivePack } from '@/pack/runtime';

// `source.ts` reads the runtime override once, at module evaluation. To
// exercise both branches we reset the module registry between cases so the
// next `import('@/pack/source')` re-evaluates against the current global.

const INJECTED: ActivePack = {
  manifest: {
    schemaVersion: 2,
    id: 'injected-pack',
    title: 'Injected Pack',
    description: 'A pack handed to the engine at runtime.',
    homeSubtitle: 'Keep the wheel turning.',
    themeColor: '#0f766e',
    categories: [{ key: 'basics', label: 'Basics' }],
  },
  questions: [
    {
      id: 'injected-basics-001',
      categoryKey: 'basics',
      difficulty: 2,
      prompt: 'Does the runtime pack override the build-time one?',
      options: [
        { key: 'A', text: 'No' },
        { key: 'B', text: 'Yes' },
      ],
      correctKey: 'B',
      explanation: 'setActivePack runs before source.ts evaluates, so it wins.',
      source: 'generated',
      reviewStatus: 'draft',
    },
  ],
};

afterEach(() => {
  globalThis.__QUIZMILL_PACK__ = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Minimal browser stub: a window with localStorage and a location hash. */
function stubBrowser({
  hash = '',
  stored = null,
  entries = {},
}: {
  hash?: string;
  stored?: string | null;
  /** Extra raw localStorage rows (e.g. pack-library keys). */
  entries?: Record<string, string>;
}) {
  const map = new Map<string, string>(Object.entries(entries));
  if (stored !== null) map.set('quizmill.activePack', stored);
  vi.stubGlobal('window', {
    location: { hash },
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
}

describe('runtime pack source', () => {
  it('falls back to the build-time pack when nothing is injected', async () => {
    vi.resetModules();
    const { activeManifest, activeQuestions } = await import('@/pack/source');
    // The committed demo pack is the build-time default; it is not ours.
    expect(activeManifest.id).not.toBe('injected-pack');
    expect(activeQuestions.length).toBeGreaterThan(0);
  });

  it('uses the injected pack when setActivePack runs before source loads', async () => {
    vi.resetModules();
    const { setActivePack } = await import('@/pack/runtime');
    setActivePack(INJECTED);

    const { activeManifest, activeQuestions, activeScenarios, activeConcepts } =
      await import('@/pack/source');

    expect(activeManifest.id).toBe('injected-pack');
    expect(activeQuestions).toHaveLength(1);
    expect(activeQuestions[0].correctKey).toBe('B');
    // A runtime pack brings its own scenarios/concepts; omitted → empty,
    // never the build-time pack's.
    expect(activeScenarios).toEqual([]);
    expect(activeConcepts).toEqual([]);
  });

  // The layout's inline bootstrap script sets the global, but Next loads the
  // engine chunks as async scripts — when the service worker serves them from
  // cache they can execute BEFORE the inline script, so source.ts must be able
  // to find the handed-off pack itself. Regression test for the SW-cached-load
  // race where an injected pack lost to the build-time one.
  it('reads the pack from localStorage when the bootstrap script has not run yet', async () => {
    vi.resetModules();
    stubBrowser({ stored: JSON.stringify(INJECTED) });

    const { activeManifest, activeQuestions } = await import('@/pack/source');

    expect(activeManifest.id).toBe('injected-pack');
    expect(activeQuestions).toHaveLength(1);
  });

  it('reads the pack from a #pack= hash when the bootstrap script has not run yet', async () => {
    vi.resetModules();
    const encoded = encodeURIComponent(
      Buffer.from(JSON.stringify(INJECTED), 'utf8').toString('base64'),
    );
    // Hash wins over a (different) stored pack, mirroring the bootstrap.
    stubBrowser({
      hash: `#pack=${encoded}`,
      stored: JSON.stringify({ ...INJECTED, manifest: { ...INJECTED.manifest, id: 'stored-pack' } }),
    });

    const { activeManifest } = await import('@/pack/source');

    expect(activeManifest.id).toBe('injected-pack');
  });

  // The pack library stores packs under quizmill.packLibrary.pack.<id>.v1
  // and points at the active one via quizmill.activePackId — the lightest
  // handoff: no duplicated JSON blob, just a pointer the bootstrap follows.
  it('resolves the pack-library pointer to the inserted pack', async () => {
    vi.resetModules();
    stubBrowser({
      entries: {
        'quizmill.activePackId': 'injected-pack',
        'quizmill.packLibrary.pack.injected-pack.v1': JSON.stringify(INJECTED),
      },
    });

    const { activeManifest, activeQuestions } = await import('@/pack/source');

    expect(activeManifest.id).toBe('injected-pack');
    expect(activeQuestions).toHaveLength(1);
  });

  it('lets an external handoff blob outrank the library pointer', async () => {
    vi.resetModules();
    stubBrowser({
      stored: JSON.stringify(INJECTED),
      entries: {
        'quizmill.activePackId': 'library-pack',
        'quizmill.packLibrary.pack.library-pack.v1': JSON.stringify({
          ...INJECTED,
          manifest: { ...INJECTED.manifest, id: 'library-pack' },
        }),
      },
    });

    const { activeManifest } = await import('@/pack/source');

    expect(activeManifest.id).toBe('injected-pack');
  });

  it('falls back to the build-time pack when the pointer names a missing pack', async () => {
    vi.resetModules();
    stubBrowser({ entries: { 'quizmill.activePackId': 'gone' } });

    const { activeManifest } = await import('@/pack/source');

    expect(activeManifest.id).not.toBe('injected-pack');
  });

  // One pack id, two editions: a licence key stores the fuller bank under
  // the build-time pack's OWN id, and it renders in place of the compiled-in
  // content on every load — each `import('@/pack/source')` here is a fresh
  // evaluation, exactly what a reload or a new deploy of the app is.
  describe('the built-in pack’s unlocked edition', () => {
    const BUILD_ID = 'solar-system-demo';
    const UNLOCKED: ActivePack = {
      ...INJECTED,
      manifest: { ...INJECTED.manifest, id: BUILD_ID, title: 'Solar System (unlocked)' },
    };
    const stored = { [`quizmill.packLibrary.pack.${BUILD_ID}.v1`]: JSON.stringify(UNLOCKED) };
    const index = (entry: Record<string, unknown>) => ({
      'quizmill.packLibrary.index.v1': JSON.stringify([{ id: BUILD_ID, title: 'x', ...entry }]),
    });
    const unlockedIndex = index({ unlockUrl: 'https://unlock.test' });

    it('replaces the build-time content with no pointer at all, on every evaluation', async () => {
      for (let load = 0; load < 2; load++) {
        vi.resetModules();
        globalThis.__QUIZMILL_PACK__ = undefined;
        stubBrowser({ entries: { ...stored, ...unlockedIndex } });
        const { activeManifest, activeQuestions, buildTimeManifest, isRuntimePack } =
          await import('@/pack/source');
        expect(buildTimeManifest.id).toBe(BUILD_ID);
        expect(activeManifest.id).toBe(BUILD_ID);
        expect(activeManifest.title).toBe('Solar System (unlocked)');
        expect(activeQuestions).toHaveLength(1);
        expect(isRuntimePack).toBe(true);
      }
    });

    it('stands in when the pointer names a pack that is gone', async () => {
      vi.resetModules();
      stubBrowser({ entries: { ...stored, ...unlockedIndex, 'quizmill.activePackId': 'gone' } });
      const { activeManifest } = await import('@/pack/source');
      expect(activeManifest.title).toBe('Solar System (unlocked)');
    });

    it('yields to another pack that is pointed at', async () => {
      vi.resetModules();
      stubBrowser({
        entries: {
          ...stored,
          ...unlockedIndex,
          'quizmill.activePackId': 'injected-pack',
          'quizmill.packLibrary.pack.injected-pack.v1': JSON.stringify(INJECTED),
        },
      });
      const { activeManifest } = await import('@/pack/source');
      expect(activeManifest.id).toBe('injected-pack');
    });

    it('is not a pack stored under the same id any other way — that must not shadow the build', async () => {
      vi.resetModules();
      stubBrowser({ entries: { ...stored, ...index({ origin: 'some.bundle.json' }) } });
      const { activeManifest, isRuntimePack } = await import('@/pack/source');
      expect(activeManifest.title).not.toBe('Solar System (unlocked)');
      expect(isRuntimePack).toBe(false);
    });

    it('once removed, the build-time content is back', async () => {
      vi.resetModules();
      stubBrowser({ entries: {} });
      const { activeManifest, activeQuestions, buildTimeQuestionCount } = await import('@/pack/source');
      expect(activeManifest.id).toBe(BUILD_ID);
      expect(activeQuestions).toHaveLength(buildTimeQuestionCount);
    });
  });

  it('ignores junk in localStorage and falls back to the build-time pack', async () => {
    vi.resetModules();
    stubBrowser({ stored: 'not json {' });

    const { activeManifest, activeQuestions } = await import('@/pack/source');

    expect(activeManifest.id).not.toBe('injected-pack');
    expect(activeQuestions.length).toBeGreaterThan(0);
  });

  it('flows the injected pack through the derived data layer', async () => {
    vi.resetModules();
    const { setActivePack } = await import('@/pack/runtime');
    setActivePack(INJECTED);

    const { packManifest, packQuestions, PACK_CATEGORY_LABEL } = await import('@/pack/data');

    expect(packManifest.title).toBe('Injected Pack');
    expect(packQuestions).toHaveLength(1);
    expect(PACK_CATEGORY_LABEL.basics).toBe('Basics');
  });
});

// Packs inserted BEFORE assetsBase existed (pre-v0.3.22) sit in localStorage
// without it, so their images 404 even online. The library index recorded
// each insert's origin URL — the runtime backfills assetsBase from it once,
// persists it, and the pack's images work again without a re-insert.
describe('assetsBase backfill for packs inserted before v0.3.22', () => {
  const packKey = 'quizmill.packLibrary.pack.injected-pack.v1';

  function stubLibrary(origin?: string) {
    stubBrowser({
      entries: {
        'quizmill.activePackId': 'injected-pack',
        [packKey]: JSON.stringify(INJECTED),
        'quizmill.packLibrary.index.v1': JSON.stringify([
          { id: 'injected-pack', title: 'Injected', ...(origin ? { origin } : {}) },
        ]),
      },
    });
  }

  it('derives assetsBase from the recorded insert origin and persists it', async () => {
    vi.resetModules();
    stubLibrary('https://github.com/quizmill/pack-music-theory');
    const { getActivePackOverride } = await import('@/pack/runtime');

    const pack = getActivePackOverride();
    expect(pack?.assetsBase).toBe(
      'https://raw.githubusercontent.com/quizmill/pack-music-theory/HEAD/assets',
    );
    // Persisted, so future boots read it straight from storage.
    const stored = JSON.parse(window.localStorage.getItem(packKey)!);
    expect(stored.assetsBase).toBe(
      'https://raw.githubusercontent.com/quizmill/pack-music-theory/HEAD/assets',
    );
  });

  it('leaves a pack alone when the insert had no usable origin (picked files)', async () => {
    vi.resetModules();
    stubLibrary('pack.json, questions.json');
    const { getActivePackOverride } = await import('@/pack/runtime');

    expect(getActivePackOverride()?.assetsBase).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem(packKey)!).assetsBase).toBeUndefined();
  });

  it('never overwrites an assetsBase the pack already has', async () => {
    vi.resetModules();
    stubBrowser({
      entries: {
        'quizmill.activePackId': 'injected-pack',
        [packKey]: JSON.stringify({ ...INJECTED, assetsBase: 'https://cdn.example.com/a' }),
        'quizmill.packLibrary.index.v1': JSON.stringify([
          { id: 'injected-pack', title: 'Injected', origin: 'https://github.com/other/repo' },
        ]),
      },
    });
    const { getActivePackOverride } = await import('@/pack/runtime');
    expect(getActivePackOverride()?.assetsBase).toBe('https://cdn.example.com/a');
  });
});
