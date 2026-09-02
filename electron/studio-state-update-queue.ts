import {
  mergeProjectAssetBindings,
  type AgentModelRole,
  type ModelSecretRef,
  type ModelSecretScope,
  type ProjectDraft,
  type SuiteRunRecord,
  type StudioState,
} from '../shared/studio.js';

export interface StudioStatePersistence {
  load(): Promise<StudioState>;
  save(state: StudioState): Promise<StudioState>;
}

export class StudioStateUpdateQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly store: StudioStatePersistence) {}

  update(
    updater: (current: StudioState) => StudioState | Promise<StudioState>,
    options: { preserveModelSecretRefs?: boolean } = {},
  ): Promise<StudioState> {
    const preserveModelSecretRefs = options.preserveModelSecretRefs ?? true;
    return this.enqueue(async () => {
      const current = await this.store.load();
      const next = await updater(current);
      return this.store.save(
        preserveModelSecretRefs ? preserveCurrentModelSecretRefs(current, next) : next,
      );
    });
  }

  saveRendererState(incoming: StudioState): Promise<StudioState> {
    try {
      assertNoRendererModelApiKey(incoming);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.update((current) => mergeRendererStudioState(current, incoming));
  }

  /** Accepts state assembled by trusted main-process runtime execution only. */
  saveRuntimeState(incoming: StudioState): Promise<StudioState> {
    return this.update((current) => mergeRuntimeStudioState(current, incoming));
  }

  /** Runs a trusted main-process runtime mutation against the latest queued state. */
  updateRuntimeState(
    updater: (current: StudioState) => StudioState | Promise<StudioState>,
  ): Promise<StudioState> {
    return this.update(updater);
  }

  createRendererProject(project: ProjectDraft): Promise<StudioState> {
    try {
      assertNoRendererModelApiKey(project);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.update((state) => ({
      ...state,
      selectedProjectId: project.id,
      selectedGroupId: project.groups[0]?.id ?? '',
      selectedTestCaseId: project.testCases[0]?.id ?? '',
      projects: [project, ...state.projects],
    }));
  }

  updateRendererProject(project: ProjectDraft): Promise<StudioState> {
    try {
      assertNoRendererModelApiKey(project);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.update((state) => ({
      ...state,
      projects: state.projects.map((item) => (item.id === project.id ? project : item)),
    }));
  }

  saveModelSecretRef(scope: ModelSecretScope, modelSecret: ModelSecretRef): Promise<StudioState> {
    return this.update(
      (current) => withModelSecretRef(current, scope, modelSecret),
      { preserveModelSecretRefs: false },
    );
  }

  private enqueue(operation: () => Promise<StudioState>): Promise<StudioState> {
    const queued = this.tail.then(operation);
    this.tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }
}

export const mergeRendererStudioState = (current: StudioState, incoming: StudioState): StudioState => {
  const merged = {
    ...incoming,
    projectAssetBindings: mergeProjectAssetBindings(
      current.projectAssetBindings,
      incoming.projectAssetBindings,
      incoming.projects,
    ),
    // Suite history is owned by the Electron runtime, never by a renderer snapshot.
    suiteRunRecords: current.suiteRunRecords,
  };
  return preserveCurrentModelSecretRefs(current, merged);
};

/** Merges Suite records emitted by trusted main-process runtime persistence. */
export const mergeRuntimeStudioState = (current: StudioState, incoming: StudioState): StudioState => {
  const merged = {
    ...incoming,
    projectAssetBindings: mergeProjectAssetBindings(
      current.projectAssetBindings,
      incoming.projectAssetBindings,
      incoming.projects,
    ),
    suiteRunRecords: mergeRuntimeSuiteRunRecords(current.suiteRunRecords, incoming.suiteRunRecords),
  };
  return preserveCurrentModelSecretRefs(current, merged);
};

const mergeRuntimeSuiteRunRecords = (
  current: readonly SuiteRunRecord[],
  incoming: readonly SuiteRunRecord[],
): SuiteRunRecord[] => {
  const currentById = new Map(current.map((record) => [record.id, record]));
  const merged = incoming.map((record) => {
    const persisted = currentById.get(record.id);
    if (persisted) {
      currentById.delete(record.id);
      return preferredSuiteRunRecord(persisted, record);
    }
    return record;
  });
  return [...merged, ...currentById.values()];
};

const preferredSuiteRunRecord = (
  current: SuiteRunRecord,
  incoming: SuiteRunRecord,
): SuiteRunRecord => {
  const currentTerminal = current.status !== 'running';
  const incomingTerminal = incoming.status !== 'running';
  if (currentTerminal !== incomingTerminal) {
    return currentTerminal ? current : incoming;
  }
  if (!currentTerminal) {
    return durableSuiteFacts(incoming) > durableSuiteFacts(current) ? incoming : current;
  }

  const currentFinishedAt = completionTime(current);
  const incomingFinishedAt = completionTime(incoming);
  if (currentFinishedAt !== incomingFinishedAt) {
    return incomingFinishedAt > currentFinishedAt ? incoming : current;
  }
  return durableSuiteFacts(incoming) > durableSuiteFacts(current) ? incoming : current;
};

const completionTime = (record: SuiteRunRecord): number => {
  const timestamp = record.finishedAt ? Date.parse(record.finishedAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const durableSuiteFacts = (record: SuiteRunRecord): number => {
  const members = record.members ?? [];
  return record.memberRunIds.length * 3 + members.length * 4 +
    members.filter((member) => member.runId).length +
    (record.reasonCode ? 1 : 0) +
    Object.values(record.summary).reduce((total, count) => total + count, 0);
};

export const modelApiKeyValidationErrorMessage = '渲染进程状态包含不允许的模型密钥字段。';

/** Reject raw model keys from untrusted IPC payloads without exposing their values. */
export const assertNoRendererModelApiKey = (value: unknown): void => {
  if (containsModelApiKey(value, new WeakSet<object>())) {
    throw new Error(modelApiKeyValidationErrorMessage);
  }
};

const containsModelApiKey = (value: unknown, visited: WeakSet<object>): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (visited.has(value)) {
    return false;
  }
  visited.add(value);

  return Object.entries(value).some(([key, nestedValue]) =>
    key === 'modelApiKey' ||
    (key === 'midsceneConfig' && containsLegacyApiKey(nestedValue)) ||
    (key === 'agentModelConfig' && containsLegacyAgentModelApiKey(nestedValue)) ||
    containsModelApiKey(nestedValue, visited),
  );
};

const containsLegacyApiKey = (value: unknown): boolean => {
  return Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'apiKey'));
};

const containsLegacyAgentModelApiKey = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return (['planner', 'executor', 'verifier', 'reporter'] as AgentModelRole[])
    .some((role) => containsLegacyApiKey((value as Partial<Record<AgentModelRole, unknown>>)[role]));
};

