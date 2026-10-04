import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savePaperSheet, type PaperSheet } from '@/pack/paper';
import {
  addInkPoint,
  choosePageWidth,
  deleteSheetInk,
  eraseStrokesAt,
  hasSheetInk,
  loadFingerWrites,
  loadSheetInk,
  pageScale,
  pruneSheetInk,
  saveFingerWrites,
  saveSheetInk,
  sheetInkKey,
  strokePath,
  MAX_DISPLAY_WIDTH,
  MAX_PAGE_WIDTH,
  MIN_PAGE_WIDTH,
  type InkStroke,
} from '@/pack/paperInk';

function sheet(id: string): PaperSheet {
  return {
    id,
    code: 'P-TEST',
    createdAt: 1_700_000_000_000,
    categoryKey: 'planets',
    questionIds: ['q1'],
  };
}

const line = (p: number[], c = '#000'): InkStroke => ({ c, p });

describe('page geometry', () => {
  it('lays a fresh sheet out at the viewport width, within bounds', () => {
    expect(choosePageWidth(500)).toBe(500);
    expect(choosePageWidth(280)).toBe(MIN_PAGE_WIDTH); // small phone
    expect(choosePageWidth(1180)).toBe(MAX_PAGE_WIDTH); // landscape tablet
    expect(choosePageWidth(0)).toBe(MAX_PAGE_WIDTH); // not measured yet
  });

  it('scales a pinned layout to the space, never re-wrapping it', () => {
    expect(pageScale(500, 500)).toBe(1);
    // Written in portrait, turned to landscape: the same layout, bigger.
    expect(pageScale(760, 1180)).toBeCloseTo(MAX_DISPLAY_WIDTH / 760);
    // Written on a tablet, opened in a narrow window: the same layout, smaller.
    expect(pageScale(760, 380)).toBe(0.5);
    expect(pageScale(760, 0)).toBe(1);
  });
});

describe('addInkPoint', () => {
  it('rounds to a tenth of a pixel and drops near-duplicate samples', () => {
    const p: number[] = [];
    expect(addInkPoint(p, 10.04, 20.06)).toBe(true);
    expect(addInkPoint(p, 10.3, 20.2)).toBe(false); // a pencil's jitter
    expect(addInkPoint(p, 14.26, 20)).toBe(true);
    expect(p).toEqual([10, 20.1, 14.3, 20]);
  });
});

describe('strokePath', () => {
  it('renders a tap as a dot and two points as a segment', () => {
    expect(strokePath([])).toBe('');
    expect(strokePath([5, 6])).toBe('M5 6l0.01 0.01');
    expect(strokePath([0, 0, 10, 0])).toBe('M0 0L10 0');
  });

  it('curves through the midpoints of longer strokes', () => {
    // Samples become control points; the curve passes through midpoints
    // and still ends exactly where the pen lifted.
    expect(strokePath([0, 0, 10, 0, 10, 10, 20, 10])).toBe(
      'M0 0Q10 0 10 5Q10 10 15 10L20 10',
    );
  });
});

describe('eraseStrokesAt', () => {
  const a = line([0, 0, 100, 0]);
  const b = line([0, 50, 100, 50]);
  const dot = line([200, 200]);
  const strokes = [a, b, dot];

  it('rubs out whole strokes the eraser passes over', () => {
    // Between two far-apart samples of `a` — a hit on the segment, not
    // just on a recorded point.
    expect(eraseStrokesAt(strokes, 50, 4, 10)).toEqual([b, dot]);
    expect(eraseStrokesAt(strokes, 203, 203, 10)).toEqual([a, b]);
  });

  it('returns the SAME array when nothing was hit', () => {
    expect(eraseStrokesAt(strokes, 50, 25, 10)).toBe(strokes);
  });
});

describe('ink persistence', () => {
  let store: Map<string, string>;
  let quota = false;

  beforeEach(() => {
    store = new Map();
    quota = false;
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (quota) throw new Error('QuotaExceededError');
          store.set(k, v);
        },
        removeItem: (k: string) => void store.delete(k),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
      dispatchEvent: () => true,
    });
  });

  it('round-trips a sheet’s ink with the layout width it was written at', () => {
    const ink = { v: 1 as const, w: 744, strokes: [line([1, 2, 3, 4], '#2a5fc4')] };
    expect(saveSheetInk('s1', ink)).toBe(true);
    expect(loadSheetInk('s1')).toEqual(ink);
    expect(hasSheetInk('s1')).toBe(true);
    expect(hasSheetInk('other')).toBe(false);
  });

  it('stores nothing for an ink-free sheet', () => {
    saveSheetInk('s1', { v: 1, w: 744, strokes: [line([1, 2])] });
    saveSheetInk('s1', { v: 1, w: 744, strokes: [] });
    expect(store.has(sheetInkKey('s1'))).toBe(false);
    expect(loadSheetInk('s1')).toBeNull();
  });

  it('reports a refused write instead of throwing', () => {
    quota = true;
    expect(saveSheetInk('s1', { v: 1, w: 744, strokes: [line([1, 2])] })).toBe(false);
  });

  it('survives junk in storage, keeping only well-formed strokes', () => {
    store.set(sheetInkKey('s1'), '{not json');
    expect(loadSheetInk('s1')).toBeNull();
    store.set(sheetInkKey('s1'), JSON.stringify({ v: 1, w: 0, strokes: [] }));
    expect(loadSheetInk('s1')).toBeNull();
    store.set(
      sheetInkKey('s1'),
      JSON.stringify({
        v: 1,
        w: 700,
        strokes: [{ c: '#000', p: [1, 2, 3] }, { c: 7, p: [1, 2] }, { c: '#000', p: [1, 2] }],
      }),
    );
    expect(loadSheetInk('s1')?.strokes).toEqual([{ c: '#000', p: [1, 2] }]);
  });

  it('prunes ink whose sheet is gone, and deletes on request', () => {
    savePaperSheet(sheet('kept'));
    saveSheetInk('kept', { v: 1, w: 700, strokes: [line([1, 2])] });
    saveSheetInk('gone', { v: 1, w: 700, strokes: [line([1, 2])] });
    pruneSheetInk();
    expect(hasSheetInk('kept')).toBe(true);
    expect(hasSheetInk('gone')).toBe(false);
    deleteSheetInk('kept');
    expect(hasSheetInk('kept')).toBe(false);
  });

  it('defaults to a finger that writes, and remembers the choice', () => {
    expect(loadFingerWrites()).toBe(true);
    saveFingerWrites(false);
    expect(loadFingerWrites()).toBe(false);
    saveFingerWrites(true);
    expect(loadFingerWrites()).toBe(true);
  });
});
