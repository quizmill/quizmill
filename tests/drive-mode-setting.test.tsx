// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';

// The Settings voice picker needs voices; happy-dom has no
// speechSynthesis, so fake the speech seam with two en voices.
const fakeSpeech = vi.hoisted(() => ({
  previews: [] as { text: string; opts?: unknown }[],
}));
vi.mock('@/lib/speech', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/speech')>();
  const FAKE_VOICES = [
    { name: 'Samantha', lang: 'en-US', voiceURI: 'uri:samantha', default: true, localService: true },
    { name: 'Ava (Premium)', lang: 'en-US', voiceURI: 'uri:ava', default: false, localService: true },
  ] as SpeechSynthesisVoice[];
  return {
    ...real,
    ttsSupported: () => true,
    listVoices: async () => FAKE_VOICES,
    speak: async (text: string, opts?: unknown) => {
      fakeSpeech.previews.push({ text, opts });
      return true;
    },
  };
});

import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import {
  loadDriveModeEnabled,
  loadDriveVoicePrefs,
  saveDriveModeEnabled,
  saveDriveRate,
  saveDriveVoice,
  saveLevelFilter,
  loadLevelFilter,
} from '@/lib/storage';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  fakeSpeech.previews = [];
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

describe('Drive Mode setting', () => {
  it('defaults to off and round-trips through storage', () => {
    expect(loadDriveModeEnabled()).toBe(false);
    saveDriveModeEnabled(true);
    expect(loadDriveModeEnabled()).toBe(true);
    saveDriveModeEnabled(false);
    expect(loadDriveModeEnabled()).toBe(false);
  });

  it('keeps other prefs intact when toggled', () => {
    saveLevelFilter('basics');
    saveDriveModeEnabled(true);
    saveDriveModeEnabled(false);
    expect(loadLevelFilter()).toBe('basics');
  });

  it('hides the Home drive card by default', async () => {
    await render(<PackHome />);
    expect(
      container.querySelector('[data-testid="drive-card"]'),
    ).toBeNull();
  });

  it('shows the Home drive card once enabled', async () => {
    saveDriveModeEnabled(true);
    await render(<PackHome />);
    const card = container.querySelector('[data-testid="drive-card"]');
    expect(card).toBeTruthy();
    // Next's Link normalizes the trailing slash outside the static export.
    expect(card?.getAttribute('href')).toMatch(/^\/drive\/?$/);
  });

  it('Settings toggle switches the pref on and off', async () => {
    await render(<SettingsPage />);
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="drive-mode-toggle"]',
    );
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(loadDriveModeEnabled()).toBe(true);
    expect(toggle!.getAttribute('aria-checked')).toBe('true');
    // Enabled state surfaces a direct link too.
    expect(container.textContent).toContain('Open drive mode');

    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(loadDriveModeEnabled()).toBe(false);
  });

  it('voice/rate prefs round-trip and clamp', () => {
    expect(loadDriveVoicePrefs()).toEqual({ voiceURI: null, rate: 1 });
    saveDriveVoice('uri:ava');
    saveDriveRate(1.15);
    expect(loadDriveVoicePrefs()).toEqual({ voiceURI: 'uri:ava', rate: 1.15 });
    saveDriveRate(99); // hand-edited storage must not produce chipmunk mode
    expect(loadDriveVoicePrefs().rate).toBe(1.5);
    saveDriveVoice(null);
    expect(loadDriveVoicePrefs().voiceURI).toBeNull();
  });

  it('Settings voice picker and speed slider persist, preview uses them', async () => {
    saveDriveModeEnabled(true);
    await render(<SettingsPage />);
    // Voices load async after the toggle is found on.
    await act(async () => {});

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="drive-voice-select"]',
    );
    expect(select).toBeTruthy();
    expect(select!.value).toBe(''); // Auto
    expect(select!.options.length).toBe(3); // Auto + 2 fake voices

    await act(async () => {
      select!.value = 'uri:ava';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(loadDriveVoicePrefs().voiceURI).toBe('uri:ava');

    const slider = container.querySelector<HTMLInputElement>(
      '[data-testid="drive-rate-slider"]',
    );
    expect(slider).toBeTruthy();
    await act(async () => {
      // Controlled input: React's value tracker ignores a plain .value
      // write, so go through the native setter before dispatching.
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setValue.call(slider!, '1.15');
      slider!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(loadDriveVoicePrefs().rate).toBe(1.15);

    // Preview speaks with the chosen voice + rate.
    const preview = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Preview voice'),
    );
    await act(async () => {
      preview!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fakeSpeech.previews.at(-1)?.opts).toEqual({
      voiceURI: 'uri:ava',
      rate: 1.15,
    });
  });
});
