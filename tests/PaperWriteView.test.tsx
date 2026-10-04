// @vitest-environment happy-dom
//
// Writing on a sheet on screen, driven the way the page is used: open a
// sheet for writing, put ink on it with a mouse / finger / pencil, and
// come back to it later. happy-dom has no layout (every rect is zero),
// so client coordinates are taken as page coordinates — which is all
// these tests need; real geometry is covered end to end in
// tests/e2e-pack/paper.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PaperPage } from '@/pack/PaperPage';
import { packQuestions } from '@/pack/data';
import { savePaperSheet, type PaperSheet } from '@/pack/paper';
import { FINGER_WRITES_KEY, loadSheetInk, sheetInkKey } from '@/pack/paperInk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.restoreAllMocks();
});

async function unmount() {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function q(sel: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

const SHEET: PaperSheet = {
  id: 'sheet-on-screen',
  code: 'P-INKY',
  createdAt: Date.now() - 3_600_000,
  categoryKey: packQuestions[0].categoryKey,
  questionIds: packQuestions.slice(0, 3).map((p) => p.id),
};

/** Open the stored sheet straight on its write-on-screen view. */
async function openForWriting() {
  savePaperSheet(SHEET);
  window.location.hash = `#write=${SHEET.id}`;
  await act(async () => {
    root = createRoot(container);
    root.render(<PaperPage />);
  });
  await settle();
  return q('[data-testid="ink-surface"]');
}

let nextPointerId = 1;

async function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  opts: { pointerType?: string; pointerId: number },
) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerType: opts.pointerType ?? 'mouse',
        pointerId: opts.pointerId,
      }),
    );
  });
}

/** One stroke through the given points with one pointer. */
async function stroke(
  target: Element,
  points: [number, number][],
  pointerType = 'mouse',
  end: 'pointerup' | 'pointercancel' = 'pointerup',
) {
  const pointerId = nextPointerId++;
  const [first, ...rest] = points;
  await pointer(target, 'pointerdown', first[0], first[1], { pointerType, pointerId });
  for (const [x, y] of rest) {
    await pointer(target, 'pointermove', x, y, { pointerType, pointerId });
  }
  const last = points[points.length - 1];
  await pointer(target, end, last[0], last[1], { pointerType, pointerId });
}

const inkPaths = () => container.querySelectorAll('[data-testid="ink-stroke"]');

