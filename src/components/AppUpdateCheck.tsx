'use client';

import { useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  checkForAppUpdate,
  isUpdateReady,
  reloadApp,
  subscribeUpdateReady,
  type AppUpdateResult,
} from '@/lib/appUpdate';

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
 * bottom banner offers, which also appears, since both share the one
 * page-lifetime "update ready" flag (src/lib/appUpdate.ts). That flag,
 * not the last check's answer, decides whether Refresh shows: once a new
 * build has installed behind this page nothing but a reload changes that,
 * however a later check comes out.
 */
export function AppUpdateCheck() {
  const [checked, setChecked] = useState<Status>('idle');
  const ready = useSyncExternalStore(subscribeUpdateReady, isUpdateReady, () => false);
  const status: Status = ready ? 'update-ready' : checked;

  const check = async () => {
    setChecked('checking');
    setChecked(await checkForAppUpdate());
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
