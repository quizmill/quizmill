import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_CONFIG } from '@/config';
import { UpdateNotifier } from '@/components/UpdateNotifier';
import { SyncBootstrap } from '@/components/SyncBootstrap';

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
        </div>
        <UpdateNotifier />
        <SyncBootstrap />
      </body>
    </html>
  );
}
