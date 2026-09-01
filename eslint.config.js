import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.acceptance/**', '.worktrees/**'],
  },
  {
    files: [
      'src/**/*.{ts,tsx,cts,mts}',
      'electron/**/*.{ts,tsx,cts,mts}',
      'shared/**/*.{ts,tsx,cts,mts}',
      'scripts/**/*.{ts,tsx,cts,mts}',
    ],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/fixtures/**', '**/generated/**'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
    },
  },
];
