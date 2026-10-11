'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { buildTimeManifest } from '@/pack/source';
import { cachePackAssets } from '@/lib/packAssets';
import { getInsertedPack } from '@/lib/packLibrary';
import {
  UNLOCK_FALLBACK,
  stashUnlockedToast,
  unlockPack,
  type UnlockConfig,
  type UnlockOutcome,
} from '@/lib/unlock';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Cap the validation errors shown for a bundle the endpoint sent broken. */
const MAX_ERRORS_SHOWN = 4;

/**
 * Licence key entry — the ONE handler behind both the /unlock route (where
 * the key arrives in the URL fragment and is submitted for the learner)
 * and "Have a licence key?" on /packs (typed or pasted). The outcome is
 * shown right here, where the learner is: a failure stays in the form
 * with the endpoint's text and the file fallback; a success stashes the
 * confirmation for Home and navigates there, so the unlocked pack is the
 * first thing on screen with no Packs visit in between.
 */
export function LicenceKeyForm({
  config,
  autoKey,
}: {
  config: UnlockConfig;
  /** A key that arrived by URL: submitted once on mount, kept in the field. */
  autoKey?: string;
}) {
  const [key, setKey] = useState(autoKey ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Extract<UnlockOutcome, { ok: false }> | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const started = useRef(false);
  // The request in flight, if any. Unmounting (a newer key remounts the
  // form on /unlock; leaving the page) abandons it: whatever the endpoint
  // answers afterwards must not insert or activate anything.
  const inflight = useRef<AbortController | null>(null);
  useEffect(() => () => inflight.current?.abort(), []);

  async function submit(candidate: string) {
    const trimmed = candidate.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailure(null);
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const outcome = await unlockPack(trimmed, {
        config,
        buildPackId: buildTimeManifest.id,
        signal: controller.signal,
      });
      if (!outcome.ok) {
        // Abandoned, not failed: the newer form has the learner's attention.
        if (outcome.reason !== 'cancelled') setFailure(outcome);
        return;
      }
      // Prefetch any images the bundle points at — fire-and-forget, as the
      // file insert does; the pack is already in.
      const stored = getInsertedPack(outcome.entry.id);
      if (stored) void cachePackAssets(stored).catch(() => undefined);
      stashUnlockedToast({ title: outcome.entry.title, count: outcome.entry.questionCount });
      setDone(outcome.entry.title);
      // A full load on purpose, not a client route: the active pack is
      // resolved once at boot (the layout bootstrap), so only a fresh
      // document renders the unlocked pack — same reason /packs reloads.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full load, see above
      window.location.assign(`${BASE_PATH}/`);
    } finally {
      if (inflight.current === controller) inflight.current = null;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoKey || started.current) return;
    started.current = true;
    void submit(autoKey);
    // Runs once for the key the URL carried — never again on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey]);

  return (
    <div data-testid="licence-key-form">
      <div className="flex gap-2">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(key);
          }}
          placeholder="Your licence key"
          aria-label="Licence key"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="licence-key-input"
          className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 font-mono text-sm text-ink-800 placeholder:font-sans placeholder:text-ink-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
        />
        <Button
          size="sm"
          onClick={() => void submit(key)}
          disabled={busy || !key.trim()}
          data-testid="licence-key-go"
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>

      {done ? (
        <p data-testid="licence-key-done" className="mt-3 text-sm text-brand-800">
          Unlocked “{done}” — opening it…
        </p>
      ) : null}

      {failure ? (
        <div
          data-testid="licence-key-error"
          role="alert"
          className="mt-4 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm text-ink-800"
        >
          <p className="font-semibold">{failure.message}</p>
          {failure.errors && failure.errors.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {failure.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {failure.errors.length > MAX_ERRORS_SHOWN ? (
                <li className="list-none text-ink-500">
                  …and {failure.errors.length - MAX_ERRORS_SHOWN} more.
                </li>
              ) : null}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-ink-600">
            <Link href="/packs" className="underline">
              {UNLOCK_FALLBACK}
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
