/**
 * Social client — friends, groups, leaderboards, cheers.
 *
 * Like `sync.ts`, this is the browser side of an OPTIONAL cloud feature. It
 * is completely dormant unless a Supabase project is configured: every entry
 * point checks {@link isSocialEnabled} and no-ops (returning empty/neutral
 * values) otherwise, so the pure-local app is unchanged.
 *
 * All graph mutations go through SECURITY DEFINER RPCs (see the 0002
 * migration) — the client never writes the friendship/group tables directly,
 * so it can't forge an accepted edge or read someone it isn't connected to.
 *
 * Kids-safe by construction: profiles expose a chosen display name + a preset
 * avatar key only (never email), cheers are a fixed preset enum (no free
 * text), and the public leaderboard is resolved by share code through an RPC
 * that returns aggregate columns only.
 */
import { getSupabase, SYNC_CONFIGURED } from './supabase';
import * as storage from './storage';
import {
  computeProfileStats,
  type ProfileStats,
} from './social-stats';
import type { LeaderboardRow } from './leaderboard';

/** True when this build can talk to a Supabase project at all. */
export function isSocialEnabled(): boolean {
  return SYNC_CONFIGURED;
}

// ── Presets (the kid-safe palette) ───────────────────────────────────────

/** Preset avatars — an emoji + a stable key stored on the profile. */
export const AVATARS: { key: string; emoji: string }[] = [
  { key: 'fox', emoji: '🦊' },
  { key: 'panda', emoji: '🐼' },
  { key: 'otter', emoji: '🦦' },
  { key: 'owl', emoji: '🦉' },
  { key: 'tiger', emoji: '🐯' },
  { key: 'koala', emoji: '🐨' },
  { key: 'dolphin', emoji: '🐬' },
  { key: 'rabbit', emoji: '🐰' },
];

export function avatarEmoji(key: string): string {
  return AVATARS.find((a) => a.key === key)?.emoji ?? '🦊';
}

export type CheerKind = 'keep_going' | 'nice_streak' | 'high_five' | 'star';

/** Preset cheers — the entire vocabulary of player-to-player messaging. */
export const CHEERS: { kind: CheerKind; emoji: string; label: string }[] = [
  { kind: 'keep_going', emoji: '🔥', label: 'Keep going!' },
  { kind: 'nice_streak', emoji: '⚡', label: 'Nice streak!' },
  { kind: 'high_five', emoji: '🙌', label: 'High five!' },
  { kind: 'star', emoji: '⭐', label: 'Superstar!' },
];

// ── Types ────────────────────────────────────────────────────────────────

export interface Profile {
  userId: string;
  displayName: string;
  avatar: string;
  friendCode: string;
}

export interface FriendCard extends LeaderboardRow {
  userId: string;
}

export interface IncomingRequest {
  requesterId: string;
  displayName: string;
  avatar: string;
}

export interface Group {
  id: string;
  name: string;
  shareCode: string;
}

// ── Row mapping ──────────────────────────────────────────────────────────

function rowToProfile(r: Record<string, unknown>): Profile {
  return {
    userId: r.user_id as string,
    displayName: r.display_name as string,
    avatar: r.avatar as string,
    friendCode: r.friend_code as string,
  };
}

function statsToRow(s: ProfileStats, user_id: string) {
  return {
    user_id,
    week_start: s.weekStart,
    week_xp: s.weekXp,
    total_xp: s.totalXp,
    streak_days: s.streakDays,
    questions_week: s.questionsWeek,
    accuracy_pct: s.accuracyPct,
    sticker_count: s.stickerCount,
    updated_at: new Date().toISOString(),
  };
}

function rowToLeaderboard(r: Record<string, unknown>): LeaderboardRow {
  return {
    displayName: r.display_name as string,
    avatar: r.avatar as string,
    weekXp: (r.week_xp as number) ?? 0,
    totalXp: (r.total_xp as number) ?? 0,
    streakDays: (r.streak_days as number) ?? 0,
    questionsWeek: (r.questions_week as number) ?? 0,
    accuracyPct: (r.accuracy_pct as number) ?? 0,
    stickerCount: (r.sticker_count as number) ?? 0,
  };
}

// ── Profile ──────────────────────────────────────────────────────────────

/** Create-or-fetch my profile, minting a friend code on first call. */
export async function ensureProfile(
  displayName?: string,
  avatar?: string,
): Promise<Profile | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc('ensure_profile', {
    p_display_name: displayName ?? null,
    p_avatar: avatar ?? null,
  });
  if (error || !data) return null;
  return rowToProfile(data as Record<string, unknown>);
}

