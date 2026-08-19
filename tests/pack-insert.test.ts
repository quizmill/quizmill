import { describe, expect, it } from 'vitest';
import {
  fetchPackFromUrl,
  parsePackFiles,
  resolvePackUrl,
} from '@/lib/packInsert';

const MANIFEST = { id: 'x', title: 'X' };
const QUESTIONS = [{ id: 'q1' }];

describe('parsePackFiles', () => {
  it('accepts a single bundle file with manifest + questions', () => {
    const out = parsePackFiles([
      { name: 'my-pack.json', text: JSON.stringify({ manifest: MANIFEST, questions: QUESTIONS }) },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.candidate.manifest).toEqual(MANIFEST);
  });

  it('assembles pack files picked together, optional files included', () => {
    const out = parsePackFiles([
      { name: 'pack.json', text: JSON.stringify(MANIFEST) },
      { name: 'questions.json', text: JSON.stringify(QUESTIONS) },
      { name: 'scenarios.json', text: '[]' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.candidate.questions).toEqual(QUESTIONS);
      expect(out.candidate.scenarios).toEqual([]);
      expect(out.candidate.concepts).toBeUndefined();
    }
  });

  it('matches the standard file names case-insensitively', () => {
    const out = parsePackFiles([
      { name: 'Pack.JSON', text: JSON.stringify(MANIFEST) },
      { name: 'Questions.json', text: JSON.stringify(QUESTIONS) },
    ]);
    expect(out.ok).toBe(true);
  });

  it('explains what to select when required files are missing', () => {
    const out = parsePackFiles([{ name: 'pack.json', text: JSON.stringify(MANIFEST) }]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toContain('questions.json');
  });

  it('reports the file that is not valid JSON', () => {
    const out = parsePackFiles([
      { name: 'pack.json', text: '{oops' },
      { name: 'questions.json', text: JSON.stringify(QUESTIONS) },
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toContain('pack.json');
  });
});

describe('resolvePackUrl', () => {
  it('rewrites a GitHub repo URL to raw.githubusercontent.com', () => {
    expect(resolvePackUrl('https://github.com/quizmill/pack-world-capitals')).toEqual({
      kind: 'dir',
      base: 'https://raw.githubusercontent.com/quizmill/pack-world-capitals/HEAD',
    });
  });

  it('keeps the branch and path of a GitHub tree URL', () => {
    expect(
      resolvePackUrl('https://github.com/o/r/tree/main/packs/one/'),
    ).toEqual({ kind: 'dir', base: 'https://raw.githubusercontent.com/o/r/main/packs/one' });
  });

  it('treats a .json URL as a bundle and anything else as a directory', () => {
    expect(resolvePackUrl('https://example.com/pack-bundle.json')).toEqual({
      kind: 'bundle',
      url: 'https://example.com/pack-bundle.json',
    });
    expect(resolvePackUrl('https://example.com/packs/capitals/')).toEqual({
      kind: 'dir',
      base: 'https://example.com/packs/capitals',
    });
  });

  it('rejects non-http input', () => {
    expect(resolvePackUrl('ftp://x')).toBeNull();
    expect(resolvePackUrl('quizmill/pack')).toBeNull();
  });
});

describe('fetchPackFromUrl', () => {
  function fakeFetch(routes: Record<string, unknown>): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url in routes) {
        return new Response(JSON.stringify(routes[url]), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
  }

  it('fetches a pack directory, omitting optional files that 404', async () => {
    const out = await fetchPackFromUrl(
      'https://example.com/pack',
      fakeFetch({
        'https://example.com/pack/pack.json': MANIFEST,
        'https://example.com/pack/questions.json': QUESTIONS,
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.candidate.manifest).toEqual(MANIFEST);
      expect(out.candidate.scenarios).toBeUndefined();
    }
  });

  it('errors when a required file is missing', async () => {
    const out = await fetchPackFromUrl(
      'https://example.com/pack',
      fakeFetch({ 'https://example.com/pack/pack.json': MANIFEST }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toContain('questions.json');
  });

  it('fetches a bundle URL and checks its shape', async () => {
    const ok = await fetchPackFromUrl(
      'https://example.com/bundle.json',
      fakeFetch({ 'https://example.com/bundle.json': { manifest: MANIFEST, questions: QUESTIONS } }),
    );
    expect(ok.ok).toBe(true);

    const bad = await fetchPackFromUrl(
      'https://example.com/bundle.json',
      fakeFetch({ 'https://example.com/bundle.json': { nope: true } }),
    );
    expect(bad.ok).toBe(false);
  });

  it('guides the user on unusable input', async () => {
    const out = await fetchPackFromUrl('not a url');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toContain('http');
  });
});
