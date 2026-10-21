// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PackUpdatedNotice, resetPackUpdatedNoticeForTests } from '@/components/PackUpdatedNotice';
import {
  PACK_UPDATED_NOTICE_KEY,
  stashPackUpdatedNotice,
  writePackUpdatedNotices,
} from '@/lib/packUpdates';

/**
 * The one-line "Updated: now N questions" on Home after an unlocked pack's
 * daily check fetched a newer bundle. The line is read from sessionStorage
 * exactly once; a notice for the ACTIVE pack reloads Home first (the pack
 * is bound once per page load), keeping the line for the render after.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let reload: ReturnType<typeof vi.fn<() => void>>;

async function render() {
  await act(async () => {
    root.render(<PackUpdatedNotice reload={reload} />);
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  resetPackUpdatedNoticeForTests();
  reload = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('PackUpdatedNotice', () => {
  it('renders nothing when nothing was stashed', async () => {
    await render();
    expect(container.textContent).toBe('');
    expect(reload).not.toHaveBeenCalled();
  });

  it('shows one line per updated pack, exactly once, and can be dismissed', async () => {
    writePackUpdatedNotices([
      { id: 'paid-pack', title: 'Full Course', count: 7, reload: false },
      { id: 'other', title: 'Other Pack', count: 1, reload: false },
    ]);
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Updated: now 7 questions');
    expect(text).toContain('“Full Course” has new questions.');
    expect(text).toContain('Updated: now 1 question');
    expect(text).toContain('“Other Pack”');
    // Taken: a later render (another visit to Home) shows nothing.
    expect(window.sessionStorage.getItem(PACK_UPDATED_NOTICE_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click();
    });
    expect(container.textContent).not.toContain('Full Course');
    expect(container.textContent).toContain('Other Pack');
  });

  it('a notice for the active pack reloads Home first and keeps the line for the next render', async () => {
    writePackUpdatedNotices([{ id: 'paid-pack', title: 'Full Course', count: 7, reload: true }]);
    await render();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('');
    expect(JSON.parse(window.sessionStorage.getItem(PACK_UPDATED_NOTICE_KEY)!)).toEqual([
      { id: 'paid-pack', title: 'Full Course', count: 7, reload: false },
    ]);
  });

  it('picks up a notice stashed while Home is already showing', async () => {
    await render();
    expect(container.textContent).toBe('');
    await act(async () => {
      stashPackUpdatedNotice({ id: 'other', title: 'Other Pack', count: 4, reload: false });
    });
    expect(container.textContent).toContain('Updated: now 4 questions');
    expect(reload).not.toHaveBeenCalled();
    // …and one for the active pack arriving later reloads, as on mount.
    await act(async () => {
      stashPackUpdatedNotice({ id: 'paid-pack', title: 'Full Course', count: 9, reload: true });
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.sessionStorage.getItem(PACK_UPDATED_NOTICE_KEY)!)).toEqual([
      { id: 'paid-pack', title: 'Full Course', count: 9, reload: false },
    ]);
  });
});
