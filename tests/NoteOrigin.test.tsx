// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NoteOrigin } from '@/pack/NoteOrigin';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(generatedFrom?: { questionId: string; note: string }) {
  await act(async () => {
    root = createRoot(container);
    root.render(<NoteOrigin generatedFrom={generatedFrom} />);
  });
}

describe('NoteOrigin', () => {
  it('renders nothing for a question without provenance', async () => {
    await render(undefined);
    expect(container.querySelector('[data-testid="note-origin"]')).toBeNull();
  });

  it('shows the note and the original question it was left on', async () => {
    // demo-planets-001 exists in the seeded demo pack.
    await render({ questionId: 'demo-planets-001', note: 'more like this please' });
    const el = container.querySelector('[data-testid="note-origin"]')!;
    expect(el.textContent).toContain('from your note');
    expect(el.textContent).toContain('more like this please');
    expect(el.textContent).toContain('closest to the Sun');
  });

  it('still shows the note when the original question left the pack', async () => {
    await render({ questionId: 'gone-question', note: 'keep this topic coming' });
    const el = container.querySelector('[data-testid="note-origin"]')!;
    expect(el.textContent).toContain('keep this topic coming');
    expect(el.textContent).not.toContain('Left on:');
  });
});
