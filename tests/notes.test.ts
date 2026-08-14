import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAll,
  getNote,
  loadNotes,
  mergeRemote,
  onMutation,
  recordNote,
  saveNotes,
  type Mutation,
} from '@/lib/storage';
import {
  buildNotesExport,
  buildNotesPrompt,
  notesExportFilename,
  NOTES_EXPORT_FORMAT,
  NOTES_EXPORT_VERSION,
} from '@/pack/notes-export';
import type { PackCategory, PackQuestion } from '@/pack/data';

// Minimal localStorage so the storage module (node test env) has a window.
function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeLocalStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('question notes (storage)', () => {
  it('records, updates, and reads back a note', () => {
    recordNote('q1', 'go deeper on this', 100);
    expect(getNote('q1')).toEqual({ questionId: 'q1', text: 'go deeper on this', updatedAt: 100 });

    recordNote('q1', 'actually, revisit next week', 200);
    expect(loadNotes()).toHaveLength(1); // one note per question — replaced
    expect(getNote('q1')?.text).toBe('actually, revisit next week');
    expect(getNote('q1')?.updatedAt).toBe(200);
  });

  it('trims text and treats empty/whitespace/null as delete', () => {
    recordNote('q1', '  padded  ', 100);
    expect(getNote('q1')?.text).toBe('padded');

    recordNote('q1', '   ', 200);
    expect(getNote('q1')).toBeUndefined();

    recordNote('q2', 'x', 100);
    recordNote('q2', null, 200);
    expect(loadNotes()).toEqual([]);
  });

  it('deleting a non-existent note is a silent no-op (no mutation emitted)', () => {
    const seen: Mutation[] = [];
    const off = onMutation((m) => seen.push(m));
    recordNote('q-none', null);
    off();
    expect(seen).toEqual([]);
  });

  it('emits upsert and delete mutations for the sync queue', () => {
    const seen: Mutation[] = [];
    const off = onMutation((m) => seen.push(m));
    recordNote('q1', 'note', 100);
    recordNote('q1', '', 200);
    off();
    expect(seen).toEqual([
      { table: 'notes', row: { questionId: 'q1', text: 'note', updatedAt: 100 } },
      { table: 'notes', op: 'delete', questionId: 'q1' },
    ]);
  });

  it('merges remote notes last-write-wins by updatedAt', () => {
    recordNote('q1', 'local older', 100);
    recordNote('q2', 'local newer', 500);

    const changed = mergeRemote({
      notes: [
        { questionId: 'q1', text: 'remote newer', updatedAt: 200 },
        { questionId: 'q2', text: 'remote older', updatedAt: 100 },
        { questionId: 'q3', text: 'remote only', updatedAt: 50 },
      ],
    });

    expect(changed).toBe(true);
    expect(getNote('q1')?.text).toBe('remote newer');
    expect(getNote('q2')?.text).toBe('local newer');
    expect(getNote('q3')?.text).toBe('remote only');
  });

  it('clearAll wipes notes too', () => {
    recordNote('q1', 'note', 100);
    clearAll();
    expect(loadNotes()).toEqual([]);
  });
});

// ---- notes export (the AI-generation handoff) ----

const categories: PackCategory[] = [
  { key: 'cat-a', label: 'Category A' },
  { key: 'cat-b', label: 'Category B' },
];

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
    explanation: 'Because B.',
    source: 'generated',
    reviewStatus: 'draft',
    ...over,
  };
}

describe('buildNotesExport', () => {
  it('joins notes to their questions, newest note first', () => {
    saveNotes([
      { questionId: 'q1', text: 'older note', updatedAt: 100 },
      { questionId: 'q2', text: 'newer note', updatedAt: 200 },
    ]);
    const out = buildNotesExport(
      loadNotes(),
      [question('q1'), question('q2', { categoryKey: 'cat-b', tags: ['t1'] })],
      categories,
      { id: 'demo', title: 'Demo Pack' },
      999,
    );

    expect(out.format).toBe(NOTES_EXPORT_FORMAT);
    expect(out.version).toBe(NOTES_EXPORT_VERSION);
    expect(out.packId).toBe('demo');
    expect(out.exportedAt).toBe(999);
    expect(out.notes.map((n) => n.questionId)).toEqual(['q2', 'q1']);
    expect(out.notes[0].question).toMatchObject({
      categoryKey: 'cat-b',
      categoryLabel: 'Category B',
      correctKeys: ['B'],
      tags: ['t1'],
    });
    expect(out.notes[1].question?.options).toHaveLength(4);
  });

  it('normalises multi-answer keys and survives a vanished question', () => {
    const out = buildNotesExport(
      [
        { questionId: 'q-multi', text: 'tricky', updatedAt: 1 },
        { questionId: 'q-gone', text: 'question was removed', updatedAt: 2 },
      ],
      [question('q-multi', { correctKey: undefined, correctKeys: ['A', 'C'] })],
      categories,
      { id: 'demo', title: 'Demo Pack' },
    );
    const multi = out.notes.find((n) => n.questionId === 'q-multi');
    const gone = out.notes.find((n) => n.questionId === 'q-gone');
    expect(multi?.question?.correctKeys).toEqual(['A', 'C']);
    expect(gone?.question).toBeUndefined();
    expect(gone?.note).toBe('question was removed');
  });

  it('names the file with pack id and zero-padded local date', () => {
    expect(notesExportFilename('demo', new Date(2026, 7, 3).getTime())).toBe(
      'quizmill-notes-demo-2026-08-03.json',
    );
  });
});

describe('buildNotesPrompt', () => {
  it('renders instructions, each question with options + answer, and the note', () => {
    const data = buildNotesExport(
      [{ questionId: 'q1', text: 'MORE of these please', updatedAt: 1 }],
      [question('q1')],
      categories,
      { id: 'demo', title: 'Demo Pack' },
    );
    const md = buildNotesPrompt(data);
    expect(md).toContain('"Demo Pack"');
    expect(md).toContain('## 1. Category A (q1)');
    expect(md).toContain('Question: Prompt for q1?');
    expect(md).toContain('- B) Option B');
    expect(md).toContain('Correct: B');
    expect(md).toContain('MY NOTE: MORE of these please');
  });

  it('flags questions that left the pack instead of dropping the note', () => {
    const data = buildNotesExport(
      [{ questionId: 'q-gone', text: 'still want this topic', updatedAt: 1 }],
      [],
      categories,
      { id: 'demo', title: 'Demo Pack' },
    );
    const md = buildNotesPrompt(data);
    expect(md).toContain('no longer in the pack');
    expect(md).toContain('MY NOTE: still want this topic');
  });
});