describe('writing on a sheet on screen', () => {
  it('opens the sheet as a page to write on, with the way to mark it at the foot', async () => {
    await openForWriting();
    const page = q('[data-testid="write-page"]');
    // The whole worksheet, roomier, and no answers anywhere.
    expect(page.querySelectorAll('[data-testid^="sheet-question-"]')).toHaveLength(3);
    expect(page.textContent).toContain(packQuestions[0].prompt.slice(0, 20));
    expect(page.querySelector('[data-testid="answer-box-1"]')).not.toBeNull();
    // Finished → the same QR a printout carries, plus marking right here.
    const finish = q('[data-testid="write-finish"]');
    await vi.waitFor(() => expect(finish.querySelector('svg')).not.toBeNull());
    expect(finish.textContent).toContain('P-INKY');
    expect(q('[data-testid="write-mark-here"]')).toBeDefined();
  });

  it('keeps what is written, across leaving and coming back', async () => {
    const surface = await openForWriting();
    await stroke(surface, [
      [100, 100],
      [110, 120],
      [125, 100],
    ]);
    await stroke(surface, [[300, 400]]); // a dot

    expect(inkPaths()).toHaveLength(2);
    expect(inkPaths()[0].getAttribute('d')).toMatch(/^M100 100Q110 120/);
    const stored = loadSheetInk(SHEET.id);
    expect(stored?.strokes.map((s) => s.p)).toEqual([
      [100, 100, 110, 120, 125, 100],
      [300, 400],
    ]);
    expect(stored?.w).toBeGreaterThan(0);

    // Done → back on the sheet, which now offers to carry on…
    await act(async () => {
      q('[data-testid="write-done"]').click();
    });
    await settle();
    expect(window.location.hash).toBe(`#sheet=${SHEET.id}`);
    expect(q('[data-testid="write-sheet"]').textContent).toContain('Continue on screen');

    // …and the ink is still there on return.
    await act(async () => {
      q('[data-testid="write-sheet"]').click();
    });
    await settle();
    expect(window.location.hash).toBe(`#write=${SHEET.id}`);
    expect(inkPaths()).toHaveLength(2);
  });

  it('writes in the chosen colour, undoes, and rubs out whole strokes', async () => {
    const surface = await openForWriting();
    await stroke(surface, [
      [10, 10],
      [60, 10],
    ]);
    await act(async () => {
      q('[data-testid="ink-color-2"]').click();
    });
    await stroke(surface, [
      [10, 200],
      [60, 200],
    ]);
    expect(inkPaths()[0].getAttribute('stroke')).not.toBe(
      inkPaths()[1].getAttribute('stroke'),
    );

    // Eraser: a rub across the second line takes all of it, and only it.
    await act(async () => {
      q('[data-testid="ink-eraser"]').click();
    });
    await stroke(surface, [
      [35, 180],
      [35, 205],
    ]);
    expect(inkPaths()).toHaveLength(1);
    expect(loadSheetInk(SHEET.id)?.strokes).toHaveLength(1);

    // Undo brings the rubbed-out line back; again takes it off; again
    // the first line too.
    const undo = q('[data-testid="ink-undo"]') as HTMLButtonElement;
    await act(async () => undo.click());
    expect(inkPaths()).toHaveLength(2);
    await act(async () => undo.click());
    await act(async () => undo.click());
    expect(inkPaths()).toHaveLength(0);
    expect(undo.disabled).toBe(true);
    // An empty sheet stores nothing.
    expect(localStorage.getItem(sheetInkKey(SHEET.id))).toBeNull();
  });

  it('lets a finger write until a pencil shows up, then leaves fingers to scroll', async () => {
    const surface = await openForWriting();
    expect(surface.style.touchAction).toBe('none');
    await stroke(surface, [[20, 20], [40, 40]], 'touch');
    expect(inkPaths()).toHaveLength(1);

    // First pencil contact: it writes, and fingers are handed to scrolling.
    await stroke(surface, [[100, 20], [120, 40]], 'pen');
    expect(inkPaths()).toHaveLength(2);
    expect(q('[data-testid="ink-finger"]').getAttribute('aria-pressed')).toBe('false');
    expect(surface.style.touchAction).toBe('pan-y pinch-zoom');
    expect(localStorage.getItem(FINGER_WRITES_KEY)).toBe('0');
    expect(q('[data-testid="ink-hint"]').textContent).toContain('Pencil spotted');

    await stroke(surface, [[200, 20], [220, 40]], 'touch');
    expect(inkPaths()).toHaveLength(2); // the finger scrolled; nothing drawn

    // The toggle hands writing back to the finger.
    await act(async () => {
      q('[data-testid="ink-finger"]').click();
    });
    await stroke(surface, [[200, 20], [220, 40]], 'touch');
    expect(inkPaths()).toHaveLength(3);
  });

  it('treats two fingers as a scroll, not as writing', async () => {
    const surface = await openForWriting();
    const scroller = q('[data-testid="write-scroller"]');
    scroller.scrollTop = 300;

    const first = { pointerType: 'touch', pointerId: 901 };
    const second = { pointerType: 'touch', pointerId: 902 };
    await pointer(surface, 'pointerdown', 100, 300, first);
    await pointer(surface, 'pointermove', 100, 296, first);
    await pointer(surface, 'pointerdown', 160, 300, second);
    // Both fingers drag down 40px → the page scrolls up by 40.
    await pointer(surface, 'pointermove', 100, 336, first);
    await pointer(surface, 'pointermove', 160, 340, second);
    await pointer(surface, 'pointerup', 100, 336, first);
    await pointer(surface, 'pointerup', 160, 340, second);

    expect(inkPaths()).toHaveLength(0);
    expect(scroller.scrollTop).toBe(260);
  });

  it('ignores a resting palm while the pencil is down', async () => {
    const surface = await openForWriting();
    // Fingers are writing (the default) — a palm would otherwise scribble.
    const pen = { pointerType: 'pen', pointerId: 950 };
    await pointer(surface, 'pointerdown', 50, 50, pen);
    await act(async () => {
      q('[data-testid="ink-finger"]').click(); // back to "finger writes"
    });
    await stroke(surface, [[400, 400], [420, 430]], 'touch'); // the palm
    await pointer(surface, 'pointermove', 70, 80, pen);
    await pointer(surface, 'pointerup', 70, 80, pen);
    expect(inkPaths()).toHaveLength(1);
    expect(inkPaths()[0].getAttribute('d')).toMatch(/^M50 50/);
  });

  it('forgets the ink when the sheet is deleted', async () => {
    const surface = await openForWriting();
    await stroke(surface, [[10, 10], [50, 50]]);
    expect(loadSheetInk(SHEET.id)).not.toBeNull();
    await act(async () => {
      q('[data-testid="write-done"]').click();
    });
    await settle();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      q('[aria-label="Delete sheet"]').click();
    });
    expect(loadSheetInk(SHEET.id)).toBeNull();
  });
});