const withModelSecretRef = (
  state: StudioState,
  scope: ModelSecretScope,
  modelSecret: ModelSecretRef,
): StudioState => {
  if (scope === 'midscene') {
    return {
      ...state,
      midsceneConfig: {
        ...state.midsceneConfig,
        modelSecret,
      },
    };
  }

  const role = scope.slice('agent:'.length) as AgentModelRole;
  return {
    ...state,
    agentModelConfig: {
      ...state.agentModelConfig,
      [role]: {
        ...state.agentModelConfig[role],
        modelSecret,
      },
    },
  };
};

const preserveCurrentModelSecretRefs = (current: StudioState, incoming: StudioState): StudioState => {
  return {
    ...incoming,
    midsceneConfig: {
      ...incoming.midsceneConfig,
      modelSecret: current.midsceneConfig.modelSecret,
    },
    agentModelConfig: {
      ...incoming.agentModelConfig,
      planner: {
        ...incoming.agentModelConfig.planner,
        modelSecret: current.agentModelConfig.planner.modelSecret,
      },
      executor: {
        ...incoming.agentModelConfig.executor,
        modelSecret: current.agentModelConfig.executor.modelSecret,
      },
      verifier: {
        ...incoming.agentModelConfig.verifier,
        modelSecret: current.agentModelConfig.verifier.modelSecret,
      },
      reporter: {
        ...incoming.agentModelConfig.reporter,
        modelSecret: current.agentModelConfig.reporter.modelSecret,
      },
    },
  };
};
