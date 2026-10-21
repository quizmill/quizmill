/**
 * The starter pack — the pack the HOME APP (app.quizmill.dev, the one
 * learners install and then fill from the shelf) is built from. It lives
 * at `content/pack-start/`: titled after the app rather than a subject,
 * with a few questions about using quizmill itself so Practice is never
 * empty. Home recognises it by id and puts the ways a pack gets in
 * (insert / registry / licence key) above the practice loop; once any
 * other pack is active — inserted, unlocked, handed off — nothing on
 * Home changes. The demo pack (`content/pack-demo/`) is NOT the starter:
 * it stays the schema-v2 showcase for tests, E2E and the website.
 */

/** `id` of `content/pack-start/pack.json` — the only thing Home gates on. */
export const STARTER_PACK_ID = 'quizmill-start';

/** Whether the pack with this id is the home app's starter pack. */
export function isStarterPack(packId: string): boolean {
  return packId === STARTER_PACK_ID;
}
