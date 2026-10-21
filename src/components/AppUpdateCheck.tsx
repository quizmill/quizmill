'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { checkForAppUpdate, reloadApp, type AppUpdateResult } from '@/lib/appUpdate';

type Status = 'idle' | 'checking' | AppUpdateResult;

const MESSAGE: Record<Exclude<Status, 'idle'>, string> = {
  checking: 'Checking…',
  'update-ready': 'A new version is ready.',
  'up-to-date': "You're up to date.",
  offline: "Couldn't reach the server — are you online?",
  unsupported: "This browser can't check for updates. Try reloading instead.",
};

/**
 * The About card's "Check for updates": pulls an update instead of waiting
 * for the browser to notice one (src/lib/appUpdate.ts explains why that
 * can take weeks on an installed app). One tap, one line of outcome, and
 * a Refresh button when a new build has landed — the same reload the
 * bottom banner offers, which also appears, since both watch the one
 * registration.
 */
export function AppUpdateCheck() {
  const [status, setStatus] = useState<Status>('idle');

  const check = async () => {
    setStatus('checking');
    setStatus(await checkForAppUpdate());
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid="check-updates"
        onClick={check}
        disabled={status === 'checking'}
      >
        <RefreshCw className={status === 'checking' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        Check for updates
      </Button>
      {status !== 'idle' ? (
        <span
          data-testid="update-status"
          role="status"
          className="flex flex-wrap items-center gap-2 text-xs text-ink-600"
        >
          {MESSAGE[status]}
          {status === 'update-ready' ? (
            <button
              type="button"
              data-testid="update-refresh"
              onClick={reloadApp}
              className="tap-feedback rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-brand-600"
            >
              Refresh
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
