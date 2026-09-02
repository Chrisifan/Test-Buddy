import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createInitialStudioState,
} from '../shared/studio.js';
import { calculateProjectAssetRevision } from './projectAssetStore.js';
import {
  modelApiKeyValidationErrorMessage,
  projectAssetIpcChannels,
  registerProjectAssetIpcHandlers,
} from './project-asset-ipc-handlers.js';

type Handler = (event: unknown, request: unknown) => unknown;

describe('registerProjectAssetIpcHandlers', () => {
  it.each([
    projectAssetIpcChannels.planMigration,
    projectAssetIpcChannels.writeSnapshot,
    projectAssetIpcChannels.planReload,
    projectAssetIpcChannels.reloadSnapshot,
    projectAssetIpcChannels.planUpdate,
    projectAssetIpcChannels.updateSnapshot,
  ])('rejects a nested renderer model key before %s loads state, accesses assets, or persists', async (channel) => {
    const project = createEmptyProject(1);
    const submittedKey = `sk-project-asset-${channel}-nested-key`;
    const maliciousProject = {
      ...project,
      rendererOnlyMetadata: {
        connection: {
          modelApiKey: submittedKey,
        },
      },
    };
    const dependencies = createDependencies(project);
    const handlers = registerHandlers(dependencies);
    const rejection = Promise.resolve(handlers.get(channel)!({}, requestFor(channel, maliciousProject)));

    await expect(rejection).rejects.toThrow(modelApiKeyValidationErrorMessage);
    await expect(rejection).rejects.not.toThrow(submittedKey);
    expect(dependencies.loadState).not.toHaveBeenCalled();
    expect(dependencies.getApprovedProjectAssetDirectory).not.toHaveBeenCalled();
    expect(dependencies.createAssetStore).not.toHaveBeenCalled();
    expect(dependencies.assetStore.saveInitial).not.toHaveBeenCalled();
    expect(dependencies.assetStore.save).not.toHaveBeenCalled();
    expect(dependencies.updateState).not.toHaveBeenCalled();
  });

  it('rejects a raw model key in a reloaded external snapshot before it persists the project', async () => {
    const project = createEmptyProject(1);
    const snapshotRevision = 'a'.repeat(64);
    const submittedKey = 'sk-external-reload-snapshot-key';
    const dependencies = createDependencies(project, {
      createProjectAssetReloadPlan: vi.fn().mockResolvedValue({
        projectId: project.id,
        projectDirectory: '/projects/one',
        snapshotRevision,
        status: 'ready',
        issues: [],
      }),
      assetStore: {
        loadWithRevision: vi.fn().mockResolvedValue({
          project: {
            ...project,
            importedMetadata: {
              credentials: {
                modelApiKey: submittedKey,
              },
            },
          },
          revision: snapshotRevision,
        }),
      },
    });
    const handlers = registerHandlers(dependencies);
    const rejection = Promise.resolve(handlers.get(projectAssetIpcChannels.reloadSnapshot)!({}, {
      projectId: project.id,
      project,
      snapshotRevision,
    }));

    await expect(rejection).rejects.toThrow(modelApiKeyValidationErrorMessage);
    await expect(rejection).rejects.not.toThrow(submittedKey);
    expect(dependencies.assetStore.loadWithRevision).toHaveBeenCalledOnce();
    expect(dependencies.updateState).not.toHaveBeenCalled();
  });

  it('rejects a raw model key in a post-publish external snapshot before it persists the binding', async () => {
    const project = createEmptyProject(1);
    const previousRevision = 'b'.repeat(64);
    const plannedRevision = 'c'.repeat(64);
    const submittedKey = 'sk-external-update-snapshot-key';
    const dependencies = createDependencies(project, {
      binding: {
        projectId: project.id,
        projectDirectory: '/projects/one',
        revision: previousRevision,
        boundAt: '2026-08-21T00:00:00.000Z',
      },
      createProjectAssetUpdatePlan: vi.fn().mockResolvedValue({
        projectId: project.id,
        projectDirectory: '/projects/one',
        publishedRevision: previousRevision,
        snapshotRevision: plannedRevision,
        files: [],
        status: 'ready',
        issues: [],
      }),
      assetStore: {
        loadWithRevision: vi.fn().mockResolvedValue({
          project: {
            ...project,
            importedMetadata: {
              credentials: {
                modelApiKey: submittedKey,
              },
            },
          },
          revision: plannedRevision,
        }),
      },
    });
    const handlers = registerHandlers(dependencies);
    const rejection = Promise.resolve(handlers.get(projectAssetIpcChannels.updateSnapshot)!({}, {
      projectId: project.id,
      project,
      expectedRevision: previousRevision,
      plannedRevision,
    }));

    await expect(rejection).rejects.toThrow(modelApiKeyValidationErrorMessage);
    await expect(rejection).rejects.not.toThrow(submittedKey);
    const assetStore = dependencies.createAssetStore.mock.results[0]!.value;
    expect(assetStore.save).toHaveBeenCalledWith(project, previousRevision);
    expect(assetStore.loadWithRevision).toHaveBeenCalledOnce();
    expect(dependencies.updateState).not.toHaveBeenCalled();
  });
});

