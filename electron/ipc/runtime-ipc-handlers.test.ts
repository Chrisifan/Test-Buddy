import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import * as crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptySuiteAsset,
  createInitialStudioState,
  findSuiteAsset,
  findTestCaseVersion,
  isAgentRunnableTestCase,
  type ProjectDraft,
  type RunTestCaseResponse,
  type RunSuiteResponse,
  type StudioState,
} from '../../shared/studio.js';
import { isSafeMaintenanceRationale } from '../../shared/maintenance.js';
import { executeCliCommand } from '../cli.js';
import { ProjectAssetStore } from '../projectAssetStore.js';
import { ProjectRepository, ProjectRepositoryError } from '../projectRepository.js';
import { RunCancelledError, isRunCancelled } from '../runtime/run-cancellation.js';
import * as runtimeBundle from '../runtime/runtime-bundle.js';
import { StudioStore } from '../studioStore.js';

let executeDesktopSuiteIntent: ReturnType<typeof loadRuntimeIpcHandlers>['executeDesktopSuiteIntent'];
let registerRuntimeIpcHandlers: ReturnType<typeof loadRuntimeIpcHandlers>['registerRuntimeIpcHandlers'];
let runtimeIpcChannels: ReturnType<typeof loadRuntimeIpcHandlers>['runtimeIpcChannels'];

type RuntimeIpcDependencies = {
  handle: (channel: string, listener: (event: unknown, ...args: never[]) => unknown) => void;
  loadState: ReturnType<typeof vi.fn>;
  saveState: ReturnType<typeof vi.fn>;
  getRuntimeBundle: ReturnType<typeof vi.fn>;
  loadResolvedModelConfiguration: ReturnType<typeof vi.fn>;
  createLazyModelConfigResolver: ReturnType<typeof vi.fn>;
  projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>;
  getFixtureScriptTrustContext: ReturnType<typeof vi.fn>;
  openPath: ReturnType<typeof vi.fn>;
  showSaveDialog: ReturnType<typeof vi.fn>;
  getDownloadsPath: ReturnType<typeof vi.fn>;
  showOpenDialog: ReturnType<typeof vi.fn>;
  getRuntimeInfo: ReturnType<typeof vi.fn>;
  maintenanceService: {
    createFromRun: ReturnType<typeof vi.fn>;
    accept: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    openEvidence: ReturnType<typeof vi.fn>;
  };
};

