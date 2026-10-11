// Flat ESLint config (ESLint 9).
//
// Next 16 removed the `next lint` wrapper, so we run ESLint directly.
// `eslint-config-next` ships a flat-config array (core-web-vitals +
// TypeScript parser + the Next plugin) — but no typescript-eslint RULES, so
// those come from typescript-eslint's `strict` set below. Run with
// `npm run lint`; a warning is tolerated, an error fails CI.
import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

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
  // typescript-eslint's strict set (recommended + the stricter opinions),
  // syntax-only: the type-checked variants need a full program per lint
  // run and report ~1000 findings here today — a separate job.
  ...tseslint.configs.strict.map((c) => ({ ...c, files: ['**/*.ts', '**/*.tsx', '**/*.mts'] })),
  {
    rules: {
      // Prose rule: bare apostrophes/quotes in JSX text. React escapes
      // these fine and this app is content-heavy — off rather than
      // littering copy with &apos;.
      'react/no-unescaped-entities': 'off',
      // The React Compiler's rules. Every finding they had here is fixed
      // (the browser-only "read it after mount" values go through
      // `useClientState`/`useMounted`, latest-value refs through
      // `useLatest`), so a new one is a real question to answer, not
      // noise — error for the two that are clean, warn for the one whose
      // last findings sit in files another branch is rewriting.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    rules: {
      // `{ dropped, ...rest }` is how a key is left out of a copied record;
      // the sibling is the point, not an unused variable.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // `delete copy[key]` on a copied record (state keyed by position, a
      // generic pref key) reads better than a Map or a rest-destructure
      // with a throwaway name.
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    // Tests assert presence with `!` after a lookup — a miss throws, which
    // is the failure wanted. Production code narrows instead.
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

export default config;
