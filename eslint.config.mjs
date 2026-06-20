// Flat ESLint config (ESLint 9 / Next 16). `next lint` was removed in
// Next 16, so `npm run lint` now drives the ESLint CLI directly against
// this config. `eslint-config-next` v16 ships ready-made flat-config
// arrays — we spread the `core-web-vitals` preset (the same set Next's
// default scaffold extends).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: ['out/**', '.next/**', 'next-env.d.ts', 'public/sw.js', 'content/**'],
  },
  ...nextCoreWebVitals,
  {
    // eslint-plugin-react-hooks v7 (pulled in by eslint-config-next 16)
    // adds React-Compiler-strictness rules that flag patterns this app
    // uses on purpose: the SSR mount guard (`useEffect(() => setX(true), [])`),
    // the sync/queue effects, and the imperative mini-game loops (timers +
    // Math.random outside render). Correctness there is covered by tsc and
    // the unit/E2E suites, so these are off rather than scattering disable
    // comments across every call site.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
    },
  },
];

export default config;
