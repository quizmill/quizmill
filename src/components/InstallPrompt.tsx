'use client';

import { useEffect, useState } from 'react';
import { PlusCircle, Share } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  describeInstallSurface,
  isStandaloneDisplay,
  type BeforeInstallPromptEvent,
  type InstallSurface,
} from '@/lib/install';
import { useClientState } from '@/lib/useMounted';

/** Which install surface this browser is — read on the client only. */
function detectInstallSurface(): InstallSurface {
  return describeInstallSurface(
    navigator.userAgent,
    isStandaloneDisplay(),
    navigator.maxTouchPoints,
  );
}


/** Install state for the Settings card: which surface we're on, and the
 *  stashed Chromium prompt event when the app is installable. */
function useInstallPrompt(): {
  surface: InstallSurface | null; // null until mounted (SSR-safe)
  promptEvent: BeforeInstallPromptEvent | null;
  promptInstall: () => void;
} {
  const [surface, setSurface] = useClientState<InstallSurface | null>(
    detectInstallSurface,
    null,
  );
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
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
  }, [setSurface]);

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
      className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs"
    >
      <h3 className="text-lg font-semibold text-ink-900">Add to Home Screen</h3>
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

