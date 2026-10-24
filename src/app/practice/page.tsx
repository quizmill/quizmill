'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { APP_CONFIG } from '@/config';
import { PackPracticeRunner } from '@/pack/PracticeRunner';
import { PACK_PAPER_BY_KEY } from '@/pack/data';
import { useSearchParams } from 'next/navigation';

/**
 * The practice route. The category is carried as a `?subject=` query param,
 * read on the CLIENT, rather than a path segment. A path segment would need
 * `generateStaticParams` to enumerate every category at build time — which
 * 404s any category the build didn't know about, i.e. every pack injected at
 * runtime. A query param means one statically exported route (`/practice/`)
 * serves ANY pack's categories. (The param is named `subject` for
 * engine-historical reasons; it carries the pack category key.)
 *
 * `?paper=<key>` instead practises one of the pack's named papers whole
 * (manifest `papers`, #194) — same route, same reasoning.
 */
export default function PracticePage() {
  return (
    <Suspense fallback={<Shell>Loading…</Shell>}>
      <PracticeForSubject />
    </Suspense>
  );
}

function PracticeForSubject() {
  const params = useSearchParams();
  const paper = params.get('paper');
  if (paper !== null) {
    if (paper === '' || !(paper in PACK_PAPER_BY_KEY)) {
      return (
        <Shell>
          <p className="text-ink-600">That paper isn’t in this pack.</p>
          <Link href="/" className="mt-3 inline-block font-semibold text-brand-600">
            ← Back to home
          </Link>
        </Shell>
      );
    }
    return <PackPracticeRunner paperKey={paper} />;
  }
  const subject = params.get('subject') ?? '';
  const valid = subject !== '' && APP_CONFIG.categories.some((c) => c.key === subject);
  if (!valid) {
    return (
      <Shell>
        <p className="text-ink-600">That category isn’t in this pack.</p>
        <Link href="/" className="mt-3 inline-block font-semibold text-brand-600">
          ← Back to categories
        </Link>
      </Shell>
    );
  }
  return <PackPracticeRunner categoryKey={subject} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-col gap-5">
      <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center text-ink-500 shadow-xs">
        {children}
      </div>
    </main>
  );
}
