import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**'] },
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts', 'tests/types/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: [
      'scripts/**/*.mjs',
      '*.config.mjs',
      'tests/production-build.test.mjs',
      'tests/graph-kernel.test.mjs',
      'tests/domain-migration.test.mjs',
      'tests/canvas-renderer.test.mjs',
      'tests/render-pipeline.test.mjs',
      'tests/studio-workspace.test.mjs',
      'tests/package-build.test.mjs',
      'tests/film-fonts.test.mjs',
      'tests/helpers/**/*.mjs',
    ],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright evaluates some callbacks of this Node script inside the page.
    files: ['scripts/browser-check.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
