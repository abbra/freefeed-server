import globals from 'globals';
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig([
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    settings: {
      'import-x/resolver-next': [
        createNodeResolver({ extensions: ['.js', '.ts', '.jsx', '.mjs'] }),
      ],
    },
  },
  js.configs.recommended,
  ts.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    rules: {
      'import-x/no-extraneous-dependencies': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/consistent-type-specifier-style': ['error', 'prefer-inline'],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
        },
      ],
    },
  },

  // Must be the last
  prettierRecommended,
]);
