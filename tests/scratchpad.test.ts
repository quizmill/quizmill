import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEN_COLOR,
  EMPTY_SCRATCHPAD,
  normalizeScratchpad,
} from '@/lib/storage';

describe('normalizeScratchpad', () => {
  it('returns an empty pad for null / undefined / non-objects', () => {
    expect(normalizeScratchpad(null)).toEqual(EMPTY_SCRATCHPAD);
    expect(normalizeScratchpad(undefined)).toEqual(EMPTY_SCRATCHPAD);
    expect(normalizeScratchpad('nope')).toEqual(EMPTY_SCRATCHPAD);
    expect(normalizeScratchpad(42)).toEqual(EMPTY_SCRATCHPAD);
  });

  it('upgrades the pre-draw shape ({ text, open }) with draw defaults', () => {
    // What older builds wrote — no strokes, no mode, no colour.
    expect(normalizeScratchpad({ text: 'hi', open: true })).toEqual({
      text: 'hi',
      strokes: [],
      mode: 'write',
      color: DEFAULT_PEN_COLOR,
      open: true,
    });
  });

  it('preserves a full, valid pad', () => {
    const full = {
      text: 'note',
      strokes: [{ color: '#1c2029', points: [{ x: 0.1, y: 0.2 }] }],
      mode: 'draw' as const,
      color: '#3b78e0',
      open: true,
    };
    expect(normalizeScratchpad(full)).toEqual(full);
  });

  it('drops malformed strokes and keeps valid ones', () => {
    const out = normalizeScratchpad({
      strokes: [
        { color: '#fff', points: [{ x: 0, y: 0 }] }, // ok
        { color: 123, points: [] }, // bad colour
        { points: [{ x: 0, y: 0 }] }, // missing colour
        { color: '#000', points: [{ x: 'a', y: 0 }] }, // non-numeric point
        { color: '#000', points: [{ x: 0 }] }, // missing y
        'garbage',
        null,
      ],
    });
    expect(out.strokes).toHaveLength(1);
    expect(out.strokes[0].color).toBe('#fff');
  });

  it('defaults a missing or non-string colour', () => {
    expect(normalizeScratchpad({ color: 42 }).color).toBe(DEFAULT_PEN_COLOR);
    expect(normalizeScratchpad({}).color).toBe(DEFAULT_PEN_COLOR);
    expect(normalizeScratchpad({ color: '#abc' }).color).toBe('#abc');
  });

  it('coerces an unknown mode to write, but keeps draw', () => {
    expect(normalizeScratchpad({ mode: 'doodle' }).mode).toBe('write');
    expect(normalizeScratchpad({ mode: 'draw' }).mode).toBe('draw');
  });

  it('defaults a non-string text and a non-true open', () => {
    const out = normalizeScratchpad({ text: 99, open: 'yes' });
    expect(out.text).toBe('');
    expect(out.open).toBe(false);
  });
});
