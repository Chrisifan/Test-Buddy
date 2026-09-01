import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';

import {
  deriveProjectRunReport,
  normalizeProjectAssetBindings,
  type BrowserNavigateRequest,
  type BrowserSessionRequest,
  type AgentModelRole,
  type CaptureStorageStateRequest,
  type ChatCommandRequest,
  type ImportStorageStateRequest,
  type MidsceneConfig,
  type ModelSecretRef,
  type ModelSecretScope,
  type FixtureScriptTrustRequest,
  type FixtureScriptTrustStatus,
  type ProjectAssetBinding,
  type ProjectAssetBindingStatus,
  type ProjectAssetMigrationRequest,
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
import {
  ModelConfigResolver,
  type AgentProviderRole,
  type LazyModelConfigResolver,
} from './runtime/model-config-resolver.js';
import { ModelSecretStore } from './runtime/model-secret-store.js';
import { ModelSecretTransactionCoordinator } from './model-secret-transaction.js';
import { ModelSecretTransactionJournal } from './model-secret-transaction-journal.js';
import { ScriptTrustStore } from './runtime/script-trust-store.js';
import { StorageStateStore } from './runtime/storage-state-store.js';
import { createControlledChromiumBrowserPool } from './runtime/browser-pool.js';
import type { DeterministicInteractionPreflightPolicyProvider } from './runtime/deterministic-step-contract.js';
import { testMidsceneConnection } from './runtime/midscene-connection.js';
import { electronNativeImageAdapter } from './runtime/electron-native-image-adapter.js';
import { PrdSemanticAnalysisRuntime } from './runtime/prd-semantic-analyzer.js';
import { appendRunToStudioState } from './runtime/run-history.js';
import { MaintenanceService } from './runtime/maintenance-service.js';
import { createRuntimeBundle, type RuntimeBundle } from './runtime/runtime-bundle.js';
import { registerRuntimeIpcHandlers } from './ipc/runtime-ipc-handlers.js';
import { registerModelSecretIpcHandlers } from './ipc/model-secret-ipc-handlers.js';
import { createProjectRepository, type ProjectRepository } from './projectRepository.js';
import { StudioStore } from './studioStore.js';
import { StudioStateUpdateQueue } from './studio-state-update-queue.js';
import { createMainWindowOptions } from './window-options.js';
import { registerProjectAssetIpcHandlers } from './project-asset-ipc-handlers.js';
import {
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
let modelSecretStore: ModelSecretStore | null = null;
let modelSecretTransactionCoordinator: ModelSecretTransactionCoordinator | null = null;
let scriptTrustStore: ScriptTrustStore | null = null;
let storageStateStore: StorageStateStore | null = null;
let runtimeBundle: RuntimeBundle | null = null;
let projectRepository: ProjectRepository | null = null;
let prdSemanticAnalysisRuntime: PrdSemanticAnalysisRuntime | null = null;
let studioStateUpdateQueue: StudioStateUpdateQueue | null = null;
const approvedProjectAssetDirectories = new Set<string>();

const loadApplicationIcon = () => {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'icons', 'testbuddy.png'));
  return icon.isEmpty() ? undefined : icon;
};

const getStoreOrThrow = (): StudioStore => {
  if (!studioStore) {
    throw new Error('Studio store 尚未初始化。');
  }

  return studioStore;
};

const getCredentialStoreOrThrow = (): CredentialStore => {
  if (!credentialStore) {
    throw new Error('Credential store 尚未初始化。');
  }

  return credentialStore;
};

const getModelSecretStoreOrThrow = (): ModelSecretStore => {
  if (!modelSecretStore) {
    throw new Error('模型密钥存储尚未初始化。');
  }

  return modelSecretStore;
};

const getModelSecretTransactionCoordinatorOrThrow = (): ModelSecretTransactionCoordinator => {
  if (!modelSecretTransactionCoordinator) {
    throw new Error('模型密钥事务协调器尚未初始化。');
  }
  return modelSecretTransactionCoordinator;
};

