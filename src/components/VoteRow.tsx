'use client';

import { useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useQuestionVotes } from '@/lib/useStorage';

interface VoteRowProps {
  questionId: string;
}

const COMMENT_SAVE_DEBOUNCE_MS = 600;

/**
 * Thumbs-up / thumbs-down on a question. Sits in the feedback panel
 * after the kid has answered.  Tap a thumb to vote; tap the same thumb
 * again to clear. A downvote expands a small textarea for an optional
 * "what's wrong?" comment, saved with a short debounce.
 *
 * Captured locally for now; the Developer panel in Settings surfaces
 * the count so a parent can review the curated list before any teacher
 * review pass.
 *
 * State model: the stored vote is the source of truth; `draft` (null =
 * not editing) overlays the comment while typing, so no state-syncing
 * effect is needed. Callers key this row by question id.
 */
export function VoteRow({ questionId }: VoteRowProps) {
  const { votes, setVote } = useQuestionVotes();
  const existing = votes.get(questionId);
  const [draft, setDraft] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<boolean>(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const comment = draft ?? existing?.comment ?? '';

  function flushComment(text: string) {
    if (existing?.vote !== 'down') return;
    setVote(questionId, 'down', text.trim() || undefined);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 800);
  }

  function handleCommentChange(value: string) {
    setDraft(value);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(
      () => flushComment(value),
      COMMENT_SAVE_DEBOUNCE_MS,
    );
  }

  function tapUp() {
    if (existing?.vote === 'up') {
      setVote(questionId, null);
      return;
    }
    setVote(questionId, 'up');
  }

  function tapDown() {
    if (existing?.vote === 'down') {
      setVote(questionId, null);
      setDraft(null);
      return;
    }
    // Preserve any comment we already have in local state.
    setVote(questionId, 'down', comment.trim() || undefined);
  }

  const showCommentField = existing?.vote === 'down';

  return (
    <div data-testid="vote-row" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm text-ink-500">
        <span>Was this question OK?</span>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="vote-up"
            aria-pressed={existing?.vote === 'up'}
            aria-label="Thumbs up"
            onClick={tapUp}
            className={cn(
              'tap-feedback inline-flex items-center justify-center rounded-full border-2 p-2 transition',
              existing?.vote === 'up'
                ? 'border-success-500 bg-success-100 text-success-700'
                : 'border-ink-200 bg-surface text-ink-500 hover:border-success-500/40',
            )}
          >
            <ThumbsUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="vote-down"
            aria-pressed={existing?.vote === 'down'}
            aria-label="Thumbs down"
            onClick={tapDown}
            className={cn(
              'tap-feedback inline-flex items-center justify-center rounded-full border-2 p-2 transition',
              existing?.vote === 'down'
                ? 'border-warn-500 bg-warn-100 text-warn-700'
                : 'border-ink-200 bg-surface text-ink-500 hover:border-warn-500/40',
            )}
          >
            <ThumbsDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showCommentField ? (
        <div className="flex flex-col gap-1">
          <textarea
            data-testid="vote-comment"
            placeholder="What's wrong? (optional)"
            value={comment}
            onChange={(e) => handleCommentChange(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:border-warn-500 focus:outline-none"
          />
          {savedFlash ? (
            <span className="text-right text-xs text-success-700">Saved ✓</span>
          ) : (
            <span className="text-right text-xs text-ink-400">
              {comment.length > 0 ? 'Will save when you stop typing.' : ''}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
