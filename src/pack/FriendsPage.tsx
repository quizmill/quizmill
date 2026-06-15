'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Share2, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SYNC_CONFIGURED, getSupabase } from '@/lib/supabase';
import {
  AVATARS,
  CHEERS,
  avatarEmoji,
  createGroup,
  ensureProfile,
  isSocialEnabled,
  listFriends,
  listIncomingRequests,
  myGroups,
  refreshMyStats,
  removeFriend,
  requestFriend,
  respondFriend,
  sendCheer,
  type CheerKind,
  type FriendCard,
  type Group,
  type IncomingRequest,
  type Profile,
} from '@/lib/social';
import { isValidFriendCode, normalizeFriendCode } from '@/lib/friend-code';
import { computeProfileStats } from '@/lib/social-stats';
import { rankLeaderboard, type LeaderboardRow } from '@/lib/leaderboard';
import { loadAttempts, loadAchievements } from '@/lib/storage';
import { cn } from '@/lib/cn';

/**
 * Friends & leaderboards. Connecting is a friend-code → accept handshake;
 * a shared leaderboard group has a share code anyone can view (see
 * /leaderboard). Dormant unless Supabase is configured, and gated behind
 * sign-in (which lives on Settings).
 */
export default function FriendsPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendCard[]>([]);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const [f, r, g] = await Promise.all([listFriends(), listIncomingRequests(), myGroups()]);
    setFriends(f);
    setRequests(r);
    setGroups(g);
  }, []);

  useEffect(() => {
    if (!isSocialEnabled()) {
      setSignedIn(false);
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      setSignedIn(false);
      return;
    }
    let active = true;
    void (async () => {
      const { data } = await sb.auth.getSession();
      if (!active) return;
      if (!data.session) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);
      const p = await ensureProfile();
      if (!active) return;
      setProfile(p);
      await refreshMyStats(); // push my latest numbers before reading the board
      await refresh();
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  // My own row, computed locally so I always appear on the board.
  const myStats = computeProfileStats(loadAttempts(), loadAchievements().length);
  const myRow: LeaderboardRow | null = profile
    ? {
        displayName: `${profile.displayName} (you)`,
        avatar: profile.avatar,
        weekXp: myStats.weekXp,
        totalXp: myStats.totalXp,
        streakDays: myStats.streakDays,
        questionsWeek: myStats.questionsWeek,
        accuracyPct: myStats.accuracyPct,
        stickerCount: myStats.stickerCount,
      }
    : null;
  const board = rankLeaderboard([...(myRow ? [myRow] : []), ...friends]);

  async function setAvatar(key: string) {
    const p = await ensureProfile(undefined, key);
    setProfile(p);
  }

  async function addFriend() {
    const code = normalizeFriendCode(codeInput);
    if (!isValidFriendCode(code)) {
      setStatus('That code looks off — it should be like BRAVE-OTTER-42.');
      return;
    }
    const outcome = await requestFriend(code);
    setCodeInput('');
    setStatus(
      {
        requested: 'Request sent! They’ll see it next time they open the app.',
        accepted: 'You’re now friends! 🎉',
        already_friends: 'You’re already friends with them.',
        self: 'That’s your own code 🙂',
        not_found: 'No one has that code yet.',
      }[outcome] ?? 'Something went wrong — try again.',
    );
    await refresh();
  }

  async function respond(requesterId: string, accept: boolean) {
    await respondFriend(requesterId, accept);
    await refresh();
  }

  async function unfriend(userId: string) {
    await removeFriend(userId);
    await refresh();
  }

  async function makeGroup() {
    const g = await createGroup(profile ? `${profile.displayName}’s board` : undefined);
    if (g) setGroups((prev) => [...prev, g]);
  }

  async function copyShare(group: Group) {
    const url = `${window.location.origin}/leaderboard/?code=${group.shareCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus(`Share this link: ${url}`);
    }
  }

  async function cheer(toId: string, kind: CheerKind) {
    await sendCheer(toId, kind);
    setStatus('Cheer sent! 🎉');
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (!SYNC_CONFIGURED) {
    return (
      <Shell>
        <p className="text-ink-600">
          Friends aren’t set up for this app yet.
        </p>
      </Shell>
    );
  }

  if (signedIn === null) {
    return (
      <Shell>
        <p className="text-ink-500">Loading…</p>
      </Shell>
    );
  }

  if (!signedIn) {
    return (
      <Shell>
        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink-900">Sign in to add friends</h2>
          <p className="mt-1 text-sm text-ink-600">
            Connecting with friends needs a quick sign-in (it’s how your
            progress reaches them). Everything still works offline without it.
          </p>
          <Link href="/settings" className="mt-4 inline-block">
            <Button>Go to Settings to sign in</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* My friend code + avatar */}
      <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink-900">Your friend code</h2>
        <p className="mt-1 text-sm text-ink-600">
          Share this so a friend can add you.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 rounded-xl bg-ink-100 px-3 py-2 text-center font-mono text-lg tracking-wide text-ink-900">
            {profile?.friendCode ?? '…'}
          </code>
          <Button
            variant="secondary"
            aria-label="Copy friend code"
            onClick={async () => {
              if (!profile) return;
              await navigator.clipboard.writeText(profile.friendCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Your avatar
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setAvatar(a.key)}
                aria-label={a.key}
                className={cn(
                  'tap-feedback flex h-10 w-10 items-center justify-center rounded-full text-xl',
                  profile?.avatar === a.key
                    ? 'bg-brand-100 ring-2 ring-brand-500'
                    : 'bg-ink-100',
                )}
              >
                {a.emoji}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Add a friend */}
      <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink-900">Add a friend</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="BRAVE-OTTER-42"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-center font-mono uppercase tracking-wide text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <Button onClick={addFriend} disabled={!codeInput.trim()}>
            <UserPlus className="h-4 w-4" />
            Add
          </Button>
        </div>
        {status && (
          <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{status}</p>
        )}
      </section>

      {/* Incoming requests */}
      {requests.length > 0 && (
        <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink-900">Friend requests</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.requesterId} className="flex items-center gap-3">
                <span className="text-2xl">{avatarEmoji(r.avatar)}</span>
                <span className="flex-1 font-medium text-ink-800">{r.displayName}</span>
                <Button size="sm" onClick={() => respond(r.requesterId, true)}>
                  <Check className="h-4 w-4" /> Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => respond(r.requesterId, false)}>
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Leaderboard (you + friends, this week) */}
      <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink-900">This week</h2>
          <span className="text-xs text-ink-500">resets Monday</span>
        </div>
        {board.length <= 1 ? (
          <p className="mt-2 text-sm text-ink-500">
            Add a friend to see how you stack up. Earn points just by
            practising — getting answers right is a bonus.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-1.5">
            {board.map((row, i) => {
              const isMe = row.displayName.endsWith('(you)');
              const friend = friends.find(
                (f) => f.displayName === row.displayName && f.avatar === row.avatar,
              );
              return (
                <li
                  key={`${row.displayName}-${i}`}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2',
                    isMe ? 'bg-brand-50' : 'bg-ink-50',
                  )}
                >
                  <span className="w-5 text-center font-bold text-ink-500">{row.rank}</span>
                  <span className="text-2xl">{avatarEmoji(row.avatar)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink-900">{row.displayName}</div>
                    <div className="text-xs text-ink-500">
                      🔥 {row.streakDays}d · {row.questionsWeek} this week
                    </div>
                  </div>
                  <span className="font-mono text-sm font-bold text-brand-700">
                    {row.weekXp} XP
                  </span>
                  {friend && (
                    <div className="flex gap-0.5">
                      {CHEERS.slice(0, 2).map((c) => (
                        <button
                          key={c.kind}
                          type="button"
                          aria-label={c.label}
                          title={c.label}
                          onClick={() => cheer(friend.userId, c.kind)}
                          className="tap-feedback rounded-full px-1 text-lg hover:bg-ink-100"
                        >
                          {c.emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {friends.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-ink-500">Manage friends</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {friends.map((f) => (
                <li key={f.userId} className="flex items-center gap-2 text-sm">
                  <span>{avatarEmoji(f.avatar)}</span>
                  <span className="flex-1 text-ink-700">{f.displayName}</span>
                  <button
                    type="button"
                    onClick={() => unfriend(f.userId)}
                    className="text-xs text-ink-400 underline-offset-2 hover:text-warn-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Shareable leaderboard groups */}
      <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink-900">Shareable leaderboard</h2>
        <p className="mt-1 text-sm text-ink-600">
          Make a board with a share code — anyone with the link can watch the
          standings, no sign-in needed. Great for a class or a family group.
        </p>
        {groups.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {groups.map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink-800">{g.name}</div>
                  <code className="font-mono text-xs tracking-widest text-ink-500">
                    {g.shareCode}
                  </code>
                </div>
                <Link
                  href={`/leaderboard/?code=${g.shareCode}`}
                  className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  View
                </Link>
                <Button size="sm" variant="secondary" onClick={() => copyShare(g)}>
                  <Share2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" className="mt-3" onClick={makeGroup}>
          Create a shareable board
        </Button>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
        <h1 className="text-2xl font-bold text-ink-900">Friends</h1>
      </header>
      {children}
    </main>
  );
}
