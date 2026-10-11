import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Poster look restyles every "raised" surface through ONE CSS hook
 * on the shadow utility that Card / Button / toggles share
 * (`:root[data-look='poster'] .shadow-…` in globals.css). Tailwind
 * renames its shadow scale between majors (v3 `shadow-sm` became v4
 * `shadow-xs`), and a codemod rewrites the templates but not a
 * hand-written selector — so pin the two together: the class the hook
 * targets must be the class the raised components actually carry.
 */
const css = readFileSync('src/app/globals.css', 'utf8');

function posterHookClass(): string {
  const m = css.match(/:root\[data-look='poster'\]\s+\.(shadow-[a-z0-9]+)\s*\{/);
  if (!m) throw new Error('poster slab hook not found in globals.css');
  return m[1];
}

describe('poster look slab hook', () => {
  const hook = posterHookClass();

  it.each(['src/components/ui/Card.tsx', 'src/components/ui/Button.tsx'])(
    'targets the shadow utility %s uses',
    (file) => {
      const source = readFileSync(file, 'utf8');
      const shadows = [...source.matchAll(/\bshadow-[a-z0-9]+\b/g)].map((m) => m[0]);
      expect(shadows.length).toBeGreaterThan(0);
      expect(shadows).toContain(hook);
    },
  );
});
