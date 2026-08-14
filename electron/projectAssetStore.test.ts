import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyProject, createPrdDocumentAsset, type ProjectDraft } from '../shared/studio.js';
import {
  createProjectAssetSnapshot,
  calculateProjectAssetRevision,
  inspectProjectAssetBinding,
  planProjectAssetReload,
  planProjectAssetUpdate,
  ProjectAssetStore,
  ProjectAssetStoreError,
  validateProjectAssetSnapshot,
} from './projectAssetStore.js';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

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
      'cases/case%2Fcheckout@1.json',
      'recordings/recording%2Fcheckout.json',
      expect.stringMatching(/^documents\/doc-.+\.json$/),
    ]));

    await store.saveInitial(project);

    await expect(fs.readdir(projectDirectory)).resolves.toEqual(['cases', 'documents', 'fixtures', 'project.json', 'recordings', 'suites']);
    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8')) as {
      schemaVersion?: number;
      revision?: string;
      assetIds?: { cases?: unknown };
    };
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.assetIds?.cases).toEqual([{ id: 'case/checkout', version: 1 }]);
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
    (snapshot.manifest.assetIds.cases as unknown as Array<{ id: string; version: number }>).push({
      id: 'case/checkout',
      version: 1,
    });

    expect(validateProjectAssetSnapshot(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'cases', message: expect.stringContaining('重复') }),
      expect.objectContaining({ path: 'project.json.assetIds.cases', message: expect.stringContaining('版本引用') }),
    ]));
  });

  it('persists every immutable Case version in a v2 manifest and loads both versions intact', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'versioned-cases-project');
    const project = createAssetProject();
    const firstVersion = project.testCases[0]!;
    const secondVersion = {
      ...firstVersion,
      version: 2,
      name: '提交订单（修订版）',
      notes: '保留第一个版本，并验证修订后的结果。',
    };
    project.testCases = [firstVersion, secondVersion];
    const store = new ProjectAssetStore(projectDirectory);

    const plan = await store.planMigration(project);
    expect(plan.files).toEqual(expect.arrayContaining([
      'cases/case%2Fcheckout@1.json',
      'cases/case%2Fcheckout@2.json',
    ]));
    await store.saveInitial(project);

    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8')) as {
      schemaVersion?: number;
      assetIds?: { cases?: unknown };
    };
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      assetIds: {
        cases: [
          { id: 'case/checkout', version: 1 },
          { id: 'case/checkout', version: 2 },
        ],
      },
    });
    await expect(fs.readFile(path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json'), 'utf8')).resolves.toContain('"version": 1');
    await expect(fs.readFile(path.join(projectDirectory, 'cases', 'case%2Fcheckout@2.json'), 'utf8')).resolves.toContain('"version": 2');
    await expect(store.load()).resolves.toMatchObject({
      testCases: [
        expect.objectContaining({ id: 'case/checkout', version: 1, name: firstVersion.name }),
        expect.objectContaining({ id: 'case/checkout', version: 2, name: secondVersion.name }),
      ],
    });
  });

  it('rejects missing and mismatched v2 Case files', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const missingDirectory = path.join(rootDirectory, 'missing-case-project');
    const missingStore = new ProjectAssetStore(missingDirectory);
    await missingStore.saveInitial(createAssetProject());
    await fs.rm(path.join(missingDirectory, 'cases', 'case%2Fcheckout@1.json'));

    await expect(missingStore.load()).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'cases/case%2Fcheckout@1.json' }),
      ]),
    });

    const mismatchedDirectory = path.join(rootDirectory, 'mismatched-case-project');
    const mismatchedStore = new ProjectAssetStore(mismatchedDirectory);
    await mismatchedStore.saveInitial(createAssetProject());
    const casePath = path.join(mismatchedDirectory, 'cases', 'case%2Fcheckout@1.json');
    const testCase = JSON.parse(await fs.readFile(casePath, 'utf8')) as Record<string, unknown>;
    testCase.version = 2;
    await fs.writeFile(casePath, `${JSON.stringify(testCase, null, 2)}\n`, 'utf8');

    await expect(mismatchedStore.load()).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'cases/case%2Fcheckout@1.json', message: expect.stringContaining('版本') }),
      ]),
    });
  });

  it('rejects an unmanaged v2 Case file in the project directory', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'unmanaged-case-project');
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(createAssetProject());
    await fs.writeFile(path.join(projectDirectory, 'cases', 'case%2Fcheckout@2.json'), '{}\n', 'utf8');

    await expect(store.load()).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'cases/case%2Fcheckout@2.json' }),
      ]),
    });
  });

  it('loads a legacy schema v1 snapshot without a revision and computes one for the caller', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    const project = createAssetProject();
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(project);
    const manifestPath = path.join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      schemaVersion: number;
      revision?: string;
      assetIds: { cases: unknown };
    };
    manifest.schemaVersion = 1;
    manifest.assetIds.cases = ['case/checkout'];
    delete manifest.revision;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.rename(
      path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json'),
      path.join(projectDirectory, 'cases', 'case%2Fcheckout.json'),
    );
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

  it('previews a legacy Case migration without writing the v1 directory', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    const preview = await store.planLegacyCaseMigration();

    expect(preview).toMatchObject({
      status: 'ready',
      targetSchemaVersion: 2,
      backupDirectory: expect.stringMatching(/^migration-backup\//),
      sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      files: expect.arrayContaining(['cases/case%2Fcheckout@1.json']),
    });
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('confirms a reviewed legacy Case migration with a v2 asset and retained backup', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const legacyCasePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout.json');
    const originalLegacyCase = await fs.readFile(legacyCasePath, 'utf8');
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();

    await store.confirmLegacyCaseMigration(preview);

    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8')) as {
      schemaVersion?: number;
      legacyCaseBackupDirectory?: string;
      legacyCaseBackupFiles?: Array<{ path: string; contentHash: string }>;
      assetIds?: { cases?: unknown };
    };
    const loaded = await store.loadWithRevision();
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      legacyCaseBackupDirectory: preview.backupDirectory,
      legacyCaseBackupFiles: [{
        path: 'cases/case%2Fcheckout.json',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }],
      assetIds: { cases: [{ id: 'case/checkout', version: 1 }] },
    });
    await expect(fs.readFile(path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json'), 'utf8')).resolves.toContain('"version": 1');
    await expect(fs.readFile(path.join(projectDirectory, preview.backupDirectory!, 'cases', 'case%2Fcheckout.json'), 'utf8')).resolves.toBe(originalLegacyCase);
    expect(loaded.project).toMatchObject({ testCases: [expect.objectContaining({ id: 'case/checkout', version: 1 })] });
    expect(loaded.project).not.toHaveProperty('legacyCaseBackupDirectory');
    expect(loaded.project).not.toHaveProperty('legacyCaseBackupFiles');
  });

  it('blocks a symlinked legacy Case file without reading its target', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const legacyCasePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout.json');
    await fs.rm(legacyCasePath);
    await fs.symlink(path.join(rootDirectory, 'outside-project.json'), legacyCasePath);
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'cases/case%2Fcheckout.json' })]),
    });
    await expect(store.confirmLegacyCaseMigration(await store.planLegacyCaseMigration())).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('rejects a legacy FIFO before source revisioning can block on it', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const fifoPath = path.join(projectDirectory, 'unmanaged.fifo');
    await execFileAsync('mkfifo', [fifoPath]);
    const store = new ProjectAssetStore(projectDirectory);
    const planPromise = store.planLegacyCaseMigration();
    const releasePendingFifoRead = new Promise<void>((resolve) => {
      setTimeout(() => {
        void fs.open(fifoPath, fsConstants.O_RDWR | fsConstants.O_NONBLOCK)
          .then((handle) => handle.close())
          .catch(() => undefined)
          .finally(resolve);
      }, 100);
    });

    try {
      await expect(Promise.race([
        planPromise,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('source revision attempted to read FIFO')), 50)),
      ])).resolves.toMatchObject({
        status: 'blocked',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: 'unmanaged.fifo', message: expect.stringContaining('普通文件') }),
        ]),
      });
    } finally {
      await releasePendingFifoRead;
      await planPromise.catch(() => undefined);
    }
  });

  it('rejects a legacy cases directory swapped to a symlink after validation', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const externalCasesDirectory = path.join(rootDirectory, 'outside-cases');
    let swapped = false;
    const store = new ProjectAssetStore(projectDirectory, {
      rename: fs.rename,
      afterProjectAssetPathValidation: async (_rootDirectory: string, relativePath: string) => {
        if (!swapped && relativePath === 'cases/case%2Fcheckout.json') {
          swapped = true;
          await fs.rename(path.join(projectDirectory, 'cases'), externalCasesDirectory);
          await fs.symlink(externalCasesDirectory, path.join(projectDirectory, 'cases'), 'dir');
        }
      },
    });

    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'cases', message: expect.stringContaining('拒绝符号链接') }),
      ]),
    });
    expect(swapped).toBe(true);
  });

  it('blocks a legacy Case directory symlink before resolving child assets', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const externalCasesDirectory = path.join(rootDirectory, 'outside-cases');
    await fs.rename(path.join(projectDirectory, 'cases'), externalCasesDirectory);
    await fs.symlink(externalCasesDirectory, path.join(projectDirectory, 'cases'), 'dir');
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'cases', message: expect.stringContaining('拒绝符号链接') }),
      ]),
    });
    await expect(store.confirmLegacyCaseMigration(await store.planLegacyCaseMigration())).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('rejects a symlinked declared backup file during v2 load and save', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const current = await store.loadWithRevision();
    const backupCasePath = path.join(projectDirectory, preview.backupDirectory!, 'cases', 'case%2Fcheckout.json');
    await fs.rm(backupCasePath);
    await fs.symlink(path.join(rootDirectory, 'outside-project.json'), backupCasePath);

    await expect(store.loadWithRevision()).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('migration-backup/') })]),
    });
    await expect(store.save({ ...current.project, name: '不应保存' }, current.revision)).rejects.toBeInstanceOf(ProjectAssetStoreError);
  });

  it('rejects a symlinked declared backup cases directory during v2 load and save', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const current = await store.loadWithRevision();
    const backupDirectory = path.join(projectDirectory, preview.backupDirectory!);
    const externalCasesDirectory = path.join(rootDirectory, 'outside-backup-cases');
    await fs.rename(path.join(backupDirectory, 'cases'), externalCasesDirectory);
    await fs.symlink(externalCasesDirectory, path.join(backupDirectory, 'cases'), 'dir');

    await expect(store.loadWithRevision()).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: `${preview.backupDirectory}/cases`,
          message: expect.stringContaining('拒绝符号链接'),
        }),
      ]),
    });
    await expect(store.save({ ...current.project, name: '不应保存' }, current.revision)).rejects.toBeInstanceOf(ProjectAssetStoreError);
  });

  it('rejects a backup cases directory swapped to a symlink after validation', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const setupStore = new ProjectAssetStore(projectDirectory);
    const preview = await setupStore.planLegacyCaseMigration();
    await setupStore.confirmLegacyCaseMigration(preview);
    const externalCasesDirectory = path.join(rootDirectory, 'outside-backup-cases');
    let swapped = false;
    const store = new ProjectAssetStore(projectDirectory, {
      rename: fs.rename,
      afterProjectAssetPathValidation: async (_rootDirectory: string, relativePath: string) => {
        if (!swapped && relativePath === `${preview.backupDirectory}/cases/case%2Fcheckout.json`) {
          swapped = true;
          const backupCasesDirectory = path.join(projectDirectory, preview.backupDirectory!, 'cases');
          await fs.rename(backupCasesDirectory, externalCasesDirectory);
          await fs.symlink(externalCasesDirectory, backupCasesDirectory, 'dir');
        }
      },
    });

    await expect(store.loadWithRevision()).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: `${preview.backupDirectory}/cases`,
          message: expect.stringContaining('拒绝符号链接'),
        }),
      ]),
    });
    expect(swapped).toBe(true);
  });

  it('rejects a child symlink in a directory-only declared backup during planning and load', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const manifestPath = path.join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.legacyCaseBackupFiles;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const backupCasePath = path.join(projectDirectory, preview.backupDirectory!, 'cases', 'case%2Fcheckout.json');
    const externalCasePath = path.join(rootDirectory, 'outside-backup-case.json');
    await fs.rename(backupCasePath, externalCasePath);
    await fs.symlink(externalCasePath, backupCasePath);

    const expectedIssue = expect.objectContaining({
      path: `${preview.backupDirectory}/cases/case%2Fcheckout.json`,
      message: expect.stringContaining('拒绝符号链接'),
    });
    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([expectedIssue]),
    });
    await expect(store.loadWithRevision()).rejects.toMatchObject({
      issues: expect.arrayContaining([expectedIssue]),
    });
  });

  it('rejects a modified declared backup file during v2 load and save', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const current = await store.loadWithRevision();
    const backupCasePath = path.join(projectDirectory, preview.backupDirectory!, 'cases', 'case%2Fcheckout.json');
    await fs.writeFile(backupCasePath, `${await fs.readFile(backupCasePath, 'utf8')}\n`, 'utf8');

    await expect(store.loadWithRevision()).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('migration-backup/') })]),
    });
    await expect(store.save({ ...current.project, name: '不应保存' }, current.revision)).rejects.toBeInstanceOf(ProjectAssetStoreError);
  });

  it('migrates an empty legacy Case collection and creates its declared backup hierarchy', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory, { emptyCases: true });
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();

    await store.confirmLegacyCaseMigration(preview);

    await expect(new ProjectAssetStore(projectDirectory).loadWithRevision()).resolves.toMatchObject({
      project: { testCases: [] },
    });
    expect((await fs.stat(path.join(projectDirectory, preview.backupDirectory!, 'cases'))).isDirectory()).toBe(true);
  });

  it('blocks a legacy Case migration when its exact v2 target already exists without mutation', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const legacyCasePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout.json');
    await fs.copyFile(legacyCasePath, path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json'));
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    const preview = await store.planLegacyCaseMigration();

    expect(preview).toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'cases/case%2Fcheckout@1.json' })]),
    });
    await expect(store.confirmLegacyCaseMigration(preview)).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('blocks unmanaged legacy directory entries instead of replacing and deleting them', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    await fs.writeFile(path.join(projectDirectory, 'README.md'), '# Preserve me\n', 'utf8');
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    const preview = await store.planLegacyCaseMigration();

    expect(preview).toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'README.md' })]),
    });
    await expect(store.confirmLegacyCaseMigration(preview)).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('returns a blocked plan for a malformed legacy manifest without writing', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const manifestPath = path.join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { assetIds: { cases: string[] } };
    manifest.assetIds.cases = ['case/checkout', 'case/checkout'];
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'project.json.assetIds.cases' })]),
    });
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it.each([
    ['invalid JSON', async (manifestPath: string) => { await fs.writeFile(manifestPath, '{\n', 'utf8'); }],
    ['a blank project ID', async (manifestPath: string) => {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { id: string };
      manifest.id = '   ';
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }],
  ])('returns a blocked preview for a legacy manifest with %s', async (_label, mutate) => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const manifestPath = path.join(projectDirectory, 'project.json');
    await mutate(manifestPath);
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.any(Array),
      conflicts: expect.any(Array),
    });
    await expect(store.confirmLegacyCaseMigration(await store.planLegacyCaseMigration())).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('returns a blocked plan for a legacy Case whose embedded ID disagrees with the manifest', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const casePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout.json');
    const testCase = JSON.parse(await fs.readFile(casePath, 'utf8')) as { id: string };
    testCase.id = 'case/other';
    await fs.writeFile(casePath, `${JSON.stringify(testCase, null, 2)}\n`, 'utf8');
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'cases/case%2Fcheckout.json' })]),
    });
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('is idempotent after a legacy Case migration and does not create another version or backup', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const firstPreview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(firstPreview);
    const before = await readDirectorySnapshot(projectDirectory);

    const repeatedPreview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(repeatedPreview);

    expect(repeatedPreview).toMatchObject({ status: 'alreadyMigrated' });
    await expect(fs.stat(path.join(projectDirectory, 'cases', 'case%2Fcheckout@2.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readdir(path.join(projectDirectory, 'migration-backup'))).resolves.toEqual([firstPreview.migrationId]);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('retains the declared legacy Case backup during normal v2 saves', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const beforeBackup = await readDirectorySnapshot(path.join(projectDirectory, preview.backupDirectory!));
    const current = await store.loadWithRevision();

    await store.save({ ...current.project, name: '迁移后的正常更新' }, current.revision);

    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8')) as {
      legacyCaseBackupDirectory?: string;
    };
    expect(manifest.legacyCaseBackupDirectory).toBe(preview.backupDirectory);
    await expect(readDirectorySnapshot(path.join(projectDirectory, preview.backupDirectory!))).resolves.toEqual(beforeBackup);
    await expect(store.load()).resolves.toMatchObject({ name: '迁移后的正常更新' });
  });

  it('keeps an immutable legacy backup inventory valid when later saves add and remove Cases', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const backupBeforeChanges = await readDirectorySnapshot(path.join(projectDirectory, preview.backupDirectory!));
    const first = await store.loadWithRevision();
    const addedCase = {
      ...first.project.testCases[0]!,
      id: 'case/added-later',
      name: '迁移后新增用例',
    };

    await store.save({ ...first.project, testCases: [...first.project.testCases, addedCase] }, first.revision);
    const afterAddition = await new ProjectAssetStore(projectDirectory).loadWithRevision();
    await store.save({ ...afterAddition.project, testCases: [] }, afterAddition.revision);

    await expect(new ProjectAssetStore(projectDirectory).loadWithRevision()).resolves.toMatchObject({
      project: { testCases: [] },
    });
    await expect(readDirectorySnapshot(path.join(projectDirectory, preview.backupDirectory!))).resolves.toEqual(backupBeforeChanges);
  });

  it('loads the previous backup declaration and upgrades it with an immutable inventory on save', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const manifestPath = path.join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      legacyCaseBackupDirectory?: string;
      legacyCaseBackupFiles?: Array<{ path: string; contentHash: string }>;
    };
    delete manifest.legacyCaseBackupFiles;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const legacyDeclaration = await new ProjectAssetStore(projectDirectory).loadWithRevision();
    await store.save({ ...legacyDeclaration.project, name: '升级历史备份清单' }, legacyDeclaration.revision);

    await expect(new ProjectAssetStore(projectDirectory).loadWithRevision()).resolves.toMatchObject({
      project: { name: '升级历史备份清单' },
    });
    const upgradedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      legacyCaseBackupDirectory?: string;
      legacyCaseBackupFiles?: string[];
    };
    expect(upgradedManifest).toMatchObject({
      legacyCaseBackupDirectory: preview.backupDirectory,
      legacyCaseBackupFiles: [{
        path: 'cases/case%2Fcheckout.json',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }],
    });
  });

  it('loads the previous string backup inventory and upgrades it with content hashes on save', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const store = new ProjectAssetStore(projectDirectory);
    const preview = await store.planLegacyCaseMigration();
    await store.confirmLegacyCaseMigration(preview);
    const manifestPath = path.join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.legacyCaseBackupFiles = ['cases/case%2Fcheckout.json'];
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const legacyDeclaration = await new ProjectAssetStore(projectDirectory).loadWithRevision();
    await store.save({ ...legacyDeclaration.project, name: '升级历史字符串备份清单' }, legacyDeclaration.revision);

    const upgradedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      legacyCaseBackupFiles?: Array<{ path: string; contentHash: string }>;
    };
    expect(upgradedManifest.legacyCaseBackupFiles).toEqual([{
      path: 'cases/case%2Fcheckout.json',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
  });

  it.each([
    ['an unsupported schema version', (testCase: Record<string, unknown>) => { testCase.schemaVersion = 99; }],
    ['missing steps', (testCase: Record<string, unknown>) => { delete testCase.steps; }],
    ['non-array steps', (testCase: Record<string, unknown>) => { testCase.steps = {}; }],
    ['an unsafe integer version', (testCase: Record<string, unknown>) => { testCase.version = Number.MAX_SAFE_INTEGER + 1; }],
  ])('returns a blocked plan for a legacy Case with %s', async (_label, mutate) => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const casePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout.json');
    const testCase = JSON.parse(await fs.readFile(casePath, 'utf8')) as Record<string, unknown>;
    mutate(testCase);
    await fs.writeFile(casePath, `${JSON.stringify(testCase, null, 2)}\n`, 'utf8');
    const store = new ProjectAssetStore(projectDirectory);
    const before = await readDirectorySnapshot(projectDirectory);

    await expect(store.planLegacyCaseMigration()).resolves.toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'cases/case%2Fcheckout.json' })]),
    });
    await expect(store.confirmLegacyCaseMigration(await store.planLegacyCaseMigration())).rejects.toBeInstanceOf(ProjectAssetStoreError);
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(before);
  });

  it('rolls back a legacy migration when the displaced source changes after its first validation', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    await writeLegacyCaseProject(projectDirectory);
    const preview = await new ProjectAssetStore(projectDirectory).planLegacyCaseMigration();
    let displacedSnapshot: Record<string, string> | undefined;
    const store = new ProjectAssetStore(projectDirectory, {
      rename: fs.rename,
      afterDisplacedTargetValidation: async (directory) => {
        const manifestPath = path.join(directory, 'project.json');
        await fs.writeFile(manifestPath, `${await fs.readFile(manifestPath, 'utf8')}\n`, 'utf8');
        displacedSnapshot = await readDirectorySnapshot(directory);
      },
    });

    await expect(store.confirmLegacyCaseMigration(preview)).rejects.toMatchObject({
      name: 'ProjectAssetStoreError',
      message: expect.stringContaining('变化'),
    });

    expect(displacedSnapshot).toBeDefined();
    await expect(readDirectorySnapshot(projectDirectory)).resolves.toEqual(displacedSnapshot);
    await expect(new ProjectAssetStore(projectDirectory).loadWithRevision()).resolves.toMatchObject({
      project: { testCases: [expect.objectContaining({ id: 'case/checkout' })] },
    });
  });

  it('loads a pre-fixture-and-suite snapshot whose manifest has no newer asset collections', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'legacy-project');
    const project = createAssetProject();
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(project);
    const manifestPath = path.join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      schemaVersion: number;
      assetIds: Record<string, unknown>;
    };
    manifest.schemaVersion = 1;
    manifest.assetIds.cases = ['case/checkout'];
    delete manifest.assetIds.fixtures;
    delete manifest.assetIds.suites;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.rename(
      path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json'),
      path.join(projectDirectory, 'cases', 'case%2Fcheckout.json'),
    );
    await fs.rm(path.join(projectDirectory, 'fixtures'), { recursive: true, force: true });
    await fs.rm(path.join(projectDirectory, 'suites'), { recursive: true, force: true });

    await expect(store.loadWithRevision()).resolves.toMatchObject({
      project: { id: project.id, fixtures: [], suites: [] },
    });
  });

  it('writes versioned fixture assets and rejects missing case references', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'fixture-project');
    const project = createAssetProject();
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture/seed-order',
      version: 1,
      name: '准备订单数据',
      description: '为结算用例创建可清理的订单数据。',
      inputs: [{ name: 'accountId', type: 'string' as const, required: true }],
      outputs: [{ name: 'orderId', type: 'string' as const, required: true }],
      credentialIds: [],
      environmentIds: [project.environments[0]!.id],
      setup: { mode: 'http' as const, summary: '通过受控 HTTP fixture 创建订单。' },
      cleanup: { mode: 'http' as const, summary: '通过受控 HTTP fixture 删除测试订单。' },
      concurrency: 'exclusive' as const,
      resourceLocks: ['orders:seed'],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    project.fixtures = [fixture];
    project.testCases[0] = {
      ...project.testCases[0]!,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
    };
    const store = new ProjectAssetStore(projectDirectory);

    const plan = await store.planMigration(project);
    expect(plan.files).toContain('fixtures/fixture%2Fseed-order@1.json');
    await store.saveInitial(project);
    await expect(store.load()).resolves.toMatchObject({
      fixtures: [expect.objectContaining({ id: fixture.id, version: 1, setup: fixture.setup })],
      testCases: [expect.objectContaining({
        assetReferences: expect.objectContaining({ fixtures: [{ id: fixture.id, version: 1 }] }),
      })],
    });

    const invalidSnapshot = createProjectAssetSnapshot({
      ...project,
      testCases: [{
        ...project.testCases[0]!,
        assetReferences: { fixtures: [{ id: 'fixture/missing', version: 1 }], reusableFlows: [] },
      }],
    });
    expect(validateProjectAssetSnapshot(invalidSnapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `cases/${project.testCases[0]!.id}.assetReferences.fixtures` }),
    ]));

    const invalidOutputMappingSnapshot = createProjectAssetSnapshot({
      ...project,
      fixtures: [{
        ...fixture,
        setup: {
          mode: 'http',
          summary: fixture.setup.summary,
          http: {
            method: 'POST',
            path: '/api/test-data/orders',
            expectedStatuses: [201],
            responseOutputs: [{ outputName: 'missingOutput', jsonPointer: '/orderId' }],
          },
        },
      }],
    });
    expect(validateProjectAssetSnapshot(invalidOutputMappingSnapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'fixtures/fixture%2Fseed-order@1.json' }),
    ]));
  });

  it('writes versioned Suite assets and rejects stale Case references before publishing', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'suite-project');
    const project = createAssetProject();
    const testCase = project.testCases[0]!;
    const suite = {
      schemaVersion: 1 as const,
      id: 'suite/release',
      version: 1,
      name: '发布回归',
      description: '运行结算核心链路。',
      tags: ['release'],
      environmentId: project.environments[0]!.id,
      caseReferences: [{ id: testCase.id, version: testCase.version!, dependsOn: [] }],
      execution: { concurrency: 1, failurePolicy: 'continue' as const, retryLimit: 0 },
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    project.suites = [suite];
    const store = new ProjectAssetStore(projectDirectory);

    expect((await store.planMigration(project)).files).toContain('suites/suite%2Frelease@1.json');
    await store.saveInitial(project);
    await expect(store.load()).resolves.toMatchObject({
      suites: [expect.objectContaining({ id: suite.id, version: suite.version, caseReferences: suite.caseReferences })],
    });

    const staleReferenceSnapshot = createProjectAssetSnapshot({
      ...project,
      suites: [{
        ...suite,
        caseReferences: [{ id: testCase.id, version: testCase.version! + 1, dependsOn: [] }],
      }],
    });
    expect(validateProjectAssetSnapshot(staleReferenceSnapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'suites/suite%2Frelease@1.json.caseReferences', message: expect.stringContaining('未找到用例') }),
    ]));
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

  it('creates a reviewed update plan before publishing local project edits', async () => {
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
    const updatedProject = { ...current.project, name: '待发布的本地修改' };

    const plan = await planProjectAssetUpdate(updatedProject, binding);

    expect(plan).toMatchObject({
      projectId: current.project.id,
      projectDirectory,
      publishedRevision: current.revision,
      snapshotRevision: calculateProjectAssetRevision(updatedProject),
      status: 'ready',
      issues: [],
    });
    expect(plan.files).toEqual(expect.arrayContaining(['project.json', 'cases/case%2Fcheckout@1.json']));
    await expect(store.load()).resolves.toMatchObject({ name: current.project.name });
  });

  it('blocks update plans for unchanged, externally changed, or unmanaged bound directories', async () => {
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
    const updatedProject = { ...current.project, name: '本地待发布修改' };

    await expect(planProjectAssetUpdate(current.project, binding)).resolves.toMatchObject({
      status: 'requiresReview',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'studio-data' })]),
    });

    await fs.writeFile(path.join(projectDirectory, 'notes.md'), '# External note\n', 'utf8');
    await expect(planProjectAssetUpdate(updatedProject, binding)).resolves.toMatchObject({
      status: 'requiresReview',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'notes.md' })]),
    });
    await fs.rm(path.join(projectDirectory, 'notes.md'));

    await store.save({ ...current.project, name: '外部已发布修改' }, current.revision);
    await expect(planProjectAssetUpdate(updatedProject, binding)).resolves.toMatchObject({
      status: 'requiresReview',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'project.json.revision' })]),
    });
  });

  it('strips runtime recording data when a reviewed update is published', async () => {
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
    const updatedProject = {
      ...current.project,
      name: '录制运行数据不发布',
      recordings: current.project.recordings.map((recording) => ({
        ...recording,
        steps: recording.steps.map((step) => ({
          ...step,
          screenshotPath: '/private/runtime-artifacts/new.png',
          value: 'private-updated-value',
        })),
      })),
    };

    await expect(planProjectAssetUpdate(updatedProject, binding)).resolves.toMatchObject({ status: 'ready' });
    await store.save(updatedProject, binding.revision);

    const recordingFile = await fs.readFile(path.join(projectDirectory, 'recordings', 'recording%2Fcheckout.json'), 'utf8');
    expect(recordingFile).not.toContain('/private/runtime-artifacts/new.png');
    expect(recordingFile).not.toContain('private-updated-value');
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
    const casePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json');
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
      if (entry.isSymbolicLink()) {
        files.push([relativePath, `symlink:${await fs.readlink(path.join(directory, relativePath))}`]);
        return;
      }
      files.push([relativePath, await fs.readFile(path.join(directory, relativePath), 'utf8')]);
    }));
  }

  await visit('');
  return Object.fromEntries(files.sort(([left], [right]) => left.localeCompare(right)));
}

/** Converts the current v2 fixture into the on-disk layout written by schema v1. */
async function writeLegacyCaseProject(
  projectDirectory: string,
  options: { emptyCases?: boolean } = {},
): Promise<void> {
  const store = new ProjectAssetStore(projectDirectory);
  await store.saveInitial(createAssetProject());
  const manifestPath = path.join(projectDirectory, 'project.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    schemaVersion: number;
    revision?: string;
    assetIds: { cases: unknown };
  };
  manifest.schemaVersion = 1;
  manifest.assetIds.cases = options.emptyCases ? [] : ['case/checkout'];
  delete manifest.revision;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const v2CasePath = path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json');
  if (options.emptyCases) {
    await fs.rm(v2CasePath);
  } else {
    await fs.rename(v2CasePath, path.join(projectDirectory, 'cases', 'case%2Fcheckout.json'));
  }
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
