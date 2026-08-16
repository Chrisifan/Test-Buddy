import type {
  BrowserSessionState,
  ProjectEnvironment,
  RunTestCaseResponse,
  SuiteRunRecord,
  StudioState,
} from '../../shared/studio.js';

export function appendRunToStudioState(
  state: StudioState,
  result: RunTestCaseResponse,
  environment: ProjectEnvironment,
  browserSession: BrowserSessionState,
): StudioState {
  const detail = copyDetailWithFrozenProvenance(result.detail);
  return {
    ...state,
    runDetails: [detail, ...state.runDetails.filter((run) => run.id !== result.runId)],
    recentRuns: [
      {
        id: detail.id,
        name: detail.title,
        status: detail.status,
        duration: detail.duration,
        summary: detail.summary,
        projectId: detail.projectId,
        testCaseId: detail.testCaseId,
        ...(detail.documentId ? { documentId: detail.documentId } : {}),
        environmentId: detail.environmentId,
        environmentName: environment.name,
        startedAt: detail.startedAt,
      },
      ...state.recentRuns.filter((run) => run.id !== detail.id),
    ],
    browserSession,
  };
}

/** Persists one Suite parent without adding a fabricated Case detail. */
export function appendSuiteRunToStudioState(
  state: StudioState,
  record: SuiteRunRecord,
): StudioState {
  const existingRecords = Array.isArray(state.suiteRunRecords) ? state.suiteRunRecords : [];
  const persistedRecord = {
    ...structuredClone(record),
    provenance: deepFreeze(structuredClone(record.provenance)),
  };
  return {
    ...state,
    suiteRunRecords: [
      persistedRecord,
      ...existingRecords.filter((candidate) => candidate.id !== record.id),
    ],
  };
}

function copyDetailWithFrozenProvenance(result: RunTestCaseResponse['detail']): RunTestCaseResponse['detail'] {
  if (!result.provenance) {
    return result;
  }
  return {
    ...result,
    provenance: deepFreeze(structuredClone(result.provenance)),
  };
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
}
