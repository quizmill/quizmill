import { describe, expect, it } from 'vitest';
import registry from '../tools/pack/registry.json';
import { validateRegistry } from '../tools/pack/registrySchema';
import { builtinRegistry } from '../src/lib/packRegistry';

/** A minimal well-formed entry, for building deliberately-broken registries. */
function entry(id: string, repo = `quizmill/pack-${id}`) {
  return { id, title: `Pack ${id}`, description: 'A pack.', repo };
}

describe('the published registry', () => {
  it('is valid and lists every pack exactly once', () => {
    const packs = validateRegistry(registry);
    expect(packs.length).toBeGreaterThan(0);
    expect(new Set(packs.map((p) => p.id)).size).toBe(packs.length);
  });

  it('points every demoUrl at the pack\'s own canonical subdomain', () => {
    for (const p of validateRegistry(registry)) {
      if (p.demoUrl) expect(p.demoUrl).toBe(`https://${p.id}.quizmill.dev`);
    }
  });
});

describe('validateRegistry', () => {
  // The regression this guard exists for: two branches each append an entry
  // for the same pack. Git merges both without a conflict, and the registry
  // silently lists the pack twice.
  it('rejects a duplicate id', () => {
    const doubled = { packs: [entry('aws-arch-pro'), entry('claude-cert'), entry('aws-arch-pro')] };
    expect(() => validateRegistry(doubled)).toThrow(/id "aws-arch-pro" appears 2 times/);
  });

  it('rejects two ids pointing at one repo', () => {
    const shared = {
      packs: [entry('a', 'quizmill/pack-x'), entry('b', 'quizmill/pack-x')],
    };
    expect(() => validateRegistry(shared)).toThrow(/repo "quizmill\/pack-x" appears 2 times/);
  });

  it('rejects an unknown field so metadata typos surface', () => {
    const typo = { packs: [{ ...entry('a'), demoURL: 'https://example.com' }] };
    expect(() => validateRegistry(typo)).toThrow(/invalid registry/);
  });

  it('rejects a malformed repo and a bad status', () => {
    expect(() => validateRegistry({ packs: [entry('a', 'not-a-repo')] })).toThrow(/invalid registry/);
    expect(() =>
      validateRegistry({ packs: [{ ...entry('a'), status: 'excellent' }] }),
    ).toThrow(/invalid registry/);
  });

  it('accepts the optional community metadata', () => {
    const rich = {
      packs: [
        {
          ...entry('a'),
          status: 'draft',
          badges: ['exam-pack', 'live-demo'],
          demoUrl: 'https://a.quizmill.dev',
          questionCount: 42,
        },
      ],
    };
    expect(validateRegistry(rich)[0].questionCount).toBe(42);
  });
});

describe('builtinRegistry', () => {
  it('collapses duplicate ids rather than rendering a pack twice', () => {
    const ids = builtinRegistry().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
