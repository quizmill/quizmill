import { activeManifest as manifest } from '@/pack/source';
import type {
  PackCategory,
  PackExam,
  PackGames,
  PackProgression,
  PackUpgrade,
} from '@/pack/data';

/**
 * App config — built entirely from the ACTIVE PACK's manifest. The default
 * source is the build-time pack at `content/pack/pack.json` (gitignored;
 * `scripts/ensure-pack.ts` seeds it from the committed demo pack and
 * `npm run pack:use <dir>` swaps in a real one), inlined by Next so every
 * pack build is fully static. A host may inject a pack at runtime instead —
 * see `src/pack/runtime.ts`. Either way the manifest reaches us via
 * `src/pack/source.ts`.
 *
 * The manifest is validated by tools/pack/schema.ts before activation;
 * by the time it's here we trust the shape. The optional blocks are the
 * pack types themselves (`src/pack/data.ts`), passed through untouched.
 */

/** A manifest category: stable `key` (storage rows, URLs), `label`,
 *  optional chip-friendly `shortLabel`, emoji `icon` and blueprint `weight`. */
export type CategoryDef = PackCategory;

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
  /** Pack-declared default look ('poster' = the campaign style). */
  look: 'classic' | 'poster';
  categories: CategoryDef[];
  /** Exam-readiness goal, when the pack declares one. Absent → no readiness UI. */
  exam?: PackExam;
  /** Reward mini-games, when the pack switches them on. Absent → no games anywhere. */
  games?: PackGames;
  /** XP/levels progression, when the pack opts in. Presence enables. */
  progression?: PackProgression;
  /** Upgrade pitch card, when the pack declares one (the card appends
   *  `?ref=<packId>-<placement>` to its url). Absent → no card anywhere. */
  upgrade?: PackUpgrade;
}

export const APP_CONFIG: AppConfig = {
  packId: manifest.id,
  title: manifest.title,
  description: manifest.description,
  homeSubtitle: manifest.homeSubtitle,
  themeColor: manifest.themeColor,
  look: manifest.look === 'poster' ? 'poster' : 'classic',
  categories: manifest.categories,
  exam: manifest.exam,
  games: manifest.games,
  progression: manifest.progression,
  upgrade: manifest.upgrade,
};

/**
 * Engine+pack build stamp, inlined at build time (a pack repo's deploy
 * sets NEXT_PUBLIC_APP_BUILD to its own commit — see deploy-pack.yml).
 * Null in dev, so locally-written rows simply carry no appBuild.
 */
export const APP_BUILD: string | null = process.env.NEXT_PUBLIC_APP_BUILD ?? null;
