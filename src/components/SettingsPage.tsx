'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Boxes,
  Car,
  Gamepad2,
  Monitor,
  Moon,
  Sun,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { APP_CONFIG } from '@/config';
import { InstallCard } from '@/components/InstallPrompt';
import { SyncSettings } from '@/components/SyncSettings';
import { TransferSettings } from '@/components/TransferSettings';
import {
  useResetAll,
  useResetToday,
  useStorageData,
} from '@/lib/useStorage';
import { cn } from '@/lib/cn';
import {
  loadDriveModeEnabled,
  saveDriveModeEnabled,
} from '@/lib/storage';
import { useTheme } from '@/lib/useTheme';
import type { ThemePref } from '@/lib/theme';
import { useLook } from '@/lib/useLook';
import { packDefaultLook } from '@/lib/look';
import type { LookPref } from '@/lib/look';
import {
  packSources,
  packGames,
  gamesEnabled,
} from '@/pack/data';
import { enabledGames } from '@/lib/games/registry';

/** Taps on the version pill that reveal the hidden games panel — the
 *  Android-style "tap the build number" easter egg. Games are a treat, so
 *  they're discovered, not advertised in the chrome. */
const GAMES_REVEAL_TAPS = 7;

const THEME_CHOICES: {
  value: ThemePref;
  label: string;
  Icon: typeof Sun;
}[] = [
  { value: 'system', label: 'Auto', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** Visual style: follow the pack's default, or pin one on this device.
 *  Poster is the loud quizmill.dev campaign look — kids' packs ship it
 *  as their default via `look` in pack.json. */
const LOOK_CHOICES: { value: LookPref; label: string }[] = [
  { value: 'pack', label: 'Pack default' },
  { value: 'classic', label: 'Classic' },
  { value: 'poster', label: 'Poster' },
];

/**
 * Settings page, grouped into labelled sections so it stays scannable as
 * cards accumulate:
 *  - (top)            — InstallCard, a self-hiding call-to-action banner
 *  - Packs            — pack library entry, question sources, `extras`
 *                       slot (e.g. the downvote browser)
 *  - Progress & sync  — SyncSettings, TransferSettings, the two resets
 *  - This device      — appearance, drive mode
 *  - About            — version + build (tap the version to reveal games)
 */
export interface SettingsPageProps {
  extras?: ReactNode;
}

/** A labelled group of settings cards. */
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="px-1 pt-3 text-xs font-semibold uppercase tracking-wider text-ink-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage({ extras }: SettingsPageProps) {
  const { sessions, attempts } = useStorageData();
  const resetAll = useResetAll();
  const resetToday = useResetToday();
  const [theme, setTheme] = useTheme();
  const [look, setLook] = useLook();

  const [pending, setPending] = useState<'today' | 'all' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Drive Mode opt-in — read after mount so SSR/first paint stay stable.
  const [driveMode, setDriveMode] = useState(false);
  useEffect(() => setDriveMode(loadDriveModeEnabled()), []);
  const toggleDriveMode = () => {
    const next = !driveMode;
    setDriveMode(next);
    saveDriveModeEnabled(next);
  };

  // Hidden games easter egg — revealed by tapping the version pill.
  const [versionTaps, setVersionTaps] = useState(0);
  const gamesRevealed = gamesEnabled && versionTaps >= GAMES_REVEAL_TAPS;
  const gameList = enabledGames(packGames?.include);

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
          Packs, progress &amp; sync, and app preferences.
        </p>
      </div>

      {message ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {message}
        </div>
      ) : null}

      <InstallCard />

      <SettingsSection title="Packs">
        <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
            <Boxes className="h-5 w-5 text-ink-500" />
            Pack library
          </h3>
          <p className="mt-1 text-sm text-ink-600">
            One app, many packs — insert new packs, swap the active one, and
            keep each pack&apos;s progress. Practising now:{' '}
            <strong>{APP_CONFIG.title}</strong>.
          </p>
          <Link
            href="/packs/"
            data-testid="open-packs"
            className="tap-feedback mt-4 inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm hover:bg-ink-50 dark:hover:bg-ink-100"
          >
            <Boxes className="h-4 w-4" />
            Manage packs
          </Link>
        </div>

        {packSources.length > 0 ? (
          <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-ink-900">Question sources</h3>
            <p className="mt-1 text-sm text-ink-600">
              Where this pack&apos;s questions come from.
            </p>
            <dl className="mt-3 flex flex-col gap-3">
              {packSources.map((src) => (
                <div key={src.label} className="flex gap-3">
                  <dt>
                    <span className="rounded-full border border-ink-200 bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
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

        {extras}
      </SettingsSection>

      <SettingsSection title="Progress & sync">
        <SyncSettings />

        <TransferSettings />
      </SettingsSection>

      <SettingsSection title="This device">
        <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-ink-900">Appearance</h3>
          <p className="mt-1 text-sm text-ink-600">
            Auto follows your device&apos;s light/dark setting.
          </p>
          <div
            role="radiogroup"
            aria-label="Colour theme"
            className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-ink-100 p-1"
          >
            {THEME_CHOICES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                data-testid={`theme-${value}`}
                onClick={() => setTheme(value)}
                className={cn(
                  'tap-feedback flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold',
                  theme === value
                    ? 'bg-surface text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:text-ink-700',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <h3 className="mt-6 text-lg font-semibold text-ink-900">Style</h3>
          <p className="mt-1 text-sm text-ink-600">
            Poster is the big, colourful look. Pack default is{' '}
            {packDefaultLook() === 'poster' ? 'Poster' : 'Classic'} for this pack.
          </p>
          <div
            role="radiogroup"
            aria-label="Visual style"
            className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-ink-100 p-1"
          >
            {LOOK_CHOICES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={look === value}
                data-testid={`look-${value}`}
                onClick={() => setLook(value)}
                className={cn(
                  'tap-feedback flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold',
                  look === value
                    ? 'bg-surface text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:text-ink-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
                <Car className="h-5 w-5 text-ink-500" />
                Drive mode
              </h3>
              <p className="mt-1 text-sm text-ink-600">
                Hands-free voice quiz for the car — questions read aloud,
                answers by voice. Adds a card to the home screen.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={driveMode}
              aria-label="Drive mode"
              data-testid="drive-mode-toggle"
              onClick={toggleDriveMode}
              className={cn(
                'tap-feedback relative mt-1 inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors',
                driveMode ? 'bg-brand-500' : 'bg-ink-200',
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  driveMode ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </div>
          {driveMode ? (
            <Link
              href="/drive/"
              className="tap-feedback mt-4 inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm hover:bg-ink-50 dark:hover:bg-ink-100"
            >
              <Car className="h-4 w-4" />
              Open drive mode
            </Link>
          ) : null}
        </div>

      </SettingsSection>

      <SettingsSection title="Reset">
        <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-ink-900">
            Reset today&apos;s progress
          </h3>
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

        <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-ink-900">
            Reset all local progress
          </h3>
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
      </SettingsSection>

      <SettingsSection title="About">
        <div className="rounded-2xl border border-ink-200 bg-surface p-5 text-sm text-ink-600 shadow-sm">
          <div className="flex items-center justify-between">
            <span>App version</span>
            <button
              type="button"
              data-testid="app-version"
              aria-label="App version"
              onClick={() => setVersionTaps((n) => n + 1)}
              className="tap-feedback select-none rounded bg-ink-100 px-2 py-0.5 font-mono text-xs text-ink-700"
            >
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'}
            </button>
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

        {gamesRevealed ? (
          <div
            data-testid="games-easter-egg"
            className="rounded-2xl border border-brand-300 bg-brand-50 p-5 shadow-sm"
          >
            <h3 className="text-lg font-semibold text-ink-900">
              🎮 You found the games!
            </h3>
            <p className="mt-1 text-sm text-ink-600">
              A little arcade tucked away as a reward for practising.
            </p>
            <p className="mt-2 text-sm text-ink-500">
              <strong>{gameList.length}</strong>{' '}
              {gameList.length === 1 ? 'game' : 'games'} to play.
            </p>
            <Link
              href="/games/"
              className="tap-feedback mt-4 inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm hover:bg-ink-50 dark:hover:bg-ink-100"
            >
              <Gamepad2 className="h-4 w-4" />
              Open the arcade
            </Link>
          </div>
        ) : null}
      </SettingsSection>
    </main>
  );
}
