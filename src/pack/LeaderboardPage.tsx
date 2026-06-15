'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trophy } from 'lucide-react';
import { SYNC_CONFIGURED } from '@/lib/supabase';
import {
  avatarEmoji,
  groupMetaByShareCode,
  leaderboardByShareCode,
} from '@/lib/social';
import { isValidShareCode, normalizeShareCode } from '@/lib/friend-code';
import { rankLeaderboard, type RankedRow } from '@/lib/leaderboard';

/**
 * Public leaderboard — resolves a `?code=XXXXXX` share code to ranked
 * standings. No sign-in required: the share-code RPC returns aggregate,
 * name+avatar-only rows. The code is read from the URL on the client so the
 * page stays a plain static export (no server, no Suspense boundary).
 */
export default function LeaderboardPage() {
  const [code, setCode] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<RankedRow[] | null>(null);
  const [meta, setMeta] = useState<{ name: string; members: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read the share code from the URL once on mount.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('code');
    if (fromUrl && isValidShareCode(fromUrl)) setCode(normalizeShareCode(fromUrl));
  }, []);

  useEffect(() => {
    if (!code || !SYNC_CONFIGURED) return;
    let active = true;
    setRows(null);
    setError(null);
    void (async () => {
      const [data, m] = await Promise.all([
        leaderboardByShareCode(code),
        groupMetaByShareCode(code),
      ]);
      if (!active) return;
      if (!m) {
        setError('No leaderboard found for that code.');
        setRows([]);
        return;
      }
      setMeta(m);
      setRows(rankLeaderboard(data));
    })();
    return () => {
      active = false;
    };
  }, [code]);

  function go() {
    const c = normalizeShareCode(input);
    if (isValidShareCode(c)) setCode(c);
    else setError('Codes are 6 letters/numbers, like K7P2QR.');
  }

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Back"
          className="tap-feedback inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-ink-900">Leaderboard</h1>
      </header>

      {!SYNC_CONFIGURED ? (
        <p className="text-ink-600">Leaderboards aren’t set up for this app yet.</p>
      ) : !code ? (
        <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-600">Enter a leaderboard share code to watch the standings.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="K7P2QR"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-center font-mono text-lg uppercase tracking-[0.3em] text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="button"
              onClick={go}
              className="tap-feedback rounded-xl bg-brand-600 px-5 py-2 font-semibold text-white"
            >
              View
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-warn-700">{error}</p>}
        </section>
      ) : rows === null ? (
        <p className="text-ink-500">Loading…</p>
      ) : error ? (
        <p className="text-warn-700">{error}</p>
      ) : (
        <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-ink-900">{meta?.name}</h2>
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            {meta?.members} {meta?.members === 1 ? 'player' : 'players'} · weekly XP, resets Monday
          </p>
          <ol className="mt-4 flex flex-col gap-1.5">
            {rows.map((row, i) => (
              <li
                key={`${row.displayName}-${i}`}
                className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2"
              >
                <span className="w-5 text-center font-bold text-ink-500">{row.rank}</span>
                <span className="text-2xl">{avatarEmoji(row.avatar)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink-900">{row.displayName}</div>
                  <div className="text-xs text-ink-500">
                    🔥 {row.streakDays}d · {row.questionsWeek} this week
                  </div>
                </div>
                <span className="font-mono text-sm font-bold text-brand-700">{row.weekXp} XP</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