const withCurrentModelConfiguration = <T>(
  callback: (resolver: ModelConfigResolver, state: StudioState) => Promise<T>,
): Promise<T> => {
  return getModelSecretTransactionCoordinatorOrThrow().withConsistentState(
    () => getStoreOrThrow().load(),
    (state) => callback(new ModelConfigResolver(getModelSecretStoreOrThrow()), state),
  );
};

const createCurrentModelConfigResolver = (): LazyModelConfigResolver => {
  return {
    resolveMidsceneConfig: () => withCurrentModelConfiguration((resolver, state) =>
      resolver.resolveMidsceneConfig(state.midsceneConfig),
    ),
    resolveAgentProviderConfig: (role: AgentProviderRole) => withCurrentModelConfiguration((resolver, state) =>
      resolver.resolveAgentProviderConfig(role, {
        midsceneConfig: state.midsceneConfig,
        agentModelConfig: state.agentModelConfig,
      }),
    ),
  };
};

/** Resolves encrypted values only inside Electron main for redaction and preflight checks. */
const resolveCurrentKnownSecrets = (): Promise<string[]> => {
  return withCurrentModelConfiguration(async (resolver, state) => {
    const resolved = await resolver.resolve({
      midsceneConfig: state.midsceneConfig,
      agentModelConfig: state.agentModelConfig,
    });
    return [...new Set([
      resolved.midsceneConfig.modelApiKey,
      ...Object.values(resolved.agentModelConfig).map((config) => config.modelApiKey),
    ].filter((value) => value.length > 0))];
  });
};

const createDeterministicInteractionPreflightPolicy = (): DeterministicInteractionPreflightPolicyProvider => {
  return {
    resolve: async () => ({ knownSecrets: await resolveCurrentKnownSecrets() }),
  };
};

const modelSecretReferenceForScope = (state: StudioState, scope: ModelSecretScope): ModelSecretRef => {
  if (scope === 'midscene') {
    return state.midsceneConfig.modelSecret;
  }
  const role = scope.slice('agent:'.length) as AgentModelRole;
  return state.agentModelConfig[role].modelSecret;
};

const persistModelSecretRef = (scope: ModelSecretScope, modelSecret: ModelSecretRef): Promise<void> => {
  return getStudioStateUpdateQueueOrThrow().saveModelSecretRef(scope, modelSecret).then(() => undefined);
};

const getStudioStateUpdateQueueOrThrow = (): StudioStateUpdateQueue => {
  if (!studioStateUpdateQueue) {
    throw new Error('Studio state 更新队列尚未初始化。');
  }
  return studioStateUpdateQueue;
};

const getScriptTrustStoreOrThrow = (): ScriptTrustStore => {
  if (!scriptTrustStore) {
    throw new Error('脚本信任存储尚未初始化。');
  }
  return scriptTrustStore;
};

const getStorageStateStoreOrThrow = (): StorageStateStore => {
  if (!storageStateStore) {
    throw new Error('认证状态存储尚未初始化。');
  }
  return storageStateStore;
};

const getRuntimeBundleOrThrow = (): RuntimeBundle => {
  if (!runtimeBundle) {
    throw new Error('Browser runtime 尚未初始化。');
  }

  return runtimeBundle;
};

const getProjectRepositoryOrThrow = (): ProjectRepository => {
  if (!projectRepository) {
    throw new Error('Project repository 尚未初始化。');
  }
  return projectRepository;
};

const getPrdSemanticAnalysisRuntimeOrThrow = (): PrdSemanticAnalysisRuntime => {
  if (!prdSemanticAnalysisRuntime) {
    prdSemanticAnalysisRuntime = new PrdSemanticAnalysisRuntime();
  }

  return prdSemanticAnalysisRuntime;
};

