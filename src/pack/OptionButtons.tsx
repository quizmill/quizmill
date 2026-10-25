import type { ReactNode } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { McqMarkdown } from '@/components/McqMarkdown';
import { PackImage } from '@/pack/PackImage';
import type { OptionKey, PackOption } from '@/pack/data';

interface OptionButtonsProps {
  options: PackOption[];
  /** The chosen option key(s). One entry for single-answer questions;
   *  several while a multi-answer ("select all") question is in progress. */
  selected: OptionKey[];
  stage: 'choosing' | 'feedback';
  /** Every correct key — one for single-answer, two+ for multi-answer. */
  correctKeys: OptionKey[];
  /** Multi-answer question — options toggle and the key bubbles are
   *  rounded squares to signal "pick more than one". */
  multi?: boolean;
  onSelect: (key: OptionKey) => void;
}

/**
 * DESIGN ROUND (#225), NOT FOR MERGE. Which presentation the per-option
 * notes use in feedback, picked with `?optv=<n>` on any runner URL:
 *   0 (default) — today's inline note
 *   1 — "Why not" / "Why" caption + a thin rule in the state colour
 *   2 — a muted X on every distractor's key bubble, note tinted to match
 *   3 — the note as its own block under the option, outside the <button>
 *   4 — a "Why not?" disclosure per option, open on the picked-wrong one
 *   5 — verdict chips ("Your answer" / "Correct answer") + captioned notes
 */
type NoteVariant = 0 | 1 | 2 | 3 | 4 | 5;
function noteVariant(): NoteVariant {
  if (typeof window === 'undefined') return 0;
  const n = Number(new URLSearchParams(window.location.search).get('optv'));
  return n >= 1 && n <= 5 ? (n as NoteVariant) : 0;
}

/**
 * The MCQ answer buttons, shared by the Practice and Review runners.
 * Renders a text list, or — when every option carries an `image`
 * (image-answer questions, e.g. Non-Verbal Reasoning) — a 2-column grid
 * of image tiles. Handles both single-answer (radio-style, one choice)
 * and multi-answer (checkbox-style, several) questions; feedback flags
 * every correct key.
 */
