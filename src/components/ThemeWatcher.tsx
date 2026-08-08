'use client';

import { useTheme } from '@/lib/useTheme';

/**
 * Invisible layout resident that keeps the theme live on every page:
 * follows OS scheme changes while in 'system' mode and picks up edits
 * from other tabs. First paint is handled by the inline bootstrap
 * script in layout.tsx — this only maintains it afterwards.
 */
export function ThemeWatcher() {
  useTheme();
  return null;
}
