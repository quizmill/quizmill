/**
 * Question pool for a notes-focused practice session (/practice/notes):
 * everything "around the learner's notes" — for each noted question, the
 * follow-up questions generated from it (`generatedFrom` points back at
 * it) plus the noted question itself, so a round mixes the new material
 * with a re-visit of what triggered the note.
 *
 * Pure and pack-shape-aware, so it lives in src/pack (the engine layer
 * never sees question shapes) and is unit-tested with fixtures.
 */
import type { QuestionNote } from '@/lib/storage';
import type { PackQuestion } from './data';

export const NOTES_BATCH_SIZE = 10;

/**
 * Build the ordered pool: notes newest-first; per note its follow-ups
 * (bank order) then the noted original. Deduped (a follow-up can itself
 * carry a note) and capped at `limit`. Notes whose question vanished
 * still contribute their follow-ups.
 */
export function notesPracticePool(
  notes: readonly QuestionNote[],
  questions: readonly PackQuestion[],
  limit: number = NOTES_BATCH_SIZE,
): PackQuestion[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const followUpsByOrigin = new Map<string, PackQuestion[]>();
  for (const q of questions) {
    const origin = q.generatedFrom?.questionId;
    if (!origin) continue;
    const list = followUpsByOrigin.get(origin) ?? [];
    list.push(q);
    followUpsByOrigin.set(origin, list);
  }

  const picked: PackQuestion[] = [];
  const seen = new Set<string>();
  const add = (q: PackQuestion | undefined) => {
    if (!q || seen.has(q.id) || picked.length >= limit) return;
    seen.add(q.id);
    picked.push(q);
  };

  for (const note of [...notes].sort((a, b) => b.updatedAt - a.updatedAt)) {
    for (const f of followUpsByOrigin.get(note.questionId) ?? []) add(f);
    add(byId.get(note.questionId));
    if (picked.length >= limit) break;
  }
  return picked;
}