export function OptionButtons({
  options,
  selected,
  stage,
  correctKeys,
  multi = false,
  onSelect,
}: OptionButtonsProps) {
  const imageOptions = options.length > 0 && options.every((o) => o.image);
  const bubbleShape = multi ? 'rounded-md' : 'rounded-full';
  const variant = noteVariant();

  return (
    <div className={imageOptions ? 'grid grid-cols-2 gap-2.5' : 'flex flex-col gap-2.5'}>
      {options.map((opt) => {
        const isThis = selected.includes(opt.key);
        const isAnswer = correctKeys.includes(opt.key);
        const feedback = stage === 'feedback';
        // A distractor the learner didn't pick, once checked.
        const otherWrong = feedback && !isAnswer && !isThis;

        let visual = 'border-ink-200 bg-surface hover:bg-ink-50 dark:hover:bg-ink-100';
        if (stage === 'choosing' && isThis) {
          visual = 'border-brand-500 bg-brand-50 text-ink-900 ring-2 ring-brand-500/30';
        } else if (feedback) {
          if (isAnswer) visual = 'border-success-500 bg-success-100 text-success-700';
          else if (isThis) visual = 'border-warn-500 bg-warn-100 text-warn-700';
          // Variants keep the unpicked option text at least as bright as
          // its note, so the note no longer outshines what it explains.
          else if (variant === 0) visual = 'border-ink-200 bg-ink-50/50 text-ink-500';
          else visual = 'border-ink-200 bg-ink-50/50 text-ink-700';
        }
        // Variant 3/4 attach the note under the button: square the
        // button's bottom corners so the two read as one card.
        const attached =
          feedback && !!opt.explanation && (variant === 3 || variant === 4) && !opt.image;

        const bubbleState =
          feedback && isAnswer
            ? 'border-success-500 bg-success-500 text-white'
            : feedback && isThis
              ? 'border-warn-500 bg-warn-500 text-white'
              : variant === 2 && otherWrong
                ? 'border-ink-300 bg-ink-100 text-ink-500'
                : isThis
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-ink-300 bg-surface text-ink-600';
        const keyBubble = (extra?: string) => (
          <span
            className={cn(
              'inline-flex h-6 w-6 shrink-0 items-center justify-center border text-xs font-bold',
              bubbleShape,
              extra,
              bubbleState,
            )}
          >
            {variant === 2 && otherWrong ? (
              <X className="h-3.5 w-3.5" aria-label={`${opt.key}, wrong`} />
            ) : (
              opt.key
            )}
          </span>
        );
        const mark =
          feedback && isAnswer ? (
            <Check className="h-5 w-5 shrink-0 text-success-500" />
          ) : feedback && isThis && !isAnswer ? (
            <X className="h-5 w-5 shrink-0 text-warn-500" />
          ) : null;
        const chip =
          variant === 5 && feedback && (isAnswer || isThis) ? (
            <span
              className={cn(
                'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                isAnswer ? 'bg-success-500 text-white' : 'bg-warn-500 text-white',
              )}
            >
              {isAnswer && isThis ? 'Your answer' : isAnswer ? 'Correct answer' : 'Your answer'}
            </span>
          ) : null;

        const tone = isAnswer ? 'text-success-700' : isThis ? 'text-warn-700' : 'text-ink-600';
        const rule = isAnswer
          ? 'border-success-500/40'
          : isThis
            ? 'border-warn-500/40'
            : 'border-ink-300';
        const caption = isAnswer ? 'Why' : 'Why not';
        const captionEl = (
          <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide opacity-80">
            {caption}
          </span>
        );
        // The option's own verdict, inline under its text once checked —
        // so "why this one is wrong" sits next to the wrong one instead of
        // buried in the explanation block below. Hidden while choosing
        // (it would give the answer away). Tinted to the option's state:
        // the answer reads green, a wrong pick amber, the rest muted.
        // Not linkified: the note lives inside the (disabled) <button>,
        // where a nested <a> is invalid and unreachable.
        let note: ReactNode = null;
        if (feedback && opt.explanation && variant !== 3 && variant !== 4) {
          note = (
            <span
              data-testid="option-explanation"
              className={cn(
                'block w-full text-left text-[13px] font-normal leading-snug',
                variant === 0 ? 'mt-1' : 'transition-opacity duration-500 starting:opacity-0',
                (variant === 1 || variant === 5) && cn('mt-2 border-t pt-2', rule),
                variant === 2 && 'mt-1',
                variant === 2 && otherWrong ? 'text-ink-500' : tone,
              )}
            >
              {(variant === 1 || variant === 5) && captionEl}
              <McqMarkdown text={opt.explanation} linkify={false} />
            </span>
          );
        }
        // Variants 3/4: the note sits OUTSIDE the button, so it can carry
        // links and be selected.
        let block: ReactNode = null;
        if (attached && opt.explanation) {
          const blockTone = isAnswer
            ? 'border-success-500 bg-success-50 text-success-700'
            : isThis
              ? 'border-warn-500 bg-warn-50 text-warn-700'
              : 'border-ink-200 bg-ink-50 text-ink-600';
          if (variant === 3) {
            block = (
              <div
                data-testid="option-explanation"
                className={cn(
                  '-mt-0.5 rounded-b-xl border-2 border-t-0 px-4 py-2.5 text-[13px] leading-snug transition-opacity duration-500 starting:opacity-0',
                  blockTone,
                )}
              >
                <div className={cn('border-l-2 pl-3', rule)}>
                  {captionEl}
                  <McqMarkdown text={opt.explanation} />
                </div>
              </div>
            );
          } else {
            block = (
              <details
                data-testid="option-explanation"
                open={isThis && !isAnswer}
                className={cn(
                  'group -mt-0.5 rounded-b-xl border-2 border-t-0 px-4 py-2 text-[13px] leading-snug',
                  blockTone,
                )}
              >
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-bold uppercase tracking-wide opacity-80 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  {isAnswer ? 'Why?' : 'Why not?'}
                </summary>
                <div className="pt-1 pb-0.5 pl-[18px]">
                  <McqMarkdown text={opt.explanation} />
                </div>
              </details>
            );
          }
        }

        if (opt.image) {
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onSelect(opt.key)}
              disabled={stage === 'feedback'}
              className={cn(
                'tap-feedback flex flex-col items-center gap-2 rounded-xl border-2 p-3 shadow-xs transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default',
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
              {note}
            </button>
          );
        }

        const button = (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.key)}
            disabled={stage === 'feedback'}
            className={cn(
              'tap-feedback flex min-h-14 items-start gap-3 rounded-xl border-2 px-4 py-3 text-left text-[15px] font-medium shadow-xs transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default',
              visual,
              attached && 'rounded-b-none',
            )}
          >
            {keyBubble('mt-0.5')}
            <span className="flex-1 leading-relaxed">
              {chip ? (
                <span className="flex items-start justify-between gap-2">
                  <McqMarkdown text={opt.text} />
                  {chip}
                </span>
              ) : (
                <McqMarkdown text={opt.text} />
              )}
              {note}
            </span>
            {!chip && mark}
          </button>
        );
        if (!block) return button;
        return (
          <div key={opt.key} className="flex flex-col">
            {button}
            {block}
          </div>
        );
      })}
    </div>
  );
}
