import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import {
  type BrowserNavigateRequest,
  type BrowserSessionRequest,
  type ChatCommandRequest,
  type ProjectDraft,
  type RecordingCapturedEvent,
  type RuntimeInfo,
  type RunEventPayload,
  type RunRecordingRequest,
  type RunTestCaseRequest,
  type RunWorkflowRequest,
  type SaveCredentialRequest,
  type SessionStartRequest,
  type StudioState,
} from '../shared/studio.js';
import { ArtifactManager } from './runtime/artifact-manager.js';
import { OpenAICompatibleAgentPlanner } from './runtime/agent-planner.js';
import { OpenAICompatibleAgentReporter } from './runtime/agent-reporter.js';
import { OpenAICompatibleAgentVerifier } from './runtime/agent-verifier.js';
import { BrowserRuntime } from './runtime/browser-runtime.js';
import { CredentialStore } from './runtime/credential-store.js';
import { MidsceneSemanticActionRuntime } from './runtime/semantic-action-runtime.js';
import { electronNativeImageAdapter } from './runtime/electron-native-image-adapter.js';
import { RecordingRunner } from './runtime/recording-runner.js';
import { TestRunner } from './runtime/test-runner.js';
import { PixelVisualDiffService } from './runtime/visual-diff.js';
import { StudioStore } from './studioStore.js';
import { StudioRuntime } from './studioRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let studioStore: StudioStore | null = null;
let studioRuntime: StudioRuntime | null = null;
let credentialStore: CredentialStore | null = null;
let browserRuntime: BrowserRuntime | null = null;
let testRunner: TestRunner | null = null;
let recordingRunner: RecordingRunner | null = null;
let artifactManager: ArtifactManager | null = null;

function getStoreOrThrow(): StudioStore {
  if (!studioStore) {
    throw new Error('Studio store 尚未初始化。');
  }

  return studioStore;
}

function getCredentialStoreOrThrow(): CredentialStore {
  if (!credentialStore) {
    throw new Error('Credential store 尚未初始化。');
  }

  return credentialStore;
}

function getBrowserRuntimeOrThrow(): BrowserRuntime {
  if (!browserRuntime) {
    throw new Error('Browser runtime 尚未初始化。');
  }

  return browserRuntime;
}

function getTestRunnerOrThrow(): TestRunner {
  if (!testRunner) {
    throw new Error('Test runner 尚未初始化。');
  }

  return testRunner;
}

function getRecordingRunnerOrThrow(): RecordingRunner {
  if (!recordingRunner) {
    throw new Error('Recording runner 尚未初始化。');
  }

  return recordingRunner;
}

function getArtifactManagerOrThrow(): ArtifactManager {
  if (!artifactManager) {
    throw new Error('Artifact manager 尚未初始化。');
  }

  return artifactManager;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 1200,
    minHeight: 760,
    title: 'TestBuddy',
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return window;
}

function getRuntimeOrThrow(): StudioRuntime {
  if (!studioRuntime) {
    throw new Error('Studio runtime 尚未初始化。');
  }

  return studioRuntime;
}

