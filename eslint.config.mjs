import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts', 'types/**/*.ts', 'tests/types/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: ['scripts/**/*.mjs', '*.config.mjs', 'tests/production-build.test.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
