// .tsx so this runs on happy-dom (vitest environmentMatchGlobs) — the
// persistence + apply functions need window/document/localStorage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  loadThemePref,
  resolveTheme,
  saveThemePref,
  THEME_EVENT,
  THEME_KEY,
} from '@/lib/theme';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('resolveTheme', () => {
  it('pins explicit prefs regardless of the OS scheme', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS scheme in system mode', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
  });
});

describe('theme persistence', () => {
  it('defaults to system when nothing is stored', () => {
    expect(loadThemePref()).toBe('system');
  });

  it('round-trips light and dark', () => {
    saveThemePref('dark');
    expect(loadThemePref()).toBe('dark');
    saveThemePref('light');
    expect(loadThemePref()).toBe('light');
  });

  it('stores a bare string the pre-paint bootstrap can read without JSON', () => {
    saveThemePref('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('removes the key entirely for system (bootstrap default path)', () => {
    saveThemePref('dark');
    saveThemePref('system');
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(loadThemePref()).toBe('system');
  });

  it('treats junk in storage as system', () => {
    window.localStorage.setItem(THEME_KEY, 'blorange');
    expect(loadThemePref()).toBe('system');
  });

  it('notifies listeners on save so mounted hooks re-sync', () => {
    const spy = vi.fn();
    window.addEventListener(THEME_EVENT, spy);
    saveThemePref('dark');
    window.removeEventListener(THEME_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('applyTheme', () => {
  it('toggles the dark class on <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
