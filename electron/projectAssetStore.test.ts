import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyProject, createPrdDocumentAsset, type ProjectDraft } from '../shared/studio.js';
import {
  createProjectAssetSnapshot,
  calculateProjectAssetRevision,
  inspectProjectAssetBinding,
  planProjectAssetReload,
  ProjectAssetStore,
  ProjectAssetStoreError,
  validateProjectAssetSnapshot,
} from './projectAssetStore.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ProjectAssetStore', () => {
  it('writes a reviewed initial project snapshot with a revision and keeps runtime recording data out of project assets', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const project = createAssetProject();
    const store = new ProjectAssetStore(projectDirectory);

    const plan = await store.planMigration(project);
    expect(plan).toMatchObject({ projectId: project.id, projectDirectory, status: 'ready', conflicts: [] });
    expect(plan.snapshotRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.snapshotRevision).toBe(calculateProjectAssetRevision(project));
    expect(plan.files).toEqual(expect.arrayContaining([
      'project.json',
      'cases/case%2Fcheckout.json',
      'recordings/recording%2Fcheckout.json',
      expect.stringMatching(/^documents\/doc-.+\.json$/),
    ]));

    await store.saveInitial(project);

    await expect(fs.readdir(projectDirectory)).resolves.toEqual(['cases', 'documents', 'project.json', 'recordings']);
    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8')) as { revision?: string };
    expect(manifest.revision).toMatch(/^[a-f0-9]{64}$/);
    const recordingFile = await fs.readFile(path.join(projectDirectory, 'recordings', 'recording%2Fcheckout.json'), 'utf8');
    expect(recordingFile).not.toContain('/private/runtime-artifacts/checkout.png');
    expect(recordingFile).not.toContain('private-original-value');

    const loaded = await store.load();
    expect(loaded).toMatchObject({
      id: project.id,
      name: project.name,
      testCases: [expect.objectContaining({ id: 'case/checkout', schemaVersion: 2 })],
      recordings: [expect.objectContaining({ id: 'recording/checkout' })],
      documents: [expect.objectContaining({ id: project.documents[0]?.id })],
    });
    expect(loaded.recordings[0]?.steps[0]?.screenshotPath).toBeUndefined();
    expect(loaded.recordings[0]?.steps[0]?.value).toBeUndefined();
  });

  it('writes the initial snapshot into an existing empty directory', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'selected-empty-project');
    await fs.mkdir(projectDirectory);
    const project = createAssetProject();
    const store = new ProjectAssetStore(projectDirectory);

    await store.saveInitial(project);

    await expect(store.load()).resolves.toMatchObject({ id: project.id, name: project.name });
    await expect(fs.readdir(rootDirectory)).resolves.toEqual(['selected-empty-project']);
  });

  it('keeps a non-empty destination untouched until its migration conflicts are reviewed', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'existing-project');
    await fs.mkdir(projectDirectory, { recursive: true });
    await fs.writeFile(path.join(projectDirectory, 'notes.md'), '# Existing files\n', 'utf8');
    const store = new ProjectAssetStore(projectDirectory);

    const plan = await store.planMigration(createAssetProject());
    expect(plan).toMatchObject({ status: 'requiresReview', conflicts: ['notes.md'] });
    await expect(store.saveInitial(createAssetProject())).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(fs.readFile(path.join(projectDirectory, 'notes.md'), 'utf8')).resolves.toBe('# Existing files\n');
    await expect(fs.stat(path.join(projectDirectory, 'project.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects duplicate asset identifiers and manifest references before filesystem writes', () => {
    const snapshot = createProjectAssetSnapshot(createAssetProject());
    snapshot.testCases.push({ ...snapshot.testCases[0]! });

    expect(validateProjectAssetSnapshot(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'cases', message: expect.stringContaining('重复') }),
      expect.objectContaining({ path: 'project.json.assetIds.cases', message: expect.stringContaining('不一致') }),
    ]));
  });

  it('loads a legacy schema v1 snapshot without a revision and computes one for the caller', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    const project = createAssetProject();
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(project);
    const manifestPath = path.join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.revision;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const recordingPath = path.join(projectDirectory, 'recordings', 'recording%2Fcheckout.json');
    const recording = JSON.parse(await fs.readFile(recordingPath, 'utf8')) as { steps: Array<Record<string, unknown>> };
    recording.steps[0]!.value = 'legacy-private-value';
    await fs.writeFile(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');

    const loaded = await store.loadWithRevision();

    expect(loaded.project).toMatchObject({ id: project.id, name: project.name });
    expect(loaded.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded.project.recordings[0]?.steps[0]?.value).toBeUndefined();
    expect(JSON.parse(await fs.readFile(manifestPath, 'utf8'))).not.toHaveProperty('revision');
  });

  it('updates a bound project when the expected revision matches', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    const updatedProject = {
      ...current.project,
      name: '订单回归项目',
      description: 'CAS 更新后的项目。',
    };

    await store.save(updatedProject, current.revision);

    const updated = await store.loadWithRevision();
    expect(updated.project).toMatchObject({
      id: current.project.id,
      name: '订单回归项目',
      description: 'CAS 更新后的项目。',
    });
    expect(updated.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(updated.revision).not.toBe(current.revision);
    await expect(fs.readdir(rootDirectory)).resolves.toEqual(['orders-project']);
  });

  it('rejects a stale expected revision without modifying the current snapshot', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const stale = await store.loadWithRevision();
    await store.save({ ...stale.project, name: '外部更新' }, stale.revision);
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.save({ ...stale.project, name: '陈旧更新' }, stale.revision)).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'project.json.revision' }),
      ]),
    });

    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('rejects a different project id without modifying the current snapshot', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.save({ ...current.project, id: 'different-project' }, current.revision)).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'project.json.id' }),
      ]),
    });

    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('rejects untracked external files without deleting them during a CAS update', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    await fs.writeFile(path.join(projectDirectory, 'notes.md'), '# External note\n', 'utf8');
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.save({ ...current.project, name: '不应覆盖外部文件' }, current.revision)).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'notes.md' }),
      ]),
    });

    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('detects asset content tampering when loading a revisioned snapshot', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const casePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout.json');
    const testCase = JSON.parse(await fs.readFile(casePath, 'utf8')) as Record<string, unknown>;
    testCase.name = '被外部篡改';
    await fs.writeFile(casePath, `${JSON.stringify(testCase, null, 2)}\n`, 'utf8');

    await expect(store.load()).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'project.json.revision' }),
      ]),
    });
  });

  it('distinguishes an in-sync snapshot, local edits, and an externally published revision', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    const binding = {
      projectId: current.project.id,
      projectDirectory,
      revision: current.revision,
      boundAt: '2026-08-11T00:00:00.000Z',
    };

    await expect(inspectProjectAssetBinding(current.project, binding)).resolves.toMatchObject({ state: 'inSync', issues: [] });
    await expect(inspectProjectAssetBinding({ ...current.project, name: '本地未快照修改' }, binding)).resolves.toMatchObject({
      state: 'localChanges',
      issues: [expect.objectContaining({ path: 'studio-data' })],
    });

    await store.save({ ...current.project, name: '外部发布的资产修改' }, current.revision);

    await expect(inspectProjectAssetBinding(current.project, binding)).resolves.toMatchObject({
      state: 'externalChanges',
      issues: [expect.objectContaining({ path: 'project.json.revision' })],
    });
  });

  it('reports a tracked project directory that becomes unavailable without modifying state', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    await fs.rm(projectDirectory, { recursive: true, force: true });

    await expect(inspectProjectAssetBinding(current.project, {
      projectId: current.project.id,
      projectDirectory,
      revision: current.revision,
      boundAt: '2026-08-11T00:00:00.000Z',
    })).resolves.toMatchObject({ state: 'unavailable' });
  });

  it('plans a reload only for a valid external revision with no local edits', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    const binding = {
      projectId: current.project.id,
      projectDirectory,
      revision: current.revision,
      boundAt: '2026-08-11T00:00:00.000Z',
    };
    await store.save({ ...current.project, name: '外部资产版本' }, current.revision);

    const readyPlan = await planProjectAssetReload(current.project, binding);
    expect(readyPlan).toMatchObject({
      projectId: current.project.id,
      projectDirectory,
      status: 'ready',
      issues: [],
      snapshotRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    await expect(planProjectAssetReload({ ...current.project, name: '本地编辑' }, binding)).resolves.toMatchObject({
      status: 'requiresReview',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'studio-data' })]),
    });

    await fs.rm(projectDirectory, { recursive: true, force: true });
    await expect(planProjectAssetReload(current.project, binding)).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('restores the previous snapshot when the staged directory exchange fails', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    const before = await readDirectorySnapshot(projectDirectory);
    let renameCalls = 0;
    const failingStore = new ProjectAssetStore(projectDirectory, {
      rename: async (source, destination) => {
        renameCalls += 1;
        if (renameCalls === 2) {
          throw new Error('injected directory exchange failure');
        }
        await fs.rename(source, destination);
      },
    });

    await expect(failingStore.save({ ...current.project, name: '不应落盘' }, current.revision)).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('injected directory exchange failure') }),
      ]),
    });

    expect(renameCalls).toBe(3);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
    await expect(store.loadWithRevision()).resolves.toEqual(current);
    await expect(fs.readdir(rootDirectory)).resolves.toEqual(['orders-project']);
  });

  it('reports a committed snapshot accurately when old-backup cleanup fails', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    const current = await store.loadWithRevision();
    const cleanupFailingStore = new ProjectAssetStore(projectDirectory, {
      rename: fs.rename,
      remove: async (directory) => {
        if (path.basename(directory).includes('.backup-')) {
          throw new Error('injected backup cleanup failure');
        }
        await fs.rm(directory, { recursive: true, force: true });
      },
    });

    await expect(cleanupFailingStore.save({ ...current.project, name: '已提交的新快照' }, current.revision)).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      message: expect.stringContaining('已提交'),
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('.backup-'),
          message: expect.stringContaining('injected backup cleanup failure'),
        }),
      ]),
    });

    await expect(store.load()).resolves.toMatchObject({ name: '已提交的新快照' });
    const entries = await fs.readdir(rootDirectory);
    const backupName = entries.find((entry) => entry.includes('.backup-'));
    expect(backupName).toBeDefined();
    await expect(new ProjectAssetStore(path.join(rootDirectory, backupName!)).loadWithRevision()).resolves.toEqual(current);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-project-assets-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function readDirectorySnapshot(directory: string): Promise<Record<string, string>> {
  const files: Array<[string, string]> = [];

  async function visit(relativeDirectory: string): Promise<void> {
    const entries = await fs.readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
        return;
      }
      files.push([relativePath, await fs.readFile(path.join(directory, relativePath), 'utf8')]);
    }));
  }

  await visit('');
  return Object.fromEntries(files.sort(([left], [right]) => left.localeCompare(right)));
}

