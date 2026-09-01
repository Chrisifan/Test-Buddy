import { describe, expect, it } from 'vitest';

import { createLocalAcceptanceFixture } from './acceptance-fixtures.js';

describe('local acceptance fixture assets', () => {
  it('creates exactly twenty immutable Case@1 assets in one serial Suite@1', () => {
    const fixture = createLocalAcceptanceFixture('http://127.0.0.1:43123');

    expect(fixture.project.testCases).toHaveLength(20);
    expect(fixture.project.testCases).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 1, steps: [] }),
    ]));
    expect(new Set(fixture.project.testCases.map((testCase) => `${testCase.id}@${testCase.version}`)).size).toBe(20);
    expect(fixture.suite).toMatchObject({
      version: 1,
      environmentId: fixture.environment.id,
      execution: { concurrency: 1, failurePolicy: 'continue', retryLimit: 0 },
    });
    expect(fixture.suite.caseReferences).toEqual(
      fixture.project.testCases.map((testCase) => ({ id: testCase.id, version: 1, dependsOn: [] })),
    );
  });
});
