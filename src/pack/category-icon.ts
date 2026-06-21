/**
 * Per-category iconography.
 *
 * A category MAY author an `icon` (a single emoji) in the pack manifest;
 * when it doesn't, we fall back to a deterministic emoji chosen by the
 * category's declaration order, so every pack gets visual variety for
 * free — the same auto-by-order scheme as the category tones.
 *
 * The resolved icon drives BOTH the home category card and that
 * category's mastery sticker, so a category and its sticker always show
 * the same mark. Pure (no manifest import) so it stays trivially
 * testable and shareable across the data layer and the sticker cabinet.
 */
export const CATEGORY_FALLBACK_EMOJIS = [
  '📚', '🧮', '🧩', '🔬', '🪐', '🗺️', '⚙️', '🎨',
] as const;

/** Resolve a category's display icon: its authored `icon`, else a
 *  deterministic fallback by index. */
export function categoryIcon(cat: { icon?: string }, index: number): string {
  return (
    cat.icon ??
    CATEGORY_FALLBACK_EMOJIS[index % CATEGORY_FALLBACK_EMOJIS.length]
  );
}
