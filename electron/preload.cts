import type {
  RunIntentIpcErrorResponse,
  HistoricalRerunExecutionResult,
  HistoricalRerunPlan,
  MaintenanceDraftAcceptanceRequest,
  MaintenanceDraftCreationRequest,
  MaintenanceDraftRejectionRequest,
  MaintenanceEvidenceOpenRequest,
  RunSuiteIntent,
  RunSuiteResponse,
  RunTestCaseIntent,
  RunTestCaseResponse,
} from '../shared/studio.js';

const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preloads can only require Electron built-ins, so these channels
// must remain local rather than loading the shared CommonJS module.
const runtimeIpcChannels = {
  getInfo: 'runtime:get-info',
  runTestCase: 'runtime:run-test-case',
  runSuite: 'runtime:run-suite',
  cancelRun: 'runtime:cancel-run',
  loadRunDetail: 'runtime:load-run-detail',
  loadSuiteRunRecord: 'runtime:load-suite-run-record',
  listMaintenanceDrafts: 'runtime:list-maintenance-drafts',
  createMaintenanceDraft: 'runtime:create-maintenance-draft',
  acceptMaintenanceDraft: 'runtime:accept-maintenance-draft',
  rejectMaintenanceDraft: 'runtime:reject-maintenance-draft',
  openMaintenanceEvidence: 'runtime:open-maintenance-evidence',
  planArtifactRetention: 'runtime:plan-artifact-retention',
  confirmArtifactRetention: 'runtime:confirm-artifact-retention',
  planHistoricalRerun: 'runtime:plan-historical-rerun',
  runHistoricalRerun: 'runtime:run-historical-rerun',
  openArtifact: 'runtime:open-artifact',
  exportArtifact: 'runtime:export-artifact',
  attachManualEvidence: 'runtime:attach-manual-evidence',
} as const;

const invokeRunIntent = <T,>(channel: string, request: RunSuiteIntent | RunTestCaseIntent): Promise<T> => {
  return ipcRenderer.invoke(channel, request).then((response: unknown) => {
    if (isRunIntentIpcError(response)) {
      throw Object.assign(new Error(response.message), { code: response.code });
    }
    return response as T;
  });
};

const isRunIntentIpcError = (response: unknown): response is RunIntentIpcErrorResponse => {
  return typeof response === 'object' &&
    response !== null &&
    'type' in response &&
    response.type === 'testBuddy.runtimeError' &&
    'code' in response &&
    (response.code === 'staleProjectRevision' ||
      response.code === 'projectRevisionChanged' ||
      response.code === 'missingAssetVersion') &&
    'message' in response &&
    typeof response.message === 'string';
};

