const { contextBridge, ipcRenderer } = require('electron');
const { runtimeIpcChannels } = require('./ipc/runtime-ipc-channels.cjs');

contextBridge.exposeInMainWorld('desktopApi', {
  loadStudioState: () => ipcRenderer.invoke('studio:load-state'),
  saveStudioState: (state: unknown) => ipcRenderer.invoke('studio:save-state', state),
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
  runTestCase: (request: unknown) => ipcRenderer.invoke(runtimeIpcChannels.runTestCase, request),
  runSuite: (request: unknown) => ipcRenderer.invoke(runtimeIpcChannels.runSuite, request),
  runRecording: (request: unknown) => ipcRenderer.invoke('runtime:run-recording', request),
  cancelRun: (runId: string) => ipcRenderer.invoke(runtimeIpcChannels.cancelRun, runId),
  exportProjectReport: (request: unknown) => ipcRenderer.invoke('runtime:export-project-report', request),
  loadRunDetail: (runId: string) => ipcRenderer.invoke(runtimeIpcChannels.loadRunDetail, runId),
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
