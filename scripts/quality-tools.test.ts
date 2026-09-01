import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('quality gate runs lint without invoking baseline audit reports', async () => {
  const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  expect(packageJson.scripts.quality).toBe('pnpm lint');
  expect(packageJson.scripts['quality:unused']).toBe('knip --config knip.json');
  expect(packageJson.scripts['quality:duplicates']).toBe('jscpd --config jscpd.json');
  expect(packageJson.scripts['analyze:bundle']).toContain('ANALYZE_BUNDLE=1');
  expect(packageJson.scripts.build).not.toContain('visualizer');
});
