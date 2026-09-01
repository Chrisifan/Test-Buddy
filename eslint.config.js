import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.acceptance/**', '.worktrees/**'],
  },
  {
    files: ['**/*.{ts,tsx,cts}'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'func-style': ['warn', 'expression', { allowArrowFunctions: true }],
    },
  },
];
