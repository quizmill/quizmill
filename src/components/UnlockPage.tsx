'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, Check, Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LicenceKeyEntry, useLicenceUnlock, type LicenceUnlock } from '@/components/LicenceKeyForm';
import { isStandaloneDisplay } from '@/lib/install';
import {
  openUnlockedPack,
  readKeyFromHash,
  stripKeyFromLocation,
  unlockConfig,
  type UnlockConfig,
} from '@/lib/unlock';
import { useClientState, useMounted } from '@/lib/useMounted';

function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white"
    >
      {n}
    </span>
  );
}

// The key the URL carried, read once per page load and remembered: the
// read also wipes the fragment, and React re-invokes client reads in dev
// strict mode, so a second read would find nothing.
let urlKey: string | null | undefined;
function takeUrlKey(): string | null {
  if (urlKey === undefined) {
    urlKey = readKeyFromHash(window.location.hash);
    stripKeyFromLocation();
  }
  return urlKey;
}

/** Test seam — forget the remembered key so each test starts clean. */
export function resetUnlockPageForTests(): void {
  urlKey = undefined;
}

/**
 * `/unlock#key=…` — the one-tap path for a learner holding a licence key:
 * the key is read from the FRAGMENT (never the query string: fragments
 * reach no server and no log; a `?key=` is scrubbed from the address bar
 * but not used), wiped from the address bar at once, and
 * submitted for them. Browser links stay on the confirmation until the
 * learner starts practising; installed apps load Home after a short hold.
 * A refusal brings back the key panel and the prefilled form.
 *
 * In a browser tab the key is also offered with a Copy button, quietly
 * below Start practising: on iOS a link from outside always opens in
 * Safari while an installed app keeps its own storage. The claim hand-off
 * usually carries the unlock over by itself; the key is the manual bridge
 * (Packs → Have a licence key?) when it doesn't.
 *
 * The route exists and works in every build: the key alone says which
 * pack, so nothing about the active pack decides whether a learner can
 * unlock one here (see src/lib/unlock.ts for how the endpoint is chosen).
 */
