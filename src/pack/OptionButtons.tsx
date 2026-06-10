import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { McqMarkdown } from '@/components/McqMarkdown';
import { PackImage } from '@/pack/PackImage';
import type { OptionKey, PackOption } from '@/pack/data';

interface OptionButtonsProps {
  options: PackOption[];
  selected: OptionKey | null;
  stage: 'choosing' | 'feedback';
  correctKey: OptionKey;
  onSelect: (key: OptionKey) => void;
}

/**
 * The MCQ answer buttons, shared by the Practice and Review runners.
 * Renders a text list, or — when every option carries an `image`
 * (image-answer questions, e.g. Non-Verbal Reasoning) — a 2-column grid
 * of image tiles. Selection/feedback styling is identical to both.
 */
export function OptionButtons({
  options,
  selected,
  stage,
  correctKey,
  onSelect,
}: OptionButtonsProps) {
  const imageOptions = options.length > 0 && options.every((o) => o.image);

  return (
    <div className={imageOptions ? 'grid grid-cols-2 gap-2.5' : 'flex flex-col gap-2.5'}>
      {options.map((opt) => {
        const isThis = selected === opt.key;
        const isAnswer = opt.key === correctKey;

        let visual = 'border-ink-200 bg-white hover:bg-ink-50';
        if (stage === 'choosing' && isThis) {
          visual = 'border-brand-500 bg-brand-50 text-ink-900 ring-2 ring-brand-500/30';
        } else if (stage === 'feedback') {
          if (isAnswer) visual = 'border-success-500 bg-success-100 text-success-700';
          else if (isThis) visual = 'border-warn-500 bg-warn-100 text-warn-700';
          else visual = 'border-ink-200 bg-ink-50/50 text-ink-500';
        }

        const bubbleState =
          stage === 'feedback' && isAnswer
            ? 'border-success-500 bg-success-500 text-white'
            : stage === 'feedback' && isThis
              ? 'border-warn-500 bg-warn-500 text-white'
              : isThis
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-ink-300 bg-white text-ink-600';
        const keyBubble = (extra?: string) => (
          <span
            className={cn(
              'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-xs font-bold',
              extra,
              bubbleState,
            )}
          >
            {opt.key}
          </span>
        );
        const mark =
          stage === 'feedback' && isAnswer ? (
            <Check className="h-5 w-5 flex-shrink-0 text-success-500" />
          ) : stage === 'feedback' && isThis && !isAnswer ? (
            <X className="h-5 w-5 flex-shrink-0 text-warn-500" />
          ) : null;

        if (opt.image) {
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onSelect(opt.key)}
              disabled={stage === 'feedback'}
              className={cn(
                'tap-feedback flex flex-col items-center gap-2 rounded-xl border-2 p-3 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default',
                visual,
              )}
            >
              <span className="flex w-full items-center justify-between">
                {keyBubble()}
                {mark}
              </span>
              <PackImage
                src={opt.image}
                alt={opt.text}
                className="max-h-32 w-auto object-contain"
              />
            </button>
          );
        }

        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.key)}
            disabled={stage === 'feedback'}
            className={cn(
              'tap-feedback flex min-h-14 items-start gap-3 rounded-xl border-2 px-4 py-3 text-left text-[15px] font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default',
              visual,
            )}
          >
            {keyBubble('mt-0.5')}
            <span className="flex-1 leading-relaxed">
              <McqMarkdown text={opt.text} />
            </span>
            {mark}
          </button>
        );
      })}
    </div>
  );
}
