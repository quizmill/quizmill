'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';

/**
 * The Home screen's mode cards — Drive, Coach, Paper practice, Review
 * mistakes. One row: an icon bubble, a title with a one-line blurb, and an
 * arrow, the whole card a link. The modes differ only in colour, so each
 * picks a `tone` and the markup lives here once.
 */

export type HomeCardTone = 'night' | 'brand' | 'ink' | 'warn';

/** Per-tone classes for the card, the icon bubble, the two text lines and
 *  the arrow. `night` is the dark Drive card; the rest are light. */
const TONE: Record<
  HomeCardTone,
  { card: string; bubble: string; title: string; blurb: string; arrow: string }
> = {
  night: {
    card: 'border-night-700 bg-night-800',
    bubble: 'bg-brand-500/20 text-[#8bb8ff]',
    title: 'text-white',
    blurb: 'text-night-300',
    arrow: 'text-night-400',
  },
  brand: {
    card: 'border-brand-500/30 bg-brand-50',
    bubble: 'bg-brand-500/20 text-brand-700',
    title: 'text-ink-900',
    blurb: 'text-ink-600',
    arrow: 'text-ink-400',
  },
  ink: {
    card: 'border-ink-400/25 bg-ink-50',
    bubble: 'bg-ink-200 text-ink-700',
    title: 'text-ink-900',
    blurb: 'text-ink-600',
    arrow: 'text-ink-400',
  },
  warn: {
    card: 'border-warn-500/40 bg-warn-100/60',
    bubble: 'bg-warn-500/20 text-warn-700',
    title: 'text-ink-900',
    blurb: 'text-ink-600',
    arrow: 'text-ink-500',
  },
};

export function HomeCard({
  href,
  icon: Icon,
  title,
  blurb,
  tone,
  testid,
}: {
  href: string;
  icon: LucideIcon;
  title: ReactNode;
  blurb: ReactNode;
  tone: HomeCardTone;
  testid?: string;
}) {
  const t = TONE[tone];
  return (
    <Link
      href={href}
      data-testid={testid}
      className={`tap-feedback flex items-center justify-between gap-3 rounded-2xl border ${t.card} p-4 shadow-xs`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${t.bubble}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className={`text-base font-semibold ${t.title}`}>{title}</div>
          <div className={`text-sm ${t.blurb}`}>{blurb}</div>
        </div>
      </div>
      <ArrowRight className={`h-5 w-5 shrink-0 ${t.arrow}`} />
    </Link>
  );
}
