import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Calm palette: muted blues / greens / warm greys. No neon.
        ink: {
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
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#b7d4ff',
          300: '#8bb8ff',
          400: '#5e95f5',
          500: '#3b78e0',
          600: '#2a5fbf',
          700: '#234d99',
          800: '#1d3f7a',
          900: '#15305c',
        },
        success: {
          50: '#eef9f3',
          100: '#dcf5e7',
          500: '#2f9e6e',
          700: '#1d6b4a',
        },
        warn: {
          50: '#fdf5e9',
          100: '#fdecd5',
          500: '#c97b1a',
          700: '#8c5410',
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