const getApprovedProjectAssetDirectory = async (request: ProjectAssetMigrationRequest): Promise<string> => {
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
};

const toFixtureScriptTrustStatus = (record: Awaited<ReturnType<ScriptTrustStore['approve']>>): FixtureScriptTrustStatus => {
  const { projectId: _projectId, projectDirectory: _projectDirectory, schemaVersion: _schemaVersion, ...status } = record;
  return status;
};

const getFixtureScriptTrustContext = async (projectId: string): Promise<{
  projectDirectory?: string;
  records: Awaited<ReturnType<ScriptTrustStore['list']>>;
}> => {
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
};

const resolveFixtureScriptTrustRequest = async (request: FixtureScriptTrustRequest): Promise<{
  identity: Parameters<ScriptTrustStore['approve']>[0];
}> => {
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
};

const createWindow = (): BrowserWindow => {
  const icon = loadApplicationIcon();
  const window = new BrowserWindow(createMainWindowOptions({
    icon,
    preloadPath: path.join(__dirname, 'preload.cjs'),
    platform: process.platform,
  }));

  void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return window;
};

const getRuntimeOrThrow = () => {
  return getRuntimeBundleOrThrow().studioRuntime;
};

const registerIpcHandlers = (): void => {
  ipcMain.handle('studio:load-state', async () => getStoreOrThrow().load());
  ipcMain.handle('studio:save-state', async (_event, state: StudioState) => {
    await getStudioStateUpdateQueueOrThrow().saveRendererState(state);
  });
  ipcMain.handle('studio:create-project', async (_event, project: ProjectDraft) => {
    await getStudioStateUpdateQueueOrThrow().createRendererProject(project);
    return project;
  });
  ipcMain.handle('studio:update-project', async (_event, project: ProjectDraft) => {
    await getStudioStateUpdateQueueOrThrow().updateRendererProject(project);
    return project;
  });
  ipcMain.handle('studio:analyze-prd-document', async (_event, request: PrdSemanticAnalysisRequest) => {
    const planner = await createCurrentModelConfigResolver().resolveAgentProviderConfig('planner');
    return getPrdSemanticAnalysisRuntimeOrThrow().analyze({
      document: request.document,
      ...(planner.config ? { plannerConfig: planner.config } : {}),
    });
  });
  ipcMain.handle('studio:save-credential', async (_event, request: SaveCredentialRequest) =>
    getCredentialStoreOrThrow().save(request),
  );
  registerModelSecretIpcHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    coordinator: getModelSecretTransactionCoordinatorOrThrow(),
  });
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
  registerProjectAssetIpcHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    getApprovedProjectAssetDirectory,
    releaseApprovedProjectAssetDirectory: (projectDirectory) => {
      approvedProjectAssetDirectories.delete(projectDirectory);
    },
    loadState: () => getStoreOrThrow().load(),
    updateState: (updater) => getStudioStateUpdateQueueOrThrow().update(updater),
    createAssetStore: (projectDirectory) => new ProjectAssetStore(projectDirectory),
    createProjectAssetReloadPlan: planProjectAssetReload,
    createProjectAssetUpdatePlan: planProjectAssetUpdate,
    now: () => new Date(),
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
  registerRuntimeIpcHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    loadState: () => getStoreOrThrow().load(),
    saveState: async (state) => {
      await getStudioStateUpdateQueueOrThrow().saveRuntimeState(state);
    },
    createLazyModelConfigResolver: createCurrentModelConfigResolver,
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
    maintenanceService: new MaintenanceService({
      projectRepository: getProjectRepositoryOrThrow(),
      artifactManager: getRuntimeBundleOrThrow().artifactManager,
      assetStoreForProject: async (projectId) => {
        const state = await getStoreOrThrow().load();
        const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
          .find((candidate) => candidate.projectId === projectId);
        if (!binding) {
          throw new Error(`项目 ${projectId} 没有可用的项目资产绑定。`);
        }
        return new ProjectAssetStore(binding.projectDirectory);
      },
      loadState: () => getStoreOrThrow().load(),
      updateState: (updater) => getStudioStateUpdateQueueOrThrow().update(updater),
      getKnownSecrets: resolveCurrentKnownSecrets,
    }),
  });
  ipcMain.handle('runtime:test-midscene-connection', async (_event, config: MidsceneConfig) => {
    const resolvedConfig = await getModelSecretTransactionCoordinatorOrThrow().withConsistentState(
      () => getStoreOrThrow().load(),
      (state) => new ModelConfigResolver(getModelSecretStoreOrThrow()).resolveMidsceneConfig({
        ...config,
        modelSecret: state.midsceneConfig.modelSecret,
      }),
    );
    return testMidsceneConnection(resolvedConfig);
  });
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
    await getStudioStateUpdateQueueOrThrow().updateRuntimeState((state) =>
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
      deriveProjectRunReport(project, state.recentRuns, state.runDetails, undefined, {
        knownSecrets: await resolveCurrentKnownSecrets(),
      }),
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
  ipcMain.handle('runtime:send-chat-command', async (_event, request: ChatCommandRequest) => {
    const { midsceneConfig: _midsceneConfig, agentModelConfig: _agentModelConfig, ...intent } = request;
    return getRuntimeOrThrow().sendChatCommand({
      ...intent,
      modelConfigResolver: createCurrentModelConfigResolver(),
    });
  });
  ipcMain.handle('runtime:run-workflow', async (_event, request: RunWorkflowRequest) => {
    const { midsceneConfig: _midsceneConfig, agentModelConfig: _agentModelConfig, ...intent } = request;
    return getRuntimeBundleOrThrow().runWorkflow({
      ...intent,
      modelConfigResolver: createCurrentModelConfigResolver(),
    });
  });
};

