import { describe, expect, it } from 'vitest';
import {
  builtinRegistry,
  loadRegistry,
  registryRepoUrl,
  REGISTRY_API_URL,
  REGISTRY_RAW_URL,
} from '@/lib/packRegistry';

const API_LISTING = {
  packs: [
    {
      id: 'world-capitals',
      title: 'Capitals of the World',
      description: 'Expert-level capitals.',
      repo: 'quizmill/pack-world-capitals',
      themeColor: '#0f766e',
      questionCount: 45,
      categories: [{ key: 'africa', label: 'Africa' }],
    },
  ],
};

function fetchStub(routes: Record<string, unknown | number>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes[url];
    if (hit === undefined) throw new Error(`network down for ${url}`);
    if (typeof hit === 'number') return new Response('err', { status: hit });
    return new Response(JSON.stringify(hit), { status: 200 });
  }) as typeof fetch;
}

describe('loadRegistry source chain', () => {
  it('prefers the website API and keeps its enrichment', async () => {
    const { listings, source } = await loadRegistry(
      fetchStub({ [REGISTRY_API_URL]: API_LISTING }),
    );
    expect(source).toBe('api');
    expect(listings[0]).toMatchObject({ questionCount: 45, themeColor: '#0f766e' });
  });

  it('falls back to the raw GitHub registry when the API is down', async () => {
    const { listings, source } = await loadRegistry(
      fetchStub({
        [REGISTRY_API_URL]: 502,
        [REGISTRY_RAW_URL]: {
          packs: [
            { id: 'x', title: 'X Pack', description: 'd', repo: 'quizmill/pack-x' },
          ],
        },
      }),
    );
    expect(source).toBe('raw');
    expect(listings).toHaveLength(1);
    expect(listings[0].questionCount).toBeUndefined();
  });

  it('falls back to the baked registry when fully offline — never throws', async () => {
    const { listings, source } = await loadRegistry(fetchStub({}));
    expect(source).toBe('builtin');
    expect(listings.length).toBeGreaterThan(0);
    expect(listings).toEqual(builtinRegistry());
  });

  it('filters malformed entries instead of failing the listing', async () => {
    const { listings } = await loadRegistry(
      fetchStub({
        [REGISTRY_API_URL]: {
          packs: [
            { id: 'ok', title: 'OK', description: '', repo: 'a/b' },
            { id: 'bad-repo', title: 'Bad', description: '', repo: 'not a repo!' },
            { title: 'no id', repo: 'a/c' },
            null,
          ],
        },
      }),
    );
    expect(listings.map((l) => l.id)).toEqual(['ok']);
  });
});

describe('builtinRegistry', () => {
  it('ships the committed registry with the build', () => {
    const ids = builtinRegistry().map((p) => p.id);
    expect(ids).toContain('world-capitals');
    expect(ids).toContain('claude-cert');
  });
});

describe('registryRepoUrl', () => {
  it('builds the GitHub URL fetchPackFromUrl already knows how to rewrite', () => {
    expect(
      registryRepoUrl({ id: 'x', title: 'X', description: '', repo: 'quizmill/pack-x' }),
    ).toBe('https://github.com/quizmill/pack-x');
  });
});
