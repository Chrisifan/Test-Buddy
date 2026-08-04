import type {
  BrowserSessionState,
  ProjectEnvironment,
  RunTestCaseResponse,
  StudioState,
} from '../../shared/studio.js';

export function appendRunToStudioState(
  state: StudioState,
  result: RunTestCaseResponse,
  environment: ProjectEnvironment,
  browserSession: BrowserSessionState,
): StudioState {
  return {
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
        ...(result.detail.documentId ? { documentId: result.detail.documentId } : {}),
        environmentId: result.detail.environmentId,
        environmentName: environment.name,
        startedAt: result.detail.startedAt,
      },
      ...state.recentRuns.filter((run) => run.id !== result.detail.id),
    ],
    browserSession,
  };
}