describe('registerRuntimeIpcHandlers', () => {
  it('runs a bound v1 through IPC and CLI while rejecting stale or missing versions before a runner starts', async () => {
    const dataDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'testbuddy-wave-one-boundary-'));
    try {
      const project = createEmptyProject(1);
      project.id = 'project-bound-history';
      const environment = project.environments[0]!;
      const caseV1 = {
        ...createTestCase(project, 'case/checkout', environment.id),
        version: 1,
        name: 'Checkout v1',
      };
      const caseV2 = {
        ...caseV1,
        version: 2,
        name: 'Checkout v2',
      };
      project.testCases = [caseV1, caseV2];
      project.suites = [{
        ...createEmptySuiteAsset(project, 1),
        id: 'suite/checkout',
        version: 1,
        name: 'Checkout history',
        environmentId: environment.id,
        caseReferences: [{ id: caseV1.id, version: caseV1.version, dependsOn: [] }],
      }];
      const projectDirectory = path.join(dataDirectory, 'project-assets');
      const assetStore = new ProjectAssetStore(projectDirectory);
      await assetStore.saveInitial(project);
      const boundSnapshot = await assetStore.loadWithRevision();

      const missingProject = {
        ...structuredClone(project),
        id: 'project-missing-history',
        testCases: [{ ...caseV2, id: 'case/missing-history' }],
        suites: [],
      };
      const missingProjectDirectory = path.join(dataDirectory, 'missing-project-assets');
      const missingAssetStore = new ProjectAssetStore(missingProjectDirectory);
      await missingAssetStore.saveInitial(missingProject);
      const missingSnapshot = await missingAssetStore.loadWithRevision();

      const studioProject = structuredClone(project);
      studioProject.testCases = [caseV2];
      const state = createInitialStudioState();
      state.projects = [studioProject, structuredClone(missingProject)];
      state.projectAssetBindings = [
        {
          projectId: project.id,
          projectDirectory,
          revision: boundSnapshot.revision,
          boundAt: '2026-08-15T00:00:00.000Z',
        },
        {
          projectId: missingProject.id,
          projectDirectory: missingProjectDirectory,
          revision: missingSnapshot.revision,
          boundAt: '2026-08-15T00:00:00.000Z',
        },
      ];
      const studioStore = new StudioStore(dataDirectory);
      await studioStore.save(state);
      const repository = new ProjectRepository({ studioStore });

      const mainRunTestCase = vi.fn().mockResolvedValue(runTestCaseResponse(project.id, caseV1.id, environment.id));
      const dependencies = createDependencies({
        projectRepository: repository,
        getRuntimeBundle: vi.fn().mockReturnValue({
          artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
          browserRuntime: { getState: () => ({ status: 'idle' }) },
          runTestCase: mainRunTestCase,
          runSuite: vi.fn(),
          cancelRun: vi.fn(),
        }),
      });
      const handlers = registerHandlers(dependencies);

      await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
        projectId: project.id,
        testCase: { id: caseV1.id, version: caseV1.version },
        expectedProjectRevision: boundSnapshot.revision,
      })).resolves.toMatchObject({ runId: 'run-1' });
      expect(mainRunTestCase).toHaveBeenCalledWith(expect.objectContaining({
        projectSnapshot: expect.objectContaining({
          revision: boundSnapshot.revision,
          reproducibility: 'versioned',
          project: expect.objectContaining({ testCases: expect.arrayContaining([
            expect.objectContaining({ id: caseV1.id, version: 1, name: 'Checkout v1' }),
            expect.objectContaining({ id: caseV2.id, version: 2, name: 'Checkout v2' }),
          ]) }),
        }),
        testCase: expect.objectContaining({ id: caseV1.id, version: 1, name: 'Checkout v1' }),
      }));

      const cliRunTestCase = vi.fn().mockResolvedValue(runTestCaseResponse(project.id, caseV1.id, environment.id));
      const createRuntimeBundle = vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
        ensureReady: vi.fn(),
        runTestCase: cliRunTestCase,
        browserRuntime: { getState: vi.fn(() => state.browserSession) },
        close: vi.fn(),
      } as never);
      const cliSummary = await executeCliCommand({
        kind: 'run',
        dataDir: dataDirectory,
        projectId: project.id,
        caseReferences: [],
        suiteReference: { id: 'suite/checkout', version: 1 },
      });

      expect(cliSummary.results).toEqual([expect.objectContaining({ testCaseId: caseV1.id })]);
      expect(cliRunTestCase).toHaveBeenCalledWith(expect.objectContaining({
        projectSnapshot: expect.objectContaining({
          revision: boundSnapshot.revision,
          reproducibility: 'versioned',
        }),
        testCase: expect.objectContaining({ id: caseV1.id, version: 1, name: 'Checkout v1' }),
      }));

      const mainRunCount = mainRunTestCase.mock.calls.length;
      await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
        projectId: project.id,
        testCase: { id: caseV1.id, version: caseV1.version },
        expectedProjectRevision: 'f'.repeat(64),
      })).resolves.toMatchObject({ type: 'testBuddy.runtimeError', code: 'staleProjectRevision' });
      expect(mainRunTestCase).toHaveBeenCalledTimes(mainRunCount);

      await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
        projectId: missingProject.id,
        testCase: { id: 'case/missing-history', version: 1 },
        expectedProjectRevision: missingSnapshot.revision,
      })).resolves.toMatchObject({ type: 'testBuddy.runtimeError', code: 'missingAssetVersion' });
      await expect(executeCliCommand({
        kind: 'run',
        dataDir: dataDirectory,
        projectId: missingProject.id,
        caseReferences: [{ id: 'case/missing-history', version: 1 }],
      })).rejects.toThrow('未找到 Case：case/missing-history@1');
      expect(mainRunTestCase).toHaveBeenCalledTimes(mainRunCount);
      expect(cliRunTestCase).toHaveBeenCalledTimes(1);
      expect(createRuntimeBundle).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      await fsPromises.rm(dataDirectory, { recursive: true, force: true });
    }
  });

  it('registers the complete runtime IPC boundary', () => {
    const handlers = registerHandlers(createDependencies());

    expect([...handlers.keys()]).toEqual([
      runtimeIpcChannels.getInfo,
      runtimeIpcChannels.runTestCase,
      runtimeIpcChannels.runSuite,
      runtimeIpcChannels.cancelRun,
      runtimeIpcChannels.loadRunDetail,
      runtimeIpcChannels.loadSuiteRunRecord,
      runtimeIpcChannels.listMaintenanceDrafts,
      runtimeIpcChannels.createMaintenanceDraft,
      runtimeIpcChannels.acceptMaintenanceDraft,
      runtimeIpcChannels.rejectMaintenanceDraft,
      runtimeIpcChannels.openMaintenanceEvidence,
      runtimeIpcChannels.planArtifactRetention,
      runtimeIpcChannels.confirmArtifactRetention,
      runtimeIpcChannels.planHistoricalRerun,
      runtimeIpcChannels.runHistoricalRerun,
      runtimeIpcChannels.openArtifact,
      runtimeIpcChannels.exportArtifact,
      runtimeIpcChannels.attachManualEvidence,
    ]);
  });

  it('routes retention planning and explicit confirmation through ArtifactManager without exposing paths', async () => {
    const planArtifactRetention = vi.fn().mockResolvedValue({ id: 'retention-1', entries: [] });
    const confirmArtifactRetention = vi.fn().mockResolvedValue({ planId: 'retention-1', deleted: [] });
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: {
          isManagedArtifactPath: () => true,
          exportArtifact: vi.fn(),
          importManualEvidence: vi.fn(),
          planArtifactRetention,
          confirmArtifactRetention,
        },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
    });
    const handlers = registerHandlers(dependencies);
    await expect(handlers.get(runtimeIpcChannels.planArtifactRetention)!({})).resolves.toEqual({ id: 'retention-1', entries: [] });
    await expect(handlers.get(runtimeIpcChannels.confirmArtifactRetention)!({}, 'retention-1')).resolves.toEqual({ planId: 'retention-1', deleted: [] });
    expect(planArtifactRetention).toHaveBeenCalledWith();
    expect(confirmArtifactRetention).toHaveBeenCalledWith('retention-1');
  });

  it('routes only redacted maintenance intents through the main-owned service', async () => {
    const project = createEmptyProject(1);
    const testCase = createTestCase(project, 'case-maintenance', project.environments[0]!.id);
    const createFromRun = vi.fn().mockResolvedValue({ id: 'maintenance-1', status: 'draft' });
    const accept = vi.fn().mockResolvedValue({ status: 'stale', draft: { id: 'maintenance-1', status: 'stale' } });
    const reject = vi.fn().mockResolvedValue({ id: 'maintenance-1', status: 'rejected' });
    const handlers = registerHandlers(createDependencies({ maintenanceService: { createFromRun, accept, reject, openEvidence: vi.fn() } }));
    const request = {
      runId: 'run-maintenance',
      target: { kind: 'case', id: testCase.id, version: 1 },
      proposedCase: testCase,
      citations: [{ artifactId: 'artifact-maintenance', contentHash: 'a'.repeat(64) }],
    };

    await expect(handlers.get(runtimeIpcChannels.createMaintenanceDraft)!({}, request)).resolves.toEqual({ id: 'maintenance-1', status: 'draft' });
    await expect(handlers.get(runtimeIpcChannels.acceptMaintenanceDraft)!({}, {
      draftId: 'maintenance-1', expectedRevision: 'b'.repeat(64),
    })).resolves.toMatchObject({ status: 'stale' });
    await expect(handlers.get(runtimeIpcChannels.rejectMaintenanceDraft)!({}, {
      draftId: 'maintenance-1',
      rationale: 'The cited failure does not reproduce in the pinned environment.',
    })).resolves.toMatchObject({ status: 'rejected' });
    expect(createFromRun).toHaveBeenCalledWith(request);
    expect(accept).toHaveBeenCalledWith({ draftId: 'maintenance-1', expectedRevision: 'b'.repeat(64) });
    expect(reject).toHaveBeenCalledWith({
      draftId: 'maintenance-1',
      rationale: 'The cited failure does not reproduce in the pinned environment.',
    });

    await expect(handlers.get(runtimeIpcChannels.rejectMaintenanceDraft)!({}, {
      draftId: 'maintenance-1',
      rationale: 'apiKey=not-allowed',
    })).rejects.toThrow(/maintenance request/i);
    expect(reject).toHaveBeenCalledTimes(1);

    await expect(handlers.get(runtimeIpcChannels.createMaintenanceDraft)!({}, {
      ...request,
      artifactPath: '/private/evidence.png',
      projectSnapshot: project,
      modelConfig: { apiKey: 'not-allowed' },
    })).rejects.toThrow(/maintenance request/i);
    expect(createFromRun).toHaveBeenCalledTimes(1);
  });

  it('opens only an exact managed maintenance citation without accepting a renderer path', async () => {
    const managedArtifactPath = '/managed-artifacts/page-screenshots/sign-in.png';
    const openEvidence = vi.fn()
      .mockResolvedValueOnce(managedArtifactPath)
      .mockResolvedValueOnce('/tmp/unmanaged.png');
    const openPath = vi.fn().mockResolvedValue('');
    const dependencies = createDependencies({
      openPath,
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: {
          isManagedArtifactPath: (artifactPath: string) => artifactPath === managedArtifactPath,
          exportArtifact: vi.fn(),
          importManualEvidence: vi.fn(),
        },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
    });
    (dependencies.maintenanceService as unknown as { openEvidence: typeof openEvidence }).openEvidence = openEvidence;
    const handlers = registerHandlers(dependencies);
    const openMaintenanceEvidence = handlers.get('runtime:open-maintenance-evidence');
    const request = {
      draftId: 'maintenance-1',
      citation: {
        runId: 'run-sign-in',
        artifactId: 'artifact-sign-in',
        contentHash: 'a'.repeat(64),
      },
    };

    expect(openMaintenanceEvidence).toBeDefined();
    await expect(openMaintenanceEvidence!({}, request)).resolves.toBeUndefined();
    expect(openEvidence).toHaveBeenCalledWith(request);
    expect(openPath).toHaveBeenCalledWith(managedArtifactPath);

    await expect(openMaintenanceEvidence!({}, request)).rejects.toThrow('只能打开应用生成的证据文件。');
    expect(openPath).toHaveBeenCalledTimes(1);
    await expect(openMaintenanceEvidence!({}, {
      ...request,
      citation: { ...request.citation, artifactPath: '/private/evidence.png' },
    })).rejects.toThrow(/maintenance request/i);
  });

  it('rejects an unmanaged artifact before calling openPath', async () => {
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => false, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.openArtifact)!({}, '/tmp/unmanaged.html')).rejects.toThrow(
      '只能打开应用生成的证据文件。',
    );

    expect(dependencies.openPath).not.toHaveBeenCalled();
  });

  it('rejects an unmanaged artifact before showing an export dialog', async () => {
    const exportArtifact = vi.fn();
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => false, exportArtifact, importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.exportArtifact)!({}, '/tmp/unmanaged.html')).rejects.toThrow(
      '只能导出应用生成的证据文件。',
    );

    expect(dependencies.showSaveDialog).not.toHaveBeenCalled();
    expect(exportArtifact).not.toHaveBeenCalled();
  });

  it('resolves an exact Case from the repository and ignores forged renderer assets', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCaseV1 = {
      id: 'case-1',
      version: 1,
      kind: 'scenario' as const,
      name: 'Case one',
      category: 'Regression',
      lastEdited: new Date(0).toISOString(),
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      steps: [],
    };
    const testCaseV2 = { ...testCaseV1, version: 2, name: 'Forged replacement' };
    project.testCases = [testCaseV1, testCaseV2];
    const snapshot = projectSnapshot(project, '1'.repeat(64), 'projectDirectory');
    const response = runTestCaseResponse(project.id, testCaseV1.id, environment.id);
    const dependencies = createDependencies({
      getFixtureScriptTrustContext: vi.fn().mockResolvedValue({
        projectDirectory: '/projects/one',
        records: [{
          schemaVersion: 1,
          projectId: project.id,
          projectDirectory: '/projects/one',
          fixtureId: 'fixture-1',
          fixtureVersion: 1,
          lifecycle: 'setup',
          relativePath: 'setup.mjs',
          contentHash: 'a'.repeat(64),
          approvedAt: new Date(0).toISOString(),
        }],
      }),
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn().mockResolvedValue(response),
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(snapshot),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: testCaseV1.id, version: testCaseV1.version },
      expectedProjectRevision: snapshot.revision,
      fixtureScriptTrustDirectory: '/renderer-controlled',
      fixtureScriptTrustRecords: [],
      project: { ...project, testCases: [testCaseV2] },
      environment: { ...environment, name: 'Renderer override' },
    } as unknown)).resolves.toMatchObject(response);

    const runtime = dependencies.getRuntimeBundle();
    expect(dependencies.getFixtureScriptTrustContext).toHaveBeenCalledWith(project.id);
    expect(runtime.runTestCase).toHaveBeenCalledWith(expect.objectContaining({
      projectSnapshot: snapshot,
      testCase: testCaseV1,
      environment,
      fixtureScriptTrustDirectory: '/projects/one',
      fixtureScriptTrustRecords: expect.arrayContaining([expect.objectContaining({ fixtureId: 'fixture-1' })]),
    }));
    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      runDetails: [expect.objectContaining({
        id: response.detail.id,
        provenance: expect.objectContaining({ testCase: { id: testCaseV1.id, version: testCaseV1.version } }),
      })],
      recentRuns: [expect.objectContaining({
        id: response.runId,
        environmentId: environment.id,
      })],
    }));
  });

  it('persists frozen, secret-free Case provenance resolved by main before execution', async () => {
    const project = createEmptyProject(1);
    const environment = {
      ...project.environments[0]!,
      url: 'https://environment-user:environment-password@example.test/catalog?session=secret#fragment',
    };
    project.environments = [environment];
    const testCase = {
      ...createTestCase(project, 'case-provenance', environment.id),
      steps: [{
        id: 'step-provenance-agent',
        type: 'ai' as const,
        title: 'Inspect checkout',
        body: 'Inspect the checkout page.',
      }],
      assetReferences: {
        fixtures: [{ id: 'fixture-checkout', version: 1 }],
        reusableFlows: [],
      },
    };
    project.testCases = [testCase];
    project.fixtures = [{
      id: 'fixture-checkout',
      version: 1,
      name: 'Checkout fixture',
      description: '',
      tags: [],
      inputSchema: [],
      outputs: [],
      lifecycle: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }];
    const state = createInitialStudioState();
    state.midsceneConfig = {
      ...state.midsceneConfig,
      modelBaseUrl: 'https://model-user:model-password@models.example.test/v1?token=endpoint-secret',
      modelSecret: {
        id: 'midscene',
        hasKey: true,
        updatedAt: '2026-08-17T00:00:00.000Z',
      },
      modelName: 'model-v1',
    };
    const response = runTestCaseResponse(project.id, testCase.id, environment.id);
    const resolveMidsceneConfig = vi.fn().mockResolvedValue({
      ...state.midsceneConfig,
      modelApiKey: 'main-process-model-api-secret',
    });
    const createLazyModelConfigResolver = vi.fn().mockReturnValue({
      resolveMidsceneConfig,
      resolveAgentProviderConfig: vi.fn(),
    });
    let receivedModelApiKey = '';
    const runTestCase = vi.fn().mockImplementation(async (request) => {
      request.testCase.assetReferences!.fixtures[0]!.version = 99;
      request.environment.url = 'https://runner-mutated.example.test';
      const config = await request.modelConfigResolver.resolveMidsceneConfig();
      receivedModelApiKey = config.modelApiKey;
      config.modelApiKey = 'mutated-model-api-secret';
      return response;
    });
    const dependencies = createDependencies({
      loadState: vi.fn().mockResolvedValue(state),
      createLazyModelConfigResolver,
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '9'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    const result = await handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: testCase.id, version: testCase.version },
    }) as RunTestCaseResponse;

    expect(result.runId).toBe(response.runId);
    expect(result.title).toBe(response.title);
    expect(result.detail).toMatchObject({
      ...response.detail,
    });
    expect(result.detail.provenance).toMatchObject({
      testCase: { id: testCase.id, version: testCase.version },
      environment: { baseUrl: 'https://example.test/catalog' },
    });
    expect(Object.isFrozen(result.detail.provenance)).toBe(true);
    expect(createLazyModelConfigResolver).toHaveBeenCalledTimes(1);
    expect(resolveMidsceneConfig).toHaveBeenCalledTimes(1);
    expect(receivedModelApiKey).toBe('main-process-model-api-secret');
    expect(JSON.stringify(state)).not.toContain('modelApiKey');

    const savedState = dependencies.saveState.mock.calls.at(-1)![0];
    expect(savedState.runDetails[0]).toMatchObject({
      provenance: {
        projectId: project.id,
        projectRevision: '9'.repeat(64),
        testCase: { id: testCase.id, version: 1 },
        fixtures: [{ id: 'fixture-checkout', version: 1 }],
        environment: {
          id: environment.id,
          baseUrl: 'https://example.test/catalog',
        },
        browserProfile: { engine: 'chromium', headless: true },
        executor: { appVersion: 'test-buddy-desktop', runnerVersion: 'runtime-bundle-v1' },
        model: { model: 'model-v1', hasKey: true },
      },
    });
    const persisted = JSON.stringify(savedState.runDetails[0]!.provenance);
    expect(persisted).not.toContain('model-api-secret');
    expect(persisted).not.toContain('main-process-model-api-secret');
    expect(persisted).not.toContain('mutated-model-api-secret');
    expect(persisted).not.toContain('model-password');
    expect(persisted).not.toContain('endpoint-secret');
    expect(persisted).not.toContain('environment-password');
    expect(persisted).not.toContain('runner-mutated');
  });

  it('preserves a concurrent StudioState edit while a Case run is pending', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-concurrent-case', environment.id);
    project.testCases = [testCase];
    const response = runTestCaseResponse(project.id, testCase.id, environment.id);
    const initialState = createInitialStudioState();
    const executionState = {
      ...initialState,
      runtimeProfile: { ...initialState.runtimeProfile, baseUrl: 'https://execution-case.example.test' },
      midsceneConfig: { ...initialState.midsceneConfig, modelName: 'execution-case-model' },
    };
    const concurrentState = {
      ...executionState,
      projects: [{ ...project, name: 'Concurrent Case edit' }],
      runtimeProfile: { ...executionState.runtimeProfile, baseUrl: 'https://concurrent-case.example.test' },
      midsceneConfig: { ...executionState.midsceneConfig, modelName: 'concurrent-case-model' },
    };
    let currentState = executionState;
    const deferred = deferredResult<RunTestCaseResponse>();
    const runTestCase = vi.fn().mockImplementation(() => {
      deferred.markStarted();
      return deferred.promise;
    });
    const dependencies = createDependencies({
      loadState: vi.fn().mockImplementation(async () => currentState),
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '1'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    const pending = handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: testCase.id, version: testCase.version },
    });
    await deferred.started;
    expect(runTestCase).toHaveBeenCalledWith(expect.objectContaining({
      runtimeProfile: executionState.runtimeProfile,
      browserSession: executionState.browserSession,
    }));
    expect(dependencies.loadResolvedModelConfiguration).not.toHaveBeenCalled();
    currentState = concurrentState;
    deferred.resolve(response);
    await expect(pending).resolves.toMatchObject(response);

    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      projects: [expect.objectContaining({ name: 'Concurrent Case edit' })],
      runtimeProfile: concurrentState.runtimeProfile,
      midsceneConfig: concurrentState.midsceneConfig,
      runDetails: [expect.objectContaining({ id: response.detail.id })],
    }));
  });

  it('runs a deterministic Case without resolving model secrets', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-deterministic-no-model-resolution', environment.id);
    project.testCases = [testCase];
    const response = runTestCaseResponse(project.id, testCase.id, environment.id);
    const loadResolvedModelConfiguration = vi.fn().mockRejectedValue(new Error('dangling model secret must stay unread'));
    const runTestCase = vi.fn().mockResolvedValue(response);
    const dependencies = createDependencies({
      loadResolvedModelConfiguration,
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, 'd'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: testCase.id, version: testCase.version },
    })).resolves.toMatchObject(response);

    expect(loadResolvedModelConfiguration).not.toHaveBeenCalled();
    expect(runTestCase).toHaveBeenCalledWith(expect.not.objectContaining({
      midsceneConfig: expect.anything(),
      agentModelConfig: expect.anything(),
    }));
  });

  it('passes a lazy resolver into an Agent Case instead of resolving all model secrets at IPC entry', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-ipc-lazy-models', environment.id);
    testCase.steps = [{ id: 'step-ipc-lazy-models', type: 'ai', title: 'Save', body: 'Click save' }];
    project.testCases = [testCase];
    const response = runTestCaseResponse(project.id, testCase.id, environment.id);
    const lazyResolver = {
      resolveMidsceneConfig: vi.fn(),
      resolveAgentProviderConfig: vi.fn(),
    };
    const createLazyModelConfigResolver = vi.fn().mockReturnValue(lazyResolver);
    const runTestCase = vi.fn().mockResolvedValue(response);
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, 'c'.repeat(64), 'projectDirectory')),
      },
      createLazyModelConfigResolver,
    } as never);
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: testCase.id, version: testCase.version },
    })).resolves.toMatchObject(response);

    expect(createLazyModelConfigResolver).toHaveBeenCalledTimes(1);
    expect(runTestCase).toHaveBeenCalledWith(expect.objectContaining({ modelConfigResolver: lazyResolver }));
    expect(lazyResolver.resolveMidsceneConfig).not.toHaveBeenCalled();
    expect(lazyResolver.resolveAgentProviderConfig).not.toHaveBeenCalled();
  });

  it('preserves a concurrent StudioState edit while a Suite run is pending', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-concurrent-suite', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-concurrent',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const response = runSuiteResponse(project.id, testCase.id, environment.id);
    const initialState = createInitialStudioState();
    const executionState = {
      ...initialState,
      runtimeProfile: { ...initialState.runtimeProfile, baseUrl: 'https://execution-suite.example.test' },
      midsceneConfig: { ...initialState.midsceneConfig, modelName: 'execution-suite-model' },
    };
    const concurrentState = {
      ...executionState,
      projects: [{ ...project, name: 'Concurrent Suite edit' }],
      runtimeProfile: { ...executionState.runtimeProfile, baseUrl: 'https://concurrent-suite.example.test' },
      midsceneConfig: { ...executionState.midsceneConfig, modelName: 'concurrent-suite-model' },
    };
    let currentState = executionState;
    const deferred = deferredResult<typeof response>();
    const runSuite = vi.fn().mockImplementation(() => {
      deferred.markStarted();
      return deferred.promise;
    });
    const dependencies = createDependencies({
      loadState: vi.fn().mockImplementation(async () => currentState),
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite,
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '2'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    const pending = handlers.get(runtimeIpcChannels.runSuite)!({}, {
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    });
    await deferred.started;
    expect(runSuite).toHaveBeenCalledWith(expect.objectContaining({
      runtimeProfile: executionState.runtimeProfile,
      modelConfigResolver: expect.any(Object),
      browserSession: executionState.browserSession,
    }));
    expect(dependencies.loadResolvedModelConfiguration).not.toHaveBeenCalled();
    currentState = concurrentState;
    deferred.resolve(response);
    await expect(pending).resolves.toMatchObject(response);

    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      projects: [expect.objectContaining({ name: 'Concurrent Suite edit' })],
      runtimeProfile: concurrentState.runtimeProfile,
      midsceneConfig: concurrentState.midsceneConfig,
      runDetails: [expect.objectContaining({ id: response.detail.caseDetails[0]!.id })],
    }));
  });

  it.each(['staleProjectRevision', 'projectRevisionChanged'] as const)(
    'serializes %s before RuntimeBundle execution',
    async (code) => {
    const project = createEmptyProject(1);
    const runTestCase = vi.fn();
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockRejectedValue(Object.assign(new Error('revision changed'), { code })),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: 'case/checkout', version: 1 },
      expectedProjectRevision: '0'.repeat(64),
      project: { ...project, id: 'forged-project' },
    } as unknown)).resolves.toEqual({
      type: 'testBuddy.runtimeError',
      code,
      message: 'revision changed',
    });

    expect(runTestCase).not.toHaveBeenCalled();
    expect(dependencies.getFixtureScriptTrustContext).not.toHaveBeenCalled();
    },
  );

  it('does not fall back to legacy loading when a bound asset source is unavailable', async () => {
    const project = createEmptyProject(1);
    const runTestCase = vi.fn();
    const load = vi.fn().mockResolvedValue(projectSnapshot(project, '5'.repeat(64), 'legacyStudioStore'));
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load,
        loadBound: vi.fn().mockRejectedValue(Object.assign(new Error('bound source unavailable'), { code: 'bindingUnavailable' })),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: 'case/checkout', version: 1 },
      expectedProjectRevision: '5'.repeat(64),
    })).rejects.toMatchObject({ code: 'bindingUnavailable' });

    expect(load).not.toHaveBeenCalled();
    expect(runTestCase).not.toHaveBeenCalled();
  });

  it('rejects a bound request when its binding disappears even if the legacy revision matches', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case/checkout',
      version: 1,
      kind: 'scenario' as const,
      name: 'Checkout',
      category: 'Regression',
      lastEdited: new Date(0).toISOString(),
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      steps: [],
    };
    project.testCases = [testCase];
    const runTestCase = vi.fn().mockResolvedValue(runTestCaseResponse(project.id, testCase.id, environment.id));
    const load = vi.fn().mockResolvedValue(projectSnapshot(project, '7'.repeat(64), 'legacyStudioStore'));
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load,
        loadBound: vi.fn().mockRejectedValue(Object.assign(new Error('unbound'), { code: 'projectUnbound' })),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: testCase.id, version: testCase.version },
      expectedProjectRevision: '7'.repeat(64),
    })).resolves.toMatchObject({
      type: 'testBuddy.runtimeError',
      code: 'projectRevisionChanged',
    });

    expect(load).not.toHaveBeenCalled();
    expect(runTestCase).not.toHaveBeenCalled();
  });

  it('rejects a missing exact Case before RuntimeBundle execution', async () => {
    const project = createEmptyProject(1);
    const runTestCase = vi.fn();
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '2'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runTestCase)!({}, {
      projectId: project.id,
      testCase: { id: 'case/missing', version: 1 },
    })).resolves.toMatchObject({ type: 'testBuddy.runtimeError', code: 'missingAssetVersion' });

    expect(runTestCase).not.toHaveBeenCalled();
  });

  it('drops renderer cancellation and trust values before running a Suite, then persists every returned Case', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-suite-1',
      version: 1,
      kind: 'scenario' as const,
      name: 'Suite Case',
      category: 'Regression',
      lastEdited: new Date(0).toISOString(),
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      steps: [],
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-1',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const testCaseVersion = testCase.version;
    const snapshot = projectSnapshot(project, '3'.repeat(64), 'projectDirectory');
    const response = runSuiteResponse(project.id, 'case-suite-1', environment.id);
    const runSuite = vi.fn().mockImplementation(async (request) => {
      request.projectSnapshot.project.testCases[0]!.version = 2;
      request.environment.url = 'https://suite-runner-mutated.example.test';
      request.environment.name = 'Suite runner mutated';
      return response;
    });
    const dependencies = createDependencies({
      getFixtureScriptTrustContext: vi.fn().mockResolvedValue({
        projectDirectory: '/projects/one',
        records: [{
          schemaVersion: 1,
          projectId: project.id,
          projectDirectory: '/projects/one',
          fixtureId: 'fixture-suite-1',
          fixtureVersion: 1,
          lifecycle: 'setup',
          relativePath: 'setup.mjs',
          contentHash: 'b'.repeat(64),
          approvedAt: new Date(0).toISOString(),
        }],
      }),
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite,
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(snapshot),
      },
    });
    const handlers = registerHandlers(dependencies);

    const result = await handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: 'suite-ipc-run',
      cancellationSignal: { aborted: true },
      fixtureScriptTrustDirectory: '/renderer-controlled',
      fixtureScriptTrustRecords: [],
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    } as unknown) as RunSuiteResponse;

    expect(result).toMatchObject({
      ...response,
      detail: expect.objectContaining({
        caseDetails: [expect.objectContaining({
          provenance: expect.objectContaining({
            testCase: { id: testCase.id, version: testCaseVersion },
            suite: { reference: { id: suite.id, version: suite.version }, parentRunId: 'suite-ipc-run' },
          }),
        })],
      }),
    });
    expect(Object.isFrozen(result.detail.caseDetails[0]!.provenance)).toBe(true);

    const runtime = dependencies.getRuntimeBundle();
    expect(dependencies.getFixtureScriptTrustContext).toHaveBeenCalledWith(project.id);
    expect(runtime.runSuite).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'suite-ipc-run',
      projectSnapshot: snapshot,
      suite,
      environment,
      fixtureScriptTrustDirectory: '/projects/one',
      fixtureScriptTrustRecords: [expect.objectContaining({ fixtureId: 'fixture-suite-1' })],
    }));
    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      runDetails: [expect.objectContaining({
        id: response.detail.caseDetails[0]!.id,
        provenance: expect.objectContaining({
          testCase: { id: testCase.id, version: testCaseVersion },
          suite: { reference: { id: suite.id, version: suite.version }, parentRunId: 'suite-ipc-run' },
        }),
      })],
      recentRuns: [expect.objectContaining({ environmentName: 'Staging' })],
      suiteRunRecords: [expect.objectContaining({
        id: 'suite-ipc-run',
        provenance: expect.objectContaining({
          projectId: project.id,
          suite: {
            reference: { id: suite.id, version: suite.version },
            parentRunId: 'suite-ipc-run',
          },
        }),
        status: 'passed',
        memberRunIds: [response.detail.caseDetails[0]!.id],
        members: [expect.objectContaining({
          testCaseId: testCase.id,
          testCaseVersion,
          status: 'passed',
          attempts: 1,
          flaky: false,
          provenance: expect.objectContaining({
            testCase: { id: testCase.id, version: testCaseVersion },
            suite: { reference: { id: suite.id, version: suite.version }, parentRunId: 'suite-ipc-run' },
          }),
        })],
        summary: {
          passed: 1,
          failed: 0,
          blocked: 0,
          skipped: 0,
          cancelled: 0,
          error: 0,
        },
      })],
    }));
  });

  it('persists every retry attempt from a Suite in latest-first history order', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-retry-1',
      version: 1,
      kind: 'scenario' as const,
      name: 'Retry Case',
      category: 'Regression',
      lastEdited: new Date(0).toISOString(),
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      steps: [],
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-retry-1',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const failedAttempt = {
      ...runTestCaseResponse(project.id, 'case-retry-1', environment.id).detail,
      id: 'attempt-1',
      testCaseVersion: testCase.version,
      status: 'failed' as const,
      summary: 'Failed',
    };
    const passedAttempt = {
      ...runTestCaseResponse(project.id, 'case-retry-1', environment.id).detail,
      id: 'attempt-2',
      testCaseVersion: testCase.version,
      status: 'passed' as const,
      summary: 'Passed',
    };
    const response = {
      runId: 'suite-retry-run',
      title: 'Suite retry',
      detail: {
        suite: {
          suiteId: 'suite-retry-1',
          suiteVersion: 1,
          environmentId: environment.id,
          status: 'passed' as const,
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          effectiveConcurrency: 1,
          results: [{
            testCaseId: 'case-retry-1',
            testCaseVersion: 1,
            status: 'passed' as const,
            summary: 'Passed after retry',
            attempts: 2,
            flaky: true,
            runId: 'attempt-2',
          }],
          issues: [],
        },
        caseDetails: [failedAttempt, passedAttempt],
      },
    };
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn().mockResolvedValue(response),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '4'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: 'suite-retry-run',
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    } as unknown)).resolves.toMatchObject(response);

    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      runDetails: expect.arrayContaining([expect.objectContaining({ id: 'attempt-2' }), expect.objectContaining({ id: 'attempt-1' })]),
      recentRuns: expect.arrayContaining([expect.objectContaining({ id: 'attempt-2' }), expect.objectContaining({ id: 'attempt-1' })]),
    }));
    const savedState = dependencies.saveState.mock.calls.at(-1)![0];
    expect(savedState.runDetails.map((detail: { id: string }) => detail.id)).toEqual(['attempt-2', 'attempt-1']);
    expect(savedState.recentRuns.map((run: { id: string }) => run.id)).toEqual(['attempt-2', 'attempt-1']);
    expect(savedState.runDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'attempt-1',
        provenance: expect.objectContaining({ testCase: { id: testCase.id, version: testCase.version } }),
      }),
      expect.objectContaining({
        id: 'attempt-2',
        provenance: expect.objectContaining({ testCase: { id: testCase.id, version: testCase.version } }),
      }),
    ]));
  });

  it('persists same-ID Suite Case versions with distinct exact frozen provenance', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const caseV1 = { ...createTestCase(project, 'case/versioned', environment.id), version: 1, name: 'Version one' };
    const caseV2 = { ...caseV1, version: 2, name: 'Version two' };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite/versioned',
      version: 1,
      environmentId: environment.id,
      caseReferences: [
        { id: caseV1.id, version: caseV1.version, dependsOn: [] },
        { id: caseV2.id, version: caseV2.version, dependsOn: [] },
      ],
    };
    project.testCases = [caseV1, caseV2];
    project.suites = [suite];
    const firstDetail = {
      ...runTestCaseResponse(project.id, caseV1.id, environment.id).detail,
      id: 'suite-versioned-run-case-versioned@1-attempt-1',
      testCaseVersion: 1,
    };
    const secondDetail = {
      ...runTestCaseResponse(project.id, caseV2.id, environment.id).detail,
      id: 'suite-versioned-run-case-versioned@2-attempt-1',
      testCaseVersion: 2,
    };
    const response = {
      runId: 'suite-versioned-run',
      title: 'Versioned Suite',
      detail: {
        suite: {
          suiteId: suite.id,
          suiteVersion: suite.version,
          environmentId: environment.id,
          status: 'passed' as const,
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          effectiveConcurrency: 1,
          results: [
            { testCaseId: caseV1.id, testCaseVersion: 1, status: 'passed' as const, summary: 'v1', attempts: 1, flaky: false, runId: firstDetail.id },
            { testCaseId: caseV2.id, testCaseVersion: 2, status: 'passed' as const, summary: 'v2', attempts: 1, flaky: false, runId: secondDetail.id },
          ],
          issues: [],
        },
        caseDetails: [firstDetail, secondDetail],
      },
    };
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn().mockResolvedValue(response),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '6'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: response.runId,
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    })).resolves.toMatchObject(response);

    const savedState = dependencies.saveState.mock.calls.at(-1)![0];
    expect(savedState.runDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: firstDetail.id,
        provenance: expect.objectContaining({ testCase: { id: caseV1.id, version: 1 } }),
      }),
      expect.objectContaining({
        id: secondDetail.id,
        provenance: expect.objectContaining({ testCase: { id: caseV2.id, version: 2 } }),
      }),
    ]));
    expect(new Set(savedState.runDetails.map((detail: { id: string }) => detail.id)).size).toBe(2);
  });

  it.each([
    ['cancellation', () => new RunCancelledError(), 'cancelled', 'userCancelled'],
    ['executor error', () => new Error('runtime crashed'), 'error', 'executorError'],
  ] as const)('terminalizes a Suite parent when RuntimeBundle rejects with %s', async (_label, createError, status, reasonCode) => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-rejected-suite', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-rejected',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const rejection = createError();
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn().mockRejectedValue(rejection),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '7'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: 'suite-rejected-run',
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    })).rejects.toBe(rejection);

    const savedState = dependencies.saveState.mock.calls.at(-1)![0];
    expect(savedState.runDetails).toEqual([]);
    expect(savedState.suiteRunRecords).toEqual([
      expect.objectContaining({
        id: 'suite-rejected-run',
        status,
        reasonCode,
        finishedAt: expect.any(String),
        memberRunIds: [],
        members: [],
      }),
    ]);
  });

  it('persists a completed Suite child and parent linkage before a later Suite executor rejection', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-progress-before-rejection', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-progress-before-rejection',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const childDetail = {
      ...runSuiteResponse(project.id, testCase.id, environment.id).detail.caseDetails[0]!,
      id: 'suite-progress-child-run',
      testCaseId: testCase.id,
      testCaseVersion: testCase.version,
      title: testCase.name,
    };
    const rejection = new Error('runtime crashed after a completed child');
    let persistedState = createInitialStudioState();
    const loadState = vi.fn(async () => persistedState);
    const saveState = vi.fn(async (nextState: StudioState) => {
      persistedState = nextState;
    });
    const runSuite = vi.fn().mockImplementation(async (request) => {
      await request.onCaseCompleted(childDetail, 1);
      throw rejection;
    });
    const dependencies = createDependencies({
      loadState,
      saveState,
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite,
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, 'c'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: 'suite-progress-before-rejection-run',
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    })).rejects.toBe(rejection);

    expect(runSuite).toHaveBeenCalledWith(expect.objectContaining({ onCaseCompleted: expect.any(Function) }));
    expect(persistedState.runDetails).toEqual([
      expect.objectContaining({
        id: childDetail.id,
        testCaseVersion: testCase.version,
        provenance: expect.objectContaining({
          testCase: { id: testCase.id, version: testCase.version },
          suite: { reference: { id: suite.id, version: suite.version }, parentRunId: 'suite-progress-before-rejection-run' },
        }),
      }),
    ]);
    expect(Object.isFrozen(persistedState.runDetails[0]!.provenance)).toBe(true);
    expect(persistedState.suiteRunRecords).toEqual([
      expect.objectContaining({
        id: 'suite-progress-before-rejection-run',
        status: 'error',
        memberRunIds: [childDetail.id],
        members: [expect.objectContaining({
          testCaseId: testCase.id,
          testCaseVersion: testCase.version,
          runId: childDetail.id,
          status: 'passed',
        })],
        summary: { passed: 1, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
      }),
    ]);
  });

  it('persists a terminal Suite parent before fixture trust resolution rejects', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-fixture-trust-rejected', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-fixture-trust-rejected',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    let persistedState = createInitialStudioState();
    const loadState = vi.fn(async () => persistedState);
    const saveState = vi.fn(async (nextState: StudioState) => {
      persistedState = nextState;
    });
    const fixtureTrustFailure = new Error('fixture trust lookup failed');
    const getRuntimeBundle = vi.fn();
    const dependencies = createDependencies({
      loadState,
      saveState,
      getFixtureScriptTrustContext: vi.fn().mockRejectedValue(fixtureTrustFailure),
      getRuntimeBundle,
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, 'b'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: 'suite-fixture-trust-rejected-run',
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    })).rejects.toBe(fixtureTrustFailure);

    expect(getRuntimeBundle).not.toHaveBeenCalled();
    expect(saveState).toHaveBeenCalledTimes(2);
    expect(persistedState.suiteRunRecords).toEqual([
      expect.objectContaining({
        id: 'suite-fixture-trust-rejected-run',
        status: 'error',
        reasonCode: 'executorError',
        finishedAt: expect.any(String),
        memberRunIds: [],
        members: [],
        provenance: expect.objectContaining({
          projectId: project.id,
          projectRevision: 'b'.repeat(64),
          suite: { reference: { id: suite.id, version: suite.version }, parentRunId: 'suite-fixture-trust-rejected-run' },
        }),
      }),
    ]);
    expect(Object.isFrozen(persistedState.suiteRunRecords[0]!.provenance)).toBe(true);
    await expect(handlers.get(runtimeIpcChannels.loadSuiteRunRecord)!({}, 'suite-fixture-trust-rejected-run')).resolves.toMatchObject({
      id: 'suite-fixture-trust-rejected-run',
      status: 'error',
      reasonCode: 'executorError',
    });
  });

  it('preserves the original Suite runtime rejection when terminal parent persistence also fails', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-terminal-persistence-failure', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-terminal-persistence-failure',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const runtimeFailure = new Error('runtime crashed');
    const persistenceFailure = new Error('history storage unavailable');
    const saveState = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(persistenceFailure);
    const dependencies = createDependencies({
      saveState,
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn().mockRejectedValue(runtimeFailure),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, 'a'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: 'suite-terminal-persistence-failure-run',
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    })).rejects.toBe(runtimeFailure);

    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState.mock.calls[1]![0].suiteRunRecords).toEqual([
      expect.objectContaining({
        id: 'suite-terminal-persistence-failure-run',
        status: 'error',
        reasonCode: 'executorError',
      }),
    ]);
  });

  it('propagates a successful Suite persistence failure without overwriting its completed parent record', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-persistence-failure', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-persistence-failure',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const response = {
      ...runSuiteResponse(project.id, testCase.id, environment.id),
      runId: 'suite-persistence-failure-run',
      detail: {
        ...runSuiteResponse(project.id, testCase.id, environment.id).detail,
        suite: {
          ...runSuiteResponse(project.id, testCase.id, environment.id).detail.suite,
          suiteId: suite.id,
          suiteVersion: suite.version,
        },
      },
    };
    const persistenceFailure = new Error('history storage unavailable');
    const saveState = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(persistenceFailure);
    const runSuite = vi.fn().mockResolvedValue(response);
    const dependencies = createDependencies({
      saveState,
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite,
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '8'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: response.runId,
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    })).rejects.toBe(persistenceFailure);

    expect(runSuite).toHaveBeenCalledTimes(1);
    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState.mock.calls[0]![0].suiteRunRecords).toEqual([
      expect.objectContaining({ id: response.runId, status: 'running' }),
    ]);
    expect(saveState.mock.calls[1]![0].suiteRunRecords).toEqual([
      expect.objectContaining({ id: response.runId, status: 'passed' }),
    ]);
  });

  it('generates a distinct parent Suite run ID when callers omit one', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-generated-run-id', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-generated-run-id',
      version: 1,
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const runSuite = vi.fn().mockImplementation(async (request) => ({
      ...runSuiteResponse(project.id, testCase.id, environment.id),
      runId: request.runId,
      detail: {
        ...runSuiteResponse(project.id, testCase.id, environment.id).detail,
        suite: {
          ...runSuiteResponse(project.id, testCase.id, environment.id).detail.suite,
          suiteId: suite.id,
          suiteVersion: suite.version,
        },
      },
    }));
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite,
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, '9'.repeat(64), 'projectDirectory')),
      },
    });
    const handlers = registerHandlers(dependencies);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    try {
      await handlers.get(runtimeIpcChannels.runSuite)!({}, {
        projectId: project.id,
        suite: { id: suite.id, version: suite.version },
      });
      await handlers.get(runtimeIpcChannels.runSuite)!({}, {
        projectId: project.id,
        suite: { id: suite.id, version: suite.version },
      });

      const firstRunId = runSuite.mock.calls[0]![0].runId;
      const secondRunId = runSuite.mock.calls[1]![0].runId;
      expect(firstRunId).toEqual(expect.any(String));
      expect(secondRunId).toEqual(expect.any(String));
      expect(secondRunId).not.toBe(firstRunId);
      expect(dependencies.saveState.mock.calls[0]![0].suiteRunRecords[0]!.id).toBe(firstRunId);
      expect(dependencies.saveState.mock.calls[2]![0].suiteRunRecords[0]!.id).toBe(secondRunId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards a Suite run ID to the RuntimeBundle cancellation API', async () => {
    const cancelRun = vi.fn().mockReturnValue(true);
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite: vi.fn(),
        cancelRun,
      }),
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.cancelRun)!({}, 'suite-1')).resolves.toBe(true);

    expect(cancelRun).toHaveBeenCalledWith('suite-1');
  });

  it('plans and executes a historical rerun from stored provenance without accepting renderer assets', async () => {
    const project = createEmptyProject(1);
    project.id = 'project-history';
    const environment = project.environments[0]!;
    const testCase = { ...createTestCase(project, 'case-history', environment.id), version: 2, name: 'Frozen Case v2' };
    project.testCases = [testCase];
    const state = createInitialStudioState();
    state.runDetails = [{
      ...runTestCaseResponse(project.id, testCase.id, environment.id).detail,
      id: 'run-history',
      testCaseVersion: 2,
      provenance: {
        schemaVersion: 1,
        projectId: project.id,
        projectRevision: 'a'.repeat(64),
        source: 'projectDirectory',
        reproducibility: 'versioned',
        testCase: { id: testCase.id, version: 2 },
        fixtures: [], reusableFlows: [], baselines: [],
        environment: { id: environment.id, name: environment.name, baseUrl: environment.url },
        browserProfile: { engine: environment.browser, headless: environment.headless },
        executor: { appVersion: 'test-buddy-desktop', runnerVersion: 'runtime-bundle-v1' },
        model: { hasKey: false },
        createdAt: '2026-08-17T00:00:00.000Z',
      },
    }];
    const runTestCase = vi.fn().mockResolvedValue({
      ...runTestCaseResponse(project.id, testCase.id, environment.id),
      runId: 'run-history-rerun',
      detail: {
        ...runTestCaseResponse(project.id, testCase.id, environment.id).detail,
        id: 'run-history-rerun',
        testCaseId: testCase.id,
        testCaseVersion: 2,
      },
    });
    const dependencies = createDependencies({
      loadState: vi.fn().mockResolvedValue(state),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, 'a'.repeat(64), 'projectDirectory')),
      },
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => state.browserSession },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
    });
    const handlers = registerHandlers(dependencies);

    const plan = await handlers.get(runtimeIpcChannels.planHistoricalRerun)!({}, 'run-history');
    expect(plan).toEqual({ status: 'ready', runId: 'run-history' });
    expect(plan).not.toHaveProperty('testCase');
    expect(runTestCase).not.toHaveBeenCalled();

    await expect(handlers.get(runtimeIpcChannels.runHistoricalRerun)!({}, 'run-history')).resolves.toMatchObject({
      status: 'completed',
      response: {
        runId: 'run-history-rerun',
        detail: {
          provenance: expect.objectContaining({
            projectRevision: 'a'.repeat(64),
            testCase: { id: testCase.id, version: 2 },
          }),
        },
      },
    });
    expect(runTestCase).toHaveBeenCalledWith(expect.objectContaining({
      projectSnapshot: expect.objectContaining({ revision: 'a'.repeat(64) }),
      testCase: expect.objectContaining({ id: testCase.id, version: 2, name: 'Frozen Case v2' }),
      environment: expect.objectContaining({ id: environment.id }),
    }));
  });

  it('blocks a legacy historical rerun before requesting the browser runtime', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const state = createInitialStudioState();
    state.runDetails = [{
      ...runTestCaseResponse(project.id, 'case-legacy', environment.id).detail,
      id: 'run-legacy',
    }];
    const runTestCase = vi.fn();
    const dependencies = createDependencies({
      loadState: vi.fn().mockResolvedValue(state),
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => state.browserSession },
        runTestCase,
        runSuite: vi.fn(),
        cancelRun: vi.fn(),
      }),
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.planHistoricalRerun)!({}, 'run-legacy')).resolves.toMatchObject({
      status: 'blocked',
      runId: 'run-legacy',
      reason: { code: 'legacyAmbiguousNeutral' },
      missingReferences: [],
    });
    await expect(handlers.get(runtimeIpcChannels.runHistoricalRerun)!({}, 'run-legacy')).resolves.toMatchObject({
      status: 'blocked',
      runId: 'run-legacy',
    });
    expect(runTestCase).not.toHaveBeenCalled();
  });

  it('exposes the public desktop-main Suite execution boundary used by IPC', async () => {
    expect(typeof executeDesktopSuiteIntent).toBe('function');
    if (!executeDesktopSuiteIntent) {
      return;
    }
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = createTestCase(project, 'case-public-desktop-boundary', environment.id);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-public-desktop-boundary',
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const response = runSuiteResponse(project.id, testCase.id, environment.id);
    const runSuite = vi.fn().mockResolvedValue(response);
    const dependencies = createDependencies({
      getRuntimeBundle: vi.fn().mockReturnValue({
        artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
        browserRuntime: { getState: () => ({ status: 'idle' }) },
        runTestCase: vi.fn(),
        runSuite,
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(projectSnapshot(project, 'b'.repeat(64), 'projectDirectory')),
      },
    });

    await expect(executeDesktopSuiteIntent(dependencies, {
      runId: 'suite-public-desktop-boundary',
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    })).resolves.toMatchObject(response);
    expect(runSuite).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'suite-public-desktop-boundary',
      suite: expect.objectContaining({ id: suite.id, version: suite.version }),
    }));
  });
});

