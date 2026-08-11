import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  PrdDocumentAsset,
  ProjectDraft,
  RecordingAsset,
  TestCaseDraft,
} from '../shared/studio.js';

const projectAssetSchemaVersion = 1 as const;

export interface ProjectAssetManifest extends Omit<ProjectDraft, 'testCases' | 'recordings' | 'documents'> {
  schemaVersion: typeof projectAssetSchemaVersion;
  revision?: string;
  assetIds: {
    cases: string[];
    recordings: string[];
    documents: string[];
  };
}

export interface ProjectAssetSnapshot {
  manifest: ProjectAssetManifest;
  testCases: TestCaseDraft[];
  recordings: RecordingAsset[];
  documents: PrdDocumentAsset[];
}

export interface ProjectAssetReadResult {
  project: ProjectDraft;
  revision: string;
}

export interface ProjectAssetStoreFileSystem {
  rename(source: string, destination: string): Promise<void>;
  remove?(directory: string): Promise<void>;
}

export interface ProjectAssetMigrationPlan {
  projectId: string;
  projectDirectory: string;
  files: string[];
  status: 'ready' | 'requiresReview';
  conflicts: string[];
}

export interface ProjectAssetValidationIssue {
  path: string;
  message: string;
}

export class ProjectAssetStoreError extends Error {
  constructor(
    message: string,
    readonly issues: ProjectAssetValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ProjectAssetStoreError';
  }
}

export function createProjectAssetSnapshot(project: ProjectDraft): ProjectAssetSnapshot {
  const sanitizedProject = sanitizeProjectAsset(project);
  const { testCases, recordings, documents, ...projectMetadata } = sanitizedProject;
  return {
    manifest: {
      ...projectMetadata,
      schemaVersion: projectAssetSchemaVersion,
      revision: calculateProjectAssetRevision(sanitizedProject),
      assetIds: {
        cases: testCases.map((testCase) => testCase.id),
        recordings: recordings.map((recording) => recording.id),
        documents: documents.map((document) => document.id),
      },
    },
    testCases,
    recordings,
    documents,
  };
}

export function validateProjectAssetSnapshot(snapshot: ProjectAssetSnapshot): ProjectAssetValidationIssue[] {
  const issues: ProjectAssetValidationIssue[] = [];
  const manifest = snapshot.manifest;
  if (manifest.schemaVersion !== projectAssetSchemaVersion) {
    issues.push({ path: 'project.json.schemaVersion', message: '仅支持 project asset schema version 1。' });
  }
  if (!isNonEmptyString(manifest.id)) {
    issues.push({ path: 'project.json.id', message: '项目 ID 不能为空。' });
  }

  validateAssetCollection('cases', snapshot.testCases, manifest.assetIds.cases, issues);
  validateAssetCollection('recordings', snapshot.recordings, manifest.assetIds.recordings, issues);
  validateAssetCollection('documents', snapshot.documents, manifest.assetIds.documents, issues);

  if (manifest.revision !== undefined) {
    if (!isRevision(manifest.revision)) {
      issues.push({ path: 'project.json.revision', message: '项目 revision 必须是 SHA-256 摘要。' });
    } else {
      const actualRevision = calculateProjectAssetRevision(projectFromSnapshot(snapshot));
      if (manifest.revision !== actualRevision) {
        issues.push({ path: 'project.json.revision', message: 'manifest revision 与项目资产内容不一致。' });
      }
    }
  }

  snapshot.recordings.forEach((recording) => {
    if (!Array.isArray(recording.steps)) {
      issues.push({ path: `recordings/${recording.id}.json.steps`, message: '录制步骤必须是数组。' });
      return;
    }
    recording.steps.forEach((step, index) => {
      if (step.screenshotPath !== undefined) {
        issues.push({
          path: `recordings/${recording.id}.json.steps[${index}].screenshotPath`,
          message: '项目资产不能保存运行截图或本地 artifact 路径。',
        });
      }
      if (step.value !== undefined) {
        issues.push({
          path: `recordings/${recording.id}.json.steps[${index}].value`,
          message: '项目资产不能保存录制时输入或选择的原值。',
        });
      }
    });
  });

  return issues;
}

