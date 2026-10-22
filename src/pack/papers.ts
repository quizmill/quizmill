/**
 * Pure helpers for the pack's named papers (manifest `papers`, #194).
 * Papers are many and unordered, so the UI never renders them as a pill
 * row: Home and Paper practice show them as a list grouped by `series`,
 * and this is the one place that grouping is decided.
 */
import type { PackPaper } from '@/pack/data';

export interface PaperGroup {
  /** The series name, or null for papers declared without one. */
  series: string | null;
  papers: PackPaper[];
}

/**
 * Session pseudo-subject for a sitting of a paper that spans categories
 * (an exam mock): the session has no one category, so — like the timed
 * exam's 'exam' — it carries this marker while every attempt keeps its
 * question's real category key.
 */
export const PAPER_SUBJECT = 'paper';

/** The session subject for a sitting of `paper`: its owning category
 *  when it has one, otherwise the cross-category marker. */
export function paperSubject(paper: Pick<PackPaper, 'categoryKey'>): string {
  return paper.categoryKey ?? PAPER_SUBJECT;
}

/**
 * Group papers by `series`, keeping manifest order both for the groups
 * (first appearance) and within each group. Papers with no series form
 * one group at the position of the first of them, so an author who
 * lists "Mock 1, Mock 2" before "Series A …" sees them first.
 */
export function groupPapers(papers: readonly PackPaper[]): PaperGroup[] {
  const groups: PaperGroup[] = [];
  const byKey = new Map<string | null, PaperGroup>();
  for (const paper of papers) {
    const key = paper.series ?? null;
    let group = byKey.get(key);
    if (!group) {
      group = { series: key, papers: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.papers.push(paper);
  }
  return groups;
}

/**
 * Per-paper progress for a Home row: how many of the paper's questions
 * have been answered (latest cold look each — see `latestColdLook`) and
 * how many of those were right. A "mock result" for a paper sat whole:
 * nothing stored, derived from attempts like everything else.
 */
export function paperProgress(
  total: number,
  looks: readonly { isCorrect: boolean }[],
): { total: number; answered: number; correct: number; pct: number } {
  const answered = looks.length;
  const correct = looks.filter((a) => a.isCorrect).length;
  return {
    total,
    answered,
    correct,
    pct: answered === 0 ? 0 : Math.round((correct / answered) * 100),
  };
}
