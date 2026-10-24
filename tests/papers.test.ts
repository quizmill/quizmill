import { describe, expect, it } from 'vitest';
import { groupPapers, paperProgress, paperSubject, PAPER_SUBJECT } from '@/pack/papers';
import { bankForPaper } from '@/pack/runner';
import type { PackPaper, PackQuestion } from '@/pack/data';

function q(id: string, paperId?: string, categoryKey = 'c'): PackQuestion {
  return {
    id,
    categoryKey,
    difficulty: 1,
    prompt: 'a prompt long enough',
    options: [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
    ],
    correctKey: 'A',
    explanation: 'x'.repeat(40),
    source: 'generated',
    reviewStatus: 'draft',
    ...(paperId ? { paperId } : {}),
  };
}

describe('groupPapers', () => {
  const papers: PackPaper[] = [
    { key: 'mock-1', label: 'Practice exam 1' },
    { key: 'a1', label: 'Paper 1', series: 'Series A' },
    { key: 'b1', label: 'Paper 1', series: 'Series B' },
    { key: 'a2', label: 'Paper 2', series: 'Series A' },
    { key: 'mock-2', label: 'Practice exam 2' },
  ];

  it('groups by series in order of first appearance, keeping manifest order within a group', () => {
    const groups = groupPapers(papers);
    expect(groups.map((g) => g.series)).toEqual([null, 'Series A', 'Series B']);
    expect(groups[0].papers.map((p) => p.key)).toEqual(['mock-1', 'mock-2']);
    expect(groups[1].papers.map((p) => p.key)).toEqual(['a1', 'a2']);
    expect(groups[2].papers.map((p) => p.key)).toEqual(['b1']);
  });

  it('is a single unnamed group when no paper declares a series', () => {
    const groups = groupPapers([
      { key: 'p1', label: 'One' },
      { key: 'p2', label: 'Two' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].series).toBeNull();
    expect(groups[0].papers).toHaveLength(2);
  });

  it('returns no groups for no papers', () => {
    expect(groupPapers([])).toEqual([]);
  });
});

describe('bankForPaper', () => {
  // Bank order is paper order — the whole-paper sheet relies on it.
  const bank = [q('p1-q1', 'p1'), q('loose'), q('p1-q2', 'p1', 'other'), q('p2-q1', 'p2')];

  it('returns the paper’s questions in bank order, whatever their category', () => {
    expect(bankForPaper(bank, 'p1').map((x) => x.id)).toEqual(['p1-q1', 'p1-q2']);
  });

  it('is empty for an unknown paper', () => {
    expect(bankForPaper(bank, 'ghost')).toEqual([]);
  });
});

describe('paperSubject', () => {
  it('is the owning category for a single-category paper', () => {
    expect(paperSubject({ categoryKey: 'maths' })).toBe('maths');
  });

  it('is the cross-category marker for a paper with no categoryKey', () => {
    expect(paperSubject({})).toBe(PAPER_SUBJECT);
    expect(PAPER_SUBJECT).toBe('paper');
  });
});

describe('paperProgress', () => {
  it('counts answered and correct over the latest cold looks', () => {
    expect(
      paperProgress(50, [{ isCorrect: true }, { isCorrect: false }, { isCorrect: true }]),
    ).toEqual({ total: 50, answered: 3, correct: 2, pct: 67 });
  });

  it('reads 0% (not NaN) before anything is answered', () => {
    expect(paperProgress(50, [])).toEqual({ total: 50, answered: 0, correct: 0, pct: 0 });
  });
});
