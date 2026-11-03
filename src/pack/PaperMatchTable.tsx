import { McqMarkdown } from '@/components/McqMarkdown';
import type { PackQuestion } from '@/pack/data';

/**
 * A matching question on a printed sheet (#269): its rows down the side,
 * the shared choices across the top, and a tick box where they meet —
 * the learner ticks one per row, so the table IS the answer box. With
 * `showAnswers` (the coach's answer key) the right box of each row is
 * ticked and the row's explanation sits under it.
 */
export function PaperMatchTable({
  question,
  showAnswers = false,
}: {
  question: Pick<PackQuestion, 'rows' | 'choices' | 'correctMatch'>;
  showAnswers?: boolean;
}) {
  const rows = question.rows ?? [];
  const choices = question.choices ?? [];
  return (
    <table className="mt-2 w-full border-collapse text-left" data-testid="paper-match-table">
      <thead>
        <tr>
          <th className="sr-only">Row</th>
          {choices.map((c) => (
            <th
              key={c.key}
              scope="col"
              className="px-1 pb-1 text-center align-bottom text-[11px] font-semibold leading-tight"
            >
              {c.text}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const answer = question.correctMatch?.[r.key];
          return (
            <tr key={r.key} className="border-t border-neutral-300">
              <td className="py-1.5 pr-2 align-top">
                <span className="mr-1 font-bold">{i + 1}.</span>
                <McqMarkdown text={r.text} />
                {showAnswers && r.explanation ? (
                  <div className="mt-0.5 text-[12px] text-neutral-600">
                    <McqMarkdown text={r.explanation} />
                  </div>
                ) : null}
              </td>
              {choices.map((c) => (
                <td key={c.key} className="px-1 py-1.5 text-center align-top">
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-sm border-2 border-neutral-900"
                    aria-label={showAnswers && answer === c.key ? `${c.text} (answer)` : c.text}
                  >
                    {showAnswers && answer === c.key ? (
                      <span data-testid="key-tick" className="text-sm font-bold leading-none">✓</span>
                    ) : null}
                  </span>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
