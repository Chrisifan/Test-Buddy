import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyProject, createPrdDocumentAsset, type ProjectDraft } from '../shared/studio.js';
import {
  createProjectAssetSnapshot,
  ProjectAssetStore,
  ProjectAssetStoreError,
  validateProjectAssetSnapshot,
} from './projectAssetStore.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ProjectAssetStore', () => {
  it('writes a reviewed initial project snapshot atomically and keeps runtime artifact paths out of project assets', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'orders-project');
    const project = createAssetProject();
    const store = new ProjectAssetStore(projectDirectory);

    const plan = await store.planMigration(project);
    expect(plan).toMatchObject({ projectId: project.id, projectDirectory, status: 'ready', conflicts: [] });
    expect(plan.files).toEqual(expect.arrayContaining([
      'project.json',
      'cases/case%2Fcheckout.json',
      'recordings/recording%2Fcheckout.json',
      expect.stringMatching(/^documents\/doc-.+\.json$/),
    ]));

    await store.saveInitial(project);

    await expect(fs.readdir(projectDirectory)).resolves.toEqual(['cases', 'documents', 'project.json', 'recordings']);
    const recordingFile = await fs.readFile(path.join(projectDirectory, 'recordings', 'recording%2Fcheckout.json'), 'utf8');
    expect(recordingFile).not.toContain('/private/runtime-artifacts/checkout.png');

    const loaded = await store.load();
    expect(loaded).toMatchObject({
      id: project.id,
      name: project.name,
      testCases: [expect.objectContaining({ id: 'case/checkout', schemaVersion: 2 })],
      recordings: [expect.objectContaining({ id: 'recording/checkout' })],
      documents: [expect.objectContaining({ id: project.documents[0]?.id })],
    });
    expect(loaded.recordings[0]?.steps[0]?.screenshotPath).toBeUndefined();
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
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-project-assets-'));
  temporaryDirectories.push(directory);
  return directory;
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
      }],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }],
    documents: [document],
  };
}
