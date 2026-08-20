// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PackImage } from '@/pack/PackImage';
import type { ActivePack } from '@/pack/runtime';

// PackImage resolves relative pack-image paths differently depending on how
// the active pack got here: a BUILD-TIME pack serves them from the app's own
// /pack-assets/ (mirrored by scripts/pack-assets.ts), while a RUNTIME-inserted
// pack has no files in this deployment at all — its images must resolve
// against the assetsBase recorded when the pack was inserted (regression:
// packs inserted via /packs rendered every image as a 404).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.__QUIZMILL_PACK__ = undefined;
});

function runtimePack(assetsBase?: string): ActivePack {
  return {
    manifest: { id: 'rt-pack' } as ActivePack['manifest'],
    questions: [],
    ...(assetsBase ? { assetsBase } : {}),
  };
}

async function renderImage(src: string): Promise<string | null> {
  root = createRoot(container);
  await act(async () => root.render(<PackImage src={src} />));
  return container.querySelector('img')?.getAttribute('src') ?? null;
}

describe('PackImage src resolution', () => {
  it('serves a build-time pack image from the app’s own /pack-assets/', async () => {
    expect(await renderImage('saturn.svg')).toBe('/pack-assets/saturn.svg');
  });

  it('resolves a runtime-inserted pack image against its assetsBase', async () => {
    globalThis.__QUIZMILL_PACK__ = runtimePack('https://example.com/mt/assets');
    expect(await renderImage('note-treble-g4.svg')).toBe(
      'https://example.com/mt/assets/note-treble-g4.svg',
    );
  });

  it('falls back to /pack-assets/ for a runtime pack without assetsBase', async () => {
    globalThis.__QUIZMILL_PACK__ = runtimePack();
    expect(await renderImage('note.svg')).toBe('/pack-assets/note.svg');
  });

  it('passes absolute http(s) image URLs through untouched, override or not', async () => {
    globalThis.__QUIZMILL_PACK__ = runtimePack('https://example.com/mt/assets');
    expect(await renderImage('https://cdn.example.com/x.png')).toBe(
      'https://cdn.example.com/x.png',
    );
  });
});
