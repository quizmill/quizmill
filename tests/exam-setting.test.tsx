// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import { EXAM_KEY, loadExamShown, saveExamShown } from '@/lib/examPref';
import { clearAll } from '@/lib/storage';

// The timed exam is the PACK's to switch on (exam.durationMinutes); the
// device may only hide it — the Levels & XP pattern (#192).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
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

describe('Timed exam device switch', () => {
  it('is shown by default and stored app-level once hidden', () => {
    expect(loadExamShown()).toBe(true);
    saveExamShown(false);
    expect(localStorage.getItem(EXAM_KEY)).toBe('1');
    clearAll();
    expect(loadExamShown()).toBe(false);
    saveExamShown(true);
    expect(localStorage.getItem(EXAM_KEY)).toBeNull();
  });

  it('Settings explains the exam comes from the pack, with its numbers', async () => {
    await render(<SettingsPage />);
    const card = container.querySelector('[data-testid="exam-setting"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('Mock exam: 9 questions in 15 minutes, set by this pack');
    const toggle = card!.querySelector<HTMLButtonElement>('[data-testid="exam-toggle"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(loadExamShown()).toBe(false);
  });

  it('hiding it takes the tile off Home', async () => {
    saveExamShown(false);
    await render(<PackHome />);
    expect(container.querySelector('[data-testid="exam-card"]')).toBeNull();
    // The other modes are unaffected (the demo ships them on).
    expect(container.querySelector('[data-testid="drive-card"]')).toBeTruthy();
  });
});
