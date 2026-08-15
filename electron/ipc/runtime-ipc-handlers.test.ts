import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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
  type ProjectDraft,
  type RunTestCaseResponse,
} from '../../shared/studio.js';
import { executeCliCommand } from '../cli.js';
import { ProjectAssetStore } from '../projectAssetStore.js';
import { ProjectRepository, ProjectRepositoryError } from '../projectRepository.js';
import * as runtimeBundle from '../runtime/runtime-bundle.js';
import { StudioStore } from '../studioStore.js';

const { registerRuntimeIpcHandlers, runtimeIpcChannels } = loadRuntimeIpcHandlers();

type RuntimeIpcDependencies = {
  handle: (channel: string, listener: (event: unknown, ...args: never[]) => unknown) => void;
  loadState: ReturnType<typeof vi.fn>;
  saveState: ReturnType<typeof vi.fn>;
  getRuntimeBundle: ReturnType<typeof vi.fn>;
  projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>;
  getFixtureScriptTrustContext: ReturnType<typeof vi.fn>;
  openPath: ReturnType<typeof vi.fn>;
  showSaveDialog: ReturnType<typeof vi.fn>;
  getDownloadsPath: ReturnType<typeof vi.fn>;
  showOpenDialog: ReturnType<typeof vi.fn>;
  getRuntimeInfo: ReturnType<typeof vi.fn>;
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
      runtimeIpcChannels.openArtifact,
      runtimeIpcChannels.exportArtifact,
      runtimeIpcChannels.attachManualEvidence,
    ]);
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
    } as unknown)).resolves.toEqual(response);

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
      runDetails: [response.detail],
      recentRuns: [expect.objectContaining({
        id: response.runId,
        environmentId: environment.id,
      })],
    }));
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
      midsceneConfig: executionState.midsceneConfig,
      agentModelConfig: executionState.agentModelConfig,
      browserSession: executionState.browserSession,
    }));
    currentState = concurrentState;
    deferred.resolve(response);
    await expect(pending).resolves.toEqual(response);

    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      projects: [expect.objectContaining({ name: 'Concurrent Case edit' })],
      runtimeProfile: concurrentState.runtimeProfile,
      midsceneConfig: concurrentState.midsceneConfig,
      runDetails: [response.detail],
    }));
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
      midsceneConfig: executionState.midsceneConfig,
      agentModelConfig: executionState.agentModelConfig,
      browserSession: executionState.browserSession,
    }));
    currentState = concurrentState;
    deferred.resolve(response);
    await expect(pending).resolves.toEqual(response);

    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      projects: [expect.objectContaining({ name: 'Concurrent Suite edit' })],
      runtimeProfile: concurrentState.runtimeProfile,
      midsceneConfig: concurrentState.midsceneConfig,
      runDetails: [response.detail.caseDetails[0]],
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
    const snapshot = projectSnapshot(project, '3'.repeat(64), 'projectDirectory');
    const response = runSuiteResponse(project.id, 'case-suite-1', environment.id);
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
        runSuite: vi.fn().mockResolvedValue(response),
        cancelRun: vi.fn(),
      }),
      projectRepository: {
        load: vi.fn(),
        loadBound: vi.fn().mockResolvedValue(snapshot),
      },
    });
    const handlers = registerHandlers(dependencies);

    await expect(handlers.get(runtimeIpcChannels.runSuite)!({}, {
      runId: 'suite-ipc-run',
      cancellationSignal: { aborted: true },
      fixtureScriptTrustDirectory: '/renderer-controlled',
      fixtureScriptTrustRecords: [],
      projectId: project.id,
      suite: { id: suite.id, version: suite.version },
    } as unknown)).resolves.toEqual(response);

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
      runDetails: [response.detail.caseDetails[0]],
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
      status: 'failed' as const,
      summary: 'Failed',
    };
    const passedAttempt = {
      ...runTestCaseResponse(project.id, 'case-retry-1', environment.id).detail,
      id: 'attempt-2',
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
    } as unknown)).resolves.toEqual(response);

    expect(dependencies.saveState).toHaveBeenCalledWith(expect.objectContaining({
      runDetails: expect.arrayContaining([expect.objectContaining({ id: 'attempt-2' }), expect.objectContaining({ id: 'attempt-1' })]),
      recentRuns: expect.arrayContaining([expect.objectContaining({ id: 'attempt-2' }), expect.objectContaining({ id: 'attempt-1' })]),
    }));
    const savedState = dependencies.saveState.mock.calls[0]![0];
    expect(savedState.runDetails.map((detail: { id: string }) => detail.id)).toEqual(['attempt-2', 'attempt-1']);
    expect(savedState.recentRuns.map((run: { id: string }) => run.id)).toEqual(['attempt-2', 'attempt-1']);
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
});

