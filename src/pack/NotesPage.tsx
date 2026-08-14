'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Check, Download, NotebookPen, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { APP_CONFIG } from '@/config';
import { useQuestionNotes } from '@/lib/useStorage';
import { cn } from '@/lib/cn';
import {
  packManifest,
  packQuestions,
  PACK_CATEGORY_ICON,
  PACK_CATEGORY_LABEL,
} from '@/pack/data';
import {
  buildNotesExport,
  buildNotesPrompt,
  notesExportFilename,
} from '@/pack/notes-export';

const NOTE_SAVE_DEBOUNCE_MS = 600;

/**
 * One note in the list: the question it hangs on (category chip + prompt)
 * with the note text editable in place — same debounce-save behaviour as
 * the NoteRow in the answer panel — and a delete button.
 */
function NoteCard({
  questionId,
  initialText,
  updatedAt,
  onSave,
  onDelete,
}: {
  questionId: string;
  initialText: string;
  updatedAt: number;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const question = useMemo(
    () => packQuestions.find((q) => q.id === questionId),
    [questionId],
  );
  const [text, setText] = useState(initialText);
  const [savedFlash, setSavedFlash] = useState(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(value: string) {
    setText(value);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      // An emptied note is deleted on the delete button, not silently on
      // debounce — losing the row mid-edit would be jarring.
      if (value.trim()) {
        onSave(value);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 800);
      }
    }, NOTE_SAVE_DEBOUNCE_MS);
  }

  const categoryLabel = question
    ? (PACK_CATEGORY_LABEL[question.categoryKey] ?? question.categoryKey)
    : null;
  const icon = question ? PACK_CATEGORY_ICON[question.categoryKey] : null;

  return (
    <li
      data-testid="note-card"
      className="flex flex-col gap-2 rounded-2xl border border-ink-200 bg-surface p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {categoryLabel ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-600">
              <span aria-hidden>{icon}</span>
              {categoryLabel}
            </span>
          ) : null}
          <p className="mt-1.5 line-clamp-3 text-sm text-ink-700">
            {question?.prompt ?? '(this question is no longer in the pack)'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Delete note"
          onClick={onDelete}
          className="tap-feedback inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-warn-100 hover:text-warn-700"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <textarea
        aria-label="Note text"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={2}
        className="w-full resize-y rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-800 focus:border-brand-500 focus:outline-none"
      />
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>{new Date(updatedAt).toLocaleDateString()}</span>
        <span className={cn(savedFlash && 'text-success-700')}>
          {savedFlash ? 'Saved ✓' : ''}
        </span>
      </div>
    </li>
  );
}

/**
 * The learner's question notes in one place: review them, edit or delete,
 * and hand them to an AI to grind out MORE questions on exactly those
 * topics — either as a ready-to-paste prompt or as a JSON file for the
 * `generate-questions-from-notes` agent skill.
 */
export default function NotesPage() {
  const { notesList, setNote } = useQuestionNotes();
  const [copied, setCopied] = useState(false);
  const sorted = useMemo(
    () => [...notesList].sort((a, b) => b.updatedAt - a.updatedAt),
    [notesList],
  );

  function exportData() {
    return buildNotesExport(
      notesList,
      packQuestions,
      packManifest.categories,
      { id: APP_CONFIG.packId, title: APP_CONFIG.title },
    );
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildNotesPrompt(exportData()));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions, http); the download
      // button right next to this one is the fallback.
    }
  }

  function downloadJson() {
    const data = exportData();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = notesExportFilename(data.packId, data.exportedAt);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        {sorted.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
            <NotebookPen className="h-4 w-4" />
            {sorted.length} {sorted.length === 1 ? 'note' : 'notes'}
          </span>
        ) : null}
      </header>

      <div>
        <h1 className="text-3xl font-bold text-ink-900">My notes</h1>
        <p className="mt-1 text-ink-500">
          Questions you flagged to revisit or dig deeper into.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-surface p-5 text-sm text-ink-600">
          <p className="font-semibold text-ink-800">No notes yet.</p>
          <p className="mt-1.5 leading-relaxed">
            After you answer a question, tap <strong>Add a note</strong>{' '}
            in the answer panel to jot down anything you want to come back to —
            &ldquo;review this again&rdquo;, &ldquo;I want more questions on
            this topic&rdquo;. Your notes collect here, ready to review or to
            turn into new practice questions.
          </p>
        </div>
      ) : (
        <>
          <section
            data-testid="notes-generate-card"
            className="flex flex-col gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-4"
          >
            <div className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <Sparkles className="h-5 w-5 text-brand-600" />
              Get more questions on these topics
            </div>
            <p className="text-sm leading-relaxed text-ink-600">
              Hand your notes to an AI and it can write new practice questions
              that follow up on exactly what you flagged. Copy the ready-made
              prompt into any chat assistant — or download the notes file and
              give it to an agent with this app&rsquo;s{' '}
              <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">
                generate-questions-from-notes
              </code>{' '}
              skill to grow the pack itself.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={copyPrompt} data-testid="notes-copy-prompt">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy AI prompt'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={downloadJson}
                data-testid="notes-download"
              >
                <Download className="h-4 w-4" />
                Download notes file
              </Button>
            </div>
          </section>

          <ul data-testid="notes-list" className="flex flex-col gap-3">
            {sorted.map((n) => (
              <NoteCard
                key={n.questionId}
                questionId={n.questionId}
                initialText={n.text}
                updatedAt={n.updatedAt}
                onSave={(text) => setNote(n.questionId, text)}
                onDelete={() => setNote(n.questionId, null)}
              />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
