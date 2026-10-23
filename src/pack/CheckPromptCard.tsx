'use client';

import Link from 'next/link';
import { ArrowRight, Compass } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import type { Session } from '@/data/types';
import { CHECK_BUDGETS_MINUTES, CHECK_MAX_MINUTES, checkHistory } from '@/lib/readinessCheck';
import { loadCheckPromptDismissed, saveCheckPromptDismissed } from '@/lib/storage';
import { useClientState } from '@/lib/useMounted';
import { CHECK_PLAN } from '@/pack/check';

/**
 * Home's prompt for an exam pack: "could you pass today?" above the
 * practice loop, until the learner either sits the readiness check or
 * says they are not interested. Something to see and do, or see and
 * close — not a switch in Settings. Sitting a check retires it (the
 * result lives on the check page, reached from the rail's tile and the
 * Progress panel); closing it is remembered per pack, in the pack's
 * local prefs, so the same card never comes back on this device.
 */
export function CheckPromptCard({ sessions }: { sessions: readonly Session[] }) {
  // Hidden until mounted, like every pref-driven surface, so the first
  // paint never flashes a card the learner already closed.
  const [dismissed, setDismissed] = useClientState(loadCheckPromptDismissed, true);
  const exam = APP_CONFIG.exam;
  if (!CHECK_PLAN || !exam || dismissed) return null;
  if (checkHistory(sessions).length > 0) return null;

  const examName = exam.label ?? 'the exam';
  const dismiss = () => {
    setDismissed(true);
    saveCheckPromptDismissed(true);
  };

  return (
    <section
      data-testid="check-prompt"
      className="rounded-2xl border border-brand-500/30 bg-brand-50 p-4 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-700">
          <Compass className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-ink-900">
            Could you pass {examName} today?
          </div>
          <p className="mt-0.5 text-sm text-ink-600">
            A temperature check: {CHECK_BUDGETS_MINUTES[0]} to {CHECK_MAX_MINUTES} minutes
            across every domain, then where to study first.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <Link
          href="/practice/check/"
          data-testid="check-prompt-start"
          className="tap-feedback inline-flex items-center gap-1.5 rounded-full bg-night-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Take the check
          <ArrowRight className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          data-testid="check-prompt-dismiss"
          className="tap-feedback rounded-full px-3 py-2 text-sm font-medium text-ink-500 hover:text-ink-800"
        >
          Not interested
        </button>
      </div>
    </section>
  );
}
