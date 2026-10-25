import { describe, expect, it } from 'vitest';
import {
  buildSitting,
  passed,
  sittingLevel,
  sittingPlan,
  withheldSitting,
  EXAM_SITTING,
  EXAM_SITTING_MIN_FRACTION,
  EXAM_WITHHELD,
} from '@/pack/exam';
import { packQuestions, type PackQuestion } from '@/pack/data';

function q(id: string, level?: string): PackQuestion {
  return {
    id,
    categoryKey: 'planets',
    ...(level ? { level } : {}),
    difficulty: 3,
    prompt: `Prompt ${id}`,
    options: [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
    ],
    correctKey: 'A',
    explanation: 'Because.',
    source: 'original',
    reviewStatus: 'approved',
  };
}

const BANK = [q('e1', 'easy'), q('e2', 'easy'), q('h1', 'hard'), q('h2', 'hard'), q('h3', 'hard')];

describe('sittingLevel', () => {
  it('prefers the declared exam scope level', () => {
    expect(sittingLevel({ scope: { level: 'easy' } }, ['easy', 'hard'])).toBe('easy');
  });

  it('falls back to the last declared level — the top of the ladder', () => {
    expect(sittingLevel({}, ['easy', 'hard', 'veryhard'])).toBe('veryhard');
  });

  it('is the whole bank for a pack with no levels', () => {
    expect(sittingLevel({}, [])).toBeNull();
  });
});

describe('sittingPlan', () => {
  it('is nothing without a duration', () => {
    expect(sittingPlan({ questionCount: 75 }, 500)).toBeNull();
  });

  it('deals the real exam size in the real exam time when the band is big enough', () => {
    expect(sittingPlan({ questionCount: 75, durationMinutes: 180 }, 460)).toEqual({
      count: 75,
      durationSeconds: 180 * 60,
    });
  });

  it('pro-rates the time when the band is smaller than the real exam', () => {
    // 20 questions in 30 min = 90 s each; 12 available → 18 min.
    expect(sittingPlan({ questionCount: 20, durationMinutes: 30 }, 12)).toEqual({
      count: 12,
      durationSeconds: 1080,
    });
  });

  it('deals the whole band in the full time with no questionCount to pro-rate against', () => {
    expect(sittingPlan({ durationMinutes: 10 }, 7)).toEqual({ count: 7, durationSeconds: 600 });
    expect(sittingPlan({ durationMinutes: 10 }, 1)).toEqual({ count: 1, durationSeconds: 600 });
  });

  describe('the floor: a band under half the real exam is no sitting', () => {
    const exam = { questionCount: 75, durationMinutes: 180 };

    it('is half the declared questionCount', () => {
      expect(EXAM_SITTING_MIN_FRACTION).toBe(0.5);
    });

    it('withholds the sitting just below the floor', () => {
      expect(sittingPlan(exam, 37)).toBeNull();
      expect(sittingPlan(exam, 7)).toBeNull();
    });

    it('deals exactly at the floor', () => {
      expect(sittingPlan(exam, 38)).toEqual({ count: 38, durationSeconds: 5472 });
      expect(sittingPlan({ questionCount: 20, durationMinutes: 30 }, 10)).toEqual({
        count: 10,
        durationSeconds: 900,
      });
    });

    it('keeps pro-rating above the floor — a 60-of-75 band is still a mock', () => {
      expect(sittingPlan(exam, 60)).toEqual({ count: 60, durationSeconds: 144 * 60 });
    });
  });
});

