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
  type CaptureStorageStateRequest,
  type ChatCommandRequest,
  type ImportStorageStateRequest,
  type MidsceneConfig,
  type FixtureScriptTrustRequest,
  type FixtureScriptTrustStatus,
  type ProjectAssetBinding,
  type ProjectAssetBindingStatus,
  type ProjectAssetMigrationRequest,
  type ProjectAssetReloadPlan,
  type ProjectAssetReloadRequest,
  type ProjectAssetReloadResult,
  type ProjectAssetUpdatePlan,
  type ProjectAssetUpdateRequest,
  type ProjectDraft,
  type ProjectReportExportRequest,
  type PrdSemanticAnalysisRequest,
  type RunRecordingRequest,
  type RunWorkflowRequest,
  type RevokeStorageStateRequest,
  type SaveCredentialRequest,
  type SessionStartRequest,
  type StorageStateRef,
  type StudioState,
} from '../shared/studio.js';
import { CredentialStore } from './runtime/credential-store.js';
import { ScriptTrustStore } from './runtime/script-trust-store.js';
import { StorageStateStore } from './runtime/storage-state-store.js';
import { testMidsceneConnection } from './runtime/midscene-connection.js';
import { electronNativeImageAdapter } from './runtime/electron-native-image-adapter.js';
import { PrdSemanticAnalysisRuntime } from './runtime/prd-semantic-analyzer.js';
import { appendRunToStudioState } from './runtime/run-history.js';
import { createRuntimeBundle, type RuntimeBundle } from './runtime/runtime-bundle.js';
import { registerRuntimeIpcHandlers } from './ipc/runtime-ipc-handlers.js';
import { createProjectRepository, type ProjectRepository } from './projectRepository.js';
import { StudioStore } from './studioStore.js';
import {
  calculateProjectAssetRevision,
  inspectProjectAssetBinding,
  planProjectAssetReload,
  planProjectAssetUpdate,
  ProjectAssetStore,
} from './projectAssetStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let studioStore: StudioStore | null = null;
let credentialStore: CredentialStore | null = null;
let scriptTrustStore: ScriptTrustStore | null = null;
let storageStateStore: StorageStateStore | null = null;
let runtimeBundle: RuntimeBundle | null = null;
let projectRepository: ProjectRepository | null = null;
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

function getScriptTrustStoreOrThrow(): ScriptTrustStore {
  if (!scriptTrustStore) {
    throw new Error('脚本信任存储尚未初始化。');
  }
  return scriptTrustStore;
}

function getStorageStateStoreOrThrow(): StorageStateStore {
  if (!storageStateStore) {
    throw new Error('认证状态存储尚未初始化。');
  }
  return storageStateStore;
}

function getRuntimeBundleOrThrow(): RuntimeBundle {
  if (!runtimeBundle) {
    throw new Error('Browser runtime 尚未初始化。');
  }

  return runtimeBundle;
}

