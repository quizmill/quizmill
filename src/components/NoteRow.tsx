'use client';

import { useEffect, useRef, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useQuestionNotes } from '@/lib/useStorage';

interface NoteRowProps {
  questionId: string;
}

const NOTE_SAVE_DEBOUNCE_MS = 600;

/**
 * A study note on a question — "come back to this", "I want more
 * questions on this topic". Sits in the answer-feedback panel under the
 * vote row. Collapsed to a small "Add a note" button until tapped (or a
 * note already exists); the textarea saves with a short debounce, and
 * clearing the text deletes the note. Notes are browsable (and exportable
 * for AI question generation) on the /notes page.
 */
export function NoteRow({ questionId }: NoteRowProps) {
  const { notes, setNote } = useQuestionNotes();
  const existing = notes.get(questionId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The hook's list loads async (after mount) and refreshes on storage
  // events; only adopt storage state until the user starts editing here.
  const dirtyRef = useRef(false);

  // Reset when the row is reused for another question (this effect must run
  // before the adoption effect below, so it can't clobber an adopted note on
  // the same render pass).
  useEffect(() => {
    dirtyRef.current = false;
    setOpen(false);
    setText('');
  }, [questionId]);

  useEffect(() => {
    if (dirtyRef.current) return;
    if (existing) {
      setText(existing.text);
      setOpen(true);
    }
  }, [existing]);

  function flush(value: string) {
    setNote(questionId, value);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 800);
  }

  function handleChange(value: string) {
    dirtyRef.current = true;
    setText(value);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => flush(value), NOTE_SAVE_DEBOUNCE_MS);
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="note-toggle"
        onClick={() => setOpen(true)}
        className="tap-feedback inline-flex items-center gap-1.5 self-start rounded-full border border-ink-200 bg-surface px-3 py-1.5 text-sm font-medium text-ink-600 hover:border-brand-500/40"
      >
        <NotebookPen className="h-4 w-4" />
        Add a note
      </button>
    );
  }

  return (
    <div data-testid="note-row" className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-sm text-ink-500">
        <NotebookPen className="h-4 w-4" />
        <span>My note</span>
      </div>
      <textarea
        data-testid="note-text"
        placeholder="e.g. Review this again — and I'd like more questions on this topic."
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={2}
        className="w-full resize-y rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
      />
      <span
        className={cn(
          'text-right text-xs',
          savedFlash ? 'text-success-700' : 'text-ink-400',
        )}
      >
        {savedFlash
          ? 'Saved ✓'
          : text.trim().length > 0
            ? 'Saves when you stop typing · find it later under Notes'
            : existing
              ? 'Cleared text deletes the note.'
              : ''}
      </span>
    </div>
  );
}
