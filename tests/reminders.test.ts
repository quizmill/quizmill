import { describe, expect, it } from 'vitest';
import type { Attempt } from '@/data/types';
import {
  buildStreakMirror,
  reminderDecision,
  type StreakMirror,
} from '@/lib/reminders';

// Local-time noon anchors so day-key math doesn't drift across the test's
// timezone (toDayKey uses local calendar days).
const day = (iso: string) => new Date(`${iso}T12:00:00`);
const TODAY = day('2026-06-29');

let n = 0;
function attempt(over: Partial<Attempt> = {}): Attempt {
  n += 1;
  return {
    id: `a${n}`,
    sessionId: 's1',
    questionId: `q${n}`,
    answeredAt: TODAY.getTime(),
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 5,
    subject: 'alpha',
    topic: `q${n}`,
    difficulty: 2,
    ...over,
  };
}

/** A full qualifying day (>= goal answers) on the given date. */
function fullDay(date: Date, count = 10): Attempt[] {
  return Array.from({ length: count }, () =>
    attempt({ answeredAt: date.getTime() }),
  );
}

describe('buildStreakMirror', () => {
  it('summarises an empty history with no active or qualifying day', () => {
    const m = buildStreakMirror([], 'pack', 'My Pack', TODAY);
    expect(m).toMatchObject({
      packId: 'pack',
      title: 'My Pack',
      streak: 0,
      lastActiveDay: null,
      lastQualifyingDay: null,
    });
    expect(m.updatedAt).toBe(TODAY.getTime());
  });

  it('captures the last active day even below the daily goal', () => {
    // 3 answers today — active, but not a qualifying day.
    const m = buildStreakMirror(fullDay(TODAY, 3), 'pack', 'My Pack', TODAY);
    expect(m.lastActiveDay).toBe('2026-6-29');
    expect(m.lastQualifyingDay).toBeNull();
    expect(m.streak).toBe(0);
  });

  it('reports the streak and last qualifying day across consecutive days', () => {
    const yesterday = day('2026-06-28');
    const attempts = [...fullDay(yesterday), ...fullDay(TODAY)];
    const m = buildStreakMirror(attempts, 'pack', 'My Pack', TODAY);
    expect(m.streak).toBe(2);
    expect(m.lastQualifyingDay).toBe('2026-6-29');
    expect(m.lastActiveDay).toBe('2026-6-29');
  });
});

const mirror = (over: Partial<StreakMirror> = {}): StreakMirror => ({
  packId: 'pack',
  title: 'My Pack',
  streak: 3,
  lastActiveDay: '2026-6-28',
  lastQualifyingDay: '2026-6-28',
  goal: 10,
  updatedAt: day('2026-06-28').getTime(),
  ...over,
});

describe('reminderDecision', () => {
  it('fires when a streak is at risk: qualified yesterday, nothing today', () => {
    const d = reminderDecision(mirror(), TODAY);
    expect(d.show).toBe(true);
    expect(d.title).toBe('My Pack');
    expect(d.body).toContain('3-day streak');
  });

  it('stays quiet once today has any activity', () => {
    const d = reminderDecision(
      mirror({ lastActiveDay: '2026-6-29' }),
      TODAY,
    );
    expect(d.show).toBe(false);
  });

  it('stays quiet when there is no streak', () => {
    const d = reminderDecision(
      mirror({ streak: 0, lastQualifyingDay: null }),
      TODAY,
    );
    expect(d.show).toBe(false);
  });

  it('does not lie about a streak that is already broken', () => {
    // Last qualifying day was two days ago — the streak is gone, so no
    // "keep your streak" nag.
    const d = reminderDecision(
      mirror({ lastActiveDay: '2026-6-27', lastQualifyingDay: '2026-6-27' }),
      TODAY,
    );
    expect(d.show).toBe(false);
  });

  it('round-trips from a freshly built mirror the day after practising', () => {
    const yesterday = day('2026-06-28');
    const built = buildStreakMirror(fullDay(yesterday), 'pack', 'My Pack', yesterday);
    // The SW wakes the next day and reads that record.
    const d = reminderDecision(built, TODAY);
    expect(d.show).toBe(true);
    expect(d.body).toContain('1-day streak');
  });
});