function getProjectRepositoryOrThrow(): ProjectRepository {
  if (!projectRepository) {
    throw new Error('Project repository 尚未初始化。');
  }
  return projectRepository;
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

async function getBoundProjectAssetUpdateRequest(request: ProjectAssetUpdateRequest): Promise<{
  binding: ProjectAssetBinding;
  project: ProjectDraft;
  storedProject: ProjectDraft;
}> {
  if (!request || typeof request.projectId !== 'string' || !request.projectId.trim() || !request.project || request.project.id !== request.projectId) {
    throw new Error('项目资产更新请求无效。');
  }
  const state = await getStoreOrThrow().load();
  const storedProject = state.projects.find((candidate) => candidate.id === request.projectId);
  if (!storedProject) {
    throw new Error('项目不存在，无法更新资产快照。');
  }
  const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
    .find((candidate) => candidate.projectId === request.projectId);
  if (!binding) {
    throw new Error('项目尚未登记资产快照，无法更新。');
  }
  return { binding, project: request.project, storedProject };
}

function toFixtureScriptTrustStatus(record: Awaited<ReturnType<ScriptTrustStore['approve']>>): FixtureScriptTrustStatus {
  const { projectId: _projectId, projectDirectory: _projectDirectory, schemaVersion: _schemaVersion, ...status } = record;
  return status;
}

async function getFixtureScriptTrustContext(projectId: string): Promise<{
  projectDirectory?: string;
  records: Awaited<ReturnType<ScriptTrustStore['list']>>;
}> {
  const state = await getStoreOrThrow().load();
  const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
    .find((candidate) => candidate.projectId === projectId);
  if (!binding) {
    return { records: [] };
  }
  return {
    projectDirectory: binding.projectDirectory,
    records: await getScriptTrustStoreOrThrow().list({
      projectId,
      projectDirectory: binding.projectDirectory,
    }),
  };
}

async function resolveFixtureScriptTrustRequest(request: FixtureScriptTrustRequest): Promise<{
  identity: Parameters<ScriptTrustStore['approve']>[0];
}> {
  if (
    !request ||
    typeof request.projectId !== 'string' ||
    !request.projectId.trim() ||
    typeof request.fixtureId !== 'string' ||
    !request.fixtureId.trim() ||
    !Number.isInteger(request.fixtureVersion) ||
    request.fixtureVersion < 1 ||
    (request.lifecycle !== 'setup' && request.lifecycle !== 'cleanup')
  ) {
    throw new Error('脚本信任请求无效。');
  }
  const state = await getStoreOrThrow().load();
  const project = state.projects.find((candidate) => candidate.id === request.projectId);
  const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
    .find((candidate) => candidate.projectId === request.projectId);
  const fixture = project?.fixtures.find((candidate) => (
    candidate.id === request.fixtureId && candidate.version === request.fixtureVersion
  ));
  const declaration = request.lifecycle === 'setup' ? fixture?.setup : fixture?.cleanup;
  if (!project || !binding || !fixture || declaration?.mode !== 'script' || !declaration.script) {
    throw new Error('只能为已绑定项目中的脚本 Fixture 创建信任记录。');
  }
  return {
    identity: {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      fixtureId: fixture.id,
      fixtureVersion: fixture.version,
      lifecycle: request.lifecycle,
      relativePath: declaration.script.relativePath,
      contentHash: declaration.script.contentHash,
    },
  };
}

/** The renderer snapshot must still match studio-data before external writes are enabled. */
async function createProjectAssetUpdatePlan(request: ProjectAssetUpdateRequest): Promise<ProjectAssetUpdatePlan> {
  const { binding, project, storedProject } = await getBoundProjectAssetUpdateRequest(request);
  const plan = await planProjectAssetUpdate(project, binding);
  const issues = [...plan.issues];
  if (request.expectedRevision !== binding.revision) {
    issues.push({ path: 'projectAssetBindings.revision', message: '资产快照绑定已变化，请重新生成更新计划。' });
  }
  if (calculateProjectAssetRevision(storedProject) !== calculateProjectAssetRevision(project)) {
    issues.push({ path: 'studio-data', message: '持久化项目已变化，请先刷新本地编辑态。' });
  }
  if (!issues.length || plan.status === 'unavailable') {
    return plan;
  }
  return { ...plan, status: 'requiresReview', issues };
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
  ipcMain.handle('studio:import-storage-state', async (event, request: ImportStorageStateRequest): Promise<StorageStateRef | null> => {
    if (
      !request ||
      typeof request.projectId !== 'string' ||
      !request.projectId.trim() ||
      typeof request.label !== 'string' ||
      !request.label.trim()
    ) {
      throw new Error('认证状态导入请求无效。');
    }
    const project = (await getStoreOrThrow().load()).projects.find((candidate) => candidate.id === request.projectId);
    if (!project) {
      throw new Error('项目不存在，无法导入认证状态。');
    }
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, {
        title: '选择 Playwright storageState 文件',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      : await dialog.showOpenDialog({
        title: '选择 Playwright storageState 文件',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return getStorageStateStoreOrThrow().importFile(project.id, request.label, result.filePaths[0]);
  });
  ipcMain.handle('studio:capture-storage-state', async (_event, request: CaptureStorageStateRequest): Promise<StorageStateRef> => {
    if (
      !request ||
      typeof request.projectId !== 'string' ||
      !request.projectId.trim() ||
      typeof request.label !== 'string' ||
      !request.label.trim() ||
      (request.storageStateId !== undefined && (typeof request.storageStateId !== 'string' || !request.storageStateId.trim()))
    ) {
      throw new Error('认证状态捕获请求无效。');
    }
    const project = (await getStoreOrThrow().load()).projects.find((candidate) => candidate.id === request.projectId);
    if (!project) {
      throw new Error('项目不存在，无法捕获认证状态。');
    }
    const serializedState = await getRuntimeBundleOrThrow().browserRuntime.captureStorageState(project.id);
    return request.storageStateId
      ? getStorageStateStoreOrThrow().replace(project.id, request.storageStateId, serializedState)
      : getStorageStateStoreOrThrow().save(project.id, request.label, serializedState);
  });
  ipcMain.handle('studio:revoke-storage-state', async (_event, request: RevokeStorageStateRequest): Promise<void> => {
    if (
      !request ||
      typeof request.projectId !== 'string' ||
      !request.projectId.trim() ||
      typeof request.storageStateId !== 'string' ||
      !request.storageStateId.trim()
    ) {
      throw new Error('认证状态撤销请求无效。');
    }
    await getStorageStateStoreOrThrow().revoke(request.projectId, request.storageStateId);
  });
  ipcMain.handle('studio:list-fixture-script-trusts', async (_event, projectId: string): Promise<FixtureScriptTrustStatus[]> => {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw new Error('项目 ID 无效。');
    }
    const context = await getFixtureScriptTrustContext(projectId);
    return context.records.map(toFixtureScriptTrustStatus);
  });
  ipcMain.handle('studio:approve-fixture-script-trust', async (_event, request: FixtureScriptTrustRequest): Promise<FixtureScriptTrustStatus> => {
    const { identity } = await resolveFixtureScriptTrustRequest(request);
    return toFixtureScriptTrustStatus(await getScriptTrustStoreOrThrow().approve(identity));
  });
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
  ipcMain.handle('studio:plan-project-asset-update', async (_event, request: ProjectAssetUpdateRequest): Promise<ProjectAssetUpdatePlan> =>
    createProjectAssetUpdatePlan(request),
  );
  ipcMain.handle('studio:update-project-asset-snapshot', async (_event, request: ProjectAssetUpdateRequest): Promise<ProjectAssetBinding> => {
    const { binding: expectedBinding } = await getBoundProjectAssetUpdateRequest(request);
    const plan = await createProjectAssetUpdatePlan(request);
    if (
      plan.status !== 'ready' ||
      !plan.snapshotRevision ||
      plan.snapshotRevision !== request.plannedRevision ||
      plan.publishedRevision !== expectedBinding.revision
    ) {
      throw new Error('项目资产更新计划已失效，请重新生成计划。');
    }

    const assetStore = new ProjectAssetStore(expectedBinding.projectDirectory);
    await assetStore.save(request.project, expectedBinding.revision);
    const snapshot = await assetStore.loadWithRevision();
    if (snapshot.project.id !== request.projectId || snapshot.revision !== request.plannedRevision) {
      throw new Error('项目资产快照提交结果不一致，请刷新状态后再试。');
    }

    // Reload after the external commit so a queued renderer save cannot be overwritten.
    const currentState = await getStoreOrThrow().load();
    if (!currentState.projects.some((candidate) => candidate.id === request.projectId)) {
      throw new Error('项目已删除，资产快照已发布但无法登记绑定。');
    }
    const binding: ProjectAssetBinding = {
      projectId: request.projectId,
      projectDirectory: expectedBinding.projectDirectory,
      revision: snapshot.revision,
      boundAt: new Date().toISOString(),
    };
    await getStoreOrThrow().save({
      ...currentState,
      projectAssetBindings: mergeProjectAssetBindings(currentState.projectAssetBindings, [binding], currentState.projects),
    });
    return binding;
  });
  registerRuntimeIpcHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    loadState: () => getStoreOrThrow().load(),
    saveState: async (state) => {
      await getStoreOrThrow().save(state);
    },
    getRuntimeBundle: getRuntimeBundleOrThrow,
    projectRepository: getProjectRepositoryOrThrow(),
    getFixtureScriptTrustContext,
    openPath: (artifactPath) => shell.openPath(artifactPath),
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    getDownloadsPath: () => app.getPath('downloads'),
    showOpenDialog: (event, options) => {
      const owner = BrowserWindow.fromWebContents((event as Electron.IpcMainInvokeEvent).sender) ?? mainWindow;
      return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
    },
    getRuntimeInfo: () => ({
      platform: 'desktop',
      persistence: 'file',
      storagePath: getStoreOrThrow().storagePath,
    }),
  });
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
  projectRepository = createProjectRepository({ studioStore });
  credentialStore = new CredentialStore(rootDir);
  await credentialStore.ensureReady();
  scriptTrustStore = new ScriptTrustStore(rootDir);
  await scriptTrustStore.ensureReady();
  storageStateStore = new StorageStateStore(rootDir);
  await storageStateStore.ensureReady();
  runtimeBundle = createRuntimeBundle({
    rootDir,
    visualDiffImageAdapter: electronNativeImageAdapter,
    deterministicInputBindingResolver: {
      resolve: (request) => getCredentialStoreOrThrow().resolve(request),
    },
    storageStateResolver: {
      resolve: (projectId, storageStateId) => getStorageStateStoreOrThrow().resolve(projectId, storageStateId),
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
