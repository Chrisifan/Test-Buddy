import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyProject, createInitialStudioState, type ProjectAssetBinding, type ProjectDraft } from '../shared/studio.js';
import { ProjectAssetStore } from './projectAssetStore.js';
import { ProjectRepository } from './projectRepository.js';
import { StudioStore } from './studioStore.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ProjectRepository', () => {
  it('selects the pinned directory snapshot when a project is bound', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const studioProject = createProject('project-orders', 'StudioStore copy');
    const directoryProject = createProject('project-orders', 'Pinned directory copy');
    const projectDirectory = path.join(rootDirectory, 'orders-assets');
    const assetStore = new ProjectAssetStore(projectDirectory);
    await assetStore.saveInitial(directoryProject);
    const binding = await createBinding(projectDirectory, studioProject.id);
    const studioStore = await saveStudioState(rootDirectory, studioProject, [binding]);
    const repository = new ProjectRepository({ studioStore });

    await expect(repository.load(studioProject.id)).resolves.toMatchObject({
      source: 'projectDirectory',
      reproducibility: 'versioned',
      revision: binding.revision,
      project: expect.objectContaining({ id: studioProject.id, name: 'Pinned directory copy' }),
    });
  });

  it('loads a bound project from its pinned directory and rejects a stale expected revision', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const project = createProject('project-orders', 'Orders');
    const projectDirectory = path.join(rootDirectory, 'orders-assets');
    const assetStore = new ProjectAssetStore(projectDirectory);
    await assetStore.saveInitial(project);
    const binding = await createBinding(projectDirectory, project.id);
    const studioStore = await saveStudioState(rootDirectory, project, [binding]);
    const repository = new ProjectRepository({ studioStore });

    const bound = await repository.loadBound(project.id, binding.revision);

    expect(bound).toMatchObject({
      source: 'projectDirectory',
      reproducibility: 'versioned',
      revision: binding.revision,
      project: expect.objectContaining({ id: project.id, name: 'Orders' }),
    });
    bound.project.name = 'mutated by caller';
    await expect(repository.loadBound(project.id)).resolves.toMatchObject({ project: { name: 'Orders' } });
    await expect(repository.loadBound(project.id, 'f'.repeat(64))).rejects.toMatchObject({
      code: 'staleProjectRevision',
    });
  });

  it('rejects a bound directory whose revision changes outside StudioStore', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const project = createProject('project-orders', 'Orders');
    const projectDirectory = path.join(rootDirectory, 'orders-assets');
    const assetStore = new ProjectAssetStore(projectDirectory);
    await assetStore.saveInitial(project);
    const binding = await createBinding(projectDirectory, project.id);
    const studioStore = await saveStudioState(rootDirectory, project, [binding]);
    const repository = new ProjectRepository({ studioStore });

    await assetStore.save({ ...project, name: 'Changed outside StudioStore' }, binding.revision);

    await expect(repository.loadBound(project.id, binding.revision)).rejects.toMatchObject({
      code: 'projectRevisionChanged',
    });
  });

  it('uses StudioStore only for an unbound legacy project', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const project = createProject('legacy-project', 'Legacy project');
    const studioStore = await saveStudioState(rootDirectory, project, []);
    const repository = new ProjectRepository({ studioStore });

    await expect(repository.load(project.id)).resolves.toMatchObject({
      source: 'legacyStudioStore',
      reproducibility: 'legacy',
      project: expect.objectContaining({ id: project.id, name: 'Legacy project' }),
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(repository.loadBound(project.id)).rejects.toMatchObject({ code: 'projectUnbound' });
  });

  it('does not fall back to StudioStore when a bound directory is unavailable', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const project = createProject('project-orders', 'Studio fallback must not run');
    const studioStore = await saveStudioState(rootDirectory, project, [{
      projectId: project.id,
      projectDirectory: path.join(rootDirectory, 'missing-assets'),
      revision: 'a'.repeat(64),
      boundAt: '2026-08-14T00:00:00.000Z',
    }]);
    const repository = new ProjectRepository({ studioStore });

    await expect(repository.load(project.id)).rejects.toMatchObject({ code: 'bindingUnavailable' });
  });

  it('rejects a bound directory that belongs to a different project', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const studioProject = createProject('project-orders', 'Orders');
    const directoryProject = createProject('project-billing', 'Billing');
    const projectDirectory = path.join(rootDirectory, 'billing-assets');
    const assetStore = new ProjectAssetStore(projectDirectory);
    await assetStore.saveInitial(directoryProject);
    const binding = await createBinding(projectDirectory, studioProject.id);
    const studioStore = await saveStudioState(rootDirectory, studioProject, [binding]);
    const repository = new ProjectRepository({ studioStore });

    await expect(repository.loadBound(studioProject.id)).rejects.toMatchObject({ code: 'projectRevisionChanged' });
  });
});

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-project-repository-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createProject = (id: string, name: string): ProjectDraft => {
  return { ...createEmptyProject(1), id, name };
};

const createBinding = async (projectDirectory: string, projectId: string): Promise<ProjectAssetBinding> => {
  const snapshot = await new ProjectAssetStore(projectDirectory).loadWithRevision();
  return {
    projectId,
    projectDirectory,
    revision: snapshot.revision,
    boundAt: '2026-08-14T00:00:00.000Z',
  };
};

const saveStudioState = async (
  rootDirectory: string,
  project: ProjectDraft,
  projectAssetBindings: ProjectAssetBinding[],
): Promise<StudioStore> => {
  const studioStore = new StudioStore(rootDirectory);
  await studioStore.save({
    ...createInitialStudioState(),
    projects: [project],
    projectAssetBindings,
  });
  return studioStore;
};
