import { describe, expect, it } from 'vitest';
import {
  builtinRegistry,
  loadRegistry,
  registryRepoUrl,
  REGISTRY_API_URL,
  REGISTRY_RAW_URL,
} from '@/lib/packRegistry';
import { resolvePackUrl } from '@/lib/packInsert';

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

  it('lists every published AWS cert pack', () => {
    const ids = builtinRegistry().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['aws-arch-pro', 'aws-genai', 'aws-saa', 'aws-clf', 'aws-aif']));
  });

  it('lists each pack once — ids and install sources (repo + path) are unique', () => {
    const packs = builtinRegistry();
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes(packs.map((p) => p.id))).toEqual([]);
    expect(dupes(packs.map((p) => registryRepoUrl(p)))).toEqual([]);
  });

  it('points the AWS packs at their directory in the shared repo', () => {
    const aws = builtinRegistry().filter((p) => p.id.startsWith('aws-'));
    expect(aws).toHaveLength(5);
    for (const p of aws) {
      expect(p).toMatchObject({ repo: 'quizmill/packs-aws', path: p.id });
    }
  });

  // `url` is read by the website's pack directory, not by the app, so it
  // is not on the listing type.
  it('links every AWS pack to its hosted app', () => {
    for (const p of builtinRegistry().filter((p) => p.id.startsWith('aws-'))) {
      expect(p).toMatchObject({ url: `https://${p.id}.quizmill.dev` });
    }
  });
});

describe('registryRepoUrl', () => {
  it('builds the GitHub URL fetchPackFromUrl already knows how to rewrite', () => {
    expect(
      registryRepoUrl({ id: 'x', title: 'X', description: '', repo: 'quizmill/pack-x' }),
    ).toBe('https://github.com/quizmill/pack-x');
  });

  it('points at the directory when the entry has a path', () => {
    const url = registryRepoUrl({
      id: 'aws-clf',
      title: 'X',
      description: '',
      repo: 'quizmill/packs-aws',
      path: 'aws-clf',
    });
    expect(url).toBe('https://github.com/quizmill/packs-aws/tree/HEAD/aws-clf');
    expect(resolvePackUrl(url)).toEqual({
      kind: 'dir',
      base: 'https://raw.githubusercontent.com/quizmill/packs-aws/HEAD/aws-clf',
    });
  });
});

describe('registry entries with a path', () => {
  const entry = (path: unknown) => ({ id: 'p', title: 'P', description: '', repo: 'a/b', path });
  const load = async (path: unknown) =>
    (await loadRegistry(fetchStub({ [REGISTRY_API_URL]: { packs: [entry('ok'), entry(path)] } })))
      .listings;

  it('keeps a well-formed path', async () => {
    const listings = await load('packs/deep-one');
    expect(listings.map((l) => l.path)).toEqual(['ok', 'packs/deep-one']);
  });

  it('drops an entry whose path is malformed or climbs out of the repo', async () => {
    for (const bad of ['../x', '/abs', 'a//b', 'a/../b', 'has space', '', 42, 'x?y=1']) {
      expect((await load(bad)).map((l) => l.path)).toEqual(['ok']);
    }
  });
});
