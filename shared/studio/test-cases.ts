import type { ProjectDraft, TestCaseDraft, VersionedTestAssetReference } from '../studio.js';

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

/** Finds only the Case revision explicitly requested by the caller. */
export const findTestCaseVersion = (
  project: Pick<ProjectDraft, 'testCases'>,
  reference: VersionedTestAssetReference,
): TestCaseDraft | undefined => {
  const matches = findMatchingTestCaseVersions(project, reference);
  return matches.length === 1 ? matches[0] : undefined;
};

/** Returns one highest immutable Case revision for every Case ID. */
export const listLatestTestCaseVersions = (
  project: Pick<ProjectDraft, 'testCases'>,
): TestCaseDraft[] => {
  const latest = new Map<string, TestCaseDraft>();
  const seenVersions = new Set<string>();
  project.testCases.forEach((testCase) => {
    const version = normalizeTestCaseVersion(testCase.version);
    const key = versionedReferenceKey({ id: testCase.id, version });
    if (seenVersions.has(key)) {
      throw new Error(`Duplicate Case version ${key}.`);
    }
    seenVersions.add(key);
    const previous = latest.get(testCase.id);
    if (!previous || normalizeTestCaseVersion(testCase.version) > normalizeTestCaseVersion(previous.version)) {
      latest.set(testCase.id, testCase);
    }
  });
  return [...latest.values()];
};

/** Clones a published Case and assigns its next immutable revision. */
export const createNextTestCaseVersion = (
  project: Pick<ProjectDraft, 'testCases'>,
  source: TestCaseDraft,
  patch: Omit<Partial<TestCaseDraft>, 'id' | 'version'>,
): TestCaseDraft => {
  const sourceReference = { id: source.id, version: normalizeTestCaseVersion(source.version) };
  const canonicalSource = findTestCaseVersion(project, sourceReference);
  if (!canonicalSource) {
    throw new Error(`Case source ${versionedReferenceKey(sourceReference)} must match exactly one published Case version.`);
  }
  const highestVersion = project.testCases
    .filter((candidate) => candidate.id === canonicalSource.id)
    .reduce((highest, candidate) => Math.max(highest, normalizeTestCaseVersion(candidate.version)), 0);
  return {
    ...structuredClone(canonicalSource),
    ...structuredClone(patch),
    id: canonicalSource.id,
    version: highestVersion + 1,
  };
};

/** Preserves historical revisions and appends at most one transformed latest Case per ID. */
export const appendLatestTestCaseTransforms = (
  project: Pick<ProjectDraft, 'testCases'>,
  transform: (testCase: TestCaseDraft) => TestCaseDraft | undefined,
): TestCaseDraft[] => {
  const appended = listLatestTestCaseVersions(project).flatMap((testCase) => {
    const transformed = transform(testCase);
    if (!transformed) {
      return [];
    }
    const { id: _id, version: _version, ...patch } = transformed;
    return [createNextTestCaseVersion(project, testCase, patch)];
  });
  return [...project.testCases, ...appended];
};

/** Returns the immutable revision assigned to the next editor save. */
export const nextTestCaseVersion = (version: number): number => normalizeTestCaseVersion(version) + 1;
