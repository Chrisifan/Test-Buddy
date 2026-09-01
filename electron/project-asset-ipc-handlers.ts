import {
  calculateProjectAssetRevision,
  planProjectAssetReload,
  planProjectAssetUpdate,
  ProjectAssetStore,
  type ProjectAssetReadResult,
} from './projectAssetStore.js';
import {
  mergeProjectAssetBindings,
  normalizeProjectAssetBindings,
  type ProjectAssetBinding,
  type ProjectAssetMigrationPlan,
  type ProjectAssetMigrationRequest,
  type ProjectAssetReloadPlan,
  type ProjectAssetReloadRequest,
  type ProjectAssetReloadResult,
  type ProjectAssetUpdatePlan,
  type ProjectAssetUpdateRequest,
  type ProjectDraft,
  type StudioState,
} from '../shared/studio.js';
import {
  assertNoRendererModelApiKey,
  modelApiKeyValidationErrorMessage,
} from './studio-state-update-queue.js';

export { modelApiKeyValidationErrorMessage } from './studio-state-update-queue.js';

export const projectAssetIpcChannels = {
  planMigration: 'studio:plan-project-asset-migration',
  writeSnapshot: 'studio:write-project-asset-snapshot',
  planReload: 'studio:plan-project-asset-reload',
  reloadSnapshot: 'studio:reload-project-asset-snapshot',
  planUpdate: 'studio:plan-project-asset-update',
  updateSnapshot: 'studio:update-project-asset-snapshot',
} as const;

type ProjectAssetStoreOperations = Pick<
  ProjectAssetStore,
  'planMigration' | 'saveInitial' | 'save' | 'loadWithRevision'
>;

export interface ProjectAssetIpcDependencies {
  handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void;
  getApprovedProjectAssetDirectory(request: ProjectAssetMigrationRequest): Promise<string>;
  releaseApprovedProjectAssetDirectory(projectDirectory: string): void;
  loadState(): Promise<StudioState>;
  updateState(updater: (state: StudioState) => StudioState | Promise<StudioState>): Promise<StudioState>;
  createAssetStore(projectDirectory: string): ProjectAssetStoreOperations;
  createProjectAssetReloadPlan(project: ProjectDraft, binding: ProjectAssetBinding): Promise<ProjectAssetReloadPlan>;
  createProjectAssetUpdatePlan(project: ProjectDraft, binding: ProjectAssetBinding): Promise<ProjectAssetUpdatePlan>;
  now(): Date;
}

