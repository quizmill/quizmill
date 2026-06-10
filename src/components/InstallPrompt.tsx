'use client';

import { useEffect, useState } from 'react';
import { PlusCircle, Share, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  describeInstallSurface,
  type BeforeInstallPromptEvent,
  type InstallSurface,
} from '@/lib/install';

const DISMISS_KEY = 'quizmill.install-banner-dismissed';

/** Shared state for both install UIs: which surface we're on, and the
 *  stashed Chromium prompt event when the app is installable. */
function useInstallPrompt(): {
  surface: InstallSurface | null; // null until mounted (SSR-safe)
  promptEvent: BeforeInstallPromptEvent | null;
  promptInstall: () => void;
} {
  const [surface, setSurface] = useState<InstallSurface | null>(null);
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari's pre-standard flag.
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setSurface(
      describeInstallSurface(
        navigator.userAgent,
        standalone,
        navigator.maxTouchPoints,
      ),
    );

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the mini-infobar away; we offer our own button
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setSurface('standalone');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = () => {
    void promptEvent?.prompt();
  };

  return { surface, promptEvent, promptInstall };
}

/**
 * Settings card explaining how to install, with a real install button
 * when the browser offers one. Hidden while already running installed.
 */
export function InstallCard() {
  const { surface, promptEvent, promptInstall } = useInstallPrompt();
  if (surface === null || surface === 'standalone') return null;

  return (
    <div
      data-testid="install-card"
      className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-ink-900">Add to Home Screen</h2>
      <p className="mt-1 text-sm text-ink-600">
        Install the app for full-screen practice that works offline.
      </p>
      {promptEvent ? (
        <Button className="mt-4" onClick={promptInstall}>
          <PlusCircle className="h-4 w-4" />
          Install app
        </Button>
      ) : surface === 'ios' ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-600">
          <li>
            Tap the <Share className="inline h-4 w-4 align-text-bottom" />{' '}
            Share button in Safari.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>.
          </li>
        </ol>
      ) : (
        <p className="mt-3 text-sm text-ink-600">
          In your browser&apos;s menu, choose <strong>Install app</strong> (or{' '}
          <strong>Add to Home Screen</strong>).
        </p>
      )}
    </div>
  );
}

/**
 * Compact home-screen banner, shown only when the browser is actually
 * offering installation (Chromium's beforeinstallprompt) and the user
 * hasn't dismissed it this browser.
 */
export function InstallBanner() {
  const { surface, promptEvent, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (surface !== 'browser' || !promptEvent || dismissed) return null;

  return (
    <div
      data-testid="install-banner"
      className="flex items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-3 pl-4 shadow-sm"
    >
      <div className="text-sm font-medium text-brand-800">
        ⊕ Add to Home Screen — works offline
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <Button size="sm" onClick={promptInstall}>
          Install
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          className="tap-feedback rounded-full p-1.5 text-ink-500 hover:bg-ink-100"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, '1');
            setDismissed(true);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