const registerHandlers = (dependencies: RuntimeIpcDependencies) => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerRuntimeIpcHandlers({
    ...dependencies,
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, listener),
  });
  return handlers;
};

const createDependencies = (overrides: Partial<RuntimeIpcDependencies> = {}): RuntimeIpcDependencies => {
  const state = createInitialStudioState();
  const project = createEmptyProject(0);
  const loadState = overrides.loadState ?? vi.fn().mockResolvedValue(state);
  return {
    loadState,
    saveState: vi.fn().mockResolvedValue(undefined),
    getRuntimeBundle: vi.fn().mockReturnValue({
      artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
      browserRuntime: { getState: () => ({ status: 'idle' }) },
      runTestCase: vi.fn(),
      runSuite: vi.fn(),
      cancelRun: vi.fn(),
    }),
    loadResolvedModelConfiguration: vi.fn().mockImplementation(async () => {
      const current = await loadState();
      return {
        state: current,
        modelConfigs: {
          midsceneConfig: {
            ...current.midsceneConfig,
            modelApiKey: 'test-only-main-process-midscene-key',
          },
          agentModelConfig: resolvedAgentModelConfig(current),
        },
      };
    }),
    createLazyModelConfigResolver: vi.fn().mockReturnValue({
      resolveMidsceneConfig: vi.fn(),
      resolveAgentProviderConfig: vi.fn(),
    }),
    projectRepository: {
      load: vi.fn().mockResolvedValue(projectSnapshot(project, 'f'.repeat(64), 'legacyStudioStore')),
      loadBound: vi.fn().mockRejectedValue(Object.assign(new Error('unbound'), { code: 'projectUnbound' })),
    },
    getFixtureScriptTrustContext: vi.fn().mockResolvedValue({ records: [] }),
    openPath: vi.fn().mockResolvedValue(''),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    getDownloadsPath: vi.fn().mockReturnValue('/downloads'),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    getRuntimeInfo: vi.fn().mockReturnValue({ platform: 'desktop', persistence: 'file' }),
    maintenanceService: {
      createFromRun: vi.fn(),
      accept: vi.fn(),
      reject: vi.fn(),
      openEvidence: vi.fn(),
    },
    ...overrides,
  };
};

