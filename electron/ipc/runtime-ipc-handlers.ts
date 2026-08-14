import path from 'node:path';

import type {
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';

import type {
  FixtureScriptTrustRecord,
  ProjectEnvironment,
  RunDetail,
  RunSuiteResponse,
  RunSuiteIntent,
  RunTestCaseIntent,
  RunTestCaseResponse,
  RuntimeInfo,
  StudioState,
} from '../../shared/studio.js';
import { findSuiteAsset, findTestCaseVersion } from '../../shared/studio.js';
import type { ProjectRepository, ProjectSnapshot } from '../projectRepository.js';
import { appendRunToStudioState } from '../runtime/run-history.js';
import type { ResolvedRunSuiteRequest, ResolvedRunTestCaseRequest, RuntimeBundle } from '../runtime/runtime-bundle.js';
import channelModule from './runtime-ipc-channels.cjs';

const { runtimeIpcChannels } = channelModule;

export { runtimeIpcChannels };

type RuntimeIpcChannel = (typeof runtimeIpcChannels)[keyof typeof runtimeIpcChannels];

interface RuntimeIpcArguments {
  [runtimeIpcChannels.getInfo]: [];
  [runtimeIpcChannels.runTestCase]: [RunTestCaseIntent];
  [runtimeIpcChannels.runSuite]: [RunSuiteIntent];
  [runtimeIpcChannels.cancelRun]: [string];
  [runtimeIpcChannels.loadRunDetail]: [string];
  [runtimeIpcChannels.openArtifact]: [string];
  [runtimeIpcChannels.exportArtifact]: [string];
  [runtimeIpcChannels.attachManualEvidence]: [];
}

export interface RuntimeIpcRegistrar {
  handle<Channel extends RuntimeIpcChannel>(
    channel: Channel,
    listener: (event: unknown, ...args: RuntimeIpcArguments[Channel]) => unknown,
  ): void;
}

type RuntimeIpcBundle = Pick<RuntimeBundle, 'runTestCase' | 'runSuite' | 'cancelRun'> & {
  artifactManager: Pick<RuntimeBundle['artifactManager'], 'isManagedArtifactPath' | 'exportArtifact' | 'importManualEvidence'>;
  browserRuntime: Pick<RuntimeBundle['browserRuntime'], 'getState'>;
};

export interface RuntimeIpcDependencies extends RuntimeIpcRegistrar {
  loadState: () => Promise<StudioState>;
  saveState: (state: StudioState) => Promise<void>;
  getRuntimeBundle: () => RuntimeIpcBundle;
  projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>;
  getFixtureScriptTrustContext: (projectId: string) => Promise<{
    projectDirectory?: string;
    records: FixtureScriptTrustRecord[];
  }>;
  openPath: (artifactPath: string) => Promise<string>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  getDownloadsPath: () => string;
  showOpenDialog: (event: unknown, options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  getRuntimeInfo: () => RuntimeInfo;
}

export class RunIntentResolutionError extends Error {
  constructor(
    readonly code: 'missingAssetVersion',
    message: string,
  ) {
    super(message);
    this.name = 'RunIntentResolutionError';
  }
}

export function registerRuntimeIpcHandlers(dependencies: RuntimeIpcDependencies): void {
  dependencies.handle(runtimeIpcChannels.getInfo, async () => dependencies.getRuntimeInfo());

  dependencies.handle(runtimeIpcChannels.runTestCase, async (_event, request) => {
    const projectSnapshot = await loadProjectSnapshot(dependencies.projectRepository, request.projectId, request.expectedProjectRevision);
    const testCase = findTestCaseVersion(projectSnapshot.project, request.testCase);
    if (!testCase) {
      throw new RunIntentResolutionError('missingAssetVersion', `未找到 Case：${request.testCase.id}@${request.testCase.version}。`);
    }
    const environment = findEnvironment(projectSnapshot, testCase.environmentId, `Case ${testCase.id}@${testCase.version}`);
    const state = await dependencies.loadState();
    const scriptTrust = await dependencies.getFixtureScriptTrustContext(request.projectId);
    const runtime = dependencies.getRuntimeBundle();
    const resolvedRequest: ResolvedRunTestCaseRequest = {
      ...(request.runId ? { runId: request.runId } : {}),
      projectSnapshot,
      testCase,
      environment,
      runtimeProfile: state.runtimeProfile,
      midsceneConfig: state.midsceneConfig,
      agentModelConfig: state.agentModelConfig,
      browserSession: state.browserSession,
      fixtureScriptTrustRecords: scriptTrust.records,
      ...(scriptTrust.projectDirectory ? { fixtureScriptTrustDirectory: scriptTrust.projectDirectory } : {}),
    };
    const result = await runtime.runTestCase(resolvedRequest);
    await dependencies.saveState(
      appendRunToStudioState(
        state,
        result,
        environment,
        runtime.browserRuntime.getState(),
      ),
    );
    return result;
  });

  dependencies.handle(runtimeIpcChannels.runSuite, async (_event, request) => {
    const projectSnapshot = await loadProjectSnapshot(dependencies.projectRepository, request.projectId, request.expectedProjectRevision);
    const suite = findSuiteAsset(projectSnapshot.project, request.suite);
    if (!suite) {
      throw new RunIntentResolutionError('missingAssetVersion', `未找到 Suite：${request.suite.id}@${request.suite.version}。`);
    }
    const environment = findEnvironment(projectSnapshot, suite.environmentId, `Suite ${suite.id}@${suite.version}`);
    const state = await dependencies.loadState();
    const scriptTrust = await dependencies.getFixtureScriptTrustContext(request.projectId);
    const runtime = dependencies.getRuntimeBundle();
    const resolvedRequest: ResolvedRunSuiteRequest = {
      ...(request.runId ? { runId: request.runId } : {}),
      projectSnapshot,
      suite,
      environment,
      runtimeProfile: state.runtimeProfile,
      midsceneConfig: state.midsceneConfig,
      agentModelConfig: state.agentModelConfig,
      browserSession: state.browserSession,
      fixtureScriptTrustRecords: scriptTrust.records,
      ...(scriptTrust.projectDirectory ? { fixtureScriptTrustDirectory: scriptTrust.projectDirectory } : {}),
    };
    const result = await runtime.runSuite(resolvedRequest);
    if (!result.detail.caseDetails.length) {
      return result;
    }
    const nextState = result.detail.caseDetails.reduce((current, detail) => {
      const environment = projectSnapshot.project.environments.find((candidate) => candidate.id === detail.environmentId);
      if (!environment) {
        return current;
      }
      return appendRunToStudioState(current, toCaseRunResponse(detail), environment, runtime.browserRuntime.getState());
    }, state);
    await dependencies.saveState(nextState);
    return result;
  });

  dependencies.handle(runtimeIpcChannels.cancelRun, async (_event, runId): Promise<boolean> => {
    if (typeof runId !== 'string' || !runId.trim()) {
      throw new Error('运行 ID 无效。');
    }
    return dependencies.getRuntimeBundle().cancelRun(runId);
  });

  dependencies.handle(runtimeIpcChannels.loadRunDetail, async (_event, runId) => {
    const state = await dependencies.loadState();
    return state.runDetails.find((run) => run.id === runId) ?? null;
  });

  dependencies.handle(runtimeIpcChannels.openArtifact, async (_event, artifactPath) => {
    const runtime = dependencies.getRuntimeBundle();
    if (typeof artifactPath !== 'string' || !runtime.artifactManager.isManagedArtifactPath(artifactPath)) {
      throw new Error('只能打开应用生成的证据文件。');
    }
    const error = await dependencies.openPath(artifactPath);
    if (error) {
      throw new Error(`打开证据文件失败：${error}`);
    }
  });

  dependencies.handle(runtimeIpcChannels.exportArtifact, async (_event, artifactPath): Promise<boolean> => {
    const runtime = dependencies.getRuntimeBundle();
    if (typeof artifactPath !== 'string' || !runtime.artifactManager.isManagedArtifactPath(artifactPath)) {
      throw new Error('只能导出应用生成的证据文件。');
    }
    const result = await dependencies.showSaveDialog({
      defaultPath: path.join(dependencies.getDownloadsPath(), path.basename(artifactPath)),
      title: '导出测试报告',
    });
    if (result.canceled || !result.filePath) {
      return false;
    }
    await runtime.artifactManager.exportArtifact(artifactPath, result.filePath);
    return true;
  });

  dependencies.handle(runtimeIpcChannels.attachManualEvidence, async (event) => {
    const result = await dependencies.showOpenDialog(event, {
      title: '附加人工检查证据',
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return dependencies.getRuntimeBundle().artifactManager.importManualEvidence(result.filePaths[0]);
  });
}

async function loadProjectSnapshot(
  projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>,
  projectId: string,
  expectedProjectRevision?: string,
): Promise<ProjectSnapshot> {
  try {
    return await projectRepository.loadBound(projectId, expectedProjectRevision);
  } catch (error) {
    if (isProjectUnboundError(error)) {
      return projectRepository.load(projectId);
    }
    throw error;
  }
}

function isProjectUnboundError(error: unknown): error is { code: 'projectUnbound' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'projectUnbound';
}

function findEnvironment(
  projectSnapshot: ProjectSnapshot,
  environmentId: string,
  assetLabel: string,
): ProjectEnvironment {
  const environment = projectSnapshot.project.environments.find((candidate) => candidate.id === environmentId);
  if (!environment) {
    throw new RunIntentResolutionError('missingAssetVersion', `${assetLabel} 引用了不存在的环境：${environmentId}。`);
  }
  return environment;
}

function toCaseRunResponse(detail: RunDetail): RunTestCaseResponse {
  return {
    runId: detail.id,
    title: detail.title,
    detail,
  };
}

export type { RuntimeIpcChannel };
