// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackReviewPage } from '@/pack/PackReviewPage';
import { DownvoteBrowser } from '@/pack/DownvoteBrowser';
import { loadAttempts, loadVotes } from '@/lib/storage';
import { answerKeysOf, isMatching, packQuestions } from '@/pack/data';

/**
 * The pack review page against the demo pack (19 questions, two
 * categories): a read-only sample of the bank with every answer shown,
 * nothing recorded as practice, and the thumbs wired to the ordinary
 * question votes.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

function cards(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="review-card"]')];
}

function shownIds(): string[] {
  return cards().map((c) => c.dataset.questionId ?? '');
}

const byId = new Map(packQuestions.map((q) => [q.id, q]));

describe('PackReviewPage', () => {
  it('shows ten questions of the pack by default, with the answers revealed', async () => {
    await render(<PackReviewPage />);
    expect(packQuestions.length).toBeGreaterThan(10);
    expect(cards()).toHaveLength(10);
    expect(new Set(shownIds()).size).toBe(10);
    expect(container.textContent).toContain(`Showing 10 of ${packQuestions.length} questions`);

    for (const card of cards()) {
      const q = byId.get(card.dataset.questionId ?? '');
      expect(q).toBeDefined();
      if (!q) continue;
      // Metadata a learner never sees.
      expect(card.textContent).toContain(q.id);
      expect(card.querySelector('[data-testid="review-status-chip"]')?.textContent).toBe(
        q.reviewStatus,
      );
      expect(card.textContent).toContain(`Difficulty ${q.difficulty}/5`);
      // The explanation is open and the right answer is lit.
      expect(card.textContent).toContain(q.explanation.slice(0, 30));
      if (isMatching(q)) {
        const rows = card.querySelectorAll('[data-row-correct="true"]');
        expect(rows).toHaveLength(q.rows?.length ?? 0);
      } else {
        const answered = answerKeysOf(q);
        // The option buttons are the disabled ones (the thumbs stay live).
        const lit = [...card.querySelectorAll('button[disabled]')].filter((b) =>
          b.className.includes('border-success-500 '),
        );
        expect(lit).toHaveLength(answered.length);
        for (const key of answered) {
          const option = q.options?.find((o) => o.key === key);
          expect(lit.some((b) => b.textContent?.includes(option?.text ?? '\u0000'))).toBe(true);
        }
      }
      // Options are inert — this is a reading, not a sitting.
      for (const b of card.querySelectorAll<HTMLButtonElement>('button[disabled]')) {
        expect(b.disabled).toBe(true);
      }
    }
    expect(loadAttempts()).toHaveLength(0);
  });

  it('switches to twenty, capped at the pack size', async () => {
    await render(<PackReviewPage />);
    await click(container.querySelector('[data-testid="review-size-20"]')!);
    expect(cards()).toHaveLength(Math.min(20, packQuestions.length));
    expect(
      container.querySelector('[data-testid="review-size-20"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(new Set(shownIds()).size).toBe(cards().length);
  });

  it('draws the unseen questions next, then starts the bank over', async () => {
    await render(<PackReviewPage />);
    const first = shownIds();
    await click(container.querySelector('[data-testid="review-redraw"]')!);
    const second = shownIds();
    expect(second).toHaveLength(10);
    // 19 questions: 9 unseen come first, then one from the reopened bank.
    const unseen = second.filter((id) => !first.includes(id));
    expect(unseen).toHaveLength(packQuestions.length - 10);
    expect(container.textContent).toContain('has been shown — starting over');
  });

  it('files a thumbs-down as an ordinary question vote', async () => {
    await render(
      <>
        <PackReviewPage />
        <DownvoteBrowser />
      </>,
    );
    const firstCard = cards()[0];
    const id = firstCard.dataset.questionId!;
    await click(firstCard.querySelector('[data-testid="vote-down"]')!);
    expect(loadVotes()).toEqual([expect.objectContaining({ questionId: id, vote: 'down' })]);
    // …so it shows up in the Question feedback browser in Settings.
    expect(container.querySelector('[data-testid="dev-downvotes"]')?.textContent).toContain(id);
    expect(loadAttempts()).toHaveLength(0);
  });
});
