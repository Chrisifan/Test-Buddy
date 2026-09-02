import type { MaintenanceDraft } from '../maintenance.js';
import type {
  AgentModelConfig,
  AgentModelRole,
  AgentRoleModelConfig,
  MidsceneConfig,
  ProjectAssetBinding,
  ProjectDraft,
  RunCancellation,
  RunDetail,
  RunSummary,
  StartupGuideState,
  StudioState,
  TestCaseDraft,
  WorkflowDraft,
} from '../studio.js';
import { createInitialStudioState } from './defaults.js';
import { findTestCaseVersion, listLatestTestCaseVersions } from './test-cases.js';

export interface StudioStateHydrationDependencies {
  normalizeProjectDraft: (project: ProjectDraft) => ProjectDraft;
  normalizeMaintenanceDrafts: (value: unknown) => MaintenanceDraft[];
  testCaseToWorkflow: (testCase: TestCaseDraft) => WorkflowDraft;
}

const builtInMockProjectId = 'project-demo';
const builtInMockChatEntryIds = new Set(['chat-001', 'chat-002', 'chat-003']);

export const createStudioStateHydrator = (dependencies: StudioStateHydrationDependencies) => (
  rawState: Partial<StudioState> | null | undefined,
): StudioState => {
  const initialState = createInitialStudioState();
  if (!rawState) {
    return initialState;
  }

  const migratedProjects = Array.isArray(rawState.projects)
    ? rawState.projects
        .filter((project) => project?.id !== builtInMockProjectId)
        .map(dependencies.normalizeProjectDraft)
    : [];
  const projectAssetBindings = normalizeProjectAssetBindings(rawState.projectAssetBindings, migratedProjects);

  const selectedProjectId =
    rawState.selectedProjectId && migratedProjects.some((project) => project.id === rawState.selectedProjectId)
      ? rawState.selectedProjectId
      : migratedProjects[0]?.id ?? '';
  const selectedProject = migratedProjects.find((project) => project.id === selectedProjectId);
  const selectedGroupId =
    rawState.selectedGroupId && selectedProject?.groups.some((group) => group.id === rawState.selectedGroupId)
      ? rawState.selectedGroupId
      : selectedProject?.groups[0]?.id ?? '';
  const legacySelectedTestCaseId =
    rawState.selectedTestCaseId &&
    selectedProject?.testCases.some((testCase) => testCase.id === rawState.selectedTestCaseId)
      ? rawState.selectedTestCaseId
      : selectedProject?.testCases[0]?.id ?? '';
  const selectedTestCaseReference =
    rawState.selectedTestCaseReference && selectedProject && findTestCaseVersion(selectedProject, rawState.selectedTestCaseReference)
      ? rawState.selectedTestCaseReference
      : legacySelectedTestCaseId
        ? (() => {
            const latest = listLatestTestCaseVersions(selectedProject ?? { testCases: [] })
              .find((testCase) => testCase.id === legacySelectedTestCaseId);
            return latest ? { id: latest.id, version: normalizeTestCaseVersion(latest.version) } : undefined;
          })()
        : undefined;
  const selectedRecordingId =
    rawState.selectedRecordingId &&
    selectedProject?.recordings.some((recording) => recording.id === rawState.selectedRecordingId)
      ? rawState.selectedRecordingId
      : selectedProject?.recordings[0]?.id ?? '';
  const rawMidsceneConfig = (rawState.midsceneConfig ?? {}) as Partial<MidsceneConfig> & {
    apiKey?: unknown;
    endpoint?: string;
    modelApiKey?: unknown;
    workspaceName?: string;
  };
  const {
    apiKey: _legacyMidsceneApiKey,
    modelApiKey: _legacyModelApiKey,
    ...keyFreeMidsceneConfig
  } = rawMidsceneConfig;
  const hydratedMidsceneConfig = {
    ...initialState.midsceneConfig,
    ...keyFreeMidsceneConfig,
    modelBaseUrl: rawMidsceneConfig.modelBaseUrl ?? rawMidsceneConfig.endpoint ?? '',
    modelName: rawMidsceneConfig.modelName ?? rawMidsceneConfig.workspaceName ?? '',
  };
  const rawAgentModelConfig = (rawState.agentModelConfig ?? {}) as Partial<AgentModelConfig>;
  const hydratedAgentModelConfig = (Object.keys(initialState.agentModelConfig) as AgentModelRole[]).reduce(
    (nextConfig, role) => ({
      ...nextConfig,
      [role]: {
        ...initialState.agentModelConfig[role],
        ...withoutLegacyModelApiKey(rawAgentModelConfig[role]),
      },
    }),
    {} as AgentModelConfig,
  );
  const rawStartupGuide: Partial<StartupGuideState> = rawState.startupGuide ?? {};
  const runDetails = Array.isArray(rawState.runDetails)
    ? rawState.runDetails
      .filter((run) => run.projectId !== builtInMockProjectId)
      .map(migrateLegacyRunDetail)
    : initialState.runDetails;
  const suiteRunRecords = Array.isArray(rawState.suiteRunRecords)
    ? rawState.suiteRunRecords.map((record) => ({
      ...structuredClone(record),
      members: Array.isArray(record.members) ? structuredClone(record.members) : [],
    }))
    : initialState.suiteRunRecords;
  const recentRuns = Array.isArray(rawState.recentRuns)
    ? rawState.recentRuns
      .filter((run) => run.projectId !== builtInMockProjectId)
      .map((run) => migrateLegacyRunSummary(run, findUnambiguousMatchingRunDetail(run, runDetails)))
    : initialState.recentRuns;

  return {
    selectedProjectId,
    selectedGroupId,
    ...(selectedTestCaseReference ? { selectedTestCaseReference } : {}),
    selectedRecordingId,
    projects: migratedProjects,
    projectAssetBindings,
    runDetails,
    suiteRunRecords,
    maintenanceDrafts: dependencies.normalizeMaintenanceDrafts(rawState.maintenanceDrafts),
    recentRuns,
    chatEntries: Array.isArray(rawState.chatEntries)
      ? rawState.chatEntries.filter((entry) => !builtInMockChatEntryIds.has(entry.id))
      : initialState.chatEntries,
    runtimeProfile: {
      ...initialState.runtimeProfile,
      ...(rawState.runtimeProfile ?? {}),
      baseUrl:
        rawState.runtimeProfile?.baseUrl === 'https://demo-shop.local'
          ? ''
          : rawState.runtimeProfile?.baseUrl ?? initialState.runtimeProfile.baseUrl,
    },
    midsceneConfig: hydratedMidsceneConfig,
    agentModelConfig: hydratedAgentModelConfig,
    appearance: {
      ...initialState.appearance,
      ...(rawState.appearance ?? {}),
    },
    startupGuide: {
      ...initialState.startupGuide,
      ...rawStartupGuide,
      completed: rawStartupGuide.completed ?? isMidsceneConfigured(hydratedMidsceneConfig),
    },
    // A Playwright page belongs to the Electron process and cannot outlive it.
    // Restoring its former status would display stale errors or a false-ready state.
    browserSession: initialState.browserSession,
    selectedWorkflowId: selectedTestCaseReference?.id ?? '',
    workflows: selectedProject?.testCases.map(dependencies.testCaseToWorkflow) ?? initialState.workflows,
  };
};

