import { normalizeProjectAssetBindings, type ProjectDraft, type ProjectAssetBinding } from '../shared/studio.js';
import { calculateProjectAssetRevision, ProjectAssetStore } from './projectAssetStore.js';
import type { StudioStore } from './studioStore.js';

export interface ProjectSnapshot {
  project: ProjectDraft;
  revision: string;
  source: 'projectDirectory' | 'legacyStudioStore';
  reproducibility: 'versioned' | 'legacy';
}

export type ProjectRepositoryErrorCode =
  | 'projectNotFound'
  | 'bindingUnavailable'
  | 'staleProjectRevision'
  | 'projectRevisionChanged';

export class ProjectRepositoryError extends Error {
  constructor(
    readonly code: ProjectRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectRepositoryError';
  }
}

/** Loads one execution-authoritative project snapshot from its bound source. */
export class ProjectRepository {
  constructor(
    private readonly dependencies: { studioStore: Pick<StudioStore, 'load'> },
  ) {}

  async load(projectId: string): Promise<ProjectSnapshot> {
    const { project, binding } = await this.readProject(projectId);
    if (binding) {
      return this.loadBoundProject(projectId, binding);
    }

    return {
      project: structuredClone(project),
      revision: calculateProjectAssetRevision(project),
      source: 'legacyStudioStore',
      reproducibility: 'legacy',
    };
  }

  async loadBound(projectId: string, expectedRevision?: string): Promise<ProjectSnapshot> {
    const { binding } = await this.readProject(projectId);
    if (!binding) {
      throw new ProjectRepositoryError(
        'bindingUnavailable',
        `项目 ${projectId} 没有可用的项目资产绑定。`,
      );
    }

    return this.loadBoundProject(projectId, binding, expectedRevision);
  }

  private async readProject(projectId: string): Promise<{ project: ProjectDraft; binding?: ProjectAssetBinding }> {
    const state = await this.dependencies.studioStore.load();
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new ProjectRepositoryError('projectNotFound', `未找到项目：${projectId}。`);
    }

    const binding = normalizeProjectAssetBindings(state.projectAssetBindings, state.projects)
      .find((candidate) => candidate.projectId === projectId);
    return { project, binding };
  }

  private async loadBoundProject(
    projectId: string,
    binding: ProjectAssetBinding,
    expectedRevision?: string,
  ): Promise<ProjectSnapshot> {
    let loaded: Awaited<ReturnType<ProjectAssetStore['loadWithRevision']>>;
    try {
      loaded = await new ProjectAssetStore(binding.projectDirectory).loadWithRevision();
    } catch (error) {
      const detail = error instanceof Error ? `：${error.message}` : '';
      throw new ProjectRepositoryError(
        'bindingUnavailable',
        `无法读取项目 ${projectId} 的已绑定资产目录${detail}`,
      );
    }

    if (loaded.project.id !== projectId) {
      throw new ProjectRepositoryError(
        'projectRevisionChanged',
        `项目 ${projectId} 的已绑定资产目录属于项目 ${loaded.project.id}。`,
      );
    }
    if (loaded.revision !== binding.revision) {
      throw new ProjectRepositoryError(
        'projectRevisionChanged',
        `项目 ${projectId} 的已绑定资产 revision 已变化。`,
      );
    }
    if (expectedRevision !== undefined && expectedRevision !== loaded.revision) {
      throw new ProjectRepositoryError(
        'staleProjectRevision',
        `项目 ${projectId} 的请求 revision 已过期。`,
      );
    }

    return {
      project: structuredClone(loaded.project),
      revision: loaded.revision,
      source: 'projectDirectory',
      reproducibility: 'versioned',
    };
  }
}

export function createProjectRepository(
  dependencies: { studioStore: Pick<StudioStore, 'load'> },
): ProjectRepository {
  return new ProjectRepository(dependencies);
}
