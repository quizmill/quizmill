// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PacksPage } from '@/components/PacksPage';
import { ACTIVE_PACK_ID_KEY } from '@/lib/packKeys';

// The registry browser fetches on mount and the insert prefetches images —
// neither is under test here, and neither may touch the network.
vi.mock('@/lib/packRegistry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/packRegistry')>();
  return {
    ...mod,
    loadRegistry: vi.fn(async () => ({ source: 'builtin', listings: [] })),
  };
});
// The image prefetch is a spy so a test can hold one insert's prefetch open
// past the next insert.
const cachePackAssets = vi.hoisted(() =>
  vi.fn<() => Promise<{ total: number; cached: number }>>(async () => ({ total: 0, cached: 0 })),
);
vi.mock('@/lib/packAssets', () => ({ cachePackAssets }));
// The URL path is only ever asserted NOT to run here (it must never touch
// the network), so the fetch is a spy that would hang if it were called.
const fetchPackFromUrl = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<never>>(() => new Promise<never>(() => {})),
);
vi.mock('@/lib/packInsert', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/packInsert')>();
  return { ...mod, fetchPackFromUrl };
});

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The feedback a file insert gives WHERE THE USER IS. The Insert card is
 * the last thing on /packs, so on a laptop the picker is used scrolled to
 * the bottom: a confirmation rendered at the top of the page is invisible,
 * and the natural reaction is to pick the file again (a double insert).
 * The result therefore renders inside the card itself, scrolls into view,
 * and carries the one action that matters next — Make active.
 */

/** A minimal valid v2 pack, as a single bundle file. */
function bundleJson(id = 'fixture-pack', title = 'Fixture Pack'): string {
  const question = (n: number) => ({
    id: `${id}-shapes-00${n}`,
    categoryKey: 'shapes',
    difficulty: 1,
    prompt: `Fixture question ${n}: which of these is a square?`,
    options: [
      { key: 'A', text: 'The one with four equal sides' },
      { key: 'B', text: 'The round one' },
    ],
    correctKey: 'A',
    explanation: 'A square has four equal sides and four right angles.',
    source: 'original',
    reviewStatus: 'draft',
  });
  return JSON.stringify({
    manifest: {
      schemaVersion: 2,
      id,
      title,
      description: 'A fixture pack for the insert feedback tests.',
      homeSubtitle: 'Fixture.',
      themeColor: '#123456',
      categories: [{ key: 'shapes', label: 'Shapes' }],
    },
    questions: [question(1), question(2)],
  });
}

let container: HTMLDivElement;
let root: Root | undefined;
let scrollIntoView: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  // happy-dom implements neither; stub both so the component's calls are
  // observable rather than fatal.
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/packs/', search: '', reload },
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PacksPage />);
  });
  await act(async () => {});
}

function fileInput(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('[data-testid="insert-files"]');
  if (!el) throw new Error('no file input');
  return el;
}

function insertCard(): HTMLElement {
  const h2 = Array.from(container.querySelectorAll('h2')).find((h) =>
    h.textContent?.includes('Insert a pack'),
  );
  const section = h2?.closest('section');
  if (!section) throw new Error('no Insert a pack card');
  return section;
}

function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find((x) =>
    x.textContent?.includes(text),
  );
  if (!b) throw new Error(`no button "${text}"`);
  return b;
}

/** Hand the picker a file, as the OS dialog would. `text` can be deferred
 *  to hold the component in its reading state. */
