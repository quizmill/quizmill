'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStarredQuestions } from '@/lib/useStorage';

interface StarButtonProps {
  questionId: string;
  /** 'row' renders the labelled feedback-panel control; 'icon' a bare toggle. */
  variant?: 'row' | 'icon';
  className?: string;
}

/**
 * Star a question to review and refine it later. In the feedback panel it
 * sits beside the thumbs row as a labelled control; the `icon` variant is a
 * bare toggle for compact spots (e.g. the Starred page list). Tapping
 * toggles; the star fills when set. Persisted locally and mirrored to the
 * cloud when sync is on.
 */
export function StarButton({ questionId, variant = 'row', className }: StarButtonProps) {
  const { stars, toggleStar } = useStarredQuestions();
  const starred = stars.has(questionId);

  const toggle = (
    <button
      type="button"
      data-testid="star-toggle"
      aria-pressed={starred}
      aria-label={starred ? 'Unstar this question' : 'Star this question for later'}
      onClick={() => toggleStar(questionId)}
      className={cn(
        'tap-feedback inline-flex items-center justify-center rounded-full border-2 p-2 transition',
        starred
          ? 'border-brand-500 bg-brand-100 text-brand-700'
          : 'border-ink-200 bg-white text-ink-500 hover:border-brand-500/40',
      )}
    >
      <Star className={cn('h-4 w-4', starred && 'fill-current')} />
    </button>
  );

  if (variant === 'icon') {
    return <span className={className}>{toggle}</span>;
  }

  return (
    <div
      data-testid="star-row"
      className={cn('flex items-center justify-between gap-3 text-sm text-ink-500', className)}
    >
      <span>{starred ? 'Saved to review later.' : 'Star to review & refine later.'}</span>
      {toggle}
    </div>
  );
}
