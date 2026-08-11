import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';

import {
  deriveProjectRunReport,
  mergeProjectAssetBindings,
  normalizeProjectAssetBindings,
  type BrowserNavigateRequest,
  type BrowserSessionRequest,
  type ChatCommandRequest,
  type MidsceneConfig,
  type ProjectAssetBinding,
  type ProjectAssetBindingStatus,
  type ProjectAssetMigrationRequest,
  type ProjectAssetReloadPlan,
  type ProjectAssetReloadRequest,
  type ProjectAssetReloadResult,
  type ProjectDraft,
  type ProjectReportExportRequest,
  type PrdSemanticAnalysisRequest,
  type RuntimeInfo,
  type RunRecordingRequest,
  type RunTestCaseRequest,
  type RunWorkflowRequest,
  type SaveCredentialRequest,
  type SessionStartRequest,
  type StudioState,
} from '../shared/studio.js';
import { CredentialStore } from './runtime/credential-store.js';
import { testMidsceneConnection } from './runtime/midscene-connection.js';
import { electronNativeImageAdapter } from './runtime/electron-native-image-adapter.js';
import { PrdSemanticAnalysisRuntime } from './runtime/prd-semantic-analyzer.js';
import { appendRunToStudioState } from './runtime/run-history.js';
import { createRuntimeBundle, type RuntimeBundle } from './runtime/runtime-bundle.js';
import { StudioStore } from './studioStore.js';
import {
  calculateProjectAssetRevision,
  inspectProjectAssetBinding,
  planProjectAssetReload,
  ProjectAssetStore,
} from './projectAssetStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let studioStore: StudioStore | null = null;
let credentialStore: CredentialStore | null = null;
let runtimeBundle: RuntimeBundle | null = null;
let prdSemanticAnalysisRuntime: PrdSemanticAnalysisRuntime | null = null;
const approvedProjectAssetDirectories = new Set<string>();

function loadApplicationIcon() {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'icons', 'testbuddy.png'));
  return icon.isEmpty() ? undefined : icon;
}

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

function getRuntimeBundleOrThrow(): RuntimeBundle {
  if (!runtimeBundle) {
    throw new Error('Browser runtime 尚未初始化。');
  }

  return runtimeBundle;
}

function getPrdSemanticAnalysisRuntimeOrThrow(): PrdSemanticAnalysisRuntime {
  if (!prdSemanticAnalysisRuntime) {
    prdSemanticAnalysisRuntime = new PrdSemanticAnalysisRuntime();
  }

  return prdSemanticAnalysisRuntime;
}

async function getApprovedProjectAssetDirectory(request: ProjectAssetMigrationRequest): Promise<string> {
  if (
    !request ||
    typeof request.projectId !== 'string' ||
    !request.projectId.trim() ||
    typeof request.projectDirectory !== 'string' ||
    !request.projectDirectory.trim()
  ) {
    throw new Error('项目资产请求无效。');
  }

  let projectDirectory: string;
  try {
    projectDirectory = await fs.realpath(request.projectDirectory);
  } catch {
    throw new Error('所选项目资产目录已不可用，请重新选择。');
  }
  if (!approvedProjectAssetDirectories.has(projectDirectory)) {
    throw new Error('只能写入本次由用户选择的项目资产目录。');
  }
  return projectDirectory;
}

function getProjectForAssetRequest(request: ProjectAssetMigrationRequest): Promise<ProjectDraft> {
  return getStoreOrThrow().load().then((state) => {
    const project = state.projects.find((item) => item.id === request.projectId);
    if (!project) {
      throw new Error('项目不存在，无法生成资产快照。');
    }
    if (request.project && typeof request.project === 'object' && request.project.id === project.id) {
      return request.project;
    }
    return project;
  });
}

