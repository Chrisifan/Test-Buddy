import path from 'node:path';

import type {
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';

import type {
  FixtureScriptTrustRecord,
  RunDetail,
  RunSuiteRequest,
  RunSuiteResponse,
  RunTestCaseRequest,
  RunTestCaseResponse,
  RuntimeInfo,
  StudioState,
} from '../../shared/studio.js';
import { appendRunToStudioState } from '../runtime/run-history.js';
import type { RuntimeBundle } from '../runtime/runtime-bundle.js';
import channelModule from './runtime-ipc-channels.cjs';

const { runtimeIpcChannels } = channelModule;

export { runtimeIpcChannels };

type RuntimeIpcChannel = (typeof runtimeIpcChannels)[keyof typeof runtimeIpcChannels];

interface RuntimeIpcArguments {
  [runtimeIpcChannels.getInfo]: [];
  [runtimeIpcChannels.runTestCase]: [RunTestCaseRequest];
  [runtimeIpcChannels.runSuite]: [RunSuiteRequest];
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

export function registerRuntimeIpcHandlers(dependencies: RuntimeIpcDependencies): void {
  dependencies.handle(runtimeIpcChannels.getInfo, async () => dependencies.getRuntimeInfo());

  dependencies.handle(runtimeIpcChannels.runTestCase, async (_event, request) => {
    const scriptTrust = await dependencies.getFixtureScriptTrustContext(request.project.id);
    const runtime = dependencies.getRuntimeBundle();
    const result = await runtime.runTestCase({
      ...request,
      fixtureScriptTrustRecords: scriptTrust.records,
      fixtureScriptTrustDirectory: scriptTrust.projectDirectory,
    });
    const state = await dependencies.loadState();
    await dependencies.saveState(
      appendRunToStudioState(
        state,
        result,
        request.environment,
        runtime.browserRuntime.getState(),
      ),
    );
    return result;
  });

  dependencies.handle(runtimeIpcChannels.runSuite, async (_event, request) => {
    const {
      cancellationSignal: _rendererCancellationSignal,
      fixtureScriptTrustRecords: _rendererFixtureScriptTrustRecords,
      fixtureScriptTrustDirectory: _rendererFixtureScriptTrustDirectory,
      ...safeRequest
    } = request;
    const scriptTrust = await dependencies.getFixtureScriptTrustContext(request.project.id);
    const runtime = dependencies.getRuntimeBundle();
    const result = await runtime.runSuite({
      ...safeRequest,
      fixtureScriptTrustRecords: scriptTrust.records,
      fixtureScriptTrustDirectory: scriptTrust.projectDirectory,
    });
    if (!result.detail.caseDetails.length) {
      return result;
    }
    const state = await dependencies.loadState();
    const nextState = result.detail.caseDetails.reduce((current, detail) => {
      const environment = request.project.environments.find((candidate) => candidate.id === detail.environmentId);
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

function toCaseRunResponse(detail: RunDetail): RunTestCaseResponse {
  return {
    runId: detail.id,
    title: detail.title,
    detail,
  };
}

export type { RuntimeIpcChannel };
