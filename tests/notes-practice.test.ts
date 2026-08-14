import { describe, expect, it } from 'vitest';
import { notesPracticePool } from '@/pack/notes-practice';
import type { PackQuestion } from '@/pack/data';
import type { QuestionNote } from '@/lib/storage';

function question(id: string, over: Partial<PackQuestion> = {}): PackQuestion {
  return {
    id,
    categoryKey: 'cat-a',
    difficulty: 3,
    prompt: `Prompt for ${id}?`,
    options: [
      { key: 'A', text: 'Option A' },
      { key: 'B', text: 'Option B' },
      { key: 'C', text: 'Option C' },
      { key: 'D', text: 'Option D' },
    ],
    correctKey: 'B',
    explanation: 'Because B, for reasons long enough to satisfy the schema.',
    source: 'generated',
    reviewStatus: 'draft',
    ...over,
  };
}

function note(questionId: string, updatedAt: number): QuestionNote {
  return { questionId, text: `note on ${questionId}`, updatedAt };
}

describe('notesPracticePool', () => {
  const bank = [
    question('q1'),
    question('q2'),
    question('f1a', { generatedFrom: { questionId: 'q1', note: 'n' } }),
    question('f1b', { generatedFrom: { questionId: 'q1', note: 'n' } }),
    question('f2a', { generatedFrom: { questionId: 'q2', note: 'n' } }),
    question('q3'),
  ];

  it('gathers follow-ups then the noted original, newest note first', () => {
    const pool = notesPracticePool([note('q1', 100), note('q2', 200)], bank);
    expect(pool.map((q) => q.id)).toEqual(['f2a', 'q2', 'f1a', 'f1b', 'q1']);
  });

  it('a note with no follow-ups yields just the noted question', () => {
    const pool = notesPracticePool([note('q3', 100)], bank);
    expect(pool.map((q) => q.id)).toEqual(['q3']);
  });

  it('survives a note whose question left the pack (keeps its follow-ups)', () => {
    const orphanBank = [question('f9', { generatedFrom: { questionId: 'gone', note: 'n' } })];
    const pool = notesPracticePool([note('gone', 100)], orphanBank);
    expect(pool.map((q) => q.id)).toEqual(['f9']);
  });

  it('dedupes when a follow-up itself carries a note', () => {
    const pool = notesPracticePool([note('f1a', 300), note('q1', 100)], bank);
    // f1a appears once (as the newest note's question), then q1's group.
    expect(pool.map((q) => q.id)).toEqual(['f1a', 'f1b', 'q1']);
  });

  it('caps the round at the batch limit', () => {
    const bigBank = Array.from({ length: 20 }, (_, i) =>
      question(`f${i}`, { generatedFrom: { questionId: 'q1', note: 'n' } }),
    ).concat(question('q1'));
    const pool = notesPracticePool([note('q1', 100)], bigBank, 10);
    expect(pool).toHaveLength(10);
  });

  it('is empty with no notes', () => {
    expect(notesPracticePool([], bank)).toEqual([]);
  });
});