const safeFileSegment = (value: string): string => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'project';
};

app.whenReady().then(async () => {
  const icon = loadApplicationIcon();
  if (icon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon);
  }
  const rootDir = app.getPath('userData');
  studioStore = new StudioStore(rootDir);
  await studioStore.ensureReady();
  studioStateUpdateQueue = new StudioStateUpdateQueue(studioStore);
  credentialStore = new CredentialStore(rootDir);
  await credentialStore.ensureReady();
  modelSecretStore = new ModelSecretStore(rootDir);
  await modelSecretStore.ensureReady();
  modelSecretTransactionCoordinator = new ModelSecretTransactionCoordinator(
    modelSecretStore,
    persistModelSecretRef,
    new ModelSecretTransactionJournal(rootDir),
  );
  await modelSecretTransactionCoordinator.reconcile(async (scope) =>
    modelSecretReferenceForScope(await getStoreOrThrow().load(), scope),
  );
  projectRepository = createProjectRepository({ studioStore });
  scriptTrustStore = new ScriptTrustStore(rootDir);
  await scriptTrustStore.ensureReady();
  storageStateStore = new StorageStateStore(rootDir);
  await storageStateStore.ensureReady();
  runtimeBundle = createRuntimeBundle({
    rootDir,
    visualDiffImageAdapter: electronNativeImageAdapter,
    browserPool: createControlledChromiumBrowserPool({
      storageStateResolver: {
        resolve: (projectId, storageStateId) => getStorageStateStoreOrThrow().resolve(projectId, storageStateId),
      },
    }),
    deterministicInputBindingResolver: {
      resolve: (request) => getCredentialStoreOrThrow().resolve(request),
    },
    deterministicInteractionPreflightPolicy: createDeterministicInteractionPreflightPolicy(),
    storageStateResolver: {
      resolve: (projectId, storageStateId) => getStorageStateStoreOrThrow().resolve(projectId, storageStateId),
    },
    loadStudioState: () => getStoreOrThrow().load(),
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
