import { describe, expect, it } from 'vitest';
import {
  CATEGORY_FALLBACK_EMOJIS,
  categoryIcon,
} from '@/pack/category-icon';
import { buildAchievements } from '@/pack/achievements';

describe('categoryIcon', () => {
  it('prefers the authored icon when present', () => {
    expect(categoryIcon({ icon: '🚀' }, 0)).toBe('🚀');
    expect(categoryIcon({ icon: '🚀' }, 3)).toBe('🚀');
  });

  it('falls back to a deterministic emoji by index', () => {
    expect(categoryIcon({}, 0)).toBe(CATEGORY_FALLBACK_EMOJIS[0]);
    expect(categoryIcon({}, 1)).toBe(CATEGORY_FALLBACK_EMOJIS[1]);
  });

  it('wraps the fallback array for packs with many categories', () => {
    const n = CATEGORY_FALLBACK_EMOJIS.length;
    expect(categoryIcon({}, n)).toBe(CATEGORY_FALLBACK_EMOJIS[0]);
    expect(categoryIcon({}, n + 2)).toBe(CATEGORY_FALLBACK_EMOJIS[2]);
  });
});

describe('buildAchievements — mastery sticker icons', () => {
  it('reuses the category icon so card and sticker match', () => {
    const defs = buildAchievements([
      { key: 'alpha', label: 'Alpha', icon: '🚀' },
      { key: 'beta', label: 'Beta' }, // no icon → fallback
    ]);
    const alpha = defs.find((a) => a.id === 'mastery-alpha')!;
    const beta = defs.find((a) => a.id === 'mastery-beta')!;
    expect(alpha.emoji).toBe('🚀');
    expect(beta.emoji).toBe(CATEGORY_FALLBACK_EMOJIS[1]);
  });
});