/**
 * A review-only filesystem adapter for the Phase 2 asset migration. It does
 * not read or write studio-data/state.json, so callers must explicitly review
 * the plan before moving a project onto this storage layout.
 */
export class ProjectAssetStore {
  constructor(
    readonly projectDirectory: string,
    private readonly fileSystem: ProjectAssetStoreFileSystem = fs,
  ) {}

  get manifestPath(): string {
    return path.join(this.projectDirectory, 'project.json');
  }

  async planMigration(project: ProjectDraft): Promise<ProjectAssetMigrationPlan> {
    const snapshot = createProjectAssetSnapshot(project);
    const issues = validateProjectAssetSnapshot(snapshot);
    if (issues.length) {
      throw new ProjectAssetStoreError('项目资产快照未通过校验，无法创建迁移计划。', issues);
    }

    const conflicts = await listDirectoryEntries(this.projectDirectory);
    return {
      projectId: project.id,
      projectDirectory: this.projectDirectory,
      files: listAssetFiles(snapshot),
      status: conflicts.length ? 'requiresReview' : 'ready',
      conflicts,
    };
  }

  /** Writes only to an empty, pre-reviewed destination directory. */
  async saveInitial(project: ProjectDraft): Promise<void> {
    const plan = await this.planMigration(project);
    if (plan.status !== 'ready') {
      throw new ProjectAssetStoreError('目标项目目录不为空，必须先由用户审阅迁移冲突。', [
        { path: this.projectDirectory, message: `已存在：${plan.conflicts.join('、')}` },
      ]);
    }

    const snapshot = createProjectAssetSnapshot(project);
    await this.writeSnapshotAtomically(snapshot, {
      allowMissingTarget: true,
      validateDisplacedTarget: async (directory) => {
        const conflicts = await listDirectoryEntries(directory);
        if (conflicts.length) {
          throw new ProjectAssetStoreError('目标项目目录不为空，必须先由用户审阅迁移冲突。', [
            { path: this.projectDirectory, message: `已存在：${conflicts.join('、')}` },
          ]);
        }
      },
    });
  }

  async load(): Promise<ProjectDraft> {
    return (await this.loadWithRevision()).project;
  }

  async loadWithRevision(): Promise<ProjectAssetReadResult> {
    const manifest = await readJson(this.manifestPath, 'project.json') as ProjectAssetManifest;
    validateManifest(manifest);

    const [testCases, storedRecordings, documents] = await Promise.all([
      readAssetCollection<TestCaseDraft>(this.projectDirectory, 'cases', manifest.assetIds.cases),
      readAssetCollection<RecordingAsset>(this.projectDirectory, 'recordings', manifest.assetIds.recordings),
      readAssetCollection<PrdDocumentAsset>(this.projectDirectory, 'documents', manifest.assetIds.documents),
    ]);
    const recordings = manifest.revision === undefined
      ? storedRecordings.map(stripRecordingRuntimeData)
      : storedRecordings;
    const snapshot: ProjectAssetSnapshot = { manifest, testCases, recordings, documents };
    const issues = validateProjectAssetSnapshot(snapshot);
    if (issues.length) {
      throw new ProjectAssetStoreError('项目资产文件已损坏或引用不一致。', issues);
    }

    const project = projectFromSnapshot(snapshot);
    return {
      project,
      revision: calculateProjectAssetRevision(project),
    };
  }

  async save(project: ProjectDraft, expectedRevision: string): Promise<void> {
    await this.assertUpdatePreconditions(this.projectDirectory, project.id, expectedRevision);
    const snapshot = createProjectAssetSnapshot(project);
    await this.writeSnapshotAtomically(snapshot, {
      allowMissingTarget: false,
      validateDisplacedTarget: async (directory) => {
        await this.assertUpdatePreconditions(directory, project.id, expectedRevision);
      },
    });
  }

