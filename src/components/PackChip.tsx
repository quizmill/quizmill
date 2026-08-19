import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { cn } from '@/lib/cn';

/**
 * Names the ACTIVE pack on pack-scoped pages (Progress, Stickers, Notes —
 * everything they show lives under `quizmill.<packId>.*`). One installed
 * app can hold many packs, so these pages say whose data is on screen;
 * tapping the chip opens the shelf (/packs) to swap. Rendered as an
 * eyebrow above the page H1.
 */
export function PackChip({ className }: { className?: string }) {
  return (
    <Link
      href="/packs/"
      data-testid="pack-chip"
      aria-label={`Active pack: ${APP_CONFIG.title} — manage packs`}
      className={cn(
        'tap-feedback inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-surface px-2.5 py-1 text-xs font-semibold text-ink-600 shadow-sm hover:bg-ink-50 dark:hover:bg-ink-100',
        className,
      )}
    >
      <Boxes className="h-3.5 w-3.5 flex-shrink-0 text-brand-600" />
      <span className="truncate">{APP_CONFIG.title}</span>
    </Link>
  );
}
