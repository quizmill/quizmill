import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * Quiz-shaped loading placeholder. Mirrors the PracticeRunner layout
 * (progress header → meta chips → question card → options → action
 * button) so opening a category swaps in a recognisable skeleton
 * instead of a bare "Loading…" line. Used by both runners' pre-mount
 * state and the practice route's Suspense fallback.
 *
 * Pure markup (a real Home back-link, the rest inert) so it renders in
 * a Server Component fallback as happily as inside the client runners.
 */
export function QuizSkeleton() {
  return (
    <main
      className="flex animate-pulse flex-col gap-5"
      role="status"
      aria-label="Loading questions"
    >
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        <div className="flex w-32 items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-ink-100" />
          <div className="h-3 w-8 rounded bg-ink-100" />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="h-5 w-16 rounded-full bg-ink-100" />
        <div className="h-5 w-20 rounded-full bg-ink-100" />
        <div className="h-5 w-14 rounded-full bg-ink-100" />
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2.5">
          <div className="h-4 w-full rounded bg-ink-100" />
          <div className="h-4 w-11/12 rounded bg-ink-100" />
          <div className="h-4 w-2/3 rounded bg-ink-100" />
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm"
          >
            <div className="h-7 w-7 flex-shrink-0 rounded-full bg-ink-100" />
            <div className="h-4 flex-1 rounded bg-ink-100" />
          </div>
        ))}
      </div>

      <div className="h-14 w-full rounded-xl bg-ink-100" />

      <span className="sr-only">Loading questions…</span>
    </main>
  );
}
