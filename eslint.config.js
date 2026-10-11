// ESLint (flat config): catches leftovers — unused imports and variables, undefined names, loose
// equality. Run with `npm run lint`; `npm test` runs it first.
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'public/**', 'core-build/**', 'native/**', '.emsdk/**', 'node_modules/**', 'patches/**', '**/*.tmp.mjs'],
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // Buffer: base64 fallbacks for modules the unit tests run under Node (guarded by typeof).
      globals: { ...globals.browser, Buffer: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-undef': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Node: tests, scripts, the e2e suite and config files.
    files: ['**/*.test.js', 'tests/**', 'scripts/**', '*.config.js', 'tools/memory-analysis/**'],
    languageOptions: { globals: { ...globals.node } },
  },
];
