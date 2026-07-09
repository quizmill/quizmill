'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Car, Gamepad2, Trash2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InstallCard } from '@/components/InstallPrompt';
import { SyncSettings } from '@/components/SyncSettings';
import {
  useResetAll,
  useResetToday,
  useStorageData,
} from '@/lib/useStorage';
import { cn } from '@/lib/cn';
import {
  loadDriveModeEnabled,
  loadDriveVoicePrefs,
  saveDriveModeEnabled,
  saveDriveRate,
  saveDriveVoice,
} from '@/lib/storage';
import { listVoices, speak, ttsSupported, voicesForLang } from '@/lib/speech';
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

/**
 * Settings page:
 *  - SyncSettings   — cloud sync sign-in (dormant unless configured)
 *  - Reset today    — remove just today's sessions
 *  - Reset all      — wipe local progress for the active pack
 *  - App version    — semver + build tag (tap it to reveal games)
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

  // Drive Mode opt-in — read after mount so SSR/first paint stay stable.
  const [driveMode, setDriveMode] = useState(false);
  useEffect(() => setDriveMode(loadDriveModeEnabled()), []);
  const toggleDriveMode = () => {
    const next = !driveMode;
    setDriveMode(next);
    saveDriveModeEnabled(next);
  };

  // Drive Mode voice tuning. Voices resolve async (voiceschanged), and
  // only voices in the browser's language are offered — a full list is
  // hundreds of entries on iOS.
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [driveVoice, setDriveVoice] = useState<string | null>(null);
  const [driveRate, setDriveRate] = useState(1);
  useEffect(() => {
    const prefs = loadDriveVoicePrefs();
    setDriveVoice(prefs.voiceURI);
    setDriveRate(prefs.rate);
  }, []);
  useEffect(() => {
    if (!driveMode) return;
    let cancelled = false;
    listVoices().then((all) => {
      if (cancelled) return;
      const lang =
        typeof navigator !== 'undefined' ? navigator.language : 'en';
      setVoices(voicesForLang(all, lang));
    });
    return () => {
      cancelled = true;
    };
  }, [driveMode]);
  const pickVoice = (voiceURI: string) => {
    const next = voiceURI === '' ? null : voiceURI;
    setDriveVoice(next);
    saveDriveVoice(next);
  };
  const pickRate = (rate: number) => {
    setDriveRate(rate);
    saveDriveRate(rate);
  };
  const previewVoice = () => {
    speak(
      'Question 1 of 10. Which planet is closest to the sun? A. Mercury. B. Venus.',
      { voiceURI: driveVoice, rate: driveRate },
    );
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

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
                <Car className="h-5 w-5 text-ink-500" />
                Drive mode
              </h2>
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
            <div className="mt-4 flex flex-col gap-4 border-t border-ink-100 pt-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="drive-voice"
                  className="text-sm font-semibold text-ink-800"
                >
                  Voice
                </label>
                <select
                  id="drive-voice"
                  data-testid="drive-voice-select"
                  value={driveVoice ?? ''}
                  onChange={(e) => pickVoice(e.target.value)}
                  className="rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 shadow-sm"
                >
                  <option value="">Auto — best available</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-500">
                  {ttsSupported()
                    ? 'On iPhone, nicer voices appear here after you download them: Settings → Accessibility → Spoken Content → Voices (pick an “Enhanced” or “Premium” one).'
                    : 'Speech isn’t available in this browser.'}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="drive-rate"
                  className="flex items-center justify-between text-sm font-semibold text-ink-800"
                >
                  <span>Speed</span>
                  <span className="font-mono text-xs text-ink-500">
                    ×{driveRate.toFixed(2)}
                  </span>
                </label>
                <input
                  id="drive-rate"
                  data-testid="drive-rate-slider"
                  type="range"
                  min={0.7}
                  max={1.3}
                  step={0.05}
                  value={driveRate}
                  onChange={(e) => pickRate(Number(e.target.value))}
                  className="accent-brand-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={previewVoice}>
                  <Volume2 className="h-4 w-4" />
                  Preview voice
                </Button>
                <Link
                  href="/drive/"
                  className="tap-feedback inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm hover:bg-ink-50"
                >
                  <Car className="h-4 w-4" />
                  Open drive mode
                </Link>
              </div>
            </div>
          ) : null}
        </div>

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
            <h2 className="text-lg font-semibold text-ink-900">
              🎮 You found the games!
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              A little arcade tucked away as a reward for practising.
            </p>
            <p className="mt-2 text-sm text-ink-500">
              <strong>{gameList.length}</strong>{' '}
              {gameList.length === 1 ? 'game' : 'games'} to play.
            </p>
            <Link
              href="/games/"
              className="tap-feedback mt-4 inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm hover:bg-ink-50"
            >
              <Gamepad2 className="h-4 w-4" />
              Open the arcade
            </Link>
          </div>
        ) : null}

        {extras}
      </section>
    </main>
  );
}
