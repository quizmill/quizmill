import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivePack } from '@/pack/runtime';

// `source.ts` reads the runtime override once, at module evaluation. To
// exercise both branches we reset the module registry between cases so the
// next `import('@/pack/source')` re-evaluates against the current global.

const INJECTED: ActivePack = {
  manifest: {
    schemaVersion: 1,
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
  vi.resetModules();
});

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
