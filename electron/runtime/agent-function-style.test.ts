import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const agentModules = [
  'electron/runtime/agent-planner.ts',
  'electron/runtime/agent-reporter.ts',
  'electron/runtime/agent-verifier.ts',
];

test('agent runtime helpers use arrow functions outside their classes', async () => {
  const sources = await Promise.all(agentModules.map((modulePath) => readFile(resolve(process.cwd(), modulePath), 'utf8')));

  expect(sources.join('\n')).not.toMatch(/\bfunction\s+[A-Za-z_$]/u);
});