const registerHandlers = (dependencies: ReturnType<typeof createDependencies>): Map<string, Handler> => {
  const handlers = new Map<string, Handler>();
  registerProjectAssetIpcHandlers({
    ...dependencies,
    handle: (channel, listener) => handlers.set(channel, listener as Handler),
  });
  return handlers;
};

const createDependencies = (
  project: ReturnType<typeof createEmptyProject>,
  overrides: Record<string, unknown> = {},
) => {
  const binding = overrides.binding ?? {
    projectId: project.id,
    projectDirectory: '/projects/one',
    revision: calculateProjectAssetRevision(project),
    boundAt: '2026-08-21T00:00:00.000Z',
  };
  const state = createInitialStudioState();
  state.projects = [project];
  state.projectAssetBindings = [binding as typeof state.projectAssetBindings[number]];
  const assetStore = {
    planMigration: vi.fn(),
    saveInitial: vi.fn(),
    save: vi.fn(),
    loadWithRevision: vi.fn(),
    ...(overrides.assetStore as object | undefined),
  };

  return {
    getApprovedProjectAssetDirectory: vi.fn().mockResolvedValue('/projects/one'),
    releaseApprovedProjectAssetDirectory: vi.fn(),
    loadState: vi.fn().mockResolvedValue(state),
    updateState: vi.fn(),
    createAssetStore: vi.fn().mockReturnValue(assetStore),
    createProjectAssetReloadPlan: vi.fn().mockResolvedValue({
      projectId: project.id,
      projectDirectory: '/projects/one',
      snapshotRevision: 'd'.repeat(64),
      status: 'ready',
      issues: [],
    }),
    createProjectAssetUpdatePlan: vi.fn().mockResolvedValue({
      projectId: project.id,
      projectDirectory: '/projects/one',
      publishedRevision: (binding as { revision: string }).revision,
      snapshotRevision: 'e'.repeat(64),
      files: [],
      status: 'ready',
      issues: [],
    }),
    now: () => new Date('2026-08-21T00:00:00.000Z'),
    assetStore,
    ...overrides,
  };
};

const requestFor = (channel: string, project: ReturnType<typeof createEmptyProject>) => {
  if (channel === projectAssetIpcChannels.planMigration || channel === projectAssetIpcChannels.writeSnapshot) {
    return {
      projectId: project.id,
      projectDirectory: '/projects/one',
      project,
      plannedRevision: 'f'.repeat(64),
    };
  }
  if (channel === projectAssetIpcChannels.planReload || channel === projectAssetIpcChannels.reloadSnapshot) {
    return {
      projectId: project.id,
      project,
      snapshotRevision: 'f'.repeat(64),
    };
  }
  return {
    projectId: project.id,
    project,
    expectedRevision: 'd'.repeat(64),
    plannedRevision: 'f'.repeat(64),
  };
};
