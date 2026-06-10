import { cn } from '@/lib/cn';
import {
  PACK_CATEGORY_LABEL,
  PACK_LEVEL_LABEL,
  PACK_LEVEL_TONE,
  type PackQuestion,
} from '@/pack/data';

/**
 * The metadata chip row above a question: its category, level band (if the
 * pack defines levels), and any tags (topic, source marker, …). All
 * pack-driven — the engine carries no domain terminology.
 */
export function QuestionMeta({ question }: { question: PackQuestion }) {
  const levelLabel = question.level ? PACK_LEVEL_LABEL[question.level] : undefined;
  const tags = question.tags ?? [];
  return (
    <>
      <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
        {PACK_CATEGORY_LABEL[question.categoryKey] ?? question.categoryKey}
      </span>
      {levelLabel ? (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
            question.level ? PACK_LEVEL_TONE[question.level] : '',
          )}
        >
          {levelLabel}
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
