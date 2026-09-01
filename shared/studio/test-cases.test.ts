import { expect, test } from 'vitest';
import {
  createNextTestCaseVersion,
  findTestCaseVersion,
  listLatestTestCaseVersions,
  nextTestCaseVersion,
} from './test-cases.js';
import { createEmptyTestCase } from '../studio.js';

test('case version helpers preserve historical revisions and normalize legacy versions', () => {
  const caseV1 = { ...createEmptyTestCase(1, 'group-main', 'env-local'), id: 'case-checkout', version: 1 };
  const caseV2 = { ...caseV1, version: 2, name: 'Checkout v2' };
  const project = { testCases: [caseV1, caseV2] };

  expect(nextTestCaseVersion(Number.NaN)).toBe(2);
  expect(findTestCaseVersion(project, { id: caseV1.id, version: 1 })).toBe(caseV1);
  expect(listLatestTestCaseVersions(project)).toEqual([caseV2]);
  expect(createNextTestCaseVersion(project, caseV2, { name: 'Checkout v3' })).toMatchObject({
    id: caseV2.id,
    version: 3,
    name: 'Checkout v3',
  });
});
