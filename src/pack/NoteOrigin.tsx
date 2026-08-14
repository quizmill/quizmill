import { useMemo } from 'react';
import { NotebookPen } from 'lucide-react';
import { packQuestions, type PackQuestion } from '@/pack/data';

/**
 * Provenance chip for a question generated from one of the learner's
 * study notes (`generatedFrom` in the pack schema). Shown in the answer
 * feedback panel so the loop closes visibly: you asked for this — here's
 * the note, and the question it was left on. Degrades gracefully when
 * the original question has since left the pack.
 */
export function NoteOrigin({
  generatedFrom,
}: {
  generatedFrom?: PackQuestion['generatedFrom'];
}) {
  const original = useMemo(
    () =>
      generatedFrom
        ? packQuestions.find((q) => q.id === generatedFrom.questionId)
        : undefined,
    [generatedFrom],
  );
  if (!generatedFrom) return null;

  return (
    <div
      data-testid="note-origin"
      className="flex flex-col gap-1 rounded-lg border border-brand-500/30 bg-brand-50 px-3 py-2 text-xs text-ink-600"
    >
      <div className="inline-flex items-center gap-1 font-semibold text-brand-700">
        <NotebookPen className="h-3.5 w-3.5" />
        Made for you, from your note
      </div>
      <div className="italic">&ldquo;{generatedFrom.note}&rdquo;</div>
      {original ? (
        <div className="text-ink-500">
          Left on: <span className="line-clamp-2">{original.prompt}</span>
        </div>
      ) : null}
    </div>
  );
}
