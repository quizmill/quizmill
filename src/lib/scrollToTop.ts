/**
 * Jump the active quiz view back to the top when advancing to the next
 * question. The quiz uses an app-shell whose only scroller is the inner
 * `#quiz-scroll` element (see QuizShell), so reset that; fall back to the
 * window for any non-shell caller. SSR/no-window safe.
 */
export function scrollToTop(): void {
  if (typeof window === 'undefined') return;
  const inner = document.getElementById('quiz-scroll');
  if (inner) {
    inner.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return;
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}