const migrateLegacyRunDetail = (run: RunDetail): RunDetail => {
  if ((run as { status?: unknown }).status !== 'neutral') {
    return run;
  }

  return {
    ...run,
    ...classifyLegacyNeutralRun(run.cancellation),
  };
};

const migrateLegacyRunSummary = (run: RunSummary, detail?: RunDetail): RunSummary => {
  if ((run as { status?: unknown }).status !== 'neutral') {
    return run;
  }

  if (detail && isTerminalRunStatus(detail.status)) {
    return {
      ...run,
      status: detail.status,
      ...(detail.reason ? { reason: detail.reason } : {}),
    };
  }

  return {
    ...run,
    ...classifyLegacyNeutralRun(),
  };
};

export const findUnambiguousMatchingRunDetail = (summary: RunSummary, details: RunDetail[]): RunDetail | undefined => {
  const sameId = details.filter((detail) => detail.id === summary.id);
  const hasProjectId = summary.projectId !== undefined;
  const hasTestCaseId = summary.testCaseId !== undefined;
  const hasEnvironmentId = summary.environmentId !== undefined;
  if (!hasProjectId && !hasTestCaseId && !hasEnvironmentId) {
    return sameId.length === 1 ? sameId[0] : undefined;
  }

  const matches = sameId.filter((detail) =>
    (!hasProjectId || detail.projectId === summary.projectId) &&
    (!hasTestCaseId || detail.testCaseId === summary.testCaseId) &&
    (!hasEnvironmentId || detail.environmentId === summary.environmentId),
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const classifyLegacyNeutralRun = (cancellationValue?: unknown): Pick<RunDetail, 'status' | 'reason'> => {
  const cancellation = normalizeLegacyUserCancellation(cancellationValue);
  if (cancellation) {
    return {
      status: 'cancelled',
      reason: {
        code: 'userCancelled',
        message: cancellation.message,
      },
    };
  }

  return {
    status: 'blocked',
    reason: {
      code: 'legacyAmbiguousNeutral',
      message: 'Legacy neutral run could not be classified from structured evidence.',
    },
  };
};

const normalizeLegacyUserCancellation = (value: unknown): RunCancellation | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const cancellation = value as Partial<RunCancellation>;
  return cancellation.source === 'user' &&
    cancellation.reason === 'userCancelled' &&
    typeof cancellation.message === 'string' &&
    cancellation.message.trim() &&
    typeof cancellation.cancelledAt === 'string'
    ? {
        source: 'user',
        reason: 'userCancelled',
        message: cancellation.message,
        cancelledAt: cancellation.cancelledAt,
      }
    : undefined;
};

/** Drops malformed or stale pointers without reading any external project directory. */
export const normalizeProjectAssetBindings = (
  rawBindings: unknown,
  projects: Array<Pick<ProjectDraft, 'id'>>,
): ProjectAssetBinding[] => {
  if (!Array.isArray(rawBindings)) {
    return [];
  }

  const projectIds = new Set(projects.map((project) => project.id));
  const seenProjectIds = new Set<string>();
  return rawBindings.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }

    const binding = candidate as Partial<ProjectAssetBinding>;
    if (
      typeof binding.projectId !== 'string' ||
      !projectIds.has(binding.projectId) ||
      seenProjectIds.has(binding.projectId) ||
      typeof binding.projectDirectory !== 'string' ||
      !binding.projectDirectory.trim() ||
      typeof binding.revision !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(binding.revision) ||
      typeof binding.boundAt !== 'string' ||
      Number.isNaN(Date.parse(binding.boundAt))
    ) {
      return [];
    }

    seenProjectIds.add(binding.projectId);
    return [{
      projectId: binding.projectId,
      projectDirectory: binding.projectDirectory,
      revision: binding.revision,
      boundAt: binding.boundAt,
    }];
  });
};

