// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PaperPage } from '@/pack/PaperPage';
import { PaperMarkPage } from '@/pack/PaperMarkPage';
import { APP_CONFIG } from '@/config';
import { packQuestions } from '@/pack/data';
import { savePaperSheet, type PaperSheet } from '@/pack/paper';

// Printing a whole named paper (#194): the compose card offers the pack's
// papers in a select grouped by series (a pill row cannot hold dozens of
// long labels); picking one prints the entire paper in bank order and
// the sheet is headed by the paper, not a category + level.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
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

function q(sel: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

async function pickPaper(key: string) {
  const select = q('[data-testid="paper-pick"]') as HTMLSelectElement;
  await act(async () => {
    select.value = key;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function storedSheets(): PaperSheet[] {
  return JSON.parse(
    localStorage.getItem(`quizmill.${APP_CONFIG.packId}.paperSheets.v1`) ?? '[]',
  );
}

const PAPER_1_IDS = packQuestions.filter((x) => x.paperId === 'starter-paper-1').map((x) => x.id);

describe('PaperPage paper picker', () => {
  it('offers the pack’s papers grouped by series, defaulting to a mixed sheet', async () => {
    await render(<PaperPage />);
    const select = q('[data-testid="paper-pick"]') as HTMLSelectElement;
    expect(select.value).toBe('');
    const groups = Array.from(select.querySelectorAll('optgroup'));
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Starter papers']);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['', 'starter-paper-1', 'starter-paper-2']);
    // Two books can both be "Paper 1": the owning category disambiguates.
    expect(select.textContent).toContain('Paper 1 · Planets');
    // The mixed-sheet controls are all still there.
    expect(container.querySelector('[role="radiogroup"][aria-label="Category"]')).toBeTruthy();
    expect(container.querySelector('[role="radiogroup"][aria-label="Level"]')).toBeTruthy();
    expect(container.querySelector('[role="radiogroup"][aria-label="Question count"]')).toBeTruthy();
  });

  it('prints a chosen paper whole, in bank order, under the paper’s heading', async () => {
    await render(<PaperPage />);
    await pickPaper('starter-paper-1');
    // A paper is the unit: no category, level or count to choose.
    expect(container.querySelector('[role="radiogroup"][aria-label="Category"]')).toBeNull();
    expect(container.querySelector('[role="radiogroup"][aria-label="Level"]')).toBeNull();
    expect(container.querySelector('[role="radiogroup"][aria-label="Question count"]')).toBeNull();
    expect(q('[data-testid="create-sheet"]').textContent).toContain('all 6, in order');

    await act(async () => {
      q('[data-testid="create-sheet"]').click();
    });
    const [sheet] = storedSheets();
    expect(sheet.paperId).toBe('starter-paper-1');
    expect(sheet.categoryKey).toBe('planets');
    expect(sheet.level).toBeUndefined();
    expect(sheet.questionIds).toEqual(PAPER_1_IDS);

    const printed = q('[data-testid="paper-sheet"]').textContent ?? '';
    expect(printed).toContain('Starter papers · Paper 1');
    expect(printed).toContain('6 questions');
  });

  it('heads the marking page with the paper too', async () => {
    const sheet: PaperSheet = {
      id: 'paper-sheet-under-test',
      code: 'P-PAPR',
      createdAt: Date.now(),
      categoryKey: 'planets',
      paperId: 'starter-paper-1',
      questionIds: PAPER_1_IDS,
    };
    savePaperSheet(sheet);
    window.location.hash = `#sheet=${sheet.id}`;
    await render(<PaperMarkPage />);
    expect(container.textContent).toContain('P-PAPR');
    expect(container.textContent).toContain('Starter papers · Paper 1');
  });
});
