import { tagNamesLevel } from '../../tools/pack/schema';
import { cn } from '@/lib/cn';
import {
  PACK_CATEGORY_LABEL,
  PACK_LEVEL_LABEL,
  PACK_LEVEL_TONE,
  PACK_PAPER_BY_KEY,
  type PackQuestion,
} from '@/pack/data';

/**
 * The metadata chip row above a question: its category, level band (if the
 * pack defines levels), the paper it belongs to (if the pack defines
 * papers), and any tags (topic, source marker, …). All pack-driven — the
 * engine carries no domain terminology.
 */
export function QuestionMeta({
  question,
  hideTags = false,
}: {
  question: PackQuestion;
  /** Category + level only — for views where the pack's tags are noise
   *  (the coach replay shows a parent the question, not its taxonomy). */
  hideTags?: boolean;
}) {
  // A level chip only when the pack names the band (a stray level key
  // on a question that the manifest doesn't declare renders nothing).
  const level = question.level;
  const levelLabel = level ? PACK_LEVEL_LABEL[level] : undefined;
  // Likewise a paper chip only for a declared paper; "Series · Paper 1",
  // since two books can both have a Paper 1.
  const paper = question.paperId ? PACK_PAPER_BY_KEY[question.paperId] : undefined;
  // A tag that repeats the level would show the tier twice next to its
  // chip; a tag naming some other level stays.
  const tags = hideTags
    ? []
    : (question.tags ?? []).filter(
        (tag) => !(level && levelLabel && tagNamesLevel(tag, { key: level, label: levelLabel })),
      );
  return (
    <>
      <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
        {PACK_CATEGORY_LABEL[question.categoryKey] ?? question.categoryKey}
      </span>
      {level && levelLabel ? (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
            PACK_LEVEL_TONE[level],
          )}
        >
          {levelLabel}
        </span>
      ) : null}
      {paper ? (
        <span
          className="rounded-full border border-ink-300 bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700"
          data-testid="paper-chip"
        >
          {paper.series ? `${paper.series} · ${paper.label}` : paper.label}
        </span>
      ) : null}
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-600"
        >
          {tag}
        </span>
      ))}
    </>
  );
}
