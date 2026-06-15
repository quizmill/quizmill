/**
 * Friend-code helpers — the human-shareable "add my friend code" handle.
 *
 * The AUTHORITATIVE code is minted server-side (see `gen_friend_code()` in
 * the 0002 migration) so it's globally unique and never enumerable from the
 * client. This module only deals with what the browser needs: cleaning up
 * and sanity-checking what a user *types in* when adding someone.
 *
 * Codes are word-based on purpose — "BRAVE-OTTER-42" is something a child
 * can read aloud and re-type, which a random "7F3K9Q" is not.
 */

/** Canonical shape: TWO-WORDS-NN, uppercase. */
const FRIEND_CODE_RE = /^[A-Z]+-[A-Z]+-\d{2}$/;

/**
 * Normalise typed input toward the canonical form: uppercase, trim, and
 * turn any run of spaces/underscores/dashes into a single dash. So
 * "brave otter 42", "Brave_Otter_42" and "BRAVE--OTTER--42" all land on
 * "BRAVE-OTTER-42". Does not validate — see {@link isValidFriendCode}.
 */
export function normalizeFriendCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when the (normalised) code matches the canonical TWO-WORDS-NN shape. */
export function isValidFriendCode(raw: string): boolean {
  return FRIEND_CODE_RE.test(normalizeFriendCode(raw));
}

/** Share codes (group leaderboards) are 6 unambiguous chars: no 0/O/1/I. */
const SHARE_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export function normalizeShareCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function isValidShareCode(raw: string): boolean {
  return SHARE_CODE_RE.test(normalizeShareCode(raw));
}
