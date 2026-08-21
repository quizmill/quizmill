/** The visual-look preference (Poster / Classic) — mirrors theme.test.
 * .tsx so it runs on happy-dom (vitest environmentMatchGlobs). */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyLook,
  loadLookPref,
  LOOK_KEY,
  resolveLook,
  saveLookPref,
} from '@/lib/look';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-look');
});

describe('loadLookPref', () => {
  it("defaults to 'pack' (follow the pack manifest)", () => {
    expect(loadLookPref()).toBe('pack');
  });

  it('reads a pinned choice and ignores junk', () => {
    window.localStorage.setItem(LOOK_KEY, 'poster');
    expect(loadLookPref()).toBe('poster');
    window.localStorage.setItem(LOOK_KEY, 'sparkly');
    expect(loadLookPref()).toBe('pack');
  });
});

describe('saveLookPref', () => {
  it("stores pins and clears the key for 'pack'", () => {
    saveLookPref('poster');
    expect(window.localStorage.getItem(LOOK_KEY)).toBe('poster');
    saveLookPref('pack');
    expect(window.localStorage.getItem(LOOK_KEY)).toBeNull();
  });
});

describe('resolveLook', () => {
  it('follows the pack default only when unpinned', () => {
    expect(resolveLook('pack', 'poster')).toBe('poster');
    expect(resolveLook('pack', 'classic')).toBe('classic');
    expect(resolveLook('classic', 'poster')).toBe('classic');
    expect(resolveLook('poster', 'classic')).toBe('poster');
  });
});

describe('applyLook', () => {
  it('sets and removes the data-look attribute', () => {
    applyLook('poster');
    expect(document.documentElement.getAttribute('data-look')).toBe('poster');
    applyLook('classic');
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });
});