const resolvedAgentModelConfig = (state: ReturnType<typeof createInitialStudioState>) => {
  return {
    planner: { ...state.agentModelConfig.planner, modelApiKey: 'test-only-main-process-planner-key' },
    executor: { ...state.agentModelConfig.executor, modelApiKey: 'test-only-main-process-executor-key' },
    verifier: { ...state.agentModelConfig.verifier, modelApiKey: 'test-only-main-process-verifier-key' },
    reporter: { ...state.agentModelConfig.reporter, modelApiKey: 'test-only-main-process-reporter-key' },
  };
};

const projectSnapshot = (
  project: ProjectDraft,
  revision: string,
  source: 'projectDirectory' | 'legacyStudioStore',
) => {
  return {
    project,
    revision,
    source,
    reproducibility: source === 'projectDirectory' ? 'versioned' as const : 'legacy' as const,
  };
};

const createTestCase = (project: ProjectDraft, id: string, environmentId: string) => {
  return {
    id,
    version: 1,
    kind: 'scenario' as const,
    name: id,
    category: 'Regression',
    lastEdited: new Date(0).toISOString(),
    url: project.environments.find((environment) => environment.id === environmentId)?.url ?? '',
    notes: '',
    groupId: project.groups[0]!.id,
    environmentId,
    source: 'manual' as const,
    steps: [],
  };
};

