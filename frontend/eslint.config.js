import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // XSS hygiene. The CSP hashes every inlined script and Trusted Types is
      // enabled at runtime, but those controls are only as good as the source:
      // a single innerHTML would turn them back off. Fail the build instead.
      'no-restricted-globals': [
        'error',
        { name: 'eval', message: 'eval() defeats the CSP. Use a lookup table instead.' },
        { name: 'Function', message: 'new Function() is the same as eval.' }
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'any',
          property: 'innerHTML',
          message: 'Use React children/text content; innerHTML is an XSS sink.'
        },
        {
          object: 'any',
          property: 'outerHTML',
          message: 'Use React children/text content; outerHTML is an XSS sink.'
        },
        {
          object: 'any',
          property: 'insertAdjacentHTML',
          message: 'Use React children/text content; insertAdjacentHTML is an XSS sink.'
        },
        {
          object: 'any',
          property: 'srcdoc',
          message: 'Use an iframe with a sandbox; srcdoc bypasses the document CSP.'
        }
      ],
      'no-new-func': 'error'
    }
  },
  {
    // Test files are allowed to reach for these helpers.
    files: ['**/*.test.{ts,tsx}', 'scripts/**/*.mjs'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-new-func': 'off'
    }
  }
);
