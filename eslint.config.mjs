// ESLint, flat config. Correctness rules only — no formatting: the code has a
// consistent hand style that a formatter would fight, and typecheck (`tsc -b`)
// already covers types. `npm run lint` runs it; CI runs it beside typecheck.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/dist-single/**', '**/node_modules/**',
      'packages/app-extension/releases/**', '**/.vscode-test/**',
      // the reference implementation is frozen, not maintained code
      'prototype/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // an unused parameter is documentation of a signature (`_edits`); an
      // unused import or local is a mistake
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'all', argsIgnorePattern: '^_', caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_',
      }],
      // `!` is used deliberately where an index is known good (`row.cols[idx]!`)
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // the one file that is Node/CommonJS by contract: vscode-test's config
    files: ['packages/app-extension/.vscode-test.mjs'],
    languageOptions: { globals: { process: 'readonly', __dirname: 'readonly' } },
  },
);