function registerHandlers(dependencies: RuntimeIpcDependencies) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerRuntimeIpcHandlers({
    ...dependencies,
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, listener),
  });
  return handlers;
}

function createDependencies(overrides: Partial<RuntimeIpcDependencies> = {}): RuntimeIpcDependencies {
  const state = createInitialStudioState();
  const project = createEmptyProject(0);
  return {
    loadState: vi.fn().mockResolvedValue(state),
    saveState: vi.fn().mockResolvedValue(undefined),
    getRuntimeBundle: vi.fn().mockReturnValue({
      artifactManager: { isManagedArtifactPath: () => true, exportArtifact: vi.fn(), importManualEvidence: vi.fn() },
      browserRuntime: { getState: () => ({ status: 'idle' }) },
      runTestCase: vi.fn(),
      runSuite: vi.fn(),
      cancelRun: vi.fn(),
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
    ...overrides,
  };
}

function projectSnapshot(
  project: ProjectDraft,
  revision: string,
  source: 'projectDirectory' | 'legacyStudioStore',
) {
  return {
    project,
    revision,
    source,
    reproducibility: source === 'projectDirectory' ? 'versioned' as const : 'legacy' as const,
  };
}

function createTestCase(project: ProjectDraft, id: string, environmentId: string) {
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
}

function deferredResult<T>() {
  let resolve: (value: T) => void = () => undefined;
  let markStarted: () => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  const started = new Promise<void>((nextResolve) => {
    markStarted = nextResolve;
  });
  return { promise, resolve, started, markStarted };
}

function loadRuntimeIpcHandlers(): {
  registerRuntimeIpcHandlers: (dependencies: RuntimeIpcDependencies) => void;
  runtimeIpcChannels: {
    getInfo: string;
    runTestCase: string;
    runSuite: string;
    cancelRun: string;
    loadRunDetail: string;
    openArtifact: string;
    exportArtifact: string;
    attachManualEvidence: string;
  };
} {
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

  const runHistoryModule = { exports: {} as { appendRunToStudioState?: unknown } };
  new Function('module', 'exports', compile(path.join(process.cwd(), 'electron', 'runtime', 'run-history.ts')))(
    runHistoryModule,
    runHistoryModule.exports,
  );

  const handlerModule = { exports: {} as Record<string, unknown> };
  const require = (moduleId: string) => {
    if (moduleId === 'node:path') {
      return path;
    }
    if (moduleId === './runtime-ipc-channels.cjs') {
      return channelModule.exports;
    }
    if (moduleId === '../runtime/run-history.js') {
      return runHistoryModule.exports;
    }
    if (moduleId === '../../shared/studio.js') {
      return { findSuiteAsset, findTestCaseVersion };
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
}

function runTestCaseResponse(projectId: string, testCaseId: string, environmentId: string): RunTestCaseResponse {
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
}

function runSuiteResponse(projectId: string, testCaseId: string, environmentId: string) {
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
      caseDetails: [runTestCaseResponse(projectId, testCaseId, environmentId).detail],
    },
  };
}