function registerIpcHandlers(): void {
  ipcMain.handle('studio:load-state', async () => getStoreOrThrow().load());
  ipcMain.handle('studio:save-state', async (_event, state: StudioState) => {
    await getStoreOrThrow().save(state);
  });
  ipcMain.handle('studio:create-project', async (_event, project: ProjectDraft) => {
    const state = await getStoreOrThrow().load();
    const nextState: StudioState = {
      ...state,
      selectedProjectId: project.id,
      selectedGroupId: project.groups[0]?.id ?? '',
      selectedTestCaseId: project.testCases[0]?.id ?? '',
      projects: [project, ...state.projects],
    };
    await getStoreOrThrow().save(nextState);
    return project;
  });
  ipcMain.handle('studio:update-project', async (_event, project: ProjectDraft) => {
    const state = await getStoreOrThrow().load();
    await getStoreOrThrow().save({
      ...state,
      projects: state.projects.map((item) => (item.id === project.id ? project : item)),
    });
    return project;
  });
  ipcMain.handle('studio:save-credential', async (_event, request: SaveCredentialRequest) =>
    getCredentialStoreOrThrow().save(request),
  );
  ipcMain.handle('runtime:get-info', async (): Promise<RuntimeInfo> => ({
    platform: 'desktop',
    persistence: 'file',
    storagePath: getStoreOrThrow().storagePath,
  }));
  ipcMain.handle('runtime:start-browser-session', async (_event, request: BrowserSessionRequest) =>
    getBrowserRuntimeOrThrow().start(request),
  );
  ipcMain.handle('runtime:navigate-browser-session', async (_event, request: BrowserNavigateRequest) =>
    getBrowserRuntimeOrThrow().navigate(request),
  );
  ipcMain.handle('runtime:capture-browser-snapshot', async () =>
    getBrowserRuntimeOrThrow().capture(),
  );
  ipcMain.handle('runtime:run-test-case', async (_event, request: RunTestCaseRequest) => {
    const result = await getTestRunnerOrThrow().run(request);
    const state = await getStoreOrThrow().load();
    await getStoreOrThrow().save({
      ...state,
      runDetails: [result.detail, ...state.runDetails.filter((run) => run.id !== result.runId)],
      recentRuns: [
        {
          id: result.detail.id,
          name: result.detail.title,
          status: result.detail.status,
          duration: result.detail.duration,
          summary: result.detail.summary,
          projectId: result.detail.projectId,
          testCaseId: result.detail.testCaseId,
          environmentId: result.detail.environmentId,
          environmentName: request.environment.name,
          startedAt: result.detail.startedAt,
        },
        ...state.recentRuns.filter((run) => run.id !== result.detail.id).slice(0, 9),
      ],
      browserSession: getBrowserRuntimeOrThrow().getState(),
    });
    return result;
  });
  ipcMain.handle('runtime:run-recording', async (_event, request: RunRecordingRequest) => {
    const result = await getRecordingRunnerOrThrow().run(request);
    const state = await getStoreOrThrow().load();
    await getStoreOrThrow().save({
      ...state,
      runDetails: [result.detail, ...state.runDetails.filter((run) => run.id !== result.runId)],
      recentRuns: [
        {
          id: result.detail.id,
          name: result.detail.title,
          status: result.detail.status,
          duration: result.detail.duration,
          summary: result.detail.summary,
          projectId: result.detail.projectId,
          testCaseId: result.detail.testCaseId,
          environmentId: result.detail.environmentId,
          environmentName: request.environment.name,
          startedAt: result.detail.startedAt,
        },
        ...state.recentRuns.filter((run) => run.id !== result.detail.id).slice(0, 9),
      ],
      browserSession: getBrowserRuntimeOrThrow().getState(),
    });
    return result;
  });
  ipcMain.handle('runtime:load-run-detail', async (_event, runId: string) => {
    const state = await getStoreOrThrow().load();
    return state.runDetails.find((run) => run.id === runId) ?? null;
  });
  ipcMain.handle('runtime:open-artifact', async (_event, artifactPath: string) => {
    if (
      typeof artifactPath !== 'string' ||
      !getArtifactManagerOrThrow().isManagedArtifactPath(artifactPath)
    ) {
      throw new Error('只能打开应用生成的证据文件。');
    }

    const error = await shell.openPath(artifactPath);
    if (error) {
      throw new Error(`打开证据文件失败：${error}`);
    }
  });
  ipcMain.handle('runtime:export-artifact', async (_event, artifactPath: string): Promise<boolean> => {
    if (
      typeof artifactPath !== 'string' ||
      !getArtifactManagerOrThrow().isManagedArtifactPath(artifactPath)
    ) {
      throw new Error('只能导出应用生成的证据文件。');
    }

    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), path.basename(artifactPath)),
      title: '导出测试报告',
    });
    if (result.canceled || !result.filePath) {
      return false;
    }

    await getArtifactManagerOrThrow().exportArtifact(artifactPath, result.filePath);
    return true;
  });
  ipcMain.handle('runtime:start-session', async (_event, request: SessionStartRequest) =>
    getRuntimeOrThrow().startSession(request),
  );
  ipcMain.handle('runtime:end-session', async () => getRuntimeOrThrow().endSession());
  ipcMain.handle('runtime:send-chat-command', async (_event, request: ChatCommandRequest) =>
    getRuntimeOrThrow().sendChatCommand(request),
  );
  ipcMain.handle('runtime:run-workflow', async (_event, request: RunWorkflowRequest) =>
    getRuntimeOrThrow().runWorkflow(request),
  );
}

app.whenReady().then(async () => {
  const rootDir = app.getPath('userData');
  studioStore = new StudioStore(rootDir);
  await studioStore.ensureReady();
  credentialStore = new CredentialStore(rootDir);
  await credentialStore.ensureReady();
  artifactManager = new ArtifactManager(rootDir);
  await artifactManager.ensureReady();
  browserRuntime = new BrowserRuntime(rootDir, artifactManager, (event: RecordingCapturedEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('runtime:recording-event', event);
    }
  });
  const semanticActionRuntime = new MidsceneSemanticActionRuntime(browserRuntime, undefined, {
    reportDirectory: path.join(rootDir, 'studio-data', 'artifacts'),
  });
  studioRuntime = new StudioRuntime(
    (event: RunEventPayload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('runtime:run-event', event);
      }
    },
    browserRuntime,
    semanticActionRuntime,
    new OpenAICompatibleAgentPlanner(),
    new OpenAICompatibleAgentVerifier(),
    new OpenAICompatibleAgentReporter(),
    {
      writeReporterReport: async ({ runId, markdown }) => {
        const reportArtifacts = await getArtifactManagerOrThrow().createReporterReport(
          runId,
          'Reporter 失败分析',
          markdown,
        );
        return {
          markdownPath: reportArtifacts.markdown.path,
          htmlPath: reportArtifacts.html.path,
        };
      },
    },
  );
  testRunner = new TestRunner(artifactManager, browserRuntime, (event: RunEventPayload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('runtime:run-event', event);
    }
  });
  recordingRunner = new RecordingRunner(
    browserRuntime,
    (event: RunEventPayload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('runtime:run-event', event);
      }
    },
    new PixelVisualDiffService(electronNativeImageAdapter),
  );
  registerIpcHandlers();
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
