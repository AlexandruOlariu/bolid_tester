module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'prettier',
  ],
  settings: { react: { version: 'detect' } },
  env: { node: true, jest: true, es2021: true, browser: true },
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    'android',
    'ios',
    '.expo',
    '*.config.js',
    '.eslintrc.cjs',
  ],
  rules: {
    // TypeScript already checks these; keep the net practical for an app-wide sweep.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // `no-undef` is redundant (and noisy) under TypeScript — the compiler resolves every identifier,
    // and this rule false-positives on RN/DOM globals (fetch, AbortController, requestAnimationFrame…).
    'no-undef': 'off',

    // Modern JSX runtime (react-jsx) — no `import React` needed for JSX.
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',
    // TypeScript replaces prop-types; RN text conventions make unescaped entities pure noise; inline
    // render callbacks (tabBarIcon, icon, headerTitle) trip display-name as false positives.
    'react/prop-types': 'off',
    'react/no-unescaped-entities': 'off',
    'react/display-name': 'off',

    // The rules that actually matter for hooks correctness: illegal hook placement is an error;
    // stale/missing deps are a warning (fix real bugs, silence documented false positives inline).
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