export const registerProjectAssetIpcHandlers = (dependencies: ProjectAssetIpcDependencies): void => {
  dependencies.handle(projectAssetIpcChannels.planMigration, async (_event, incoming) => {
    const request = assertMigrationRequestWithoutModelKey(incoming);
    const projectDirectory = await dependencies.getApprovedProjectAssetDirectory(request);
    const project = await getProjectForAssetRequest(dependencies, request);
    return dependencies.createAssetStore(projectDirectory).planMigration(project);
  });

  dependencies.handle(projectAssetIpcChannels.writeSnapshot, async (_event, incoming): Promise<ProjectAssetBinding> => {
    const request = assertMigrationRequestWithoutModelKey(incoming);
    const projectDirectory = await dependencies.getApprovedProjectAssetDirectory(request);
    const project = await getProjectForAssetRequest(dependencies, request);
    try {
      if (request.plannedRevision !== calculateProjectAssetRevision(project)) {
        throw new Error('项目配置已变化，请重新生成资产快照计划。');
      }
      const assetStore = dependencies.createAssetStore(projectDirectory);
      await assetStore.saveInitial(project);
      const snapshot = await assetStore.loadWithRevision();
      assertNoRendererModelApiKey(snapshot.project);
      const binding: ProjectAssetBinding = {
        projectId: project.id,
        projectDirectory,
        revision: snapshot.revision,
        boundAt: dependencies.now().toISOString(),
      };
      await dependencies.updateState((state) => {
        if (!state.projects.some((candidate) => candidate.id === project.id)) {
          throw new Error('项目已被删除，无法登记资产快照。');
        }
        return {
          ...state,
          projects: state.projects.map((candidate) => candidate.id === project.id ? project : candidate),
          projectAssetBindings: mergeProjectAssetBindings(
            state.projectAssetBindings,
            [binding],
            state.projects,
          ),
        };
      });
      return binding;
    } finally {
      dependencies.releaseApprovedProjectAssetDirectory(projectDirectory);
    }
  });

  dependencies.handle(projectAssetIpcChannels.planReload, async (_event, incoming): Promise<ProjectAssetReloadPlan> => {
    const request = assertReloadRequestWithoutModelKey(incoming);
    return createProjectAssetReloadPlan(dependencies, request);
  });

  dependencies.handle(projectAssetIpcChannels.reloadSnapshot, async (_event, incoming): Promise<ProjectAssetReloadResult> => {
    const request = assertReloadRequestWithoutModelKey(incoming);
    const { binding: currentBinding } = await getBoundProjectAssetReloadRequest(dependencies, request);
    const plan = await createProjectAssetReloadPlan(dependencies, request);
    if (plan.status !== 'ready' || !plan.snapshotRevision || plan.snapshotRevision !== request.snapshotRevision) {
      throw new Error('项目资产重载计划已失效，请重新生成计划。');
    }
    const snapshot = await dependencies.createAssetStore(currentBinding.projectDirectory).loadWithRevision();
    assertNoRendererModelApiKey(snapshot.project);
    if (snapshot.project.id !== request.projectId || snapshot.revision !== request.snapshotRevision) {
      throw new Error('项目资产目录已变化，请重新生成计划。');
    }
    const binding: ProjectAssetBinding = {
      ...currentBinding,
      revision: snapshot.revision,
      boundAt: dependencies.now().toISOString(),
    };
    await dependencies.updateState((state) => {
      if (!state.projects.some((candidate) => candidate.id === snapshot.project.id)) {
        throw new Error('项目已删除，无法登记资产快照。');
      }
      return {
        ...state,
        projects: state.projects.map((candidate) => candidate.id === snapshot.project.id ? snapshot.project : candidate),
        projectAssetBindings: mergeProjectAssetBindings(
          state.projectAssetBindings,
          [binding],
          state.projects,
        ),
      };
    });
    return { project: snapshot.project, binding };
  });

  dependencies.handle(projectAssetIpcChannels.planUpdate, async (_event, incoming): Promise<ProjectAssetUpdatePlan> => {
    const request = assertUpdateRequestWithoutModelKey(incoming);
    return createProjectAssetUpdatePlan(dependencies, request);
  });

  dependencies.handle(projectAssetIpcChannels.updateSnapshot, async (_event, incoming): Promise<ProjectAssetBinding> => {
    const request = assertUpdateRequestWithoutModelKey(incoming);
    const { binding: expectedBinding } = await getBoundProjectAssetUpdateRequest(dependencies, request);
    const plan = await createProjectAssetUpdatePlan(dependencies, request);
    if (
      plan.status !== 'ready' ||
      !plan.snapshotRevision ||
      plan.snapshotRevision !== request.plannedRevision ||
      plan.publishedRevision !== expectedBinding.revision
    ) {
      throw new Error('项目资产更新计划已失效，请重新生成计划。');
    }

    const assetStore = dependencies.createAssetStore(expectedBinding.projectDirectory);
    await assetStore.save(request.project, expectedBinding.revision);
    const snapshot = await assetStore.loadWithRevision();
    assertNoRendererModelApiKey(snapshot.project);
    if (snapshot.project.id !== request.projectId || snapshot.revision !== request.plannedRevision) {
      throw new Error('项目资产快照提交结果不一致，请刷新状态后再试。');
    }

    const binding: ProjectAssetBinding = {
      projectId: request.projectId,
      projectDirectory: expectedBinding.projectDirectory,
      revision: snapshot.revision,
      boundAt: dependencies.now().toISOString(),
    };
    await dependencies.updateState((state) => {
      if (!state.projects.some((candidate) => candidate.id === request.projectId)) {
        throw new Error('项目已删除，资产快照已发布但无法登记绑定。');
      }
      return {
        ...state,
        projectAssetBindings: mergeProjectAssetBindings(
          state.projectAssetBindings,
          [binding],
          state.projects,
        ),
      };
    });
    return binding;
  });
};

const assertMigrationRequestWithoutModelKey = (value: unknown): ProjectAssetMigrationRequest => {
  assertNoRendererModelApiKey(value);
  return value as ProjectAssetMigrationRequest;
};

