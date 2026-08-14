/**
 * Notes export — turn the learner's question notes into something an AI
 * (or a human tutor) can act on: "generate more questions on the topics
 * I flagged, taking my comments into account".
 *
 * Two pure builders over the same joined data:
 *   • buildNotesExport   → versioned JSON (`quizmill-notes`), the machine
 *     contract consumed by the `generate-questions-from-notes` agent skill.
 *     Self-contained: each note carries its full question (prompt, options,
 *     answer, category), so the consumer doesn't need the pack files.
 *   • buildNotesPrompt   → a ready-to-paste markdown prompt for any chat
 *     assistant, instructions included.
 *
 * Lives in src/pack (not src/lib) because it joins notes to question
 * shapes — the engine layer deliberately never sees those.
 */
import type { QuestionNote } from '@/lib/storage';
import { correctKeysOf, type PackCategory, type PackQuestion } from './data';

export const NOTES_EXPORT_FORMAT = 'quizmill-notes';
export const NOTES_EXPORT_VERSION = 1;

export interface NotedQuestion {
  questionId: string;
  note: string;
  noteUpdatedAt: number; // unix ms
  /** Absent when the question is no longer in the pack. */
  question?: {
    prompt: string;
    options: { key: string; text: string }[];
    correctKeys: string[];
    explanation: string;
    categoryKey: string;
    categoryLabel: string;
    difficulty: number;
    tags?: string[];
  };
}

export interface NotesExport {
  format: typeof NOTES_EXPORT_FORMAT;
  version: typeof NOTES_EXPORT_VERSION;
  packId: string;
  packTitle: string;
  exportedAt: number; // unix ms
  notes: NotedQuestion[];
}

/** Join notes to their questions (newest note first). Pure — unit-tested. */
export function buildNotesExport(
  notes: readonly QuestionNote[],
  questions: readonly PackQuestion[],
  categories: readonly PackCategory[],
  pack: { id: string; title: string },
  now: number = Date.now(),
): NotesExport {
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const categoryLabel = new Map(categories.map((c) => [c.key, c.label]));
  const joined = [...notes]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((n): NotedQuestion => {
      const q = questionById.get(n.questionId);
      return {
        questionId: n.questionId,
        note: n.text,
        noteUpdatedAt: n.updatedAt,
        ...(q
          ? {
              question: {
                prompt: q.prompt,
                options: q.options.map((o) => ({ key: o.key, text: o.text })),
                correctKeys: correctKeysOf(q),
                explanation: q.explanation,
                categoryKey: q.categoryKey,
                categoryLabel: categoryLabel.get(q.categoryKey) ?? q.categoryKey,
                difficulty: q.difficulty,
                ...(q.tags?.length ? { tags: q.tags } : {}),
              },
            }
          : {}),
      };
    });
  return {
    format: NOTES_EXPORT_FORMAT,
    version: NOTES_EXPORT_VERSION,
    packId: pack.id,
    packTitle: pack.title,
    exportedAt: now,
    notes: joined,
  };
}

/** `quizmill-notes-<packId>-YYYY-MM-DD.json` (local date). */
export function notesExportFilename(packId: string, exportedAt: number): string {
  const d = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `quizmill-notes-${packId}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/**
 * A self-explanatory markdown prompt for pasting into any AI chat: the
 * learner's notes, each with its question for context, plus instructions
 * to generate NEW questions honouring what the notes ask for.
 */
export function buildNotesPrompt(data: NotesExport): string {
  const lines: string[] = [
    `I practise with "${data.packTitle}", a multiple-choice question app.`,
    'While practising I left notes on questions I want to revisit or go',
    'deeper on. For each noted question below, read my note together with',
    'the original question, then write NEW practice questions that follow',
    'up on it — same topic, angles my note asks for, similar difficulty',
    'unless the note says otherwise. For every new question give: the',
    'question, options A–D (one clearly correct, plausible distractors),',
    'the correct letter, and a short explanation of why the answer is',
    'right and the tempting distractors are wrong.',
    '',
  ];
  data.notes.forEach((n, i) => {
    lines.push(`## ${i + 1}. ${n.question?.categoryLabel ?? 'Question'} (${n.questionId})`);
    if (n.question) {
      lines.push(`Question: ${n.question.prompt}`);
      for (const o of n.question.options) lines.push(`- ${o.key}) ${o.text}`);
      lines.push(`Correct: ${n.question.correctKeys.join(', ')}`);
    } else {
      lines.push('(This question is no longer in the pack.)');
    }
    lines.push(`MY NOTE: ${n.note}`);
    lines.push('');
  });
  return lines.join('\n');
}
