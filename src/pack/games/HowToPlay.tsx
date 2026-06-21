'use client';

interface HowToPlayProps {
  /** 3–5 short bullets. Each one fits on a line on a phone screen. */
  bullets: readonly string[];
}

/**
 * Tiny "How to play" expander shown at the bottom of every mini-game.
 * `<details>` so it's zero-JS, native keyboard accessible, and the
 * expanded state is visually distinct without any animation work.
 */
export function HowToPlay({ bullets }: HowToPlayProps) {
  return (
    <details className="mt-3 rounded-lg border border-ink-200 bg-ink-50/60 text-sm">
      <summary
        data-testid="how-to-play-summary"
        className="tap-feedback cursor-pointer list-none px-3 py-2 font-semibold text-ink-700 [&::-webkit-details-marker]:hidden"
      >
        How to play
      </summary>
      <ul className="ml-5 list-disc px-3 pb-3 pt-1 text-ink-600">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </details>
  );
}