const deferredResult = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let markStarted: () => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  const started = new Promise<void>((nextResolve) => {
    markStarted = nextResolve;
  });
  return { promise, resolve, started, markStarted };
};

const loadRuntimeIpcHandlers = (): {
  executeDesktopSuiteIntent?: (dependencies: RuntimeIpcDependencies, request: {
    runId?: string;
    projectId: string;
    suite: { id: string; version: number };
    expectedProjectRevision?: string;
  }) => Promise<RunSuiteResponse>;
  registerRuntimeIpcHandlers: (dependencies: RuntimeIpcDependencies) => void;
  runtimeIpcChannels: {
    getInfo: string;
    runTestCase: string;
    runSuite: string;
    cancelRun: string;
    loadRunDetail: string;
    loadSuiteRunRecord: string;
    listMaintenanceDrafts: string;
    createMaintenanceDraft: string;
    acceptMaintenanceDraft: string;
    rejectMaintenanceDraft: string;
    openMaintenanceEvidence: string;
    planArtifactRetention: string;
    confirmArtifactRetention: string;
    planHistoricalRerun: string;
    runHistoricalRerun: string;
    openArtifact: string;
    exportArtifact: string;
    attachManualEvidence: string;
  };
} => {
  const ipcDirectory = path.join(process.cwd(), 'electron', 'ipc');
  const compile = (sourcePath: string) => ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const channelModule = { exports: {} as { runtimeIpcChannels?: unknown } };
  new Function('module', 'exports', compile(path.join(ipcDirectory, 'runtime-ipc-channels.cts')))(channelModule, channelModule.exports);

  const runHistoryModule = { exports: {} as { appendRunToStudioState?: unknown; appendSuiteRunToStudioState?: unknown } };
  new Function('module', 'exports', compile(path.join(process.cwd(), 'electron', 'runtime', 'run-history.ts')))(
    runHistoryModule,
    runHistoryModule.exports,
  );

  const runProvenanceModule = { exports: {} as Record<string, unknown> };
  const runProvenanceRequire = (moduleId: string) => {
    if (moduleId === 'node:crypto') {
      return crypto;
    }
    if (moduleId === '../../shared/studio.js') {
      return { findTestCaseVersion };
    }
    if (moduleId === '../projectRepository.js') {
      return { ProjectRepositoryError };
    }
    throw new Error(`Unexpected run provenance dependency: ${moduleId}`);
  };
  new Function('require', 'module', 'exports', compile(path.join(process.cwd(), 'electron', 'runtime', 'run-provenance.ts')))(
    runProvenanceRequire,
    runProvenanceModule,
    runProvenanceModule.exports,
  );

  const handlerModule = { exports: {} as Record<string, unknown> };
  const require = (moduleId: string) => {
    if (moduleId === 'node:crypto') {
      return crypto;
    }
    if (moduleId === 'node:path') {
      return path;
    }
    if (moduleId === './runtime-ipc-channels.cjs') {
      return channelModule.exports;
    }
    if (moduleId === '../runtime/run-history.js') {
      return runHistoryModule.exports;
    }
    if (moduleId === '../runtime/run-provenance.js') {
      return runProvenanceModule.exports;
    }
    if (moduleId === '../runtime/run-cancellation.js') {
      return { RunCancelledError, isRunCancelled };
    }
    if (moduleId === '../../shared/studio.js') {
      return { findSuiteAsset, findTestCaseVersion, isAgentRunnableTestCase };
    }
    if (moduleId === '../../shared/maintenance.js') {
      return { isSafeMaintenanceRationale };
    }
    if (moduleId === '../projectRepository.js') {
      return { ProjectRepositoryError };
    }
    throw new Error(`Unexpected runtime IPC dependency: ${moduleId}`);
  };
  new Function('require', 'module', 'exports', compile(path.join(ipcDirectory, 'runtime-ipc-handlers.ts')))(
    require,
    handlerModule,
    handlerModule.exports,
  );

  return handlerModule.exports as unknown as ReturnType<typeof loadRuntimeIpcHandlers>;
};

