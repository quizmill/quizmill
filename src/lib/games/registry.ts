/**
 * Reward mini-game registry. A pack switches games on via its `games`
 * manifest block; the app then unlocks this little arcade once the learner
 * has answered enough questions — playing one is a treat for keeping the
 * practice wheel turning, not an always-on distraction.
 *
 * Pure data, no React — the components in src/pack/games/ render these.
 * The id union here is the engine's source of truth; the pack validator
 * (tools/pack/schema.ts, GAME_IDS) mirrors it so `games.include` can only
 * reference games that actually exist.
 */
export type GameId =
  | 'snake'
  | 'tile-puzzle'
  | 'memory'
  | 'whack'
  | 'pong'
  | 'dodger';

export interface GameDef {
  id: GameId;
  name: string;
  emoji: string;
  /** One-liner shown on the game's card. */
  blurb: string;
}

export const GAMES: readonly GameDef[] = [
  {
    id: 'snake',
    name: 'Snake',
    emoji: '🐍',
    blurb: "Eat the apples. Don't hit the wall.",
  },
  {
    id: 'tile-puzzle',
    name: 'Sliding puzzle',
    emoji: '🧩',
    blurb: 'Slide the tiles into order, 1 to 8.',
  },
  {
    id: 'memory',
    name: 'Memory',
    emoji: '🧠',
    blurb: 'Match the pairs in as few moves as you can.',
  },
  {
    id: 'whack',
    name: 'Whack-a-mole',
    emoji: '🔨',
    blurb: 'Tap the moles. 30 seconds.',
  },
  {
    id: 'pong',
    name: 'Pong',
    emoji: '🏓',
    blurb: 'Beat the red paddle to 5.',
  },
  {
    id: 'dodger',
    name: 'Dodger',
    emoji: '☄️',
    blurb: 'Dodge the falling rocks.',
  },
];

export function getGame(id: GameId): GameDef {
  const g = GAMES.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}

/** Pick a random game — used when offering a quick play. */
export function pickRandomGame(rng: () => number = Math.random): GameId {
  return GAMES[Math.floor(rng() * GAMES.length)].id;
}

/**
 * The games this pack actually offers. `include` (a subset of game ids,
 * from the manifest) narrows the set; omit it for all of them. Unknown
 * ids are ignored — the validator already rejects them at pack time, so
 * this is just defensive.
 */
export function enabledGames(include?: readonly string[]): GameDef[] {
  if (!include || include.length === 0) return [...GAMES];
  const wanted = new Set(include);
  return GAMES.filter((g) => wanted.has(g.id));
}
