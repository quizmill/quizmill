// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import NotesPage from '@/pack/NotesPage';
import { loadNotes, recordNote } from '@/lib/storage';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// A question id from the seeded demo pack, so the card shows a prompt.
const QID = 'demo-planets-001';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<NotesPage />);
  });
}

/** Type into the textarea the way React sees it (native setter + input). */
async function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(textarea),
    'value',
  )?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function card(): HTMLElement | null {
  return container.querySelector('[data-testid="note-card"]');
}

function textarea(): HTMLTextAreaElement | null {
  return container.querySelector('textarea[aria-label="Note text"]');
}

describe('NotesPage note cards', () => {
  it('shows the empty state without notes', async () => {
    await render();
    expect(card()).toBeNull();
    expect(container.textContent).toContain('No notes yet.');
  });

  it('saves an edit after the typing debounce and flashes Saved ✓', async () => {
    recordNote(QID, 'old note', 100);
    await render();
    expect(textarea()!.value).toBe('old note');

    await type(textarea()!, 'old note, revised');
    // Debounce still pending: nothing written, no flash.
    await advance(599);
    expect(loadNotes()[0]?.text).toBe('old note');
    expect(card()!.textContent).not.toContain('Saved ✓');

    await advance(1);
    expect(loadNotes()[0]?.text).toBe('old note, revised');
    expect(card()!.textContent).toContain('Saved ✓');

    // The flash clears on its own.
    await advance(800);
    expect(card()!.textContent).not.toContain('Saved ✓');
  });

  it('restarts the debounce on every keystroke', async () => {
    recordNote(QID, 'old note', 100);
    await render();

    await type(textarea()!, 'a');
    await advance(400);
    await type(textarea()!, 'ab');
    await advance(400);
    // 800 ms since the first keystroke, 400 ms since the last: not yet.
    expect(loadNotes()[0]?.text).toBe('old note');
    await advance(200);
    expect(loadNotes()[0]?.text).toBe('ab');
  });

  it('does not delete an emptied note on debounce — the card stays', async () => {
    recordNote(QID, 'old note', 100);
    await render();

    await type(textarea()!, '   ');
    await advance(1000);
    expect(loadNotes()[0]?.text).toBe('old note');
    expect(card()).not.toBeNull();
    expect(card()!.textContent).not.toContain('Saved ✓');
  });

  it('the delete button removes the note', async () => {
    recordNote(QID, 'old note', 100);
    await render();

    await act(async () => {
      container
        .querySelector('button[aria-label="Delete note"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(loadNotes()).toEqual([]);
    expect(card()).toBeNull();
  });

  it('flushes a pending edit when the page unmounts', async () => {
    recordNote(QID, 'old note', 100);
    await render();

    await type(textarea()!, 'typed then navigated away');
    await act(async () => {
      root.unmount();
    });
    // Written at unmount, not 600 ms later.
    expect(loadNotes()[0]?.text).toBe('typed then navigated away');

    // Re-create a root so afterEach's unmount has something to unmount.
    await act(async () => {
      root = createRoot(container);
    });
  });
});
