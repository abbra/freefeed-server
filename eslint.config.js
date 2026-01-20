import globals from 'globals';
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import { fixupPluginRules } from '@eslint/compat';
import youDontNeedLodashUnderscore from 'eslint-plugin-you-dont-need-lodash-underscore';
import lodash from 'eslint-plugin-lodash';

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
    plugins: {
      'you-dont-need-lodash-underscore': fixupPluginRules(youDontNeedLodashUnderscore),
      lodash: fixupPluginRules(lodash),
    },
    rules: {
      ...youDontNeedLodashUnderscore.configs['compatible-warn'].rules,
      ...lodash.configs['recommended'].rules,
    },
  },
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
      'lodash/prefer-lodash-method': 'off',
      'lodash/prefer-lodash-typecheck': 'off',
      'lodash/import-scope': ['error', 'member'],
      'lodash/prefer-constant': 'off',
    },
  },

  // Must be the last
  prettierRecommended,
]);
