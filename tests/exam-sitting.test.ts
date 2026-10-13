import { describe, expect, it } from 'vitest';
import { buildSitting, passed, sittingLevel, sittingPlan, EXAM_SITTING } from '@/pack/exam';
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
    // 20 questions in 30 min = 90 s each; 9 available → 13 min 30 s.
    expect(sittingPlan({ questionCount: 20, durationMinutes: 30 }, 9)).toEqual({
      count: 9,
      durationSeconds: 810,
    });
  });

  it('deals the whole band in the full time with no questionCount to pro-rate against', () => {
    expect(sittingPlan({ durationMinutes: 10 }, 7)).toEqual({ count: 7, durationSeconds: 600 });
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
  it('is the Advanced band at the manifest pace', () => {
    // content/pack-demo: exam { questionCount: 20, durationMinutes: 30 },
    // levels basics → advanced, 9 advanced questions.
    expect(EXAM_SITTING).not.toBeNull();
    expect(EXAM_SITTING!.level).toBe('advanced');
    const advanced = packQuestions.filter((x) => x.level === 'advanced').length;
    expect(EXAM_SITTING!.count).toBe(advanced);
    expect(EXAM_SITTING!.durationSeconds).toBe(Math.round((30 * 60 * advanced) / 20));
  });
});

describe('passed', () => {
  it('passes at or above the pass mark', () => {
    expect(passed({ passPct: 70 }, 70)).toBe(true);
    expect(passed({ passPct: 70 }, 69)).toBe(false);
  });
});
