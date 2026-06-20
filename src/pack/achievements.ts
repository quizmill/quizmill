/**
 * Achievement definitions ("sticker cabinet") for the pack variant.
 *
 * Unlike the engine's private predecessor, packs aren't known at code
 * time — so alongside the static stickers (streaks, volume, daily
 * habit, milestones) the mastery section is GENERATED from the active
 * pack's categories at build time. Mastery ids are `mastery-<key>`,
 * stable as long as the pack's category keys are (which they must be —
 * same rule as question ids).
 *
 * Each achievement has:
 *  - A stable `id` (used as the storage key)
 *  - A short name + description (shown on the cabinet tile)
 *  - An emoji that acts as the sticker visual
 *  - A category (groups tiles into sections in the cabinet)
 *  - A tier (bronze/silver/gold/platinum) — colours the tile border
 *  - For threshold stickers, the `threshold` the engine compares against
 *  - For mastery stickers, the pack `categoryKey` they track
 */
import { APP_CONFIG, type CategoryDef } from '@/config';
import { categoryIcon } from './category-icon';

export type AchievementCategory =
  | 'streak'
  | 'volume'
  | 'daily'
  | 'mastery'
  | 'milestone';
export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** streak/volume/daily: the count the engine compares against. */
  threshold?: number;
  /** mastery: the pack category this sticker tracks. */
  categoryKey?: string;
}

const STATIC_ACHIEVEMENTS: readonly Achievement[] = [
  // ──── In-a-row correct streaks (best across all history) ────
  { id: 'streak-5',  name: 'Hot streak',  description: '5 correct in a row',  emoji: '🔥', category: 'streak', tier: 'bronze',   threshold: 5 },
  { id: 'streak-10', name: 'On fire',     description: '10 correct in a row', emoji: '🎉', category: 'streak', tier: 'silver',   threshold: 10 },
  { id: 'streak-25', name: 'Unstoppable', description: '25 correct in a row', emoji: '⚡', category: 'streak', tier: 'gold',     threshold: 25 },
  { id: 'streak-50', name: 'Legendary',   description: '50 correct in a row', emoji: '🚀', category: 'streak', tier: 'platinum', threshold: 50 },

  // ──── Total questions answered ────
  { id: 'volume-50',   name: 'Getting started', description: 'Answer 50 questions',   emoji: '🌱', category: 'volume', tier: 'bronze',   threshold: 50 },
  { id: 'volume-100',  name: 'Centurion',       description: 'Answer 100 questions',  emoji: '💯', category: 'volume', tier: 'silver',   threshold: 100 },
  { id: 'volume-500',  name: 'Marathon',        description: 'Answer 500 questions',  emoji: '🏃', category: 'volume', tier: 'gold',     threshold: 500 },
  { id: 'volume-1000', name: 'Mastery',         description: 'Answer 1000 questions', emoji: '🏆', category: 'volume', tier: 'platinum', threshold: 1000 },

  // ──── Daily practice (calendar streak) ────
  { id: 'daily-3',  name: 'Three in a row', description: 'Practise 3 days in a row',  emoji: '📅', category: 'daily', tier: 'bronze',   threshold: 3 },
  { id: 'daily-7',  name: 'A whole week',   description: 'Practise 7 days in a row',  emoji: '🗓️', category: 'daily', tier: 'silver',   threshold: 7 },
  { id: 'daily-14', name: 'Fortnight',      description: 'Practise 14 days in a row', emoji: '📆', category: 'daily', tier: 'gold',     threshold: 14 },
  { id: 'daily-30', name: 'Habit unlocked', description: 'Practise 30 days in a row', emoji: '🌟', category: 'daily', tier: 'platinum', threshold: 30 },

  // ──── One-time milestones ────
  { id: 'first-session',   name: 'First steps', description: 'Finish your first session',        emoji: '🎈', category: 'milestone', tier: 'bronze' },
  { id: 'perfect-session', name: 'Flawless',    description: '100% on a full 10-question round', emoji: '✨', category: 'milestone', tier: 'gold'   },
  { id: 'comeback',        name: 'Comeback',    description: 'Finish a review session',          emoji: '💪', category: 'milestone', tier: 'bronze' },
];

/**
 * Build the full achievement list for a pack: static stickers plus one
 * gold mastery sticker per pack category. Exported separately from the
 * materialised ACHIEVEMENTS constant so tests can drive it with
 * synthetic categories.
 *
 * The mastery sticker reuses the category's resolved icon (authored, or
 * a deterministic fallback by order — see `categoryIcon`), so a category
 * card and its sticker always show the same mark.
 */
export function buildAchievements(
  categories: readonly Pick<CategoryDef, 'key' | 'label' | 'shortLabel' | 'icon'>[],
): Achievement[] {
  const mastery: Achievement[] = categories.map((cat, i) => {
    const label = cat.shortLabel ?? cat.label;
    return {
      id: `mastery-${cat.key}`,
      name: `${label} mastery`,
      description: `80% on 30+ ${label} questions`,
      emoji: categoryIcon(cat, i),
      category: 'mastery',
      tier: 'gold',
      categoryKey: cat.key,
    };
  });
  return [...STATIC_ACHIEVEMENTS, ...mastery];
}

export const ACHIEVEMENTS: readonly Achievement[] = buildAchievements(
  APP_CONFIG.categories,
);

export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, Achievement> = new Map(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

export const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  streak: 'Hot streaks',
  volume: 'Questions answered',
  daily: 'Daily practice',
  mastery: 'Category mastery',
  milestone: 'Milestones',
};

/** Stable category order for the cabinet layout. */
export const CATEGORY_ORDER: readonly AchievementCategory[] = [
  'streak',
  'volume',
  'daily',
  'mastery',
  'milestone',
];
