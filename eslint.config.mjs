// Flat ESLint config (ESLint 9).
//
// Next 16 removed the `next lint` wrapper, so we run ESLint directly.
// `eslint-config-next` ships a flat-config array (core-web-vitals +
// TypeScript rules + the Next plugin); we spread it and add the project's
// ignore globs. Run with `npm run lint`.
import next from 'eslint-config-next';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      // Active pack is gitignored, generated content — not ours to lint.
      'content/pack/**',
      // Generated PWA assets.
      'public/manifest.webmanifest',
      'next-env.d.ts',
    ],
  },
  ...next,
  {
    rules: {
      // Prose rule: bare apostrophes/quotes in JSX text. React escapes
      // these fine and this app is content-heavy — off rather than
      // littering copy with &apos;.
      'react/no-unescaped-entities': 'off',
      // Newer (aggressive) react-hooks rules. They flag legitimate,
      // shipped patterns here — mount guards (`useEffect(() =>
      // setMounted(true), [])`) and latest-value refs assigned during
      // render — that aren't bugs. Surface them as warnings to revisit
      // deliberately instead of blocking CI or forcing risky refactors
      // in a tooling change.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
];

export default config;
