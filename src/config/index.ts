import manifest from '../../content/pack/pack.json';

/**
 * App config — built entirely from the ACTIVE PACK's manifest at
 * `content/pack/pack.json`. That directory is gitignored (packs are
 * private); `scripts/ensure-pack.ts` seeds it from the committed demo
 * pack and `npm run pack:use <dir>` swaps in a real one. Next inlines
 * the JSON at build time, so every pack build is fully static.
 *
 * The manifest is validated by tools/pack/schema.ts before activation;
 * by the time it's here we trust the shape.
 */

export interface CategoryDef {
  /** Stable string key used in storage rows and URLs. */
  key: string;
  /** Full display label. */
  label: string;
  /** Shorter chip-friendly label. Falls back to `label`. */
  shortLabel?: string;
  /** Optional bespoke emoji icon for the category card / mastery sticker.
   *  Falls back to a deterministic emoji by declaration order. */
  icon?: string;
  /** Optional selection weight (e.g. an exam blueprint percentage). */
  weight?: number;
}

/** Optional exam-readiness goal, mirrored from the manifest `exam` block.
 *  Absent → no readiness UI. */
export interface ExamConfig {
  label?: string;
  passPct: number;
  scaled?: boolean;
  questionCount?: number;
  /** Restrict readiness to questions in this level band. */
  scope?: { level: string };
}

/** Optional reward mini-games, mirrored from the manifest `games` block.
 *  Absent → no games anywhere. */
export interface GamesConfig {
  /** Games a learner may play per day (default 1; 0 = unlimited). */
  dailyLimit?: number;
  /** Restrict to a subset of the built-in games (by id). Omit → all. */
  include?: string[];
}

export interface AppConfig {
  /** Pack identifier — also namespaces localStorage. */
  packId: string;
  /** Tab title / OS app name. */
  title: string;
  /** One-line description used for <meta description>. */
  description: string;
  /** Greeting shown beneath the H1 on the home page. */
  homeSubtitle: string;
  /** PWA theme-color (browser chrome / iOS status bar). */
  themeColor: string;
  categories: CategoryDef[];
  /** Exam-readiness goal, when the pack declares one. */
  exam?: ExamConfig;
  /** Reward mini-games, when the pack switches them on. */
  games?: GamesConfig;
}

export const APP_CONFIG: AppConfig = {
  packId: manifest.id,
  title: manifest.title,
  description: manifest.description,
  homeSubtitle: manifest.homeSubtitle,
  themeColor: manifest.themeColor,
  categories: manifest.categories as CategoryDef[],
  exam: (manifest as { exam?: ExamConfig }).exam,
  games: (manifest as { games?: GamesConfig }).games,
};
