/**
 * Jump the window back to the top. Used when advancing to the next
 * question: the sticky action bar lives at the bottom of the viewport,
 * so after a tap the page is scrolled down and the new question's prompt
 * would otherwise start off-screen. SSR/no-window safe.
 */
export function scrollToTop(): void {
  if (typeof window === 'undefined') return;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}
