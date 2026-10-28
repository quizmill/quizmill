import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_CONFIG } from '@/config';
import { UpdateNotifier } from '@/components/UpdateNotifier';
import { TabBar } from '@/components/TabBar';
import { SyncBootstrap } from '@/components/SyncBootstrap';
import { PackUpdateCheck } from '@/components/PackUpdateCheck';
import { UpgradeClaimCheck } from '@/components/UpgradeClaimCheck';
import { SyncIndicator } from '@/components/SyncIndicator';
import { ThemeWatcher } from '@/components/ThemeWatcher';
import { RuntimePackBoundary } from '@/components/RuntimePackBoundary';
import { LEGACY_THEME_KEY, THEME_KEY } from '@/lib/theme';
import { LOOK_KEY } from '@/lib/look';
import {
  ACTIVE_PACK_ID_KEY,
  HANDOFF_PACK_KEY,
  insertedPackKey,
} from '@/lib/packKeys';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Runtime pack bootstrap. The seam (src/pack/runtime.ts + source.ts) lets a
// host inject the pack to render via `globalThis.__QUIZMILL_PACK__`. For a
// single engine deployment that serves many packs (e.g. quizmill-cloud's
// practice surface, or the in-app pack library at /packs), there's no host
// module to call setActivePack — so set the global here, BEFORE the engine
// bundle evaluates, from the browser:
//   - a `#pack=<base64-json>` hash (cross-origin handoff), else
//   - the external handoff blob (HANDOFF_PACK_KEY), else
//   - the pack-library pointer (ACTIVE_PACK_ID_KEY → the inserted pack
//     stored under insertedPackKey(id) — see src/lib/packLibrary.ts).
// No stored pack → global stays unset → the build-time pack renders, exactly
// as before.
//
// ORDERING IS LOAD-BEARING — this must be a real inline <script>
// (dangerouslySetInnerHTML), NOT `next/script strategy="beforeInteractive"`.
// next/script serialises "beforeInteractive" code into the `self.__next_s`
// queue and the framework runtime flushes it asynchronously — racing the
// engine chunks' module evaluation. When a chunk wins, source.ts reads
// `__QUIZMILL_PACK__` before it's set and the injected pack is silently
// ignored. A parser-executed inline script always runs before any
// deferred/module bundle (guarded by tests/e2e/runtime-pack-bootstrap).
// insertedPackKey(id) = PACK_KEY_BEFORE_ID + id + PACK_KEY_AFTER_ID — split
// around a placeholder so the inline script rebuilds the exact same key.
const [PACK_KEY_BEFORE_ID, PACK_KEY_AFTER_ID] = insertedPackKey('').split('');

const PACK_BOOTSTRAP = `(function(){try{
var r=null,m=location.hash.match(/[#&]pack=([^&]+)/);
if(m){r=decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))}
else if(window.localStorage){
r=localStorage.getItem(${JSON.stringify(HANDOFF_PACK_KEY)});
if(!r){var i=localStorage.getItem(${JSON.stringify(ACTIVE_PACK_ID_KEY)});
if(i){r=localStorage.getItem(${JSON.stringify(PACK_KEY_BEFORE_ID)}+i+${JSON.stringify(PACK_KEY_AFTER_ID)})}}
}
if(r){window.__QUIZMILL_PACK__=JSON.parse(r)}
}catch(e){}})();`;

