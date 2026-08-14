// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NoteRow } from '@/components/NoteRow';
import { loadNotes, recordNote } from '@/lib/storage';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(questionId = 'q1') {
  await act(async () => {
    root = createRoot(container);
    root.render(<NoteRow questionId={questionId} />);
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

function toggle(): HTMLButtonElement | null {
  return container.querySelector('[data-testid="note-toggle"]');
}

function textarea(): HTMLTextAreaElement | null {
  return container.querySelector('[data-testid="note-text"]');
}

describe('NoteRow', () => {
  it('starts collapsed and opens an empty textarea on tap', async () => {
    await render();
    expect(textarea()).toBeNull();
    await click(toggle()!);
    expect(toggle()).toBeNull();
    expect(textarea()!.value).toBe('');
  });

  it('saves the note to storage after the typing debounce', async () => {
    await render();
    await click(toggle()!);
    await type(textarea()!, 'more questions on this topic please');

    expect(loadNotes()).toEqual([]); // debounce still pending
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(loadNotes()).toMatchObject([
      { questionId: 'q1', text: 'more questions on this topic please' },
    ]);
  });

  it('clearing the text deletes the note', async () => {
    recordNote('q1', 'old note', 100);
    await render();
    // Adopts the stored note: opens with the text prefilled.
    expect(textarea()!.value).toBe('old note');

    await type(textarea()!, '');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(loadNotes()).toEqual([]);
  });

  it('stays collapsed for a question without a note', async () => {
    recordNote('q-other', 'note elsewhere', 100);
    await render('q1');
    expect(toggle()).not.toBeNull();
    expect(textarea()).toBeNull();
  });
});