  private async assertUpdatePreconditions(
    directory: string,
    projectId: string,
    expectedRevision: string,
  ): Promise<void> {
    const current = await new ProjectAssetStore(directory).loadWithRevision();
    const issues = await validateProjectDirectoryLayout(directory, createProjectAssetSnapshot(current.project));
    if (current.project.id !== projectId) {
      issues.push({ path: 'project.json.id', message: '目标目录属于另一个项目，拒绝覆盖。' });
    }
    if (current.revision !== expectedRevision) {
      issues.push({ path: 'project.json.revision', message: '项目资产已被外部修改，请重新加载后再保存。' });
    }
    if (issues.length) {
      throw new ProjectAssetStoreError('项目资产更新前置校验失败。', issues);
    }
  }

  private async writeSnapshotAtomically(
    snapshot: ProjectAssetSnapshot,
    options: {
      allowMissingTarget: boolean;
      validateDisplacedTarget: (directory: string) => Promise<void>;
    },
  ): Promise<void> {
    const parentDirectory = path.dirname(this.projectDirectory);
    const targetName = path.basename(this.projectDirectory);
    const operationId = randomUUID();
    const temporaryDirectory = path.join(parentDirectory, `.${targetName}.staging-${operationId}`);
    const backupDirectory = path.join(parentDirectory, `.${targetName}.backup-${operationId}`);
    const issues = validateProjectAssetSnapshot(snapshot);
    if (issues.length) {
      throw new ProjectAssetStoreError('项目资产快照未通过校验，拒绝写入。', issues);
    }

    let displacedTarget = false;
    let committed = false;
    let restoredPreviousSnapshot = false;
    try {
      await fs.mkdir(temporaryDirectory, { recursive: true });
      await writeJson(path.join(temporaryDirectory, 'project.json'), snapshot.manifest);
      await writeAssetCollection(temporaryDirectory, 'cases', snapshot.testCases);
      await writeAssetCollection(temporaryDirectory, 'recordings', snapshot.recordings);
      await writeAssetCollection(temporaryDirectory, 'documents', snapshot.documents);

      const targetExists = await pathExists(this.projectDirectory);
      if (!targetExists && !options.allowMissingTarget) {
        throw new ProjectAssetStoreError('目标项目目录已被外部移除，拒绝更新。', [
          { path: this.projectDirectory, message: '预期的项目目录不存在。' },
        ]);
      }
      if (targetExists) {
        await this.fileSystem.rename(this.projectDirectory, backupDirectory);
        displacedTarget = true;
        await options.validateDisplacedTarget(backupDirectory);
      }

      await this.fileSystem.rename(temporaryDirectory, this.projectDirectory);
      committed = true;
      if (displacedTarget) {
        await this.removeDirectory(backupDirectory);
        displacedTarget = false;
      }
    } catch (error) {
      let rollbackError: unknown;
      if (!committed && displacedTarget) {
        try {
          await this.fileSystem.rename(backupDirectory, this.projectDirectory);
          displacedTarget = false;
          restoredPreviousSnapshot = true;
        } catch (caughtRollbackError) {
          rollbackError = caughtRollbackError;
        }
      }
      let stagingCleanupError: unknown;
      try {
        await this.removeDirectory(temporaryDirectory);
      } catch (caughtCleanupError) {
        stagingCleanupError = caughtCleanupError;
      }
      if (committed) {
        throw new ProjectAssetStoreError('项目资产新快照已提交，但旧快照备份清理失败。', [
          { path: backupDirectory, message: errorMessage(error) },
          ...(stagingCleanupError
            ? [{ path: temporaryDirectory, message: `staging 清理失败：${errorMessage(stagingCleanupError)}` }]
            : []),
        ]);
      }
      if (rollbackError) {
        throw new ProjectAssetStoreError('项目资产目录交换失败，且旧快照回滚失败。', [
          { path: this.projectDirectory, message: errorMessage(error) },
          { path: backupDirectory, message: `旧快照仍位于备份目录：${errorMessage(rollbackError)}` },
          ...(stagingCleanupError
            ? [{ path: temporaryDirectory, message: `staging 清理失败：${errorMessage(stagingCleanupError)}` }]
            : []),
        ]);
      }
      if (error instanceof ProjectAssetStoreError) {
        if (stagingCleanupError) {
          throw new ProjectAssetStoreError(error.message, [
            ...error.issues,
            { path: temporaryDirectory, message: `staging 清理失败：${errorMessage(stagingCleanupError)}` },
          ]);
        }
        throw error;
      }
      throw new ProjectAssetStoreError(
        restoredPreviousSnapshot ? '项目资产目录交换失败，旧快照已恢复。' : '项目资产目录交换失败，未发布新快照。',
        [
          { path: this.projectDirectory, message: errorMessage(error) },
          ...(stagingCleanupError
            ? [{ path: temporaryDirectory, message: `staging 清理失败：${errorMessage(stagingCleanupError)}` }]
            : []),
        ],
      );
    }
  }