// Apply the stored colour-scheme preference before first paint so a dark
// visitor never sees a light flash. Mirrors src/lib/theme.ts: bare-string
// key, absent/anything-else = follow the OS. A real inline script for the
// same ordering reason as the pack bootstrap (a queued script can lose the
// race against first paint and flash light at a dark visitor).
const THEME_BOOTSTRAP = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_KEY)})||localStorage.getItem(${JSON.stringify(LEGACY_THEME_KEY)});
if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)){
document.documentElement.classList.add('dark')}
}catch(e){}})();`;

// Same pre-paint treatment for the visual look: the pack's manifest default
// (APP_CONFIG.look, inlined at build) unless the device pinned a choice.
// Applied before first paint so a Poster pack never flashes classic.
const LOOK_BOOTSTRAP = `(function(){try{
var l=localStorage.getItem(${JSON.stringify(LOOK_KEY)})||${JSON.stringify(APP_CONFIG.look)};
if(l==='poster'){document.documentElement.setAttribute('data-look','poster')}
}catch(e){}})();`;

// PWA assets — generated from the active pack's manifest by
// scripts/pack-assets.ts, so the installed shortcut's title, icon, and
// theme colour always match the pack.
const ICON_PATH = `${BASE_PATH}/icon.svg`;
const APPLE_ICON_PATH = `${BASE_PATH}/apple-touch-icon.png`;
const MANIFEST_PATH = `${BASE_PATH}/manifest.webmanifest`;

export const metadata: Metadata = {
  title: APP_CONFIG.title,
  description: APP_CONFIG.description,
  manifest: MANIFEST_PATH,
  icons: {
    icon: ICON_PATH,
    // apple-touch-icon for the iOS Add-to-Home Screen tile — a PNG, as
    // iOS ignores an SVG here and falls back to a page screenshot.
    apple: APPLE_ICON_PATH,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Lets the bottom tab bar pad itself by env(safe-area-inset-bottom) on
  // phones with a home indicator.
  viewportFit: 'cover',
  themeColor: APP_CONFIG.themeColor,
};

/** The quizmill millstone mark — the runner stone seen from three-quarters
 *  above, its thickness showing, the eye in the middle — as a one-colour
 *  glyph (the full-colour tile is the starter pack's icon.svg), inline so
 *  it inherits no asset pipeline. A solid face with the eye punched out
 *  (even-odd, so the hole shows whatever is behind it): at the footer's
 *  14px anything drawn on the face reads as a grin, a slab reads as a
 *  stone. */
function MillMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path
        d="M 4 27.5 V 38 A 28 19 0 0 0 60 38 V 27.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M 4 27.5 A 28 19 0 1 0 60 27.5 A 28 19 0 1 0 4 27.5 Z M 23 27.5 A 9 6 0 1 0 41 27.5 A 9 6 0 1 0 23 27.5 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the theme bootstrap adds `class="dark"` to
    // <html> before React hydrates; that attribute diff is intentional.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-ink-50 text-ink-800 antialiased">
        {/* Parser-executed bootstraps — see the ordering notes above. First
            in <body> so they run before any deferred engine bundle. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <script dangerouslySetInnerHTML={{ __html: LOOK_BOOTSTRAP }} />
        <script dangerouslySetInnerHTML={{ __html: PACK_BOOTSTRAP }} />
        {/* Bottom padding clears the phone tab bar (h-14) plus the update
            notifier; the safe-area term keeps it clear of a home indicator. */}
        <div className="mx-auto w-full max-w-(--breakpoint-sm) px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:max-w-(--breakpoint-md) sm:pb-24 sm:pt-8">
          {/* Phone navigation: bottom tabs below sm: (desktop keeps the
              header buttons and back links). Pack-independent, so it sits
              outside the hydration boundary. */}
          <TabBar />
          {/* When the bootstrap above swapped a runtime pack in, the page was
              prerendered from a different pack — adopt that markup for the
              hydration pass instead of reporting the mismatch. */}
          <RuntimePackBoundary>{children}</RuntimePackBoundary>
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
        <ThemeWatcher />
        <UpdateNotifier />
        <SyncBootstrap />
        {/* Unlocked packs ask their endpoint for a newer bundle once a day. */}
        <PackUpdateCheck />
        {/* A purchase started from the upgrade card unlocks right here. */}
        <UpgradeClaimCheck />
        <SyncIndicator />
      </body>
    </html>
  );
}
