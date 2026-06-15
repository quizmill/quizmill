import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_CONFIG } from '@/config';
import { UpdateNotifier } from '@/components/UpdateNotifier';
import { SyncBootstrap } from '@/components/SyncBootstrap';
import { SocialBootstrap } from '@/components/SocialBootstrap';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// PWA assets — generated from the active pack's manifest by
// scripts/pack-assets.ts, so the installed shortcut's title, icon, and
// theme colour always match the pack.
const ICON_PATH = `${BASE_PATH}/icon.svg`;
const MANIFEST_PATH = `${BASE_PATH}/manifest.webmanifest`;

export const metadata: Metadata = {
  title: APP_CONFIG.title,
  description: APP_CONFIG.description,
  manifest: MANIFEST_PATH,
  icons: {
    icon: ICON_PATH,
    // apple-touch-icon for the iOS Add-to-Home Screen tile.
    apple: ICON_PATH,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: APP_CONFIG.themeColor,
};

/** The quizmill mill-wheel mark (eight paddles, one golden — the turn
 *  of the wheel), inline so it inherits no asset pipeline. */
function MillMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round">
        <path stroke="#b45309" d="M 25.79 8.82 A 24 24 0 0 1 38.21 8.82" />
        <path d="M 44.00 11.22 A 24 24 0 0 1 52.78 20.00" />
        <path d="M 55.18 25.79 A 24 24 0 0 1 55.18 38.21" />
        <path d="M 52.78 44.00 A 24 24 0 0 1 44.00 52.78" />
        <path d="M 38.21 55.18 A 24 24 0 0 1 25.79 55.18" />
        <path d="M 20.00 52.78 A 24 24 0 0 1 11.22 44.00" />
        <path d="M 8.82 38.21 A 24 24 0 0 1 8.82 25.79" />
        <path d="M 11.22 20.00 A 24 24 0 0 1 20.00 11.22" />
      </g>
      <circle cx="32" cy="32" r="5" fill="currentColor" />
    </svg>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ink-50 text-ink-800 antialiased">
        <div className="mx-auto w-full max-w-screen-sm px-4 pb-24 pt-4 sm:max-w-screen-md sm:pt-8">
          {children}
          {/* Every pack app declares its engine — packs differ, the
              mill is shared. */}
          <footer className="mt-10 text-center text-xs text-ink-400">
            <a
              href="https://quizmill.dev"
              target="_blank"
              rel="noopener"
              className="tap-feedback inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-ink-100 hover:text-ink-600"
            >
              <MillMark className="h-3.5 w-3.5" />
              <span>
                Built with <span className="font-semibold">quizmill</span> —
                the mill that grinds questions into knowledge
              </span>
            </a>
          </footer>
        </div>
        <UpdateNotifier />
        <SyncBootstrap />
        <SocialBootstrap />
      </body>
    </html>
  );
}
