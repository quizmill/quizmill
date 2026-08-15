'use client';

import { useRef, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useQuestionNotes } from '@/lib/useStorage';
import { MAX_NOTE_TEXT_LENGTH } from '@/lib/storage';

interface NoteRowProps {
  questionId: string;
}

const NOTE_SAVE_DEBOUNCE_MS = 600;

/**
 * A study note on a question — "come back to this", "I want more
 * questions on this topic". Sits in the answer-feedback panel under the
 * vote row. Collapsed to a small "Add a note" button until tapped (or a
 * note already exists); the textarea saves with a short debounce, and
 * clearing the text deletes the note. Notes are browsable on /notes and
 * feed the generate-questions-from-notes agent skill.
 *
 * State model: the stored note is the source of truth; `draft` (null =
 * not editing) overlays it while typing. Everything else derives at
 * render, so there's no state-syncing effect. Callers key this row by
 * question id so drafts reset when the question advances.
 */
export function NoteRow({ questionId }: NoteRowProps) {
  const { notes, setNote } = useQuestionNotes();
  const existing = notes.get(questionId);
  const [draft, setDraft] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = opened || draft !== null || existing !== undefined;
  const text = draft ?? existing?.text ?? '';

  function handleChange(value: string) {
    setDraft(value);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      setNote(questionId, value);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 800);
    }, NOTE_SAVE_DEBOUNCE_MS);
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="note-toggle"
        onClick={() => setOpened(true)}
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
        maxLength={MAX_NOTE_TEXT_LENGTH}
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
