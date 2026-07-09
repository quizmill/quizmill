// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// happy-dom doesn't ship crypto.randomUUID; the runner mints session and
// attempt ids with it. Borrow Node's Web Crypto.
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

// Replace the browser speech seam with a scriptable fake: `spoken`
// records every TTS call, `listenQueue` feeds recognition results (an
// empty queue behaves like silence, which the runner auto-pauses on;
// 'ERROR' entries simulate a broken recogniser).
const speech = vi.hoisted(() => ({
  stt: true,
  spoken: [] as string[],
  spokenOpts: [] as unknown[],
  listenQueue: [] as (string[] | 'ERROR')[],
}));
vi.mock('@/lib/speech', () => ({
  ttsSupported: () => true,
  sttSupported: () => speech.stt,
  warmUpTts: () => {},
  cancelSpeech: () => {},
  cancelListening: () => {},
  speak: async (text: string, opts?: unknown) => {
    speech.spoken.push(text);
    speech.spokenOpts.push(opts);
    return true;
  },
  listenOnce: async () => {
    const next = speech.listenQueue.shift() ?? [];
    return next === 'ERROR'
      ? { transcripts: [], error: true }
      : { transcripts: next, error: false };
  },
}));

import { DriveRunner } from '@/pack/DriveRunner';
import {
  loadAttempts,
  loadSessions,
  saveDriveRate,
  saveDriveVoice,
} from '@/lib/storage';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  speech.stt = true;
  speech.spoken = [];
  speech.spokenOpts = [];
  speech.listenQueue = [];
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<DriveRunner />);
  });
  await act(async () => {});
}

async function clickText(text: string) {
  const el = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(text),
  );
  expect(el, `expected a button containing "${text}"`).toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Flush the promise-chained voice loop until `predicate` holds. */
async function settleUntil(predicate: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await act(async () => {});
  }
  throw new Error(`voice loop never reached: ${label}`);
}

describe('DriveRunner', () => {
  it('runs a whole session by voice and records it', async () => {
    // 'a' answers whatever question comes up; overfill for any bank size.
    speech.listenQueue = Array.from({ length: 25 }, () => ['a']);
    await render();

    expect(container.textContent).toContain('Drive mode');
    await clickText('Start driving session');

    await settleUntil(
      () => (container.textContent ?? '').includes('Drive session complete'),
      'results screen',
    );

    const sessions = loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].subject).toBe('drive');
    expect(sessions[0].endedAt).not.toBeNull();

    const attempts = loadAttempts();
    expect(attempts).toHaveLength(sessions[0].questionCount);
    // Attempts carry the question's real category, not 'drive'.
    for (const a of attempts) expect(a.subject).not.toBe('drive');
    // Every selected answer was A (what the voice said).
    for (const a of attempts) expect(a.selectedAnswer).toBe('A');

    // The loop actually spoke: question scripts and a results line.
    expect(speech.spoken.some((s) => s.startsWith('Question 1 of'))).toBe(true);
    expect(speech.spoken.some((s) => s.startsWith('Session complete'))).toBe(
      true,
    );
  });

  it('re-reads the question on the "repeat" command', async () => {
    speech.listenQueue = [['repeat'], ['b']];
    await render();
    await clickText('Start driving session');

    await settleUntil(
      () =>
        speech.spoken.filter((s) => s.startsWith('Question 1 of')).length >= 2,
      'question re-read after repeat',
    );
    await settleUntil(() => loadAttempts().length === 1, 'answer after repeat');
    expect(loadAttempts()[0].selectedAnswer).toBe('B');
  });

  it('falls back to tap answers when speech recognition is missing', async () => {
    speech.stt = false;
    await render();
    expect(container.textContent).toContain(
      "Voice answers aren't available",
    );

    await clickText('Start driving session');
    await settleUntil(
      () => (container.textContent ?? '').includes('Tap an answer'),
      'tap-mode answer window',
    );

    // Tap the first option tile.
    const option = container.querySelector<HTMLButtonElement>(
      '[data-testid="drive-options"] button',
    );
    expect(option).toBeTruthy();
    await act(async () => {
      option!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(loadAttempts()).toHaveLength(1);
    // Feedback speech happened even in tap mode.
    await settleUntil(
      () =>
        speech.spoken.some(
          (s) => s.startsWith('Correct!') || s.startsWith('Not quite.'),
        ),
      'spoken feedback',
    );
  });

  it('degrades to tap mode when recognition keeps erroring', async () => {
    // Recognition exists but fails hard (mic denied / no audio device):
    // after two error rounds the runner announces tap mode and stops
    // listening — it must NOT auto-pause or nag.
    speech.listenQueue = ['ERROR', 'ERROR', 'ERROR', 'ERROR'];
    await render();
    await clickText('Start driving session');

    await settleUntil(
      () => (container.textContent ?? '').includes('Tap an answer'),
      'tap-mode fallback after recognition errors',
    );
    expect(
      speech.spoken.some((s) => s.includes('tap your answer')),
    ).toBe(true);
    expect(container.textContent).not.toContain('Paused');

    // Tapping still answers.
    const option = container.querySelector<HTMLButtonElement>(
      '[data-testid="drive-options"] button',
    );
    await act(async () => {
      option!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(loadAttempts()).toHaveLength(1);
  });

  it('speaks with the voice/rate prefs from Settings', async () => {
    saveDriveVoice('uri:ava');
    saveDriveRate(1.15);
    speech.listenQueue = [['a']];
    await render();
    await clickText('Start driving session');

    await settleUntil(() => speech.spoken.length > 0, 'first spoken line');
    // Every utterance carries the tuned voice and speed.
    for (const opts of speech.spokenOpts) {
      expect(opts).toEqual({ voiceURI: 'uri:ava', rate: 1.15 });
    }
  });

  it('auto-pauses after sustained silence', async () => {
    speech.listenQueue = []; // pure silence
    await render();
    await clickText('Start driving session');

    await settleUntil(
      () => (container.textContent ?? '').includes('Paused'),
      'auto-pause on silence',
    );
    expect(container.textContent).toContain('Resume');
    // No attempt was recorded by silence.
    expect(loadAttempts()).toHaveLength(0);
  });
});
