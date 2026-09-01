import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('quality commands remain opt-in and keep normal builds unchanged', async () => {
  const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  expect(packageJson.scripts.quality).toContain('pnpm lint');
  expect(packageJson.scripts['quality:unused']).toContain('knip');
  expect(packageJson.scripts['quality:duplicates']).toContain('jscpd');
  expect(packageJson.scripts['analyze:bundle']).toContain('ANALYZE_BUNDLE=1');
  expect(packageJson.scripts.build).not.toContain('visualizer');
});