function createAssetProject(): ProjectDraft {
  const project = createEmptyProject(1);
  const group = project.groups[0]!;
  const environment = project.environments[0]!;
  const document = createPrdDocumentAsset({
    name: 'checkout.md',
    kind: 'markdown',
    size: 160,
    sourceText: '# 结算\n- 用户提交订单后必须看到成功提示。',
  });
  return {
    ...project,
    testCases: [{
      schemaVersion: 2,
      version: 1,
      assetReferences: { fixtures: [], reusableFlows: [] },
      id: 'case/checkout',
      kind: 'scenario',
      groupId: group.id,
      environmentId: environment.id,
      source: 'prd',
      sourceIntent: '用户提交订单后必须看到成功提示。',
      name: '提交订单',
      category: '订单',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '验证提交结果。',
      steps: [{ id: 'step-checkout', type: 'aiAssert', title: '确认成功提示', body: '确认页面显示成功提示' }],
    }],
    recordings: [{
      id: 'recording/checkout',
      name: '结算录制',
      summary: '提交订单后检查成功提示。',
      source: 'live',
      groupId: group.id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '提交订单后显示成功提示。',
      tags: ['checkout'],
      steps: [{
        id: 'recording-step-checkout',
        kind: 'snapshot',
        title: '提交成功',
        detail: '订单已创建。',
        screenshotPath: '/private/runtime-artifacts/checkout.png',
        value: 'private-original-value',
      }],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }],
    documents: [document],
  };
}
