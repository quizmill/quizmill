'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { PackChip } from '@/components/PackChip';
import { NotebookPen, Play, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { APP_CONFIG } from '@/config';
import { useQuestionNotes } from '@/lib/useStorage';
import { MAX_NOTE_TEXT_LENGTH } from '@/lib/storage';
import { useDebouncedNote } from '@/lib/useDebouncedNote';
import { cn } from '@/lib/cn';
import {
  packQuestions,
  PACK_CATEGORY_ICON,
  PACK_CATEGORY_LABEL,
} from '@/pack/data';
import { notesPracticePool } from '@/pack/notes-practice';

/**
 * One note in the list: the question it hangs on (category chip + prompt)
 * with the note text editable in place — the same `useDebouncedNote`
 * save as the NoteRow in the answer panel, except that an emptied note is
 * deleted on the delete button, not silently on debounce (losing the row
 * mid-edit would be jarring) — a delete button, and a count of the
 * follow-up questions already generated from it (questions whose
 * `generatedFrom` points back at this note's question).
 */
function NoteCard({
  questionId,
  storedText,
  updatedAt,
  followUps,
  onSave,
  onDelete,
}: {
  questionId: string;
  storedText: string;
  updatedAt: number;
  followUps: number;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const question = useMemo(
    () => packQuestions.find((q) => q.id === questionId),
    [questionId],
  );
  const { text, setText, savedFlash, cancel } = useDebouncedNote(
    storedText,
    onSave,
    { keepEmpty: true },
  );
  // Drop any draft still waiting on the debounce before the delete removes
  // this card — otherwise the unmount flush would write it straight back.
  const handleDelete = () => {
    cancel();
    onDelete();
  };

  const categoryLabel = question
    ? (PACK_CATEGORY_LABEL[question.categoryKey] ?? question.categoryKey)
    : null;
  const icon = question ? PACK_CATEGORY_ICON[question.categoryKey] : null;

  return (
    <li
      data-testid="note-card"
      className="flex flex-col gap-2 rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {categoryLabel ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-600">
                <span aria-hidden>{icon}</span>
                {categoryLabel}
              </span>
            ) : null}
            {followUps > 0 ? (
              <span
                data-testid="note-followups"
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700"
              >
                <Sparkles className="h-3 w-3" />
                {followUps} follow-up {followUps === 1 ? 'question' : 'questions'} in the pack
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 line-clamp-3 text-sm text-ink-700">
            {question?.prompt ?? '(this question is no longer in the pack)'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Delete note"
          onClick={handleDelete}
          className="tap-feedback inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-warn-100 hover:text-warn-700"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <textarea
        aria-label="Note text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_NOTE_TEXT_LENGTH}
        rows={2}
        className="w-full resize-y rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-800 focus:border-brand-500 focus:outline-hidden"
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
 * The learner's question notes in one place: review, edit, delete — and
 * the hand-off to an AI agent that turns them into new pack questions.
 * No manual export: the agent reads notes straight from the sync backend
 * (they're a synced table) via the generate-questions-from-notes skill,
 * and every generated question links back to its note (`generatedFrom`),
 * shown in the answer panel and counted on the note cards here.
 */
export default function NotesPage() {
  const { notesList, setNote } = useQuestionNotes();
  const sorted = useMemo(
    () => [...notesList].sort((a, b) => b.updatedAt - a.updatedAt),
    [notesList],
  );
  // questionId (of the noted question) → how many pack questions were
  // generated from a note on it.
  const followUpCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of packQuestions) {
      const from = q.generatedFrom?.questionId;
      if (from) counts.set(from, (counts.get(from) ?? 0) + 1);
    }
    return counts;
  }, []);
  // Size of a notes-focused practice round (noted questions + their
  // generated follow-ups) — powers the "Practice these" button.
  const poolSize = useMemo(
    () => notesPracticePool(notesList, packQuestions).length,
    [notesList],
  );

  return (
    <main className="flex flex-col gap-6">
      {sorted.length > 0 ? (
        <header className="flex items-center justify-end">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
            <NotebookPen className="h-4 w-4" />
            {sorted.length} {sorted.length === 1 ? 'note' : 'notes'}
          </span>
        </header>
      ) : null}

      <div>
        <PackChip className="mb-2" />
        <h1 className="text-3xl font-bold text-ink-900">My notes</h1>
        <p className="mt-1 text-ink-500">
          Questions you flagged to revisit or dig deeper into.
        </p>
      </div>

      {sorted.length > 0 && poolSize > 0 ? (
        <Link href="/practice/notes/" className="block">
          <Button size="lg" block data-testid="notes-practice-cta">
            <Play className="h-4 w-4" />
            Practice these topics ({poolSize}{' '}
            {poolSize === 1 ? 'question' : 'questions'})
          </Button>
        </Link>
      ) : null}

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
            className="flex flex-col gap-2 rounded-2xl border border-brand-500/30 bg-brand-50 p-4"
          >
            <div className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <Sparkles className="h-5 w-5 text-brand-600" />
              Get more questions on these topics
            </div>
            <p className="text-sm leading-relaxed text-ink-600">
              Tell your AI agent:{' '}
              <em>&ldquo;generate questions based on my notes&rdquo;</em>. With
              this app&rsquo;s{' '}
              <code className="rounded-sm bg-ink-100 px-1 py-0.5 text-xs">
                generate-questions-from-notes
              </code>{' '}
              skill it reads your notes for{' '}
              <span className="font-semibold">{APP_CONFIG.title}</span> straight
              from your sync backend and adds new draft questions to the pack —
              each one labelled with the note and question that inspired it.
            </p>
            <p className="text-xs text-ink-500">
              Not syncing? Your notes also travel in the progress file from
              Settings → Move progress.
            </p>
          </section>

          <ul data-testid="notes-list" className="flex flex-col gap-3">
            {sorted.map((n) => (
              <NoteCard
                key={n.questionId}
                questionId={n.questionId}
                storedText={n.text}
                updatedAt={n.updatedAt}
                followUps={followUpCounts.get(n.questionId) ?? 0}
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
