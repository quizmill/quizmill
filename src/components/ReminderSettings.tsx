'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import {
  enableReminders,
  disableReminders,
  reminderState,
  type ReminderState,
} from '@/lib/reminders';

/**
 * Opt-in toggle for daily streak reminders. Scheduled notifications only run
 * where the browser supports periodic background sync (installed Chromium
 * PWAs); elsewhere — notably iOS — we say so plainly and lean on the in-app
 * streak nudge on Home instead. Mounted in Settings.
 */
export function ReminderSettings() {
  // Start unset so SSR and first paint agree; read the real state on mount
  // (Notification/permission/IndexedDB are browser-only).
  const [state, setState] = useState<ReminderState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState(reminderState());
  }, []);

  if (!state) {
    // Pre-mount placeholder keeps the card height stable.
    return (
      <div
        data-testid="reminder-settings"
        className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-ink-900">Streak reminders</h2>
        <p className="mt-1 text-sm text-ink-600">Loading…</p>
      </div>
    );
  }

  const { scheduledSupported, permission, optedIn } = state;
  const blocked = permission === 'denied';
  const on = optedIn && permission === 'granted';

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      setState(on ? await disableReminders() : await enableReminders());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="reminder-settings"
      className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink-900">Streak reminders</h2>
          <p className="mt-1 text-sm text-ink-600">
            A gentle nudge to come back and keep your streak alive.
          </p>
        </div>
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
            on ? 'bg-brand-500/20 text-brand-700' : 'bg-ink-100 text-ink-500'
          }`}
        >
          {on ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </div>
      </div>

      {scheduledSupported ? (
        <>
          <button
            type="button"
            data-testid="reminder-toggle"
            onClick={toggle}
            disabled={busy || blocked}
            aria-pressed={on}
            className={`tap-feedback mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm disabled:opacity-60 ${
              on
                ? 'border border-ink-200 bg-white text-ink-800 hover:bg-ink-50'
                : 'bg-brand-500 text-white hover:bg-brand-600'
            }`}
          >
            {on ? (
              <>
                <BellOff className="h-4 w-4" />
                Turn off reminders
              </>
            ) : (
              <>
                <Bell className="h-4 w-4" />
                Remind me daily
              </>
            )}
          </button>
          {blocked ? (
            <p className="mt-3 text-xs text-warn-700">
              Notifications are blocked for this app. Allow them in your
              browser&apos;s site settings, then try again.
            </p>
          ) : on ? (
            <p className="mt-3 text-xs text-ink-500">
              You&apos;ll get one reminder a day if you haven&apos;t practised
              yet. The exact time is up to your browser.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-xs text-ink-500">
          Scheduled reminders aren&apos;t available in this browser (they need
          an installed app on Chrome/Android). Your streak progress still shows
          on the home screen so you know when it&apos;s at risk.
        </p>
      )}
    </div>
  );
}