({ executeDesktopSuiteIntent, registerRuntimeIpcHandlers, runtimeIpcChannels } = loadRuntimeIpcHandlers());

const runTestCaseResponse = (projectId: string, testCaseId: string, environmentId: string): RunTestCaseResponse => {
  return {
    runId: 'run-1',
    title: 'Case one',
    detail: {
      id: 'run-1',
      projectId,
      testCaseId,
      environmentId,
      title: 'Case one',
      status: 'passed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:00',
      summary: 'Passed',
      logs: [],
      steps: [],
      artifacts: [],
    },
  };
};

const runSuiteResponse = (projectId: string, testCaseId: string, environmentId: string) => {
  return {
    runId: 'suite-run-1',
    title: 'Suite one',
    detail: {
      suite: {
        suiteId: 'suite-1',
        suiteVersion: 1,
        environmentId,
        status: 'passed' as const,
        startedAt: new Date(0).toISOString(),
        endedAt: new Date(0).toISOString(),
        effectiveConcurrency: 1,
        results: [{
          testCaseId,
          testCaseVersion: 1,
          status: 'passed' as const,
          summary: 'Passed',
          attempts: 1,
          flaky: false,
          runId: 'suite-case-run-1',
        }],
        issues: [],
      },
      caseDetails: [{
        ...runTestCaseResponse(projectId, testCaseId, environmentId).detail,
        testCaseVersion: 1,
      }],
    },
  };
};