async function getBoundProjectAssetReloadRequest(request: ProjectAssetReloadRequest): Promise<{
  binding: ProjectAssetBinding;
  project: ProjectDraft;
  state: StudioState;
  storedProject: ProjectDraft;
}> {
  if (!request || typeof request.projectId !== 'string' || !request.projectId.trim() || !request.project || request.project.id !== request.projectId) {
    throw new Error('项目资产重载请求无效。');
  }
  const state = await getStoreOrThrow().load();
  const storedProject = state.projects.find((candidate) => candidate.id === request.projectId);
  if (!storedProject) {
    throw new Error('项目不存在，无法重载资产快照。');
  }
  const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
    .find((candidate) => candidate.projectId === request.projectId);
  if (!binding) {
    throw new Error('项目尚未登记资产快照，无法重载。');
  }
  return { binding, project: request.project, state, storedProject };
}

async function createProjectAssetReloadPlan(request: ProjectAssetReloadRequest): Promise<ProjectAssetReloadPlan> {
  const { binding, project, storedProject } = await getBoundProjectAssetReloadRequest(request);
  const plan = await planProjectAssetReload(project, binding);
  if (calculateProjectAssetRevision(storedProject) === binding.revision || plan.status === 'unavailable') {
    return plan;
  }
  return {
    ...plan,
    status: 'requiresReview',
    issues: [
      ...plan.issues,
      { path: 'studio-data', message: '持久化项目已变化，请先刷新本地编辑态。' },
    ],
  };
}

