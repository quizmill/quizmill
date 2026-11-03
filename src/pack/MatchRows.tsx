import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { McqMarkdown } from '@/components/McqMarkdown';
import { matchPick, matchPicksOf, type AnswerKey, type PackQuestion } from '@/pack/data';

/** Choice columns per row by choice count: Yes/No and three-way classify
 *  sit on one line even on a phone; four or more wrap to two columns
 *  there and spread out on a wider screen. */
const GRID: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3',
  6: 'grid-cols-2 sm:grid-cols-3',
};

/**
 * The answer area of a matching question (#269): one card per row — its
 * statement, then the shared choices as a radio group. A tap sends the
 * pick as "row=choice"; the runner's `nextSelection` keeps one per row.
 * In feedback every row is marked right or wrong, the right choice is
 * flagged, and the row's own `explanation` shows under it — the matching
 * analogue of OptionButtons' per-option notes.
 */
export function MatchRows({
  question,
  selected,
  stage,
  onSelect,
}: {
  question: Pick<PackQuestion, 'rows' | 'choices' | 'correctMatch'>;
  selected: AnswerKey[];
  stage: 'choosing' | 'feedback';
  onSelect: (key: AnswerKey) => void;
}) {
  const rows = question.rows ?? [];
  const choices = question.choices ?? [];
  const picks = matchPicksOf(selected);
  const feedback = stage === 'feedback';

  return (
    <div className="flex flex-col gap-2.5" data-testid="match-rows">
      {rows.map((row, i) => {
        const picked = picks[row.key];
        const answer = question.correctMatch?.[row.key];
        const rowCorrect = picked !== undefined && picked === answer;
        return (
          <div
            key={row.key}
            role="radiogroup"
            aria-labelledby={`match-row-${row.key}`}
            data-row-correct={feedback ? String(rowCorrect) : undefined}
            className={cn(
              'flex flex-col gap-2.5 rounded-xl border-2 bg-surface px-4 py-3 shadow-xs',
              !feedback
                ? 'border-ink-200'
                : rowCorrect
                  ? 'border-success-500/60'
                  : 'border-warn-500/60',
            )}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink-300 text-xs font-bold text-ink-600">
                {i + 1}
              </span>
              <div
                id={`match-row-${row.key}`}
                className="flex-1 text-[15px] font-medium leading-relaxed text-ink-900"
              >
                <McqMarkdown text={row.text} />
              </div>
              {feedback ? (
                rowCorrect ? (
                  <Check className="h-5 w-5 shrink-0 text-success-500" aria-label="Right" />
                ) : (
                  <X className="h-5 w-5 shrink-0 text-warn-500" aria-label="Wrong" />
                )
              ) : null}
            </div>
            <div className={cn('grid gap-2', GRID[choices.length] ?? 'grid-cols-2')}>
              {choices.map((c) => {
                const isThis = picked === c.key;
                const isAnswer = answer === c.key;
                let visual = 'border-ink-200 bg-surface text-ink-700 hover:bg-ink-50 dark:hover:bg-ink-100';
                if (!feedback && isThis) {
                  visual = 'border-brand-500 bg-brand-50 text-ink-900 ring-2 ring-brand-500/30';
                } else if (feedback) {
                  if (isAnswer) visual = 'border-success-500 bg-success-100 text-success-700';
                  else if (isThis) visual = 'border-warn-500 bg-warn-100 text-warn-700';
                  else visual = 'border-ink-200 bg-ink-50/50 text-ink-500';
                }
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={isThis}
                    data-answer={feedback ? String(isAnswer) : undefined}
                    disabled={feedback}
                    onClick={() => onSelect(matchPick(row.key, c.key))}
                    className={cn(
                      'tap-feedback min-h-11 rounded-lg border-2 px-2 py-2 text-center text-sm font-semibold leading-snug transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default',
                      visual,
                    )}
                  >
                    {c.text}
                  </button>
                );
              })}
            </div>
            {feedback && row.explanation ? (
              <div
                data-testid="row-explanation"
                className={cn(
                  'text-[13px] leading-snug',
                  rowCorrect ? 'text-success-700' : 'text-warn-700',
                )}
              >
                <McqMarkdown text={row.explanation} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
