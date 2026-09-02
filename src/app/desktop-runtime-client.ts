import type { RecordingCapturedEvent, RunEventPayload } from '../../shared/studio.js';

type DesktopRuntime = typeof import('../lib/runtime.js');

let desktopRuntimePromise: Promise<DesktopRuntime> | undefined;
let runEventBridgePromise: Promise<void> | undefined;
let recordingEventBridgePromise: Promise<void> | undefined;

const runEventListeners = new Set<(event: RunEventPayload) => void>();
const recordingEventListeners = new Set<(event: RecordingCapturedEvent) => void>();

const loadDesktopRuntime = (): Promise<DesktopRuntime> => {
  desktopRuntimePromise ??= import('../lib/runtime.js');
  return desktopRuntimePromise;
};

const getDesktopApi = () => {
  return typeof window === 'undefined' ? undefined : window.desktopApi;
};

const ensureRunEventBridge = (): Promise<void> => {
  runEventBridgePromise ??= loadDesktopRuntime().then((runtime) => {
    runtime.onRunEvent((event) => {
      runEventListeners.forEach((listener) => listener(event));
    });
  });
  return runEventBridgePromise;
};

const ensureRecordingEventBridge = (): Promise<void> => {
  recordingEventBridgePromise ??= loadDesktopRuntime().then((runtime) => {
    runtime.onRecordingEvent((event) => {
      recordingEventListeners.forEach((listener) => listener(event));
    });
  });
  return recordingEventBridgePromise;
};

export const canReviewMaintenanceDrafts = (): boolean => {
  const desktopApi = getDesktopApi();
  return Boolean(
    desktopApi &&
    typeof desktopApi.acceptMaintenanceDraft === 'function' &&
    typeof desktopApi.rejectMaintenanceDraft === 'function' &&
    typeof desktopApi.openMaintenanceEvidence === 'function',
  );
};

export const onRunEvent = (listener: (event: RunEventPayload) => void): (() => void) => {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.onRunEvent(listener);
  }

  runEventListeners.add(listener);
  void ensureRunEventBridge().catch(() => undefined);
  return () => {
    runEventListeners.delete(listener);
  };
};

export const onRecordingEvent = (listener: (event: RecordingCapturedEvent) => void): (() => void) => {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.onRecordingEvent(listener);
  }

  recordingEventListeners.add(listener);
  void ensureRecordingEventBridge().catch(() => undefined);
  return () => {
    recordingEventListeners.delete(listener);
  };
};

export const attachManualEvidence = async (...args: Parameters<DesktopRuntime['attachManualEvidence']>) => {
  return (await loadDesktopRuntime()).attachManualEvidence(...args);
};

export const acceptMaintenanceDraft = async (...args: Parameters<DesktopRuntime['acceptMaintenanceDraft']>) => {
  return (await loadDesktopRuntime()).acceptMaintenanceDraft(...args);
};

export const analyzePrdDocument = async (...args: Parameters<DesktopRuntime['analyzePrdDocument']>) => {
  return (await loadDesktopRuntime()).analyzePrdDocument(...args);
};

export const captureBrowserSnapshot = async (...args: Parameters<DesktopRuntime['captureBrowserSnapshot']>) => {
  return (await loadDesktopRuntime()).captureBrowserSnapshot(...args);
};

export const clearModelSecret = async (...args: Parameters<DesktopRuntime['clearModelSecret']>) => {
  return (await loadDesktopRuntime()).clearModelSecret(...args);
};

export const cancelRun = async (...args: Parameters<DesktopRuntime['cancelRun']>) => {
  return (await loadDesktopRuntime()).cancelRun(...args);
};

export const confirmArtifactRetention = async (...args: Parameters<DesktopRuntime['confirmArtifactRetention']>) => {
  return (await loadDesktopRuntime()).confirmArtifactRetention(...args);
};

export const rejectMaintenanceDraft = async (...args: Parameters<DesktopRuntime['rejectMaintenanceDraft']>) => {
  return (await loadDesktopRuntime()).rejectMaintenanceDraft(...args);
};

export const endSession = async (...args: Parameters<DesktopRuntime['endSession']>) => {
  return (await loadDesktopRuntime()).endSession(...args);
};

export const exportProjectReport = async (...args: Parameters<DesktopRuntime['exportProjectReport']>) => {
  return (await loadDesktopRuntime()).exportProjectReport(...args);
};

export const navigateBrowserSession = async (...args: Parameters<DesktopRuntime['navigateBrowserSession']>) => {
  return (await loadDesktopRuntime()).navigateBrowserSession(...args);
};

export const openMaintenanceEvidence = async (...args: Parameters<DesktopRuntime['openMaintenanceEvidence']>) => {
  return (await loadDesktopRuntime()).openMaintenanceEvidence(...args);
};

export const planArtifactRetention = async (...args: Parameters<DesktopRuntime['planArtifactRetention']>) => {
  return (await loadDesktopRuntime()).planArtifactRetention(...args);
};

export const planHistoricalRerun = async (...args: Parameters<DesktopRuntime['planHistoricalRerun']>) => {
  return (await loadDesktopRuntime()).planHistoricalRerun(...args);
};

export const loadSuiteRunRecord = async (...args: Parameters<DesktopRuntime['loadSuiteRunRecord']>) => {
  return (await loadDesktopRuntime()).loadSuiteRunRecord(...args);
};

export const runRecording = async (...args: Parameters<DesktopRuntime['runRecording']>) => {
  return (await loadDesktopRuntime()).runRecording(...args);
};

export const runHistoricalRerun = async (...args: Parameters<DesktopRuntime['runHistoricalRerun']>) => {
  return (await loadDesktopRuntime()).runHistoricalRerun(...args);
};

export const runSuite = async (...args: Parameters<DesktopRuntime['runSuite']>) => {
  return (await loadDesktopRuntime()).runSuite(...args);
};

export const runTestCase = async (...args: Parameters<DesktopRuntime['runTestCase']>) => {
  return (await loadDesktopRuntime()).runTestCase(...args);
};

export const runWorkflow = async (...args: Parameters<DesktopRuntime['runWorkflow']>) => {
  return (await loadDesktopRuntime()).runWorkflow(...args);
};

export const saveCredential = async (...args: Parameters<DesktopRuntime['saveCredential']>) => {
  return (await loadDesktopRuntime()).saveCredential(...args);
};

export const saveModelSecret = async (...args: Parameters<DesktopRuntime['saveModelSecret']>) => {
  return (await loadDesktopRuntime()).saveModelSecret(...args);
};

export const sendChatCommand = async (...args: Parameters<DesktopRuntime['sendChatCommand']>) => {
  return (await loadDesktopRuntime()).sendChatCommand(...args);
};

export const startBrowserSession = async (...args: Parameters<DesktopRuntime['startBrowserSession']>) => {
  return (await loadDesktopRuntime()).startBrowserSession(...args);
};

export const startSession = async (...args: Parameters<DesktopRuntime['startSession']>) => {
  return (await loadDesktopRuntime()).startSession(...args);
};

export const testMidsceneConnection = async (...args: Parameters<DesktopRuntime['testMidsceneConnection']>) => {
  return (await loadDesktopRuntime()).testMidsceneConnection(...args);
};