  private async removeDirectory(directory: string): Promise<void> {
    if (this.fileSystem.remove) {
      await this.fileSystem.remove(directory);
      return;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function sanitizeProjectAsset(project: ProjectDraft): ProjectDraft {
  const clonedProject = structuredClone(project);
  return {
    ...clonedProject,
    recordings: clonedProject.recordings.map(stripRecordingRuntimeData),
  };
}

function stripRecordingRuntimeData(recording: RecordingAsset): RecordingAsset {
  return {
    ...structuredClone(recording),
    steps: recording.steps.map(({
      screenshotPath: _screenshotPath,
      value: _value,
      ...step
    }) => ({ ...step })),
  };
}

function validateAssetCollection(
  kind: 'cases' | 'recordings' | 'documents',
  assets: Array<{ id: string }>,
  expectedIds: string[],
  issues: ProjectAssetValidationIssue[],
): void {
  if (!Array.isArray(expectedIds) || expectedIds.some((id) => !isNonEmptyString(id))) {
    issues.push({ path: `project.json.assetIds.${kind}`, message: '资产 ID 列表必须包含非空字符串。' });
    return;
  }
  const actualIds = assets.map((asset) => asset?.id).filter(isNonEmptyString);
  if (actualIds.length !== assets.length || new Set(actualIds).size !== actualIds.length) {
    issues.push({ path: kind, message: '资产 ID 缺失或重复。' });
  }
  if (new Set(expectedIds).size !== expectedIds.length || !sameIds(expectedIds, actualIds)) {
    issues.push({ path: `project.json.assetIds.${kind}`, message: 'manifest 与资产文件的 ID 引用不一致。' });
  }
}

function validateManifest(manifest: ProjectAssetManifest): void {
  const issues: ProjectAssetValidationIssue[] = [];
  if (!manifest || typeof manifest !== 'object') {
    issues.push({ path: 'project.json', message: 'project manifest 必须是对象。' });
  } else {
    if (manifest.schemaVersion !== projectAssetSchemaVersion) {
      issues.push({ path: 'project.json.schemaVersion', message: '不支持的 project asset schema version。' });
    }
    if (!isNonEmptyString(manifest.id)) {
      issues.push({ path: 'project.json.id', message: '项目 ID 不能为空。' });
    }
    if (manifest.revision !== undefined && !isRevision(manifest.revision)) {
      issues.push({ path: 'project.json.revision', message: '项目 revision 必须是 SHA-256 摘要。' });
    }
    const assetIds = manifest.assetIds;
    if (!assetIds || !Array.isArray(assetIds.cases) || !Array.isArray(assetIds.recordings) || !Array.isArray(assetIds.documents)) {
      issues.push({ path: 'project.json.assetIds', message: 'manifest 缺少完整资产 ID 列表。' });
    } else {
      (['cases', 'recordings', 'documents'] as const).forEach((kind) => {
        const ids = assetIds[kind];
        if (ids.some((id) => !isNonEmptyString(id)) || new Set(ids).size !== ids.length) {
          issues.push({ path: `project.json.assetIds.${kind}`, message: '资产 ID 必须为不重复的非空字符串。' });
        }
      });
    }
  }
  if (issues.length) {
    throw new ProjectAssetStoreError('project manifest 无法读取。', issues);
  }
}

function listAssetFiles(snapshot: ProjectAssetSnapshot): string[] {
  return [
    'project.json',
    ...snapshot.testCases.map((asset) => assetRelativePath('cases', asset.id)),
    ...snapshot.recordings.map((asset) => assetRelativePath('recordings', asset.id)),
    ...snapshot.documents.map((asset) => assetRelativePath('documents', asset.id)),
  ];
}

async function validateProjectDirectoryLayout(
  directory: string,
  snapshot: ProjectAssetSnapshot,
): Promise<ProjectAssetValidationIssue[]> {
  const expectedEntries = new Set([
    'cases/',
    'documents/',
    'recordings/',
    ...listAssetFiles(snapshot),
  ]);
  const actualEntries = new Set(await listDirectoryTreeEntries(directory));
  const issues: ProjectAssetValidationIssue[] = [];
  actualEntries.forEach((entry) => {
    if (!expectedEntries.has(entry)) {
      issues.push({ path: entry, message: '项目目录包含未被 manifest 管理的外部条目，拒绝覆盖。' });
    }
  });
  expectedEntries.forEach((entry) => {
    if (!actualEntries.has(entry)) {
      issues.push({ path: entry, message: '项目目录缺少 manifest 所需的资产条目。' });
    }
  });
  return issues;
}

async function listDirectoryTreeEntries(
  rootDirectory: string,
  relativeDirectory = '',
): Promise<string[]> {
  const entries = await fs.readdir(path.join(rootDirectory, relativeDirectory), { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory, entry.name)
      : entry.name;
    if (entry.isDirectory()) {
      result.push(`${relativePath}/`);
      result.push(...await listDirectoryTreeEntries(rootDirectory, relativePath));
    } else {
      result.push(relativePath);
    }
  }
  return result.sort();
}

function assetRelativePath(kind: 'cases' | 'recordings' | 'documents', id: string): string {
  return path.posix.join(kind, `${encodeURIComponent(id)}.json`);
}

async function listDirectoryEntries(directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(directory)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeAssetCollection(
  rootDirectory: string,
  kind: 'cases' | 'recordings' | 'documents',
  assets: Array<{ id: string }>,
): Promise<void> {
  const directory = path.join(rootDirectory, kind);
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(assets.map((asset) => writeJson(path.join(rootDirectory, assetRelativePath(kind, asset.id)), asset)));
}

async function readAssetCollection<T extends { id: string }>(
  rootDirectory: string,
  kind: 'cases' | 'recordings' | 'documents',
  ids: string[],
): Promise<T[]> {
  return Promise.all(ids.map(async (id) => {
    const asset = await readJson(path.join(rootDirectory, assetRelativePath(kind, id)), assetRelativePath(kind, id)) as T;
    if (!asset || asset.id !== id) {
      throw new ProjectAssetStoreError('资产文件 ID 与 manifest 引用不一致。', [
        { path: assetRelativePath(kind, id), message: '资产 ID 不匹配。' },
      ]);
    }
    return asset;
  }));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new ProjectAssetStoreError(`无法读取项目资产文件：${label}。`, [
      { path: label, message: (error as Error).message || 'JSON 文件损坏或不存在。' },
    ]);
  }
}

function projectFromSnapshot(snapshot: ProjectAssetSnapshot): ProjectDraft {
  const {
    schemaVersion: _schemaVersion,
    revision: _revision,
    assetIds: _assetIds,
    ...projectMetadata
  } = snapshot.manifest;
  return {
    ...structuredClone(projectMetadata),
    testCases: structuredClone(snapshot.testCases),
    recordings: structuredClone(snapshot.recordings),
    documents: structuredClone(snapshot.documents),
  };
}

function calculateProjectAssetRevision(project: ProjectDraft): string {
  const canonicalProject = JSON.stringify(canonicalize(project));
  return createHash('sha256').update(canonicalProject, 'utf8').digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    Object.keys(source).sort().forEach((key) => {
      if (source[key] !== undefined) {
        result[key] = canonicalize(source[key]);
      }
    });
    return result;
  }
  return value;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function sameIds(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length && expected.every((id) => actual.includes(id));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
