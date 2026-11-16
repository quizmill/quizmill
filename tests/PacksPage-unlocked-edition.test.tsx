// @vitest-environment happy-dom
/**
 * The shelf with the built-in pack's unlocked edition in place (one pack
 * id, two editions — src/lib/packLibrary.ts): ONE card for the id, marked
 * Unlocked and showing the fuller edition's counts, with a way back to
 * the built-in edition that keeps progress and the licence key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PacksPage } from '@/components/PacksPage';
import { ACTIVE_PACK_ID_KEY, insertedPackKey } from '@/lib/packKeys';
import { insertPack, listInsertedPacks } from '@/lib/packLibrary';
import { licenceKeyStorageKey } from '@/lib/unlock';
import { buildTimeManifest, buildTimeQuestionCount } from '@/pack/source';

vi.mock('@/lib/packRegistry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/packRegistry')>();
  return { ...mod, loadRegistry: vi.fn(async () => ({ source: 'builtin', listings: [] })) };
});
vi.mock('@/lib/packAssets', () => ({
  cachePackAssets: vi.fn(async () => ({ total: 0, cached: 0 })),
  dropPackAssets: vi.fn(async () => undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUILD = buildTimeManifest.id;
const FULL_COUNT = buildTimeQuestionCount + 6;
const ATTEMPTS_KEY = `quizmill.${BUILD}.attempts.v1`;
const ATTEMPTS = JSON.stringify([
  { id: 'a1', questionId: 'demo-planets-001', sessionId: 's1', isCorrect: true, answeredAt: 1 },
]);

function bundle(id: string, n: number) {
  return {
    manifest: {
      schemaVersion: 2,
      id,
      title: 'Solar System Practice',
      description: 'The fuller edition a licence key unlocks.',
      homeSubtitle: 'Every planet, every moon.',
      themeColor: '#123456',
      categories: [{ key: 'planets', label: 'Planets' }],
    },
    questions: Array.from({ length: n }, (_, i) => ({
      id: `${id}-planets-${String(i + 1).padStart(3, '0')}`,
      categoryKey: 'planets',
      difficulty: 1,
      prompt: `Question ${i + 1}: which planet is the largest?`,
      options: [
        { key: 'A', text: 'Jupiter' },
        { key: 'B', text: 'Mars' },
      ],
      correctKey: 'A',
      explanation: 'Jupiter is the largest planet in the solar system by far.',
      source: 'original',
      reviewStatus: 'draft',
    })),
  };
}

let container: HTMLDivElement;
let root: Root | undefined;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/packs/', search: '', reload },
  });
  localStorage.setItem(ATTEMPTS_KEY, ATTEMPTS);
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

function seedUnlocked() {
  const r = insertPack(bundle(BUILD, FULL_COUNT), {
    origin: 'licence key · unlock.test',
    buildPackId: BUILD,
    unlockUrl: 'https://unlock.test',
    unlocked: true,
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  localStorage.setItem(licenceKeyStorageKey(BUILD), 'QL-AAAA-BBBB-CCCC');
}

function cards(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="pack-card-${BUILD}"]`));
}

describe('PacksPage — the built-in pack’s unlocked edition', () => {
  it('without one: the built-in card as ever — no badge, nothing to remove', async () => {
    await render();
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain(`${buildTimeQuestionCount} questions`);
    expect(container.querySelector('[data-testid="unlocked-pack-badge"]')).toBeNull();
    expect(container.querySelector(`[data-testid="eject-${BUILD}"]`)).toBeNull();
  });

  it('shows one card for the id: Built in, Unlocked, the fuller count, the key and the progress', async () => {
    seedUnlocked();
    await render();
    expect(cards()).toHaveLength(1);
    const card = cards()[0];
    expect(card.textContent).toContain('Built in');
    expect(card.querySelector('[data-testid="unlocked-pack-badge"]')?.textContent).toBe('Unlocked');
    expect(card.querySelector('[data-testid="active-pack-badge"]')).toBeTruthy();
    expect(card.textContent).toContain(`${FULL_COUNT} questions`);
    expect(card.textContent).toContain('1 answer');
    expect(card.querySelector('[data-testid="pack-licence-key"]')?.textContent).toContain('QL-····-····-····');
    expect(card.querySelector(`[data-testid="eject-${BUILD}"]`)?.textContent).toContain(
      'Remove unlocked edition',
    );
  });

  it('removing it reloads into the built-in edition, with progress and the key kept', async () => {
    seedUnlocked();
    // On screen through the fallback: no pointer names it.
    expect(localStorage.getItem(ACTIVE_PACK_ID_KEY)).toBeNull();
    // happy-dom has no confirm() of its own.
    const confirm = vi.fn<(message?: string) => boolean>(() => true);
    window.confirm = confirm;
    await render();
    await act(async () => {
      container
        .querySelector(`[data-testid="eject-${BUILD}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(confirm.mock.calls[0][0]).toContain(`${buildTimeQuestionCount} questions`);
    expect(confirm.mock.calls[0][0]).toContain('progress');
    expect(listInsertedPacks()).toEqual([]);
    expect(localStorage.getItem(insertedPackKey(BUILD))).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(ATTEMPTS_KEY)).toBe(ATTEMPTS);
    expect(localStorage.getItem(licenceKeyStorageKey(BUILD))).toBe('QL-AAAA-BBBB-CCCC');
  });

  it('declining the confirmation changes nothing', async () => {
    seedUnlocked();
    window.confirm = vi.fn(() => false);
    await render();
    await act(async () => {
      container
        .querySelector(`[data-testid="eject-${BUILD}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(listInsertedPacks()).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