const assertReloadRequestWithoutModelKey = (value: unknown): ProjectAssetReloadRequest => {
  assertNoRendererModelApiKey(value);
  return value as ProjectAssetReloadRequest;
};

const assertUpdateRequestWithoutModelKey = (value: unknown): ProjectAssetUpdateRequest => {
  assertNoRendererModelApiKey(value);
  return value as ProjectAssetUpdateRequest;
};

const getProjectForAssetRequest = async (
  dependencies: ProjectAssetIpcDependencies,
  request: ProjectAssetMigrationRequest,
): Promise<ProjectDraft> => {
  const state = await dependencies.loadState();
  const project = state.projects.find((item) => item.id === request.projectId);
  if (!project) {
    throw new Error('项目不存在，无法生成资产快照。');
  }
  if (request.project && typeof request.project === 'object' && request.project.id === project.id) {
    return request.project;
  }
  return project;
};

const getBoundProjectAssetReloadRequest = async (
  dependencies: ProjectAssetIpcDependencies,
  request: ProjectAssetReloadRequest,
): Promise<{ binding: ProjectAssetBinding; project: ProjectDraft; storedProject: ProjectDraft }> => {
  if (!request || typeof request.projectId !== 'string' || !request.projectId.trim() || !request.project || request.project.id !== request.projectId) {
    throw new Error('项目资产重载请求无效。');
  }
  const state = await dependencies.loadState();
  const storedProject = state.projects.find((candidate) => candidate.id === request.projectId);
  if (!storedProject) {
    throw new Error('项目不存在，无法重载资产快照。');
  }
  const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
    .find((candidate) => candidate.projectId === request.projectId);
  if (!binding) {
    throw new Error('项目尚未登记资产快照，无法重载。');
  }
  return { binding, project: request.project, storedProject };
};

const createProjectAssetReloadPlan = async (
  dependencies: ProjectAssetIpcDependencies,
  request: ProjectAssetReloadRequest,
): Promise<ProjectAssetReloadPlan> => {
  const { binding, project, storedProject } = await getBoundProjectAssetReloadRequest(dependencies, request);
  const plan = await dependencies.createProjectAssetReloadPlan(project, binding);
  if (calculateProjectAssetRevision(storedProject) === binding.revision || plan.status === 'unavailable') {
    return plan;
  }
  return {
    ...plan,
    status: 'requiresReview',
    issues: [
      ...plan.issues,
      { path: 'studio-data', message: '持久化项目已变化，请先刷新本地编辑态。' },
    ],
  };
};

const getBoundProjectAssetUpdateRequest = async (
  dependencies: ProjectAssetIpcDependencies,
  request: ProjectAssetUpdateRequest,
): Promise<{ binding: ProjectAssetBinding; project: ProjectDraft; storedProject: ProjectDraft }> => {
  if (!request || typeof request.projectId !== 'string' || !request.projectId.trim() || !request.project || request.project.id !== request.projectId) {
    throw new Error('项目资产更新请求无效。');
  }
  const state = await dependencies.loadState();
  const storedProject = state.projects.find((candidate) => candidate.id === request.projectId);
  if (!storedProject) {
    throw new Error('项目不存在，无法更新资产快照。');
  }
  const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
    .find((candidate) => candidate.projectId === request.projectId);
  if (!binding) {
    throw new Error('项目尚未登记资产快照，无法更新。');
  }
  return { binding, project: request.project, storedProject };
};

const createProjectAssetUpdatePlan = async (
  dependencies: ProjectAssetIpcDependencies,
  request: ProjectAssetUpdateRequest,
): Promise<ProjectAssetUpdatePlan> => {
  const { binding, project, storedProject } = await getBoundProjectAssetUpdateRequest(dependencies, request);
  const plan = await dependencies.createProjectAssetUpdatePlan(project, binding);
  const issues = [...plan.issues];
  if (request.expectedRevision !== binding.revision) {
    issues.push({ path: 'projectAssetBindings.revision', message: '资产快照绑定已变化，请重新生成更新计划。' });
  }
  if (calculateProjectAssetRevision(storedProject) !== calculateProjectAssetRevision(project)) {
    issues.push({ path: 'studio-data', message: '持久化项目已变化，请先刷新本地编辑态。' });
  }
  if (!issues.length || plan.status === 'unavailable') {
    return plan;
  }
  return { ...plan, status: 'requiresReview', issues };
};
