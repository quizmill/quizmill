/**
 * "Add to Home Screen" platform detection — pure so it's unit-testable.
 *
 * Three surfaces matter:
 *  - 'standalone': already running as an installed app — no UI needed.
 *  - 'ios': iPhone/iPad. No beforeinstallprompt there ever; the only
 *    path is Safari's Share → Add to Home Screen, so we show steps.
 *  - 'browser': everything else. Chromium fires `beforeinstallprompt`
 *    when installable (the caller stashes it and can trigger the real
 *    prompt); other browsers get generic menu instructions.
 */
export type InstallSurface = 'standalone' | 'ios' | 'browser';

export function describeInstallSurface(
  userAgent: string,
  standalone: boolean,
  maxTouchPoints = 0,
): InstallSurface {
  if (standalone) return 'standalone';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  // iPadOS 13+ masquerades as macOS Safari; the touch screen gives it away.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'browser';
}

/** The Chromium-only event — not in lib.dom, so declared minimally. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