/**
 * Renderer saves carry the full editing state and can be queued behind an IPC
 * that records a new asset binding. Preserve existing bindings unless the
 * incoming state supplies a newer pointer for the same surviving project.
 */
export const mergeProjectAssetBindings = (
  currentBindings: unknown,
  incomingBindings: unknown,
  projects: Array<Pick<ProjectDraft, 'id'>>,
): ProjectAssetBinding[] => {
  const currentByProjectId = new Map(
    normalizeProjectAssetBindings(currentBindings, projects).map((binding) => [binding.projectId, binding]),
  );
  const incomingByProjectId = new Map(
    normalizeProjectAssetBindings(incomingBindings, projects).map((binding) => [binding.projectId, binding]),
  );

  return projects.flatMap((project) => {
    const currentBinding = currentByProjectId.get(project.id);
    const incomingBinding = incomingByProjectId.get(project.id);
    const binding = currentBinding && incomingBinding
      ? Date.parse(incomingBinding.boundAt) >= Date.parse(currentBinding.boundAt)
        ? incomingBinding
        : currentBinding
      : incomingBinding ?? currentBinding;
    return binding ? [binding] : [];
  });
};

export const isMidsceneConfigured = (config: MidsceneConfig): boolean => {
  return Boolean(
    config.modelBaseUrl.trim() &&
      config.modelSecret.hasKey &&
      config.modelName.trim() &&
      config.modelFamily.trim(),
  );
};

const withoutLegacyModelApiKey = (config: Partial<AgentRoleModelConfig> | undefined): Partial<AgentRoleModelConfig> => {
  if (!config) {
    return {};
  }
  const {
    apiKey: _legacyApiKey,
    modelApiKey: _legacyModelApiKey,
    ...keyFreeConfig
  } = config as Partial<AgentRoleModelConfig> & {
    apiKey?: unknown;
    modelApiKey?: unknown;
  };
  return keyFreeConfig;
};

const isTerminalRunStatus = (status: RunSummary['status']): boolean => {
  return status !== 'running';
};

const normalizeTestCaseVersion = (value: unknown): number => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
};
