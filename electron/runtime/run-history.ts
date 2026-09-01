import type {
  BrowserSessionState,
  ProjectEnvironment,
  RunTestCaseResponse,
  SuiteRunRecord,
  StudioState,
} from '../../shared/studio.js';

export const appendRunToStudioState = (
  state: StudioState,
  result: RunTestCaseResponse,
  environment: ProjectEnvironment,
  browserSession: BrowserSessionState,
): StudioState => {
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
        ...(detail.reason ? { reason: structuredClone(detail.reason) } : {}),
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
};

/** Persists one Suite parent without adding a fabricated Case detail. */
export const appendSuiteRunToStudioState = (
  state: StudioState,
  record: SuiteRunRecord,
): StudioState => {
  const existingRecords = Array.isArray(state.suiteRunRecords) ? state.suiteRunRecords : [];
  const persistedRecord = deepFreeze({
    ...structuredClone(record),
    members: Array.isArray(record.members) ? structuredClone(record.members) : [],
  });
  return {
    ...state,
    suiteRunRecords: [
      persistedRecord,
      ...existingRecords.filter((candidate) => candidate.id !== record.id),
    ],
  };
};

const copyDetailWithFrozenProvenance = (result: RunTestCaseResponse['detail']): RunTestCaseResponse['detail'] => {
  if (!result.provenance) {
    return result;
  }
  return {
    ...result,
    provenance: deepFreeze(structuredClone(result.provenance)),
  };
};

const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
};
