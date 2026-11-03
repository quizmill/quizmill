import type { PackQuestion } from '@/pack/data';

/**
 * Answer the matching question on screen (#269) through its rendered
 * radio groups: every row right, or — `correctly: false` — the first row
 * wrong and the rest right, so the question grades wrong on one row.
 */
export async function answerMatching(
  root: ParentNode,
  q: PackQuestion,
  correctly: boolean,
  click: (el: Element) => Promise<void>,
): Promise<void> {
  const groups = [...root.querySelectorAll('[data-testid="match-rows"] [role="radiogroup"]')];
  const rows = q.rows ?? [];
  if (groups.length !== rows.length) throw new Error(`expected ${rows.length} match rows`);
  for (const [i, r] of rows.entries()) {
    const want = q.correctMatch?.[r.key];
    const choice = (q.choices ?? []).find((c) =>
      correctly || i > 0 ? c.key === want : c.key !== want,
    )!;
    const radio = [...groups[i].querySelectorAll('[role="radio"]')].find(
      (b) => b.textContent === choice.text,
    );
    if (!radio) throw new Error(`no choice "${choice.text}" on row ${r.key}`);
    await click(radio);
  }
}
