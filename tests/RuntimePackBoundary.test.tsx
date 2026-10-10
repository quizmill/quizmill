// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import type { ActivePack } from '@/pack/runtime';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The boundary decides from `isRuntimePack` in src/pack/source.ts, which is
 * fixed at module evaluation — so each case re-imports it against the global
 * it wants (the same trick as tests/runtime-pack.test.ts). "Server" = an
 * import with no override, rendered to a string; "client" = a fresh import
 * after the bootstrap has set `__QUIZMILL_PACK__`, hydrated over that string.
 */

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
  questions: [],
};

/** What the static build prerendered — the build-time pack's page. */
function BuildTimePage() {
  return (
    <main>
      <h1>Solar System</h1>
      <p>0 of 18 available</p>
      <a href="/practice/?subject=planets">Planets</a>
      <a href="/practice/?subject=stars">Stars</a>
    </main>
  );
}

/** What the client renders once the runtime pack is active — different
 *  text AND a different tree shape (one card, not two). */
function RuntimePage() {
  return (
    <main>
      <h1>Injected Pack</h1>
      <p>0 of 1 available</p>
      <a href="/practice/?subject=basics">Basics</a>
    </main>
  );
}

async function loadBoundary() {
  const mod = await import('@/components/RuntimePackBoundary');
  return mod.RuntimePackBoundary;
}

let container: HTMLDivElement;
let root: Root | undefined;
let recoverable: unknown[];
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  recoverable = [];
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => {
      r.unmount();
    });
    root = undefined;
  }
  container.remove();
  errorSpy.mockRestore();
  globalThis.__QUIZMILL_PACK__ = undefined;
  vi.resetModules();
});

/** Prerender `page` with no runtime pack, as the static build does. */
async function prerender(page: React.ReactElement): Promise<void> {
  vi.resetModules();
  globalThis.__QUIZMILL_PACK__ = undefined;
  const Boundary = await loadBoundary();
  container.innerHTML = renderToString(<Boundary>{page}</Boundary>);
}

/** Hydrate `page` over whatever is in the container, with the given pack
 *  (or none) already swapped in by the bootstrap. */
async function hydrate(page: React.ReactElement, pack: ActivePack | undefined): Promise<void> {
  vi.resetModules();
  globalThis.__QUIZMILL_PACK__ = pack;
  const Boundary = await loadBoundary();
  await act(async () => {
    root = hydrateRoot(container, <Boundary>{page}</Boundary>, {
      onRecoverableError: (e) => recoverable.push(e),
    });
  });
  // Let the layout effect's swap settle.
  await act(async () => {});
}

describe('RuntimePackBoundary', () => {
  it('reports a genuine mismatch when no runtime pack explains it (control)', async () => {
    // Without a runtime pack the boundary must stay out of the way — so a
    // server/client disagreement is still React's error to report. This is
    // what the two cases below would look like without the guard.
    await prerender(<BuildTimePage />);
    await hydrate(<RuntimePage />, undefined);

    expect(recoverable.length).toBeGreaterThan(0);
    expect(String(recoverable[0])).toMatch(/hydrat/i);
  });

  it('hydrates the build-time pack in place, untouched', async () => {
    await prerender(<BuildTimePage />);
    const prerenderedH1 = container.querySelector('h1');
    await hydrate(<BuildTimePage />, undefined);

    expect(recoverable).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    // Same DOM node — hydrated, not re-created.
    expect(container.querySelector('h1')).toBe(prerenderedH1);
    expect(container.querySelector('h1')?.textContent).toBe('Solar System');
  });

  it('adopts the prerendered markup for hydration, then renders the runtime pack', async () => {
    await prerender(<BuildTimePage />);
    await hydrate(<RuntimePage />, INJECTED);

    // No hydration error even though title, counts and the number of cards
    // all differ…
    expect(recoverable).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    // …and the live tree is the runtime pack's, not the prerendered one.
    expect(container.querySelector('h1')?.textContent).toBe('Injected Pack');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.textContent).not.toContain('Solar System');
  });

  it('renders the runtime pack on a client-only mount too (nothing prerendered)', async () => {
    // Belt and braces: with no server markup to adopt there is nothing to
    // hydrate against, and the live tree must still appear.
    vi.resetModules();
    globalThis.__QUIZMILL_PACK__ = INJECTED;
    const Boundary = await loadBoundary();
    const { createRoot } = await import('react-dom/client');
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Boundary>
          <RuntimePage />
        </Boundary>,
      );
    });
    await act(async () => {});

    expect(errorSpy).not.toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('Injected Pack');
  });
});
