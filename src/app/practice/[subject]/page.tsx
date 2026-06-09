import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { APP_CONFIG } from '@/config';
import { PackPracticeRunner } from '@/pack/PracticeRunner';

/**
 * One practice route per pack category, generated statically from the
 * active pack's manifest. (The route param is named `subject` for
 * engine-historical reasons — it carries the pack category key.)
 */
export function generateStaticParams() {
  return APP_CONFIG.categories.map((c) => ({ subject: c.key }));
}

export const dynamicParams = false;

export default async function PracticePage({
  params,
}: {
  params: Promise<{ subject: string }>;
}) {
  const { subject } = await params;
  const valid = APP_CONFIG.categories.some((c) => c.key === subject);
  if (!valid) notFound();

  return (
    <Suspense fallback={<LoadingShell />}>
      <PackPracticeRunner categoryKey={subject} />
    </Suspense>
  );
}

function LoadingShell() {
  return (
    <main className="flex flex-col gap-5">
      <div className="rounded-2xl border border-ink-200 bg-white p-6 text-center text-ink-500 shadow-sm">
        Loading…
      </div>
    </main>
  );
}
