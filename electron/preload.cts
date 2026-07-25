const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  loadStudioState: () => ipcRenderer.invoke('studio:load-state'),
  saveStudioState: (state: unknown) => ipcRenderer.invoke('studio:save-state', state),
  createProject: (project: unknown) => ipcRenderer.invoke('studio:create-project', project),
  updateProject: (project: unknown) => ipcRenderer.invoke('studio:update-project', project),
  saveCredential: (request: unknown) => ipcRenderer.invoke('studio:save-credential', request),
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:get-info'),
  startBrowserSession: (request: unknown) => ipcRenderer.invoke('runtime:start-browser-session', request),
  navigateBrowserSession: (request: unknown) =>
    ipcRenderer.invoke('runtime:navigate-browser-session', request),
  captureBrowserSnapshot: () => ipcRenderer.invoke('runtime:capture-browser-snapshot'),
  runTestCase: (request: unknown) => ipcRenderer.invoke('runtime:run-test-case', request),
  runRecording: (request: unknown) => ipcRenderer.invoke('runtime:run-recording', request),
  loadRunDetail: (runId: string) => ipcRenderer.invoke('runtime:load-run-detail', runId),
  openArtifact: (artifactPath: string) => ipcRenderer.invoke('runtime:open-artifact', artifactPath),
  exportArtifact: (artifactPath: string) => ipcRenderer.invoke('runtime:export-artifact', artifactPath),
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
