import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAll,
  getNote,
  loadNotes,
  mergeRemote,
  onMutation,
  recordNote,
  type Mutation,
} from '@/lib/storage';

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
