import type {
  ProjectDraft,
  ResolvedSuiteCase,
  SuiteAsset,
  SuiteCaseResolution,
  SuiteResolutionIssue,
  TestCaseDraft,
  VersionedTestAssetReference,
} from '../studio.js';

const normalizeTestCaseVersion = (value: unknown): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1
);

const versionedReferenceKey = (reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string => (
  `${reference.id}@${reference.version}`
);

const findMatchingTestCaseVersions = (
  project: Pick<ProjectDraft, 'testCases'>,
  reference: VersionedTestAssetReference,
): TestCaseDraft[] => project.testCases.filter((testCase) => (
  testCase.id === reference.id && normalizeTestCaseVersion(testCase.version) === reference.version
));

export const createEmptySuiteAsset = (
  project: Pick<ProjectDraft, 'selectedEnvironmentId'>,
  seed: number,
): SuiteAsset => {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `suite-${Date.now()}-${seed}`,
    version: 1,
    name: `新的 Suite ${seed}`,
    description: '',
    tags: [],
    environmentId: project.selectedEnvironmentId,
    caseReferences: [],
    execution: { concurrency: 1, failurePolicy: 'continue', retryLimit: 0 },
    createdAt: now,
    updatedAt: now,
  };
};

export const findSuiteAsset = (
  project: Pick<ProjectDraft, 'suites'>,
  reference: VersionedTestAssetReference,
): SuiteAsset | undefined => project.suites.find((suite) => suite.id === reference.id && suite.version === reference.version);

export const resolveSuiteCases = (
  project: Pick<ProjectDraft, 'environments' | 'testCases'>,
  suite: SuiteAsset,
): SuiteCaseResolution => {
  const environment = project.environments.find((candidate) => candidate.id === suite.environmentId);
  const issues: SuiteResolutionIssue[] = [];
  if (!suite.caseReferences.length) {
    issues.push({ kind: 'emptySuite', message: `Suite ${suite.name}@${suite.version} 未选择任何用例。` });
  }
  if (!environment) {
    issues.push({ kind: 'missingEnvironment', message: `Suite ${suite.name}@${suite.version} 引用了不存在的环境。` });
  }

  const referenceKeys = new Set<string>();
  const duplicateReference = suite.caseReferences.find((reference) => {
    const key = versionedReferenceKey(reference);
    if (referenceKeys.has(key)) return true;
    referenceKeys.add(key);
    return false;
  });
  if (duplicateReference) {
    issues.push({
      kind: 'duplicateCaseReference',
      reference: duplicateReference,
      message: `Suite ${suite.name}@${suite.version} 重复引用了用例 ${duplicateReference.id}@${duplicateReference.version}。`,
    });
    return { ...(environment ? { environment } : {}), orderedCases: [], issues };
  }

  const referencesByKey = new Map(suite.caseReferences.map((reference) => [versionedReferenceKey(reference), reference]));
  const resolvedByKey = new Map<string, ResolvedSuiteCase>();
  suite.caseReferences.forEach((reference) => {
    const matchingCases = findMatchingTestCaseVersions(project, reference);
    if (matchingCases.length !== 1) {
      issues.push({
        kind: matchingCases.length ? 'duplicateCaseVersion' : 'missingCase',
        reference,
        message: matchingCases.length
          ? `Suite 引用的用例 ${reference.id}@${reference.version} 存在重复版本。`
          : `Suite 未找到用例 ${reference.id}@${reference.version}。`,
      });
      return;
    }
    resolvedByKey.set(versionedReferenceKey(reference), { reference, testCase: matchingCases[0]! });
  });

  suite.caseReferences.forEach((reference) => {
    reference.dependsOn.forEach((dependency) => {
      if (!referencesByKey.has(versionedReferenceKey(dependency))) {
        issues.push({
          kind: 'missingDependency',
          reference,
          message: `Suite 用例 ${reference.id}@${reference.version} 的前置依赖不存在。`,
        });
      }
    });
  });
  if (issues.length) return { ...(environment ? { environment } : {}), orderedCases: [], issues };

  const remainingDependencies = new Map(
    suite.caseReferences.map((reference) => [
      versionedReferenceKey(reference),
      new Set(reference.dependsOn.map(versionedReferenceKey)),
    ]),
  );
  const orderedCases: ResolvedSuiteCase[] = [];
  const complete = new Set<string>();
  while (orderedCases.length < suite.caseReferences.length) {
    const nextReference = suite.caseReferences.find((reference) => {
      const key = versionedReferenceKey(reference);
      return !complete.has(key) && (remainingDependencies.get(key)?.size ?? 0) === 0;
    });
    if (!nextReference) {
      issues.push({ kind: 'cyclicDependency', message: `Suite ${suite.name}@${suite.version} 存在循环依赖，当前不会执行。` });
      return { ...(environment ? { environment } : {}), orderedCases: [], issues };
    }
    const nextKey = versionedReferenceKey(nextReference);
    const resolved = resolvedByKey.get(nextKey);
    if (!resolved) {
      issues.push({
        kind: 'missingCase',
        reference: nextReference,
        message: `Suite 未找到用例 ${nextReference.id}@${nextReference.version}。`,
      });
      return { ...(environment ? { environment } : {}), orderedCases: [], issues };
    }
    complete.add(nextKey);
    orderedCases.push(resolved);
    remainingDependencies.forEach((dependencies) => dependencies.delete(nextKey));
  }
  return { ...(environment ? { environment } : {}), orderedCases, issues };
};

/** @deprecated Use resolveSuiteCases; this compatibility wrapper has identical exact-version behavior. */
export const resolveSuiteTestCases = (
  project: Pick<ProjectDraft, 'environments' | 'testCases'>,
  suite: SuiteAsset,
): SuiteCaseResolution => resolveSuiteCases(project, suite);
