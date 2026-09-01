import { expect, test } from 'vitest';
import { createEmptySuiteAsset, resolveSuiteCases } from './suites.js';

test('suite helpers retain the selected environment and block an empty suite', () => {
  const suite = createEmptySuiteAsset({ selectedEnvironmentId: 'env-local' }, 7);
  const resolution = resolveSuiteCases({ environments: [], testCases: [] }, suite);

  expect(suite).toMatchObject({ version: 1, environmentId: 'env-local', caseReferences: [] });
  expect(resolution.issues.map((issue) => issue.kind)).toEqual(['emptySuite', 'missingEnvironment']);
});
