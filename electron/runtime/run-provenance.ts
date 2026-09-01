import { createHash } from 'node:crypto';

import type {
  BrowserEngine,
  FixtureAsset,
  HistoricalRerunMissingReference,
  ProjectDraft,
  ProjectEnvironment,
  ReusableFlowAsset,
  RunProvenance,
  RunReason,
  SuiteAsset,
  SuiteRunProvenance,
  TestCaseDraft,
  VersionedTestAssetReference,
} from '../../shared/studio.js';
import { findTestCaseVersion } from '../../shared/studio.js';
import { ProjectRepositoryError, type ProjectRepository, type ProjectSnapshot } from '../projectRepository.js';

/** Compact, main-owned runtime inputs used to freeze one Case run. */
export interface RunProvenanceRuntimeMetadata {
  browserProfile: {
    engine: BrowserEngine;
    headless: boolean;
  };
  executor: {
    appVersion: string;
    runnerVersion: string;
  };
  model: {
    provider?: string;
    name?: string;
    endpoint?: string;
    hasKey: boolean;
  };
  createdAt: string;
}

export type RerunMissingReference = HistoricalRerunMissingReference;

export type RerunPlan =
  | {
    status: 'ready';
    snapshot: ProjectSnapshot;
    testCase: TestCaseDraft;
    fixtures: FixtureAsset[];
    reusableFlows: ReusableFlowAsset[];
    environment: ProjectEnvironment;
  }
  | {
    status: 'blocked';
    reason: RunReason;
    missingReferences: RerunMissingReference[];
  };

/**
 * Copies only immutable execution identity into a history-safe record. The
 * raw endpoint and API key are transient inputs and never enter the result.
 */
export const createRunProvenance = (
  snapshot: ProjectSnapshot,
  testCase: TestCaseDraft,
  environment: ProjectEnvironment,
  runtimeMetadata: RunProvenanceRuntimeMetadata,
): RunProvenance => {
  const assetReferences = testCase.assetReferences;
  return deepFreeze({
    ...createRunProvenanceBase(snapshot, environment, runtimeMetadata),
    testCase: exactReference(testCase, 'Case'),
    fixtures: (assetReferences?.fixtures ?? []).map((reference) => exactReference(reference, 'Fixture')),
    reusableFlows: (assetReferences?.reusableFlows ?? []).map((reference) => exactReference(reference, 'reusable Flow')),
    baselines: assetReferences?.baseline ? [exactReference(assetReferences.baseline, 'Baseline')] : [],
  });
};

/** Freezes a Suite parent identity without inventing a representative Case. */
export const createSuiteRunProvenance = (
  snapshot: ProjectSnapshot,
  suite: SuiteAsset,
  environment: ProjectEnvironment,
  runtimeMetadata: RunProvenanceRuntimeMetadata,
  parentRunId: string,
): SuiteRunProvenance => {
  if (!parentRunId.trim()) {
    throw new Error('Suite provenance requires a parent run ID.');
  }
  return deepFreeze({
    ...createRunProvenanceBase(snapshot, environment, runtimeMetadata),
    fixtures: [],
    reusableFlows: [],
    baselines: [],
    suite: {
      reference: exactReference(suite, 'Suite'),
      parentRunId,
    },
  });
};

const createRunProvenanceBase = (
  snapshot: ProjectSnapshot,
  environment: ProjectEnvironment,
  runtimeMetadata: RunProvenanceRuntimeMetadata,
): Omit<RunProvenance, 'testCase' | 'suite' | 'fixtures' | 'reusableFlows' | 'baselines'> => {
  const modelProvider = nonEmpty(runtimeMetadata.model.provider);
  const modelName = nonEmpty(runtimeMetadata.model.name);
  const endpoint = nonEmpty(runtimeMetadata.model.endpoint);
  const fingerprint = endpoint ? endpointFingerprint(endpoint) : undefined;
  return {
    schemaVersion: 1,
    projectId: snapshot.project.id,
    projectRevision: snapshot.revision,
    source: snapshot.source,
    reproducibility: snapshot.reproducibility,
    environment: {
      id: environment.id,
      name: environment.name,
      baseUrl: redactProjectUrl(environment.url),
      ...(environment.storageStateId ? { storageStateRef: environment.storageStateId } : {}),
    },
    browserProfile: {
      engine: runtimeMetadata.browserProfile.engine,
      headless: runtimeMetadata.browserProfile.headless,
    },
    executor: {
      appVersion: runtimeMetadata.executor.appVersion,
      runnerVersion: runtimeMetadata.executor.runnerVersion,
    },
    model: {
      ...(modelProvider ? { provider: modelProvider } : {}),
      ...(modelName ? { model: modelName } : {}),
      ...(fingerprint ? { endpointFingerprint: fingerprint } : {}),
      hasKey: runtimeMetadata.model.hasKey,
    },
    createdAt: runtimeMetadata.createdAt,
  };
};

/**
 * Resolves a historical run against its recorded bound revision. It never
 * loads a current project or selects an unversioned/latest asset.
 */