function createWindow(): BrowserWindow {
  const icon = loadApplicationIcon();
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 1200,
    minHeight: 760,
    title: 'TestBuddy',
    icon,
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

function getRuntimeOrThrow() {
  return getRuntimeBundleOrThrow().studioRuntime;
}

function registerIpcHandlers(): void {
  ipcMain.handle('studio:load-state', async () => getStoreOrThrow().load());
  ipcMain.handle('studio:save-state', async (_event, state: StudioState) => {
    const store = getStoreOrThrow();
    const current = await store.load();
    await store.save({
      ...state,
      projectAssetBindings: mergeProjectAssetBindings(
        current.projectAssetBindings,
        state.projectAssetBindings,
        state.projects,
      ),
    });
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
  ipcMain.handle('studio:analyze-prd-document', async (_event, request: PrdSemanticAnalysisRequest) =>
    getPrdSemanticAnalysisRuntimeOrThrow().analyze(request),
  );
  ipcMain.handle('studio:save-credential', async (_event, request: SaveCredentialRequest) =>
    getCredentialStoreOrThrow().save(request),
  );
  ipcMain.handle('studio:select-project-asset-directory', async (event): Promise<string | null> => {
    const options: Electron.OpenDialogOptions = {
      title: '选择空目录以写入项目资产快照',
      properties: ['openDirectory', 'createDirectory'],
    };
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const projectDirectory = await fs.realpath(result.filePaths[0]);
    approvedProjectAssetDirectories.add(projectDirectory);
    return projectDirectory;
  });
  ipcMain.handle('studio:plan-project-asset-migration', async (_event, request: ProjectAssetMigrationRequest) => {
    const projectDirectory = await getApprovedProjectAssetDirectory(request);
    const project = await getProjectForAssetRequest(request);
    return new ProjectAssetStore(projectDirectory).planMigration(project);
  });
  ipcMain.handle('studio:write-project-asset-snapshot', async (_event, request: ProjectAssetMigrationRequest): Promise<ProjectAssetBinding> => {
    const projectDirectory = await getApprovedProjectAssetDirectory(request);
    const project = await getProjectForAssetRequest(request);
    try {
      if (request.plannedRevision !== calculateProjectAssetRevision(project)) {
        throw new Error('项目配置已变化，请重新生成资产快照计划。');
      }
      const assetStore = new ProjectAssetStore(projectDirectory);
      await assetStore.saveInitial(project);
      const snapshot = await assetStore.loadWithRevision();
      const state = await getStoreOrThrow().load();
      if (!state.projects.some((candidate) => candidate.id === project.id)) {
        throw new Error('项目已被删除，无法登记资产快照。');
      }
      const binding: ProjectAssetBinding = {
        projectId: project.id,
        projectDirectory,
        revision: snapshot.revision,
        boundAt: new Date().toISOString(),
      };
      await getStoreOrThrow().save({
        ...state,
        projects: state.projects.map((candidate) => candidate.id === project.id ? project : candidate),
        projectAssetBindings: mergeProjectAssetBindings(state.projectAssetBindings, [binding], state.projects),
      });
      return binding;
    } finally {
      approvedProjectAssetDirectories.delete(projectDirectory);
    }
  });
  ipcMain.handle('studio:inspect-project-asset-binding', async (_event, projectId: string): Promise<ProjectAssetBindingStatus | null> => {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw new Error('项目资产诊断请求无效。');
    }
    const state = await getStoreOrThrow().load();
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error('项目不存在，无法诊断资产快照。');
    }
    const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
      .find((candidate) => candidate.projectId === projectId);
    return binding ? inspectProjectAssetBinding(project, binding) : null;
  });
  ipcMain.handle('studio:plan-project-asset-reload', async (_event, request: ProjectAssetReloadRequest): Promise<ProjectAssetReloadPlan> =>
    createProjectAssetReloadPlan(request),
  );
  ipcMain.handle('studio:reload-project-asset-snapshot', async (_event, request: ProjectAssetReloadRequest): Promise<ProjectAssetReloadResult> => {
    const { binding: currentBinding, state } = await getBoundProjectAssetReloadRequest(request);
    const plan = await createProjectAssetReloadPlan(request);
    if (plan.status !== 'ready' || !plan.snapshotRevision || plan.snapshotRevision !== request.snapshotRevision) {
      throw new Error('项目资产重载计划已失效，请重新生成计划。');
    }
    const snapshot = await new ProjectAssetStore(currentBinding.projectDirectory).loadWithRevision();
    if (snapshot.project.id !== request.projectId || snapshot.revision !== request.snapshotRevision) {
      throw new Error('项目资产目录已变化，请重新生成计划。');
    }
    const binding: ProjectAssetBinding = {
      ...currentBinding,
      revision: snapshot.revision,
      boundAt: new Date().toISOString(),
    };
    await getStoreOrThrow().save({
      ...state,
      projects: state.projects.map((candidate) => candidate.id === snapshot.project.id ? snapshot.project : candidate),
      projectAssetBindings: mergeProjectAssetBindings(state.projectAssetBindings, [binding], state.projects),
    });
    return { project: snapshot.project, binding };
  });
  ipcMain.handle('runtime:get-info', async (): Promise<RuntimeInfo> => ({
    platform: 'desktop',
    persistence: 'file',
    storagePath: getStoreOrThrow().storagePath,
  }));
  ipcMain.handle('runtime:test-midscene-connection', async (_event, config: MidsceneConfig) =>
    testMidsceneConnection(config),
  );
  ipcMain.handle('runtime:start-browser-session', async (_event, request: BrowserSessionRequest) =>
    getRuntimeBundleOrThrow().browserRuntime.start(request),
  );
  ipcMain.handle('runtime:navigate-browser-session', async (_event, request: BrowserNavigateRequest) =>
    getRuntimeBundleOrThrow().browserRuntime.navigate(request),
  );
  ipcMain.handle('runtime:capture-browser-snapshot', async () =>
    getRuntimeBundleOrThrow().browserRuntime.capture(),
  );
  ipcMain.handle('runtime:run-test-case', async (_event, request: RunTestCaseRequest) => {
    const result = await getRuntimeBundleOrThrow().runTestCase(request);
    const state = await getStoreOrThrow().load();
    await getStoreOrThrow().save(
      appendRunToStudioState(
        state,
        result,
        request.environment,
        getRuntimeBundleOrThrow().browserRuntime.getState(),
      ),
    );
    return result;
  });
  ipcMain.handle('runtime:run-recording', async (_event, request: RunRecordingRequest) => {
    const result = await getRuntimeBundleOrThrow().runRecording(request);
    const state = await getStoreOrThrow().load();
    await getStoreOrThrow().save(
      appendRunToStudioState(
        state,
        result,
        request.environment,
        getRuntimeBundleOrThrow().browserRuntime.getState(),
      ),
    );
    return result;
  });
  ipcMain.handle('runtime:cancel-run', async (_event, runId: string): Promise<boolean> => {
    if (typeof runId !== 'string' || !runId.trim()) {
      throw new Error('运行 ID 无效。');
    }
    return getRuntimeBundleOrThrow().cancelRun(runId);
  });
  ipcMain.handle('runtime:export-project-report', async (_event, request: ProjectReportExportRequest): Promise<boolean> => {
    if (
      !request ||
      typeof request.projectId !== 'string' ||
      !request.projectId.trim() ||
      (request.locale !== 'zh-CN' && request.locale !== 'en-US')
    ) {
      throw new Error('项目报告请求无效。');
    }
    const state = await getStoreOrThrow().load();
    const project = state.projects.find((item) => item.id === request.projectId);
    if (!project) {
      throw new Error('项目不存在，无法导出报告。');
    }

    const artifactManager = getRuntimeBundleOrThrow().artifactManager;
    const reportPath = await artifactManager.createProjectRunReport(
      deriveProjectRunReport(project, state.recentRuns, state.runDetails),
      request.locale,
    );
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath('downloads'), `testbuddy-${safeFileSegment(project.name)}-report.html`),
        title: request.locale === 'en-US' ? 'Export project report' : '导出项目报告',
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (result.canceled || !result.filePath) {
        return false;
      }
      await artifactManager.exportArtifact(reportPath, result.filePath);
      return true;
    } finally {
      await artifactManager.removeArtifact(reportPath);
    }
  });
  ipcMain.handle('runtime:load-run-detail', async (_event, runId: string) => {
    const state = await getStoreOrThrow().load();
    return state.runDetails.find((run) => run.id === runId) ?? null;
  });
  ipcMain.handle('runtime:open-artifact', async (_event, artifactPath: string) => {
    if (
      typeof artifactPath !== 'string' ||
      !getRuntimeBundleOrThrow().artifactManager.isManagedArtifactPath(artifactPath)
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
      !getRuntimeBundleOrThrow().artifactManager.isManagedArtifactPath(artifactPath)
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

    await getRuntimeBundleOrThrow().artifactManager.exportArtifact(artifactPath, result.filePath);
    return true;
  });
  ipcMain.handle('runtime:attach-manual-evidence', async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: '附加人工检查证据',
      properties: ['openFile'],
    };
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return getRuntimeBundleOrThrow().artifactManager.importManualEvidence(result.filePaths[0]);
  });
  ipcMain.handle('runtime:start-session', async (_event, request: SessionStartRequest) =>
    getRuntimeOrThrow().startSession(request),
  );
  ipcMain.handle('runtime:end-session', async () => getRuntimeOrThrow().endSession());
  ipcMain.handle('runtime:send-chat-command', async (_event, request: ChatCommandRequest) =>
    getRuntimeOrThrow().sendChatCommand(request),
  );
  ipcMain.handle('runtime:run-workflow', async (_event, request: RunWorkflowRequest) =>
    getRuntimeBundleOrThrow().runWorkflow(request),
  );
}

function safeFileSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'project';
}

app.whenReady().then(async () => {
  const icon = loadApplicationIcon();
  if (icon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon);
  }
  const rootDir = app.getPath('userData');
  studioStore = new StudioStore(rootDir);
  await studioStore.ensureReady();
  credentialStore = new CredentialStore(rootDir);
  await credentialStore.ensureReady();
  runtimeBundle = createRuntimeBundle({
    rootDir,
    visualDiffImageAdapter: electronNativeImageAdapter,
    deterministicInputBindingResolver: {
      resolve: (request) => getCredentialStoreOrThrow().resolve(request),
    },
    emitRunEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('runtime:run-event', event);
      }
    },
    emitRecordingEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('runtime:recording-event', event);
      }
    },
  });
  await runtimeBundle.ensureReady();
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
