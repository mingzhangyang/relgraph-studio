import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**'] },
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: ['scripts/**/*.mjs', '*.config.mjs', 'tests/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright evaluates some callbacks of this Node script inside the page.
    files: ['scripts/browser-check.mjs', 'scripts/check-export.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