describe('withheldSitting', () => {
  // 3 hard questions against a declared 10-question, 20-minute exam.
  const exam = { passPct: 70, questionCount: 10, durationMinutes: 20 };

  it('is the full exam as declared when the floor withholds the sitting', () => {
    expect(buildSitting(exam, ['easy', 'hard'], BANK)).toBeNull();
    expect(withheldSitting(exam, ['easy', 'hard'], BANK)).toEqual({
      count: 10,
      durationSeconds: 1200,
    });
  });

  it('is null when there is a sitting to take', () => {
    const ok = { passPct: 70, questionCount: 6, durationMinutes: 12 };
    expect(buildSitting(ok, ['easy', 'hard'], BANK)).not.toBeNull();
    expect(withheldSitting(ok, ['easy', 'hard'], BANK)).toBeNull();
  });

  it('is null when no floor applies: no exam, no duration, or no questionCount', () => {
    expect(withheldSitting(undefined, ['easy', 'hard'], BANK)).toBeNull();
    expect(withheldSitting({ passPct: 70, questionCount: 10 }, ['easy', 'hard'], BANK)).toBeNull();
    expect(withheldSitting({ passPct: 70, durationMinutes: 20 }, ['easy', 'hard'], BANK)).toBeNull();
  });

  it('is null for the demo pack, whose sitting is the whole declared exam', () => {
    expect(EXAM_WITHHELD).toBeNull();
  });
});

describe('buildSitting', () => {
  it('draws from the hardest level by default', () => {
    const s = buildSitting({ passPct: 70, questionCount: 2, durationMinutes: 4 }, ['easy', 'hard'], BANK);
    expect(s).not.toBeNull();
    expect(s!.level).toBe('hard');
    expect(s!.bank.map((x) => x.id)).toEqual(['h1', 'h2', 'h3']);
    expect(s!.count).toBe(2);
    expect(s!.durationSeconds).toBe(240);
  });

  it('honours an explicit scope level', () => {
    const s = buildSitting(
      { passPct: 70, durationMinutes: 4, scope: { level: 'easy' } },
      ['easy', 'hard'],
      BANK,
    );
    expect(s!.bank.map((x) => x.id)).toEqual(['e1', 'e2']);
  });

  it('is null without durationMinutes, without an exam block, or with an empty band', () => {
    expect(buildSitting({ passPct: 70 }, ['easy', 'hard'], BANK)).toBeNull();
    expect(buildSitting(undefined, [], BANK)).toBeNull();
    expect(
      buildSitting({ passPct: 70, durationMinutes: 4 }, ['easy', 'hard', 'expert'], BANK),
    ).toBeNull();
  });

  it('uses the whole bank for a pack without levels', () => {
    const s = buildSitting({ passPct: 70, durationMinutes: 4 }, [], BANK);
    expect(s!.level).toBeNull();
    expect(s!.bank).toHaveLength(5);
  });
});

describe('the demo pack sitting', () => {
  it('is the whole Advanced band, exactly the exam the manifest declares', () => {
    // content/pack-demo: exam { questionCount: 9, durationMinutes: 15 },
    // levels basics → advanced, 9 advanced questions. The showcase must
    // not pro-rate (#192: a "9 Qs · 13:30" tile reads like a bug).
    expect(EXAM_SITTING).not.toBeNull();
    expect(EXAM_SITTING!.level).toBe('advanced');
    const advanced = packQuestions.filter((x) => x.level === 'advanced').length;
    expect(EXAM_SITTING!.count).toBe(advanced);
    expect(EXAM_SITTING!.count).toBe(9);
    expect(EXAM_SITTING!.durationSeconds).toBe(15 * 60);
  });
});

describe('passed', () => {
  it('passes at or above the pass mark', () => {
    expect(passed({ passPct: 70 }, { correct: 7, total: 10 })).toBe(true);
    expect(passed({ passPct: 70 }, { correct: 69, total: 100 })).toBe(false);
  });

  it('compares the exact fraction, not the rounded percentage', () => {
    // 4/6 = 66.67% rounds to 67 on screen but is below a 67% mark.
    expect(passed({ passPct: 67 }, { correct: 4, total: 6 })).toBe(false);
    expect(passed({ passPct: 66 }, { correct: 4, total: 6 })).toBe(true);
  });

  it('never passes an empty sitting', () => {
    expect(passed({ passPct: 0 }, { correct: 0, total: 0 })).toBe(false);
  });
});
