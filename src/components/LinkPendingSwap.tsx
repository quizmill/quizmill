'use client';

import type { ReactNode } from 'react';
import { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Swaps its children for a spinner while the enclosing <Link>'s
 * navigation is in flight, giving an instant "something's happening"
 * cue on tap — the gap between clicking a category and the quiz route
 * painting can be a second or two on a large pack.
 *
 * Must be rendered as a descendant of a next/link <Link>; useLinkStatus
 * reads that link's pending state from context.
 */
export function LinkPendingSwap({
  children,
  spinnerClassName,
}: {
  children: ReactNode;
  /** Applied to the spinner so it matches the icon it replaces. */
  spinnerClassName?: string;
}) {
  const { pending } = useLinkStatus();
  if (pending) {
    return (
      <Loader2
        className={cn('h-5 w-5 flex-shrink-0 animate-spin', spinnerClassName)}
        aria-label="Loading"
      />
    );
  }
  return <>{children}</>;
}
