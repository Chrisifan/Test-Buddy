import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createInitialStudioState,
  type FixtureAsset,
  type ProjectAssetBinding,
  type ProjectDraft,
  type ProjectEnvironment,
  type TestCaseAssetReferences,
  type TestCaseDraft,
} from '../../shared/studio.js';
import { ProjectAssetStore } from '../projectAssetStore.js';
import { ProjectRepository, ProjectRepositoryError, type ProjectSnapshot } from '../projectRepository.js';
import { StudioStore } from '../studioStore.js';
import {
  createRunProvenance,
  resolveRerunPlan,
  type RunProvenanceRuntimeMetadata,
} from './run-provenance.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('run provenance', () => {
  it('deep-freezes redacted exact inputs independently from later source mutations', () => {
    const project = createVersionedProject();
    const environment = project.environments[0]!;
    const testCase = project.testCases[0]!;
    const snapshot = projectSnapshot(project, 'a'.repeat(64));
    environment.url = 'https://account:password@staging.example.test/shop?access_token=private#session';
    environment.storageStateId = 'state-staging-1';
    testCase.assetReferences = assetReferences();
    const runtime = runtimeMetadata();

    const provenance = createRunProvenance(snapshot, testCase, environment, runtime);

    project.name = 'Mutated project';
    environment.name = 'Mutated environment';
    environment.url = 'https://changed.example.test';
    environment.storageStateId = 'changed-state';
    testCase.version = 99;
    testCase.assetReferences.fixtures[0]!.id = 'changed-fixture';
    runtime.browserProfile.engine = 'firefox';
    runtime.model.name = 'changed-model';

    expect(provenance).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-provenance',
      projectRevision: 'a'.repeat(64),
      source: 'projectDirectory',
      reproducibility: 'versioned',
      testCase: { id: 'case-checkout', version: 1 },
      fixtures: [{ id: 'fixture-account', version: 1 }],
      reusableFlows: [{ id: 'flow-login', version: 2 }],
      baselines: [{ id: 'baseline-dashboard', version: 3 }],
      environment: {
        id: 'env-staging',
        name: 'Staging',
        baseUrl: 'https://staging.example.test/shop',
        storageStateRef: 'state-staging-1',
      },
      browserProfile: { engine: 'webkit', headless: false },
      executor: { appVersion: 'app-9.0.0', runnerVersion: 'runner-3.0.0' },
      model: { provider: 'openaiCompatible', model: 'gpt-provenance', hasKey: true },
      createdAt: '2026-08-16T00:00:00.000Z',
    });
    expect(Object.isFrozen(provenance)).toBe(true);
    expect(Object.isFrozen(provenance.testCase)).toBe(true);
    expect(Object.isFrozen(provenance.fixtures)).toBe(true);
    expect(Object.isFrozen(provenance.fixtures[0]!)).toBe(true);
    expect(Object.isFrozen(provenance.environment)).toBe(true);
  });

  it('never serializes model credentials or an endpoint URL', () => {
    const project = createVersionedProject();
    const provenance = createRunProvenance(
      projectSnapshot(project, 'b'.repeat(64)),
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(),
    );
    const serialized = JSON.stringify(provenance);

    expect(serialized).not.toContain('api-key-not-persisted');
    expect(serialized).not.toContain('api-password');
    expect(serialized).not.toContain('models.example.test');
    expect(serialized).not.toContain('tenant=private');
    expect(provenance.model.endpointFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('fingerprints credential-free canonical endpoints instead of secret-bearing URL variants', () => {
    const project = createVersionedProject();
    const secretBearingEndpoint = 'https://api-user:api-password@models.example.test/v1?tenant=private#fragment';
    const canonicalEndpoint = 'https://models.example.test/v1';
    const secretBearing = createRunProvenance(
      projectSnapshot(project, 'f'.repeat(64)),
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(secretBearingEndpoint),
    );
    const canonical = createRunProvenance(
      projectSnapshot(project, 'f'.repeat(64)),
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(canonicalEndpoint),
    );

    expect(secretBearing.model.endpointFingerprint).toBe(canonical.model.endpointFingerprint);
    const serialized = JSON.stringify(secretBearing);
    expect(serialized).not.toContain('api-user');
    expect(serialized).not.toContain('api-password');
    expect(serialized).not.toContain('tenant=private');
    expect(serialized).not.toContain('fragment');
  });

  it('omits an endpoint fingerprint for an invalid endpoint instead of hashing raw input', () => {
    const project = createVersionedProject();
    const invalidEndpoint = 'not a URL?api-key=api-key-not-persisted';

    const provenance = createRunProvenance(
      projectSnapshot(project, 'f'.repeat(64)),
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(invalidEndpoint),
    );

    expect(provenance.model).not.toHaveProperty('endpointFingerprint');
    expect(JSON.stringify(provenance)).not.toContain(invalidEndpoint);
  });

  it('loads the exact bound revision and returns Case v1 when a later Case version exists', async () => {
    const project = createVersionedProject();
    const firstVersion = project.testCases[0]!;
    const secondVersion: TestCaseDraft = { ...structuredClone(firstVersion), version: 2, name: 'Checkout v2' };
    project.testCases = [firstVersion, secondVersion];
    const { binding, repository } = await createBoundRepository(project);
    const snapshot = await repository.loadBound(project.id, binding.revision);
    const provenance = createRunProvenance(snapshot, snapshot.project.testCases[0]!, snapshot.project.environments[0]!, runtimeMetadata());
    const loadBound = vi.spyOn(repository, 'loadBound');

    const plan = await resolveRerunPlan(repository, provenance);

    expect(loadBound).toHaveBeenCalledWith(project.id, binding.revision);
    expect(plan).toMatchObject({
      status: 'ready',
      snapshot: { revision: binding.revision, source: 'projectDirectory', reproducibility: 'versioned' },
      testCase: { id: firstVersion.id, version: 1, name: firstVersion.name },
      environment: { id: 'env-staging', name: 'Staging' },
    });
    if (plan.status === 'ready') {
      expect(plan.testCase).not.toBe(plan.snapshot.project.testCases[1]);
      expect(plan.testCase.version).toBe(1);
    }
  });

  it('blocks all missing historical assets and environment without loading a current project', async () => {
    const sourceProject = createVersionedProject();
    sourceProject.testCases[0]!.assetReferences = assetReferences();
    const provenance = createRunProvenance(
      projectSnapshot(sourceProject, 'c'.repeat(64)),
      sourceProject.testCases[0]!,
      sourceProject.environments[0]!,
      runtimeMetadata(),
    );
    const unavailableProject = createVersionedProject();
    unavailableProject.testCases = [];
    unavailableProject.fixtures = [];
    unavailableProject.environments = [];
    const load = vi.fn();
    const loadBound = vi.fn().mockResolvedValue(projectSnapshot(unavailableProject, provenance.projectRevision));

    const plan = await resolveRerunPlan({ load, loadBound }, provenance);

    expect(plan).toMatchObject({
      status: 'blocked',
      reason: { code: 'missingAssetVersion' },
      missingReferences: [
        { id: 'case-checkout', version: 1 },
        { id: 'fixture-account', version: 1 },
        { id: 'flow-login', version: 2 },
        { id: 'baseline-dashboard', version: 3 },
        { id: 'env-staging' },
      ],
    });
    expect(loadBound).toHaveBeenCalledWith(provenance.projectId, provenance.projectRevision);
    expect(load).not.toHaveBeenCalled();
  });

  it('resolves recorded Flow references exactly and keeps unsupported Baseline references blocked', async () => {
    const project = createVersionedProject();
    project.testCases[0]!.assetReferences = assetReferences();
    const provenance = createRunProvenance(
      projectSnapshot(project, 'c'.repeat(64)),
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(),
    );
    const injectedSnapshotProject = structuredClone(project);
    Object.assign(injectedSnapshotProject, {
      reusableFlows: [reusableFlow()],
      baselines: [{ id: 'baseline-dashboard', version: 3 }],
    });

    const plan = await resolveRerunPlan({
      loadBound: vi.fn().mockResolvedValue(projectSnapshot(injectedSnapshotProject, provenance.projectRevision)),
    }, provenance);

    expect(plan).toMatchObject({
      status: 'blocked',
      reason: { code: 'missingAssetVersion' },
      missingReferences: [
        { id: 'baseline-dashboard', version: 3 },
      ],
    });
  });

  it('always blocks legacy provenance before reading a repository', async () => {
    const project = createVersionedProject();
    const provenance = createRunProvenance(
      {
        ...projectSnapshot(project, 'd'.repeat(64)),
        source: 'legacyStudioStore',
        reproducibility: 'legacy',
      },
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(),
    );
    const loadBound = vi.fn();

    await expect(resolveRerunPlan({ loadBound }, provenance)).resolves.toMatchObject({
      status: 'blocked',
      reason: { code: 'legacyAmbiguousNeutral' },
      missingReferences: [],
    });
    expect(loadBound).not.toHaveBeenCalled();
  });

  it('rethrows unexpected repository errors instead of converting them to a blocked plan', async () => {
    const project = createVersionedProject();
    const provenance = createRunProvenance(
      projectSnapshot(project, 'f'.repeat(64)),
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(),
    );
    const unexpected = new Error('Network request failed.');

    await expect(resolveRerunPlan({ loadBound: vi.fn().mockRejectedValue(unexpected) }, provenance)).rejects.toBe(unexpected);
  });

  it('blocks a rejected recorded revision without falling back or exposing repository paths', async () => {
    const project = createVersionedProject();
    const provenance = createRunProvenance(
      projectSnapshot(project, 'e'.repeat(64)),
      project.testCases[0]!,
      project.environments[0]!,
      runtimeMetadata(),
    );
    const load = vi.fn();
    const loadBound = vi.fn().mockRejectedValue(new ProjectRepositoryError(
      'projectRevisionChanged',
      'Bound snapshot at /private/project-assets is different.',
    ));

    const plan = await resolveRerunPlan({ load, loadBound }, provenance);

    expect(plan).toMatchObject({
      status: 'blocked',
      reason: { code: 'missingAssetVersion' },
      missingReferences: [],
    });
    if (plan.status === 'blocked') {
      expect(plan.reason.message).not.toContain('/private/project-assets');
    }
    expect(load).not.toHaveBeenCalled();
  });
});

function createVersionedProject(): ProjectDraft {
  const project = createEmptyProject(1);
  project.id = 'project-provenance';
  project.name = 'Provenance project';
  project.environments = [{
    ...project.environments[0]!,
    id: 'env-staging',
    name: 'Staging',
    url: 'https://staging.example.test',
  }];
  project.selectedEnvironmentId = 'env-staging';
  project.testCases = [createTestCase(project)];
  project.fixtures = [fixture()];
  return project;
}

function createTestCase(project: ProjectDraft): TestCaseDraft {
  return {
    id: 'case-checkout',
    version: 1,
    schemaVersion: 2,
    kind: 'scenario',
    name: 'Checkout v1',
    category: 'Regression',
    lastEdited: '2026-08-16T00:00:00.000Z',
    url: project.environments[0]!.url,
    notes: '',
    groupId: project.groups[0]!.id,
    environmentId: project.environments[0]!.id,
    source: 'manual',
    assetReferences: { fixtures: [], reusableFlows: [] },
    steps: [],
  };
}

function fixture(): FixtureAsset {
  return {
    schemaVersion: 1,
    id: 'fixture-account',
    version: 1,
    name: 'Account setup',
    description: '',
    inputs: [],
    outputs: [],
    credentialIds: [],
    environmentIds: [],
    setup: {
      mode: 'http',
      summary: 'Prepare an account.',
      http: { method: 'POST', path: '/api/accounts', expectedStatuses: [200] },
    },
    concurrency: 'parallel',
    resourceLocks: [],
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  };
}

function reusableFlow() {
  return {
    schemaVersion: 1 as const,
    id: 'flow-login',
    version: 2,
    name: 'Login setup',
    description: '',
    tags: [],
    steps: [{
      id: 'flow-open-login',
      type: 'ai' as const,
      title: 'Open login',
      body: 'Open login',
      execution: {
        schemaVersion: 2 as const,
        intent: 'Open login',
        reviewStatus: 'confirmed' as const,
        actionRisk: 'low' as const,
        action: { kind: 'navigate' as const, url: 'https://example.test/login' },
      },
    }],
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  };
}

function assetReferences(): TestCaseAssetReferences {
  return {
    fixtures: [{ id: 'fixture-account', version: 1 }],
    reusableFlows: [{ id: 'flow-login', version: 2 }],
    baseline: { id: 'baseline-dashboard', version: 3 },
  };
}

function runtimeMetadata(endpoint = 'https://api-user:api-password@models.example.test/v1?tenant=private#fragment'): RunProvenanceRuntimeMetadata {
  return {
    browserProfile: { engine: 'webkit', headless: false },
    executor: { appVersion: 'app-9.0.0', runnerVersion: 'runner-3.0.0' },
    model: {
      provider: 'openaiCompatible',
      name: 'gpt-provenance',
      endpoint,
      hasKey: true,
    },
    createdAt: '2026-08-16T00:00:00.000Z',
  };
}

function projectSnapshot(project: ProjectDraft, revision: string): ProjectSnapshot {
  return {
    project,
    revision,
    source: 'projectDirectory',
    reproducibility: 'versioned',
  };
}

async function createBoundRepository(project: ProjectDraft): Promise<{
  binding: ProjectAssetBinding;
  repository: ProjectRepository;
}> {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-run-provenance-'));
  temporaryDirectories.push(rootDirectory);
  const projectDirectory = path.join(rootDirectory, 'project-assets');
  const assetStore = new ProjectAssetStore(projectDirectory);
  await assetStore.saveInitial(project);
  const snapshot = await assetStore.loadWithRevision();
  const binding: ProjectAssetBinding = {
    projectId: project.id,
    projectDirectory,
    revision: snapshot.revision,
    boundAt: '2026-08-16T00:00:00.000Z',
  };
  const studioStore = new StudioStore(rootDirectory);
  await studioStore.save({
    ...createInitialStudioState(),
    projects: [project],
    projectAssetBindings: [binding],
  });
  return { binding, repository: new ProjectRepository({ studioStore }) };
}
