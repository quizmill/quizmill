'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import * as storage from './storage';
import { SESSIONS_KEY, ATTEMPTS_KEY } from './storage';
import {
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from './sync';
import type { Attempt, Session } from '@/data/types';

const EVENT = 'quizmill:storage';
const EMPTY_SESSIONS: Session[] = [];
const EMPTY_ATTEMPTS: Attempt[] = [];

function emit() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT));
  }
}

function subscribe(cb: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

// Snapshot cache — required for useSyncExternalStore. We re-read localStorage
// only when the raw string changes; otherwise return the same array reference.
let sessionsRaw: string | null = null;
let sessionsCache: Session[] = EMPTY_SESSIONS;
let attemptsRaw: string | null = null;
let attemptsCache: Attempt[] = EMPTY_ATTEMPTS;

function getSessionsSnapshot(): Session[] {
  if (typeof window === 'undefined') return EMPTY_SESSIONS;
  const raw = window.localStorage.getItem(SESSIONS_KEY);
  if (raw === sessionsRaw) return sessionsCache;
  sessionsRaw = raw;
  sessionsCache = storage.loadSessions();
  return sessionsCache;
}

function getAttemptsSnapshot(): Attempt[] {
  if (typeof window === 'undefined') return EMPTY_ATTEMPTS;
  const raw = window.localStorage.getItem(ATTEMPTS_KEY);
  if (raw === attemptsRaw) return attemptsCache;
  attemptsRaw = raw;
  attemptsCache = storage.loadAttempts();
  return attemptsCache;
}

function getSessionsServerSnapshot(): Session[] {
  return EMPTY_SESSIONS;
}

function getAttemptsServerSnapshot(): Attempt[] {
  return EMPTY_ATTEMPTS;
}

export function useStorageData(): { sessions: Session[]; attempts: Attempt[] } {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const sessions = useSyncExternalStore(
    subscribe,
    getSessionsSnapshot,
    getSessionsServerSnapshot,
  );
  const attempts = useSyncExternalStore(
    subscribe,
    getAttemptsSnapshot,
    getAttemptsServerSnapshot,
  );
  return mounted
    ? { sessions, attempts }
    : { sessions: EMPTY_SESSIONS, attempts: EMPTY_ATTEMPTS };
}

const IDLE_SYNC_STATUS: SyncStatus = { state: 'idle', pending: 0, signedIn: false };

/**
 * Reactive cloud-sync status (online/offline + queue drain). Dormant
 * ('idle') when sync isn't configured or the user is signed out, so callers
 * can render nothing in that case. Server snapshot is always idle.
 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatus,
    () => IDLE_SYNC_STATUS,
  );
}

export function useStartSession() {
  return useCallback((session: Session) => {
    storage.saveSession(session);
    emit();
  }, []);
}

export function useRecordAttempt() {
  return useCallback((attempt: Attempt) => {
    storage.saveAttempt(attempt);
    emit();
  }, []);
}

export function useEndSession() {
  return useCallback((session: Session) => {
    storage.saveSession(session);
    emit();
  }, []);
}

export function useResetAll() {
  return useCallback(() => {
    storage.clearAll();
    emit();
  }, []);
}

export function useResetToday() {
  return useCallback(() => {
    const result = storage.clearSince(storage.startOfTodayEpoch());
    emit();
    return result;
  }, []);
}

/**
 * Earned achievements ("stickers"). Reactive — re-reads from storage on
 * the quizmill:storage event, so the cabinet updates when a runner
 * records an unlock (storage.recordEarnedAchievements emits no event
 * itself; the unlock hook's state change re-renders the runner, and
 * cross-page reads happen on mount).
 */
export function useEarnedAchievements(): {
  earned: Set<string>;
  earnedList: storage.EarnedAchievement[];
} {
  const [list, setList] = useState<storage.EarnedAchievement[]>([]);
  useEffect(() => {
    const refresh = () => setList(storage.loadAchievements());
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return {
    earned: new Set(list.map((e) => e.id)),
    earnedList: list,
  };
}

/**
 * Per-question thumbs-up / thumbs-down votes plus optional downvote
 * comment. Reactive — re-reads from storage on the quizmill:storage event.
 */
export function useQuestionVotes(): {
  votes: Map<string, storage.QuestionVote>;
  votesList: storage.QuestionVote[];
  setVote: (questionId: string, vote: storage.VoteDir | null, comment?: string) => void;
} {
  const [list, setList] = useState<storage.QuestionVote[]>([]);
  useEffect(() => {
    const refresh = () => setList(storage.loadVotes());
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const setVote = useCallback(
    (questionId: string, vote: storage.VoteDir | null, comment?: string) => {
      storage.recordVote(questionId, vote, comment);
      emit();
    },
    [],
  );
  return {
    votes: new Map(list.map((v) => [v.questionId, v])),
    votesList: list,
    setVote,
  };
}
