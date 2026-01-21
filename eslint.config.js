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
      'import-x/no-duplicates': 'error',
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
      'consistent-return': 'error',
      curly: 'error',
      'func-name-matching': 'error',
      'max-statements-per-line': ['error', { max: 1 }],
      'no-await-in-loop': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-native-reassign': 'error',
      'no-nested-ternary': 'error',
      'no-restricted-properties': [
        'warn',
        {
          object: '_',
          property: 'extend',
          message: 'consider using [...arr] or { ...obj } instead',
        },
      ],
      'no-shadow': ['error', { allow: ['err', 'res'] }],
      'no-template-curly-in-string': 'error',
      'no-throw-literal': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-computed-key': 'error',
      'no-var': 'error',
      'no-warning-comments': 'warn',
      'object-shorthand': ['error', 'properties'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'block' },
        { blankLine: 'always', prev: '*', next: 'for' },
        { blankLine: 'always', prev: '*', next: 'if' },
        { blankLine: 'always', prev: '*', next: 'switch' },
        { blankLine: 'always', prev: '*', next: 'try' },
        { blankLine: 'always', prev: '*', next: 'while' },
        { blankLine: 'always', prev: 'block', next: '*' },
        { blankLine: 'always', prev: 'for', next: '*' },
        { blankLine: 'always', prev: 'if', next: '*' },
        { blankLine: 'always', prev: 'switch', next: '*' },
        { blankLine: 'always', prev: 'try', next: '*' },
        { blankLine: 'always', prev: 'while', next: '*' },
      ],
      'prefer-const': 'error',
      'prefer-destructuring': 'error',
      'prefer-numeric-literals': 'warn',
      'prefer-object-spread': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'require-atomic-updates': 'off',
      'require-await': 'error',
      'spaced-comment': ['error', 'always', { exceptions: ['/'] }],
      strict: ['error', 'never'],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/parameter-properties': 'error',
      'you-dont-need-lodash-underscore/find': 'error',
      'you-dont-need-lodash-underscore/find-index': 'error',
      'you-dont-need-lodash-underscore/includes': 'error',
      'lodash/prefer-lodash-method': 'off',
      'lodash/prefer-lodash-typecheck': 'off',
      'lodash/import-scope': ['error', 'member'],
      'lodash/prefer-constant': 'off',
    },
  },

  // Must be the last
  prettierRecommended,
]);