async function pickFile(text: () => Promise<string>, name = 'fixture.bundle.json') {
  const input = fileInput();
  const file = new File(['-'], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: text });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('PacksPage insert feedback', () => {
  it('shows the result inside the Insert card, scrolled into view, with Make active', async () => {
    await render();
    await pickFile(async () => bundleJson());
    await act(async () => {});

    const result = insertCard().querySelector<HTMLElement>('[data-testid="insert-result"]');
    expect(result, 'result panel inside the Insert card').toBeTruthy();
    expect(result!.textContent).toContain('Inserted “Fixture Pack” (2 questions)');
    // Nothing at the top of the page any more — that was the invisible one.
    expect(container.querySelector('[data-testid="packs-message"]')).toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.instances).toContain(result);

    // The pack is on the shelf too, with its own Make active.
    expect(container.querySelector('[data-testid="pack-card-fixture-pack"]')).toBeTruthy();

    // Activating from the panel is the real thing: pointer written, reload.
    const activate = result!.querySelector<HTMLButtonElement>(
      '[data-testid="insert-result-activate"]',
    );
    expect(activate).toBeTruthy();
    await act(async () => {
      activate!.click();
    });
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBe('fixture-pack');
    expect(reload).toHaveBeenCalled();
  });

  it('says it is reading while the file is read, then returns to Choose files…', async () => {
    await render();
    let release!: (text: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    await pickFile(() => pending);

    const reading = button('Reading…');
    expect(reading.disabled).toBe(true);
    expect(button('Fetch').disabled).toBe(true);
    expect(() => button('Choose files…')).toThrow();

    await act(async () => {
      release(bundleJson());
    });
    await act(async () => {});
    expect(button('Choose files…').disabled).toBe(false);
    expect(() => button('Reading…')).toThrow();
    expect(insertCard().textContent).toContain('Inserted “Fixture Pack”');
  });

  it('keeps the result until the next pick, so a second pick is a choice, not a retry', async () => {
    await render();
    await pickFile(async () => bundleJson());
    await act(async () => {});
    expect(insertCard().querySelector('[data-testid="insert-result"]')).toBeTruthy();

    // "Not now" clears it without activating anything.
    await act(async () => {
      button('Not now').click();
    });
    expect(insertCard().querySelector('[data-testid="insert-result"]')).toBeNull();
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('puts a failed insert in the same place, scrolled into view', async () => {
    await render();
    await pickFile(async () => '{"manifest":{},"questions":[]}');
    await act(async () => {});
    const errors = insertCard().querySelector<HTMLElement>('[data-testid="insert-errors"]');
    expect(errors).toBeTruthy();
    expect(scrollIntoView.mock.instances).toContain(errors);
    expect(insertCard().querySelector('[data-testid="insert-result"]')).toBeNull();
  });

  it('clears the previous errors as soon as the next insert starts', async () => {
    await render();
    await pickFile(async () => '{"manifest":{},"questions":[]}');
    await act(async () => {});
    expect(insertCard().querySelector('[data-testid="insert-errors"]')).toBeTruthy();

    // The next pick is still being read: the old failure must not sit under
    // "Reading…" as if it were this file's verdict.
    let release!: (text: string) => void;
    await pickFile(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    expect(button('Reading…').disabled).toBe(true);
    expect(insertCard().querySelector('[data-testid="insert-errors"]')).toBeNull();

    await act(async () => {
      release(bundleJson());
    });
    await act(async () => {});
    expect(insertCard().querySelector('[data-testid="insert-result"]')).toBeTruthy();
    expect(insertCard().querySelector('[data-testid="insert-errors"]')).toBeNull();
  });

  it('lets only an insert’s own image prefetch annotate its result', async () => {
    await render();
    // The first insert's prefetch is slow…
    let releaseFirst!: (r: { total: number; cached: number }) => void;
    cachePackAssets.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    await pickFile(async () => bundleJson());
    await act(async () => {});
    expect(insertCard().textContent).toContain('Inserted “Fixture Pack”');

    // …and the same pack is re-inserted (its update path) before it resolves.
    // This bundle has no images, so its own prefetch has nothing to report.
    await pickFile(async () => bundleJson('fixture-pack', 'Fixture Pack v2'), 'v2.json');
    await act(async () => {});
    expect(insertCard().textContent).toContain('Inserted “Fixture Pack v2”');
    expect(cachePackAssets).toHaveBeenCalledTimes(2);

    // The stale prefetch must not describe the newer insert.
    await act(async () => {
      releaseFirst({ total: 2, cached: 2 });
    });
    await act(async () => {});
    expect(insertCard().textContent).toContain('Inserted “Fixture Pack v2”');
    expect(insertCard().textContent).not.toContain('images saved');
  });

  it('ignores Enter in the URL field while another insert is busy', async () => {
    await render();
    let release!: (text: string) => void;
    await pickFile(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    expect(button('Reading…').disabled).toBe(true);

    const urlInput = container.querySelector<HTMLInputElement>('[data-testid="insert-url"]');
    if (!urlInput) throw new Error('no url input');
    const pressEnter = () =>
      act(async () => {
        urlInput.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
      });
    await act(async () => {
      // Through the prototype setter: React's value tracker swallows a change
      // made through the element's own property.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        urlInput,
        'https://github.com/you/your-pack',
      );
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pressEnter();
    // The Fetch button is disabled; Enter must honour the same guard.
    expect(fetchPackFromUrl).not.toHaveBeenCalled();
    expect(button('Reading…').disabled).toBe(true);

    await act(async () => {
      release(bundleJson());
    });
    await act(async () => {});
    expect(insertCard().querySelector('[data-testid="insert-result"]')).toBeTruthy();
    // Nothing started once the file finished either — Enter was dropped, not queued.
    expect(fetchPackFromUrl).not.toHaveBeenCalled();

    // Control: the same keypress on an idle card does start the fetch, so the
    // assertions above tested the guard and not a dead key handler.
    await pressEnter();
    expect(fetchPackFromUrl).toHaveBeenCalledTimes(1);
    expect(fetchPackFromUrl).toHaveBeenCalledWith('https://github.com/you/your-pack');
    expect(button('Fetching…').disabled).toBe(true);
  });
});

/**
 * A pack unlocked with a licence key keeps the key for its update check;
 * the shelf hands it back (masked, then revealed and copied) so the same
 * pack can be unlocked on a second device without hunting for the link.
 */
describe('PacksPage licence key line', () => {
  async function insertFixture(id: string) {
    await pickFile(async () => bundleJson(id, id), `${id}.json`);
    await act(async () => {});
  }

  function card(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-testid="pack-card-${id}"]`);
    if (!el) throw new Error(`no pack card ${id}`);
    return el;
  }

  it('shows the stored key masked, and reveals and copies it on tap', async () => {
    localStorage.setItem('quizmill.keyed-pack.licence', 'QL-AB12-CD34-EF56');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render();
    await insertFixture('keyed-pack');

    const line = card('keyed-pack').querySelector<HTMLElement>('[data-testid="pack-licence-key"]');
    expect(line, 'licence key line').toBeTruthy();
    expect(line!.textContent).toContain('Licence key');
    expect(line!.textContent).toContain('QL-····-····-····');
    expect(line!.textContent).not.toContain('AB12');

    const reveal = line!.querySelector<HTMLButtonElement>('[data-testid="pack-licence-key-copy"]');
    expect(reveal).toBeTruthy();
    await act(async () => {
      reveal!.click();
    });
    expect(line!.textContent).toContain('QL-AB12-CD34-EF56');
    expect(writeText).toHaveBeenCalledWith('QL-AB12-CD34-EF56');
    expect(line!.textContent).toContain('Copied');
  });

  it('shows no key line for a pack held without a key', async () => {
    await render();
    await insertFixture('plain-pack');
    expect(card('plain-pack').querySelector('[data-testid="pack-licence-key"]')).toBeNull();
    expect(container.querySelector('[data-testid="pack-licence-key"]')).toBeNull();
  });
});
