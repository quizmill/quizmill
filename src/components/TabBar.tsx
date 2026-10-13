'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Home,
  NotebookPen,
  Settings,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The app's primary navigation: a bottom tab bar on phones, a top nav row
 * from `sm:` up. Mounted once in the root layout, so every tab route gets
 * it for free; it shows ONLY on the tab routes themselves (and Settings'
 * sub-pages), never under a runner or a full-screen mode — a session
 * should have nothing to tap away to.
 *
 * It exists so Home can be nothing but ways to practise (issue #188): the
 * four round nav buttons that used to share Home's header live here as
 * labelled tabs, and the status pieces Home used to carry (level, streak,
 * answered, readiness) moved to the Progress tab.
 *
 * The bar sets `data-tab-bar` on <html> while it is showing so other fixed
 * bottom UI (the update notifier) can lift itself above it on phones.
 */

export interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Routes (beyond `href` itself) that highlight this tab. */
  also?: readonly string[];
}

export const TABS: readonly Tab[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/progress', label: 'Progress', icon: BarChart3 },
  { href: '/stickers', label: 'Stickers', icon: Trophy },
  { href: '/notes', label: 'Notes', icon: NotebookPen },
  { href: '/settings', label: 'Settings', icon: Settings, also: ['/packs'] },
];

/** Strip the trailing slash the static export adds (`/progress/` → `/progress`). */
function normalise(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** The tab a path belongs to, or null when the path is no tab route
 *  (a runner, Drive, Coach, Paper, Games …) and the bar should hide. */
export function activeTab(pathname: string): Tab | null {
  const path = normalise(pathname);
  return (
    TABS.find((t) => t.href === path || t.also?.includes(path)) ?? null
  );
}

export function TabBar() {
  const pathname = usePathname();
  const active = activeTab(pathname ?? '/');
  const visible = active !== null;

  useEffect(() => {
    if (!visible) return;
    document.documentElement.setAttribute('data-tab-bar', '');
    return () => document.documentElement.removeAttribute('data-tab-bar');
  }, [visible]);

  if (!visible) return null;

  return (
    <nav
      aria-label="Main"
      data-testid="tab-bar"
      className={cn(
        // Phone: fixed to the bottom edge, full width, above the page's
        // bottom padding; respects the home-indicator safe area.
        'fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_0_rgb(0_0_0/0.02)] backdrop-blur-sm',
        // Desktop: an ordinary row at the top of the column.
        'sm:static sm:mb-6 sm:border-0 sm:bg-transparent sm:pb-0 sm:shadow-none sm:backdrop-blur-none',
      )}
    >
      <ul className="mx-auto flex w-full max-w-(--breakpoint-sm) items-stretch justify-around sm:max-w-none sm:justify-start sm:gap-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab === active;
          return (
            <li key={tab.href} className="flex-1 sm:flex-none">
              <Link
                href={tab.href === '/' ? '/' : `${tab.href}/`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'tap-feedback flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors',
                  'sm:h-9 sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3 sm:text-sm',
                  isActive
                    ? 'text-brand-600 sm:bg-brand-50 sm:text-brand-700'
                    : 'text-ink-500 hover:text-ink-900 sm:hover:bg-ink-100',
                )}
              >
                <Icon className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
