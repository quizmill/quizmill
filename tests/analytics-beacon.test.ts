/**
 * First-party funnel analytics — the anonymous beacon a hosted app can
 * send to its author's endpoint, and the milestones it derives from the
 * mutation bus. Everything here must be DORMANT without
 * NEXT_PUBLIC_ANALYTICS_URL, and silent once the learner switches
 * analytics off in Settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attempt, Session } from '@/data/types';
import {
  ANALYTICS_URL_ENV,
  ANALYTICS_PREF_KEY,
  DEVICE_ID_KEY,
  FUNNEL_EVENTS,
  analyticsConfigured,
  beaconFor,
  loadAnalyticsEnabled,
  loadDeviceId,
  regenerateDeviceId,
  saveAnalyticsEnabled,
  sendFunnelEvent,
  startAnalytics,
  stopAnalyticsForTests,
} from '@/lib/analytics';
import { loadEvents, recordEvent, saveAttempt, saveSession } from '@/lib/storage';
import { APP_CONFIG } from '@/config';

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const sent: { url: string; body: string }[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal('window', {
    localStorage: fakeLocalStorage(),
    dispatchEvent: () => true,
  });
  vi.stubGlobal('navigator', {
    sendBeacon: (url: string, body: string) => {
      sent.push({ url, body });
      return true;
    },
  });
  process.env[ANALYTICS_URL_ENV] = 'https://sync.example/v1/analytics';
});

afterEach(() => {
  stopAnalyticsForTests();
  delete process.env[ANALYTICS_URL_ENV];
  vi.unstubAllGlobals();
});

function attempt(id: string, extra: Partial<Attempt> = {}): Attempt {
  return {
    id,
    sessionId: 's1',
    questionId: 'q1',
    answeredAt: 1000,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'c',
    topic: 'q1',
    difficulty: 1,
    ...extra,
  };
}

function endedSession(id: string): Session {
  return {
    id,
    subject: 'c',
    startedAt: 1,
    endedAt: 2,
    questionCount: 10,
    correctCount: 7,
  };
}

describe('device id', () => {
  it('is minted once, app-level, and survives re-reads', () => {
    const id = loadDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadDeviceId()).toBe(id);
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBe(id);
    expect(DEVICE_ID_KEY.startsWith(`quizmill.${APP_CONFIG.packId}.`)).toBe(false);
  });

  it('regenerates to a fresh id on request', () => {
    const before = loadDeviceId();
    const after = regenerateDeviceId();
    expect(after).not.toBe(before);
    expect(loadDeviceId()).toBe(after);
  });
});

describe('analytics preference', () => {
  it('defaults to on, and the off state round-trips', () => {
    expect(loadAnalyticsEnabled()).toBe(true);
    saveAnalyticsEnabled(false);
    expect(loadAnalyticsEnabled()).toBe(false);
    expect(window.localStorage.getItem(ANALYTICS_PREF_KEY)).toBe('0');
    saveAnalyticsEnabled(true);
    expect(loadAnalyticsEnabled()).toBe(true);
  });
});

describe('beacon payload', () => {
  it('carries exactly event, packId, deviceId, appBuild, ts', () => {
    const payload = beaconFor({ id: 'e1', type: 'app_open', at: 123 }, 'dev-1', 'b1');
    expect(payload).toEqual({
      event: 'app_open',
      packId: APP_CONFIG.packId,
      deviceId: 'dev-1',
      appBuild: 'b1',
      ts: 123,
    });
    expect(Object.keys(payload).sort()).toEqual(['appBuild', 'deviceId', 'event', 'packId', 'ts']);
  });
});

describe('sendFunnelEvent', () => {
  it('posts a funnel event with navigator.sendBeacon', () => {
    expect(analyticsConfigured()).toBe(true);
    expect(sendFunnelEvent({ id: 'e1', type: 'first_answer', at: 5 })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://sync.example/v1/analytics');
    const body = JSON.parse(sent[0].body);
    expect(body.event).toBe('first_answer');
    expect(body.packId).toBe(APP_CONFIG.packId);
    expect(body.deviceId).toBe(loadDeviceId());
    expect(body.ts).toBe(5);
  });

  it('is dormant when NEXT_PUBLIC_ANALYTICS_URL is unset', () => {
    delete process.env[ANALYTICS_URL_ENV];
    expect(analyticsConfigured()).toBe(false);
    expect(sendFunnelEvent({ id: 'e1', type: 'app_open', at: 5 })).toBe(false);
    expect(sent).toEqual([]);
    // …and never even mints a device id for a build that can't use it.
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
  });

  it('is silent once analytics is switched off', () => {
    saveAnalyticsEnabled(false);
    expect(sendFunnelEvent({ id: 'e1', type: 'app_open', at: 5 })).toBe(false);
    expect(sent).toEqual([]);
  });

  it('ignores events outside the funnel list', () => {
    expect(FUNNEL_EVENTS).toContain('app_open');
    expect(FUNNEL_EVENTS).not.toContain('game_open');
    expect(sendFunnelEvent({ id: 'e1', type: 'game_open', at: 5 })).toBe(false);
    expect(sent).toEqual([]);
  });

  it('falls back to a keepalive fetch where sendBeacon is missing', () => {
    vi.stubGlobal('navigator', {});
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    expect(sendFunnelEvent({ id: 'e1', type: 'app_open', at: 5 })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sync.example/v1/analytics');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
  });

  it('never throws when the transport does', () => {
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('boom');
      },
    });
    expect(() => sendFunnelEvent({ id: 'e1', type: 'app_open', at: 5 })).not.toThrow();
  });
});

describe('startAnalytics (mutation bus → beacons + milestones)', () => {
  it('beacons funnel events recorded through recordEvent', () => {
    startAnalytics();
    recordEvent('app_open', undefined, 9);
    recordEvent('game_open', { game: 'snake' }, 10);
    expect(sent.map((s) => JSON.parse(s.body).event)).toEqual(['app_open']);
  });

  it('records first_answer once, on the very first attempt', () => {
    startAnalytics();
    saveAttempt(attempt('a1'));
    saveAttempt(attempt('a2'));
    const types = loadEvents().map((e) => e.type);
    expect(types.filter((t) => t === 'first_answer')).toHaveLength(1);
    expect(sent.map((s) => JSON.parse(s.body).event)).toEqual(['first_answer']);
  });

  it('does not back-date first_answer for a device with existing history', () => {
    // Two attempts already on the device before this build ran.
    saveAttempt(attempt('old-1'));
    saveAttempt(attempt('old-2'));
    startAnalytics();
    saveAttempt(attempt('a3'));
    expect(loadEvents().map((e) => e.type)).not.toContain('first_answer');
    expect(sent).toEqual([]);
  });

  it('records session_10 when the tenth session ends, once', () => {
    startAnalytics();
    for (let i = 1; i <= 9; i++) saveSession(endedSession(`s${i}`));
    expect(loadEvents().map((e) => e.type)).not.toContain('session_10');
    saveSession(endedSession('s10'));
    saveSession(endedSession('s10')); // idempotent re-save of the same end
    saveSession(endedSession('s11'));
    expect(loadEvents().filter((e) => e.type === 'session_10')).toHaveLength(1);
    expect(sent.map((s) => JSON.parse(s.body).event)).toEqual(['session_10']);
  });

  it('a still-running session does not count towards session_10', () => {
    startAnalytics();
    for (let i = 1; i <= 9; i++) saveSession(endedSession(`s${i}`));
    saveSession({ ...endedSession('s10'), endedAt: null });
    expect(loadEvents().map((e) => e.type)).not.toContain('session_10');
  });

  it('still records milestones locally when the beacon is dormant', () => {
    delete process.env[ANALYTICS_URL_ENV];
    startAnalytics();
    saveAttempt(attempt('a1'));
    expect(loadEvents().map((e) => e.type)).toContain('first_answer');
    expect(sent).toEqual([]);
  });

  it('subscribes only once', () => {
    startAnalytics();
    startAnalytics();
    recordEvent('app_open', undefined, 9);
    expect(sent).toHaveLength(1);
  });
});
