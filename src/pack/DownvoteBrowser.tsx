'use client';

import { useMemo } from 'react';
import { useQuestionVotes } from '@/lib/useStorage';
import { packQuestions } from '@/pack/data';

/**
 * Settings extra: a browser over downvoted questions, so a pack author
 * can review what users flagged (and the optional "what's wrong?"
 * comments) before editing the pack.
 */
export function DownvoteBrowser() {
  const { votesList } = useQuestionVotes();
  const ups = votesList.filter((v) => v.vote === 'up').length;
  const downs = votesList.filter((v) => v.vote === 'down');
  const byId = useMemo(
    () => new Map(packQuestions.map((q) => [q.id, q])),
    [],
  );

  return (
    <div className="mt-4 rounded-lg border border-brand-200 bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink-800">Question feedback</span>
        <span className="text-xs text-ink-500">
          👍 {ups} · 👎 {downs.length}
        </span>
      </div>
      {downs.length === 0 ? (
        <p className="mt-1 text-xs text-ink-500">
          No downvoted questions yet. You can flag a question via the
          thumbs in the answer-feedback panel.
        </p>
      ) : (
        <ul
          data-testid="dev-downvotes"
          className="mt-2 flex flex-col gap-2"
        >
          {downs.map((v) => {
            const q = byId.get(v.questionId);
            return (
              <li
                key={v.questionId}
                className="rounded-md bg-warn-100/60 px-2 py-1.5"
              >
                <div className="text-xs font-mono text-ink-500">
                  {v.questionId}
                </div>
                <div className="line-clamp-2 text-xs text-ink-700">
                  {q?.prompt ?? '(question no longer in pack)'}
                </div>
                {v.comment ? (
                  <div className="mt-0.5 text-xs italic text-ink-600">
                    &quot;{v.comment}&quot;
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