// ── My stats → cloud ─────────────────────────────────────────────────────

/** Recompute the shareable summary from local history and mirror it up. */
export async function refreshMyStats(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: auth } = await sb.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const stats = computeProfileStats(
    storage.loadAttempts(),
    storage.loadAchievements().length,
  );
  await sb.from('profile_stats').upsert(statsToRow(stats, uid));
}

// ── Friends ──────────────────────────────────────────────────────────────

/** Send a friend request by code. Returns the RPC's outcome string. */
export async function requestFriend(code: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) return 'unavailable';
  const { data, error } = await sb.rpc('request_friend', { p_code: code });
  if (error) return 'error';
  return (data as string) ?? 'error';
}

export async function respondFriend(requesterId: string, accept: boolean): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.rpc('respond_friend', { p_requester: requesterId, p_accept: accept });
}

export async function removeFriend(otherId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user?.id;
  if (!me) return;
  await sb
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${otherId}),` +
        `and(requester_id.eq.${otherId},addressee_id.eq.${me})`,
    );
}

/** Accepted friends as leaderboard-shaped cards (profile + aggregate stats). */
export async function listFriends(): Promise<FriendCard[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user?.id;
  if (!me) return [];

  const { data: edges } = await sb
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  const ids = (edges ?? []).map((e) =>
    e.requester_id === me ? (e.addressee_id as string) : (e.requester_id as string),
  );
  if (ids.length === 0) return [];

  const [{ data: profiles }, { data: stats }] = await Promise.all([
    sb.from('profiles').select('*').in('user_id', ids),
    sb.from('profile_stats').select('*').in('user_id', ids),
  ]);
  const statsById = new Map(
    (stats ?? []).map((s) => [s.user_id as string, s as Record<string, unknown>]),
  );
  return (profiles ?? []).map((p) => {
    const s = statsById.get(p.user_id as string);
    return {
      userId: p.user_id as string,
      displayName: p.display_name as string,
      avatar: p.avatar as string,
      weekXp: (s?.week_xp as number) ?? 0,
      totalXp: (s?.total_xp as number) ?? 0,
      streakDays: (s?.streak_days as number) ?? 0,
      questionsWeek: (s?.questions_week as number) ?? 0,
      accuracyPct: (s?.accuracy_pct as number) ?? 0,
      stickerCount: (s?.sticker_count as number) ?? 0,
    } satisfies FriendCard;
  });
}

/** Pending requests sent TO me, awaiting accept/decline. */
export async function listIncomingRequests(): Promise<IncomingRequest[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user?.id;
  if (!me) return [];
  const { data: edges } = await sb
    .from('friendships')
    .select('requester_id')
    .eq('addressee_id', me)
    .eq('status', 'pending');
  const ids = (edges ?? []).map((e) => e.requester_id as string);
  if (ids.length === 0) return [];
  const { data: profiles } = await sb.from('profiles').select('*').in('user_id', ids);
  return (profiles ?? []).map((p) => ({
    requesterId: p.user_id as string,
    displayName: p.display_name as string,
    avatar: p.avatar as string,
  }));
}

export async function sendCheer(toId: string, kind: CheerKind): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.rpc('send_cheer', { p_to: toId, p_kind: kind });
}

// ── Groups & leaderboards ────────────────────────────────────────────────

function rowToGroup(r: Record<string, unknown>): Group {
  return {
    id: r.id as string,
    name: r.name as string,
    shareCode: r.share_code as string,
  };
}

export async function createGroup(name?: string): Promise<Group | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc('create_group', { p_name: name ?? null });
  if (error || !data) return null;
  return rowToGroup(data as Record<string, unknown>);
}

export async function joinGroup(code: string): Promise<Group | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc('join_group', { p_code: code });
  if (error || !data) return null;
  return rowToGroup(data as Record<string, unknown>);
}

export async function myGroups(): Promise<Group[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from('groups').select('*');
  return (data ?? []).map((g) => rowToGroup(g as Record<string, unknown>));
}

/** PUBLIC: resolve a share code to leaderboard rows. Works signed out. */
export async function leaderboardByShareCode(code: string): Promise<LeaderboardRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc('leaderboard_by_share_code', { p_code: code });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToLeaderboard);
}

/** PUBLIC: the group's name + member count for a share code. */
export async function groupMetaByShareCode(
  code: string,
): Promise<{ name: string; members: number } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc('group_meta_by_share_code', { p_code: code });
  if (error || !data || (data as unknown[]).length === 0) return null;
  const row = (data as Record<string, unknown>[])[0];
  return { name: row.name as string, members: row.members as number };
}
