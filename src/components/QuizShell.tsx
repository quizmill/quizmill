import type { ReactNode } from 'react';

/**
 * Full-viewport app-shell for the active quiz view: a non-scrolling
 * header, a single inner scroll region for the question + feedback, and
 * a non-scrolling action bar pinned at the bottom (outside that region).
 *
 * Why a fixed shell instead of body scroll with a sticky bar: on iOS the
 * first tap after a flick is consumed to STOP the page's momentum scroll
 * rather than fire a click — so a quick "Next" right after scrolling the
 * explanation needed a second tap. Keeping the ONLY scroller an inner
 * element, with the action bar a sibling outside it, means a tap on
 * Check/Next is never inside the scrolling region and lands cleanly even
 * mid-momentum. The inner scroller is `#quiz-scroll` (see scrollToTop).
 *
 * Sits at z-10 — below the app's fixed overlays (SyncIndicator z-40,
 * UpdateNotifier/Celebration z-50), which therefore still show on top.
 */
export function QuizShell({
  header,
  action,
  children,
}: {
  header: ReactNode;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-ink-50">
      <div className="mx-auto flex h-full w-full max-w-screen-sm flex-col sm:max-w-screen-md">
        <div className="shrink-0 px-4 pt-4 sm:pt-6">{header}</div>
        <div
          id="quiz-scroll"
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        >
          <div className="flex flex-col gap-5">{children}</div>
        </div>
        <div className="shrink-0 border-t border-ink-200/70 bg-ink-50/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          {action}
        </div>
      </div>
    </div>
  );
}