export const resolveRerunPlan = async (
  repository: Pick<ProjectRepository, 'loadBound'>,
  provenance: RunProvenance,
): Promise<RerunPlan> => {
  if (provenance.source === 'legacyStudioStore' || provenance.reproducibility === 'legacy') {
    return blocked(legacyRerunReason());
  }

  let snapshot: ProjectSnapshot;
  try {
    snapshot = await repository.loadBound(provenance.projectId, provenance.projectRevision);
  } catch (error) {
    const reason = repositoryRerunReason(error);
    if (reason) {
      return blocked(reason);
    }
    throw error;
  }

  const testCase = findTestCaseVersion(snapshot.project, provenance.testCase);
  const fixtures = provenance.fixtures.map((reference) => findFixture(snapshot.project, reference));
  const reusableFlows = provenance.reusableFlows.map((reference) => findReusableFlow(snapshot.project, reference));
  const environment = snapshot.project.environments.find((candidate) => candidate.id === provenance.environment.id);
  const missingReferences: RerunMissingReference[] = [
    ...(testCase ? [] : [copyReference(provenance.testCase)]),
    ...provenance.fixtures.flatMap((reference, index) => fixtures[index] ? [] : [copyReference(reference)]),
    ...provenance.reusableFlows.flatMap((reference, index) => reusableFlows[index] ? [] : [copyReference(reference)]),
    ...provenance.baselines.map(copyReference),
    ...(environment ? [] : [{ id: provenance.environment.id }]),
  ];
  if (missingReferences.length) {
    return blocked(missingAssetReason(), missingReferences);
  }

  return {
    status: 'ready',
    snapshot,
    testCase: testCase!,
    fixtures: fixtures as FixtureAsset[],
    reusableFlows: reusableFlows as ReusableFlowAsset[],
    environment: environment!,
  };
};

const exactReference = (
  reference: Pick<VersionedTestAssetReference, 'id'> & { version?: number },
  label: string,
): VersionedTestAssetReference => {
  const version = reference.version;
  if (!reference.id.trim() || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new Error(`${label} provenance requires an exact versioned reference.`);
  }
  return { id: reference.id, version };
};

const copyReference = (reference: VersionedTestAssetReference): RerunMissingReference => {
  return { id: reference.id, version: reference.version };
};

const redactProjectUrl = (value: string): string => {
  const candidate = value.trim();
  try {
    const parsed = new URL(candidate);
    if (!parsed.protocol || !parsed.host) {
      return '';
    }
  } catch {
    return '';
  }

  const withoutFragment = candidate.split('#', 1)[0]!;
  const withoutQuery = withoutFragment.split('?', 1)[0]!;
  const authorityStart = withoutQuery.indexOf('://') + 3;
  const pathStart = withoutQuery.indexOf('/', authorityStart);
  const authorityEnd = pathStart === -1 ? withoutQuery.length : pathStart;
  const authority = withoutQuery.slice(authorityStart, authorityEnd);
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  return `${withoutQuery.slice(0, authorityStart)}${host}${withoutQuery.slice(authorityEnd)}`;
};

const endpointFingerprint = (endpoint: string): string | undefined => {
  const canonicalEndpoint = canonicalizeEndpoint(endpoint);
  return canonicalEndpoint
    ? `sha256:${createHash('sha256').update(canonicalEndpoint, 'utf8').digest('hex')}`
    : undefined;
};

const canonicalizeEndpoint = (endpoint: string): string | undefined => {
  try {
    const parsed = new URL(endpoint);
    if (!parsed.protocol || !parsed.host) {
      return undefined;
    }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
};

const findFixture = (
  project: Pick<ProjectDraft, 'fixtures'>,
  reference: VersionedTestAssetReference,
): FixtureAsset | undefined => {
  return project.fixtures.find((fixture) => fixture.id === reference.id && fixture.version === reference.version);
};

const findReusableFlow = (
  project: Pick<ProjectDraft, 'reusableFlows'>,
  reference: VersionedTestAssetReference,
): ReusableFlowAsset | undefined => {
  return project.reusableFlows.find((flow) => flow.id === reference.id && flow.version === reference.version);
};

const repositoryRerunReason = (error: unknown): RunReason | undefined => {
  const code = repositoryErrorCode(error);
  if (!code) {
    return undefined;
  }
  if (code === 'projectRevisionChanged' || code === 'staleProjectRevision') {
    return {
      code: 'missingAssetVersion',
      message: 'The recorded project revision no longer matches the bound project assets.',
    };
  }
  return {
    code: 'missingAssetVersion',
    message: 'The recorded project revision is unavailable from its bound project assets.',
  };
};

const repositoryErrorCode = (error: unknown): ProjectRepositoryError['code'] | undefined => {
  if (error instanceof ProjectRepositoryError) {
    return error.code;
  }
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'projectNotFound' ||
    code === 'projectUnbound' ||
    code === 'bindingUnavailable' ||
    code === 'staleProjectRevision' ||
    code === 'projectRevisionChanged'
    ? code
    : undefined;
};

const legacyRerunReason = (): RunReason => {
  return {
    code: 'legacyAmbiguousNeutral',
    message: 'Historical rerun is unavailable because this run was not captured from a versioned project snapshot.',
  };
};

const missingAssetReason = (): RunReason => {
  return {
    code: 'missingAssetVersion',
    message: 'One or more recorded asset versions are unavailable for this historical rerun.',
  };
};

const blocked = (reason: RunReason, missingReferences: RerunMissingReference[] = []): RerunPlan => {
  return { status: 'blocked', reason, missingReferences };
};

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
};
