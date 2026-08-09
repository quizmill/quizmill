import type { Config } from 'tailwindcss';

/**
 * Palette shades resolve through CSS variables (declared in globals.css) so
 * dark mode can re-map every colour in one place — components keep using
 * `bg-ink-50` / `text-brand-700` and the variables decide what that means.
 * The `<alpha-value>` slot keeps opacity modifiers (`bg-warn-100/60`) working.
 */
function themed(name: string, shades: number[]): Record<string, string> {
  return Object.fromEntries(
    shades.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]),
  );
}

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Calm palette: muted blues / greens / warm greys. No neon.
        // Semantic in both themes: low shades = backgrounds, high = text.
        ink: themed('ink', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        brand: themed('brand', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        success: themed('success', [50, 100, 200, 500, 600, 700]),
        warn: themed('warn', [50, 100, 200, 500, 600, 700]),
        // Card background: white in light mode, raised panel in dark.
        surface: 'rgb(var(--surface) / <alpha-value>)',
        // Static greys for surfaces that are dark in BOTH themes (drive
        // mode, game canvases, modal scrims, code blocks). Values mirror
        // the light-mode ink ramp and never flip.
        night: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d4d8e0',
          300: '#aab1bf',
          400: '#7c8497',
          500: '#535b70',
          600: '#3b4255',
          700: '#2a2f3d',
          800: '#1c2029',
          900: '#11141a',
        },
      },
      fontSize: {
        // Bigger defaults — he's 9.
        base: ['1.125rem', { lineHeight: '1.6' }], // 18px
        question: ['1.375rem', { lineHeight: '1.55' }], // 22px
        big: ['1.75rem', { lineHeight: '1.4' }],
      },
      borderRadius: {
        lg: '0.75rem',
        xl: '1rem',
      },
    },
  },
  plugins: [],
};

export default config;
