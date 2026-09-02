import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('excludes project-local worktrees from root test discovery', () => {
  const config = readFileSync(resolve(process.cwd(), 'vitest.config.ts'), 'utf8');

  expect(config).toContain("'.worktrees/**'");
});