export function UnlockPage() {
  const homeEntryRef = useRef<LicenceUnlock['done']>(null);
  const mounted = useMounted();
  const config = unlockConfig();
  // Read after mount: SSG has no location, and the prerender must not
  // differ from the first client paint.
  const [key, setKey] = useClientState(takeUrlKey, null);
  // Installed apps keep their automatic full load after confirmation.
  const [standalone] = useClientState(isStandaloneDisplay, true);

  // A second link tapped while this page is open is a fragment-only
  // navigation (no load) — pick its key up the same way. The new key
  // remounts the form below (keyed on it), and the old form's unmount
  // abandons any request still in flight for the previous key.
  useEffect(() => {
    const onHash = () => {
      const next = readKeyFromHash(window.location.hash);
      stripKeyFromLocation();
      if (next) {
        urlKey = next;
        setKey(next);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setKey]);

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          onClick={(event) => {
            if (!homeEntryRef.current) return;
            event.preventDefault();
            openUnlockedPack(homeEntryRef.current);
          }}
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
      </header>

      {/* Keyed on the URL key so a key arriving after mount starts a fresh
          unlock that submits it once. Nothing below the header before mount:
          the prerender can't know whether a key came, and must not paint the
          form for a page that is about to say "Unlocking…". */}
      {mounted ? (
        <UnlockBody key={key ?? ''} urlKey={key} standalone={standalone} config={config} homeEntryRef={homeEntryRef} />
      ) : null}
    </main>
  );
}

/** How long "Unlocked: …" stays up before Home loads. */
const UNLOCKED_HOLD_MS = 600;

function UnlockBody({
  urlKey: key,
  standalone,
  config,
  homeEntryRef,
}: {
  urlKey: string | null;
  standalone: boolean;
  config: UnlockConfig;
  homeEntryRef: RefObject<LicenceUnlock['done']>;
}) {
  const [copied, setCopied] = useState(false);
  // A key from the link shows one calm state in place of the form —
  // until it fails, when the form comes back with the key in it, for good.
  const calm = !!key;
  const [fellBack, setFellBack] = useState(false);
  const unlock = useLicenceUnlock(config, {
    autoKey: key ?? undefined,
    holdMs: calm && standalone ? UNLOCKED_HOLD_MS : 0,
    deferNavigation: !!key && !standalone && !fellBack,
  });
  if (calm && unlock.failure && !fellBack) setFellBack(true);

  useEffect(() => {
    homeEntryRef.current = unlock.done;
    // A newer URL key replaces the body without leaving the route.
    return () => { homeEntryRef.current = null; };
  }, [homeEntryRef, unlock.done]);

  async function copy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard access — the key is still selectable on screen
    }
  }

  const keyRow = (
    <div className="mt-2 flex items-center gap-2">
      <code
        data-testid="unlock-key-value"
        className="min-w-0 flex-1 select-all break-all rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-800"
      >
        {key}
      </code>
      <Button size="sm" variant="secondary" onClick={() => void copy()} data-testid="unlock-key-copy">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );

  if (calm && !fellBack) {
    const { done } = unlock;
    return (
      <section
        data-testid="unlock-unlocking"
        role="status"
        aria-live="polite"
        className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-ink-200 bg-surface px-5 py-10 text-center shadow-xs"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
          <KeyRound className="h-8 w-8 text-brand-600" aria-hidden />
        </span>
        {done ? (
          <p data-testid="unlock-unlocked" className="text-xl font-bold text-ink-900">
            Unlocked: {done.title}, {done.questionCount} questions
          </p>
        ) : (
          <>
            <p className="text-xl font-bold text-ink-900">Unlocking your full bank…</p>
            <div
              data-testid="unlock-progress"
              aria-hidden
              className="h-1.5 w-40 overflow-hidden rounded-full bg-brand-100"
            >
              <div className="animate-indeterminate h-full w-1/3 rounded-full bg-brand-500" />
            </div>
            <p className="text-sm text-ink-500">This takes a few seconds.</p>
          </>
        )}
        {done && !standalone ? (
          <>
            <Button data-testid="unlock-start" onClick={() => openUnlockedPack(done)}>
              Start practising
            </Button>
            <div data-testid="unlock-key" className="mt-3 w-full text-left text-xs text-ink-500">
              <p>
                Using the app from your home screen? It picks this up by itself. If it doesn’t,
                copy your key:
              </p>
              {keyRow}
            </div>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-ink-900">
          <KeyRound className="h-7 w-7 text-brand-600" />
          Unlock a pack
        </h1>
        <p className="mt-1 text-ink-500">
          A licence key fetches the pack it unlocks and makes it active on this device.
        </p>
      </div>

      {key && !standalone ? (
        <section
          data-testid="unlock-key"
          className="rounded-2xl border-2 border-brand-500 bg-surface p-5 shadow-xs"
        >
          <h2 className="text-lg font-semibold text-ink-900">Using the app on your home screen?</h2>
          <p className="mt-1 text-sm text-ink-600">
            This page opened in your browser, so the app hasn’t got your key yet.
          </p>
          <ol data-testid="unlock-key-steps" className="mt-4 flex flex-col gap-4">
            <li className="flex gap-3">
              <StepNumber n={1} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">Copy your key</p>
                {keyRow}
              </div>
            </li>
            <li className="flex gap-3">
              <StepNumber n={2} />
              <p className="font-medium text-ink-900">Go back to the app on your home screen</p>
            </li>
            <li className="flex gap-3">
              <StepNumber n={3} />
              <p className="font-medium text-ink-900">Packs → Have a licence key? → paste</p>
            </li>
          </ol>
          <p className="mt-4 text-xs text-ink-600">
            Don’t use the home-screen app? There’s no need to copy anything: the form
            below unlocks the pack in this browser.
          </p>
        </section>
      ) : null}

      {key && standalone ? (
        <section
          data-testid="unlock-key"
          className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Your licence key
          </p>
          {keyRow}
          <p className="mt-3 text-xs text-ink-600">
            Installed the app on your home screen? Paste this key under Packs →
            Have a licence key?
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs">
        <h2 className="text-lg font-semibold text-ink-900">Enter a licence key</h2>
        <p className="mt-1 text-sm text-ink-600">
          {key
            ? 'The key from your link is filled in below.'
            : 'Paste the licence key you were given.'}
        </p>
        <div className="mt-4">
          <LicenceKeyEntry unlock={unlock} initialKey={key ?? undefined} />
        </div>
      </section>
    </>
  );
}
