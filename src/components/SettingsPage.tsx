'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ArrowLeft, Gamepad2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InstallCard } from '@/components/InstallPrompt';
import { SyncSettings } from '@/components/SyncSettings';
import {
  useResetAll,
  useResetToday,
  useStorageData,
} from '@/lib/useStorage';
import {
  packSources,
  packGames,
  gamesEnabled,
  gamesUnlockAfter,
} from '@/pack/data';
import { enabledGames } from '@/lib/games/registry';

/**
 * Settings page:
 *  - SyncSettings   — cloud sync sign-in (dormant unless configured)
 *  - Reset today    — remove just today's sessions
 *  - Reset all      — wipe local progress for the active pack
 *  - App version    — semver + build tag
 *  - `extras` slot  — e.g. the downvote browser
 */
export interface SettingsPageProps {
  extras?: ReactNode;
}

export function SettingsPage({ extras }: SettingsPageProps) {
  const { sessions, attempts } = useStorageData();
  const resetAll = useResetAll();
  const resetToday = useResetToday();

  const [pending, setPending] = useState<'today' | 'all' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const gameList = enabledGames(packGames?.include);
  const gamesUnlocked = attempts.length >= gamesUnlockAfter;
  const gamesRemaining = Math.max(0, gamesUnlockAfter - attempts.length);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todaySessions = sessions.filter(
    (s) => s.startedAt >= startOfToday.getTime(),
  ).length;
  const todayAttempts = attempts.filter(
    (a) => a.answeredAt >= startOfToday.getTime(),
  ).length;

  function handleResetToday() {
    if (pending) return;
    const ok = window.confirm(
      `Reset today's progress?\n\nThis will remove ${todaySessions} session(s) and ${todayAttempts} answer(s) from today.`,
    );
    if (!ok) return;
    setPending('today');
    const result = resetToday();
    setMessage(
      `Removed ${result.sessionsRemoved} session(s) and ${result.attemptsRemoved} answer(s) from today.`,
    );
    setPending(null);
  }

  function handleResetAll() {
    if (pending) return;
    const ok = window.confirm(
      `Reset ALL local progress?\n\nThis erases every saved session and answer on this device. If you're signed in, the cloud copy stays — sign back in to restore. There is no local undo.`,
    );
    if (!ok) return;
    setPending('all');
    resetAll();
    setMessage('All local progress erased.');
    setPending(null);
  }

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
      </header>

      <div>
        <h1 className="text-3xl font-bold text-ink-900">Settings</h1>
        <p className="mt-1 text-ink-500">
          Sync, reset, and app info.
        </p>
      </div>

      {message ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {message}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <InstallCard />

        <SyncSettings />

        {packSources.length > 0 ? (
          <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink-900">Question sources</h2>
            <p className="mt-1 text-sm text-ink-600">
              Where this pack&apos;s questions come from.
            </p>
            <dl className="mt-3 flex flex-col gap-3">
              {packSources.map((src) => (
                <div key={src.label} className="flex gap-3">
                  <dt>
                    <span className="rounded-full border border-ink-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                      {src.label}
                    </span>
                  </dt>
                  <dd className="flex-1 text-sm text-ink-600">
                    {src.url ? (
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
                      >
                        {src.name ?? src.label}
                      </a>
                    ) : (
                      <span className="font-medium text-ink-800">{src.name ?? src.label}</span>
                    )}
                    {src.blurb ? <> — {src.blurb}</> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {gamesEnabled ? (
          <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink-900">Games</h2>
            <p className="mt-1 text-sm text-ink-600">
              A few quick games to enjoy between rounds of practice.
            </p>
            <p className="mt-2 text-sm text-ink-500">
              {gamesUnlocked ? (
                <>
                  Unlocked — <strong>{gameList.length}</strong>{' '}
                  {gameList.length === 1 ? 'game' : 'games'} to play.
                </>
              ) : (
                <>
                  Answer <strong>{gamesRemaining} more</strong>{' '}
                  {gamesRemaining === 1 ? 'question' : 'questions'} to unlock.
                </>
              )}
            </p>
            <Link
              href="/games/"
              className="tap-feedback mt-4 inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm hover:bg-ink-50"
            >
              <Gamepad2 className="h-4 w-4" />
              {gamesUnlocked ? 'Open games' : 'View games'}
            </Link>
          </div>
        ) : null}

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink-900">
            Reset today&apos;s progress
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            Removes only the sessions practised today.
          </p>
          <p className="mt-2 text-sm text-ink-500">
            Today on this device: <strong>{todaySessions}</strong> session(s),
            <strong> {todayAttempts}</strong> answer(s).
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={handleResetToday}
            disabled={pending !== null || todaySessions === 0}
          >
            <Trash2 className="h-4 w-4" />
            Reset today
          </Button>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink-900">
            Reset all local progress
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            Erases every saved session and answer on this device. Cloud
            sync rows (if signed in) stay — sign back in to restore.
          </p>
          <p className="mt-2 text-sm text-ink-500">
            On this device: <strong>{sessions.length}</strong> session
            {sessions.length === 1 ? '' : 's'},{' '}
            <strong>{attempts.length}</strong> answer
            {attempts.length === 1 ? '' : 's'}.
          </p>
          <Button
            variant="danger"
            className="mt-4"
            onClick={handleResetAll}
            disabled={
              (pending !== null && pending !== 'all') ||
              sessions.length + attempts.length === 0
            }
          >
            <Trash2 className="h-4 w-4" />
            Reset everything
          </Button>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5 text-sm text-ink-600 shadow-sm">
          <div className="flex items-center justify-between">
            <span>App version</span>
            <code
              data-testid="app-version"
              className="rounded bg-ink-100 px-2 py-0.5 font-mono text-xs text-ink-700"
            >
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'}
            </code>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-ink-500">
            <span>Build</span>
            <code
              data-testid="app-build"
              className="font-mono text-ink-500"
            >
              {process.env.NEXT_PUBLIC_APP_BUILD ?? 'dev'}
            </code>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Updates fetch automatically when you&apos;re back online;
            you&apos;ll see a banner offering to refresh.
          </p>
        </div>

        {extras}
      </section>
    </main>
  );
}