contextBridge.exposeInMainWorld('desktopApi', {
  loadStudioState: () => ipcRenderer.invoke('studio:load-state'),
  saveStudioState: (state: unknown) => ipcRenderer.invoke('studio:save-state', state),
  saveModelSecret: (request: unknown) => ipcRenderer.invoke('runtime:save-model-secret', request),
  clearModelSecret: (request: unknown) => ipcRenderer.invoke('runtime:clear-model-secret', request),
  createProject: (project: unknown) => ipcRenderer.invoke('studio:create-project', project),
  updateProject: (project: unknown) => ipcRenderer.invoke('studio:update-project', project),
  analyzePrdDocument: (request: unknown) => ipcRenderer.invoke('studio:analyze-prd-document', request),
  saveCredential: (request: unknown) => ipcRenderer.invoke('studio:save-credential', request),
  importStorageState: (request: unknown) => ipcRenderer.invoke('studio:import-storage-state', request),
  captureStorageState: (request: unknown) => ipcRenderer.invoke('studio:capture-storage-state', request),
  revokeStorageState: (request: unknown) => ipcRenderer.invoke('studio:revoke-storage-state', request),
  selectProjectAssetDirectory: () => ipcRenderer.invoke('studio:select-project-asset-directory'),
  planProjectAssetMigration: (request: unknown) => ipcRenderer.invoke('studio:plan-project-asset-migration', request),
  writeProjectAssetSnapshot: (request: unknown) => ipcRenderer.invoke('studio:write-project-asset-snapshot', request),
  inspectProjectAssetBinding: (projectId: string) => ipcRenderer.invoke('studio:inspect-project-asset-binding', projectId),
  planProjectAssetReload: (request: unknown) => ipcRenderer.invoke('studio:plan-project-asset-reload', request),
  reloadProjectAssetSnapshot: (request: unknown) => ipcRenderer.invoke('studio:reload-project-asset-snapshot', request),
  planProjectAssetUpdate: (request: unknown) => ipcRenderer.invoke('studio:plan-project-asset-update', request),
  updateProjectAssetSnapshot: (request: unknown) => ipcRenderer.invoke('studio:update-project-asset-snapshot', request),
  listFixtureScriptTrusts: (projectId: string) => ipcRenderer.invoke('studio:list-fixture-script-trusts', projectId),
  approveFixtureScriptTrust: (request: unknown) => ipcRenderer.invoke('studio:approve-fixture-script-trust', request),
  getRuntimeInfo: () => ipcRenderer.invoke(runtimeIpcChannels.getInfo),
  testMidsceneConnection: (config: unknown) => ipcRenderer.invoke('runtime:test-midscene-connection', config),
  startBrowserSession: (request: unknown) => ipcRenderer.invoke('runtime:start-browser-session', request),
  navigateBrowserSession: (request: unknown) =>
    ipcRenderer.invoke('runtime:navigate-browser-session', request),
  captureBrowserSnapshot: () => ipcRenderer.invoke('runtime:capture-browser-snapshot'),
  runTestCase: (request: RunTestCaseIntent) => invokeRunIntent<RunTestCaseResponse>(runtimeIpcChannels.runTestCase, request),
  runSuite: (request: RunSuiteIntent) => invokeRunIntent<RunSuiteResponse>(runtimeIpcChannels.runSuite, request),
  runRecording: (request: unknown) => ipcRenderer.invoke('runtime:run-recording', request),
  cancelRun: (runId: string) => ipcRenderer.invoke(runtimeIpcChannels.cancelRun, runId),
  exportProjectReport: (request: unknown) => ipcRenderer.invoke('runtime:export-project-report', request),
  loadRunDetail: (runId: string) => ipcRenderer.invoke(runtimeIpcChannels.loadRunDetail, runId),
  loadSuiteRunRecord: (runId: string) => ipcRenderer.invoke(runtimeIpcChannels.loadSuiteRunRecord, runId),
  listMaintenanceDrafts: () => ipcRenderer.invoke(runtimeIpcChannels.listMaintenanceDrafts),
  createMaintenanceDraft: (request: MaintenanceDraftCreationRequest) => ipcRenderer.invoke(runtimeIpcChannels.createMaintenanceDraft, request),
  acceptMaintenanceDraft: (request: MaintenanceDraftAcceptanceRequest) => ipcRenderer.invoke(runtimeIpcChannels.acceptMaintenanceDraft, request),
  rejectMaintenanceDraft: (request: MaintenanceDraftRejectionRequest) => ipcRenderer.invoke(runtimeIpcChannels.rejectMaintenanceDraft, request),
  openMaintenanceEvidence: (request: MaintenanceEvidenceOpenRequest) => ipcRenderer.invoke(runtimeIpcChannels.openMaintenanceEvidence, request),
  planArtifactRetention: () => ipcRenderer.invoke(runtimeIpcChannels.planArtifactRetention),
  confirmArtifactRetention: (planId: string) => ipcRenderer.invoke(runtimeIpcChannels.confirmArtifactRetention, planId),
  planHistoricalRerun: (runId: string) => ipcRenderer.invoke(runtimeIpcChannels.planHistoricalRerun, runId) as Promise<HistoricalRerunPlan>,
  runHistoricalRerun: (runId: string) => ipcRenderer.invoke(runtimeIpcChannels.runHistoricalRerun, runId) as Promise<HistoricalRerunExecutionResult>,
  openArtifact: (artifactPath: string) => ipcRenderer.invoke(runtimeIpcChannels.openArtifact, artifactPath),
  exportArtifact: (artifactPath: string) => ipcRenderer.invoke(runtimeIpcChannels.exportArtifact, artifactPath),
  attachManualEvidence: () => ipcRenderer.invoke(runtimeIpcChannels.attachManualEvidence),
  startSession: (request: unknown) => ipcRenderer.invoke('runtime:start-session', request),
  endSession: () => ipcRenderer.invoke('runtime:end-session'),
  sendChatCommand: (request: unknown) => ipcRenderer.invoke('runtime:send-chat-command', request),
  runWorkflow: (request: unknown) => ipcRenderer.invoke('runtime:run-workflow', request),
  onRunEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('runtime:run-event', wrapped);
    return () => {
      ipcRenderer.removeListener('runtime:run-event', wrapped);
    };
  },
  onRecordingEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('runtime:recording-event', wrapped);
    return () => {
      ipcRenderer.removeListener('runtime:recording-event', wrapped);
    };
  },
});
