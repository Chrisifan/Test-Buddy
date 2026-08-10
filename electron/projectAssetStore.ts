import { randomUUID } from 'node:crypto';
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
  const { testCases, recordings, documents, ...projectMetadata } = project;
  const sanitizedRecordings = recordings.map(stripRecordingArtifactPaths);
  return {
    manifest: {
      ...projectMetadata,
      schemaVersion: projectAssetSchemaVersion,
      assetIds: {
        cases: testCases.map((testCase) => testCase.id),
        recordings: sanitizedRecordings.map((recording) => recording.id),
        documents: documents.map((document) => document.id),
      },
    },
    testCases: structuredClone(testCases),
    recordings: sanitizedRecordings,
    documents: structuredClone(documents),
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
  constructor(readonly projectDirectory: string) {}

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
    await this.writeSnapshotAtomically(snapshot);
  }

  async load(): Promise<ProjectDraft> {
    const manifest = await readJson(this.manifestPath, 'project.json') as ProjectAssetManifest;
    validateManifest(manifest);

    const [testCases, recordings, documents] = await Promise.all([
      readAssetCollection<TestCaseDraft>(this.projectDirectory, 'cases', manifest.assetIds.cases),
      readAssetCollection<RecordingAsset>(this.projectDirectory, 'recordings', manifest.assetIds.recordings),
      readAssetCollection<PrdDocumentAsset>(this.projectDirectory, 'documents', manifest.assetIds.documents),
    ]);
    const snapshot: ProjectAssetSnapshot = { manifest, testCases, recordings, documents };
    const issues = validateProjectAssetSnapshot(snapshot);
    if (issues.length) {
      throw new ProjectAssetStoreError('项目资产文件已损坏或引用不一致。', issues);
    }

    const { schemaVersion: _schemaVersion, assetIds: _assetIds, ...project } = manifest;
    return { ...project, testCases, recordings, documents };
  }

  private async writeSnapshotAtomically(snapshot: ProjectAssetSnapshot): Promise<void> {
    const parentDirectory = path.dirname(this.projectDirectory);
    const targetName = path.basename(this.projectDirectory);
    const temporaryDirectory = path.join(parentDirectory, `.${targetName}.tmp-${randomUUID()}`);
    const issues = validateProjectAssetSnapshot(snapshot);
    if (issues.length) {
      throw new ProjectAssetStoreError('项目资产快照未通过校验，拒绝写入。', issues);
    }

    try {
      await fs.mkdir(temporaryDirectory, { recursive: true });
      await writeJson(path.join(temporaryDirectory, 'project.json'), snapshot.manifest);
      await writeAssetCollection(temporaryDirectory, 'cases', snapshot.testCases);
      await writeAssetCollection(temporaryDirectory, 'recordings', snapshot.recordings);
      await writeAssetCollection(temporaryDirectory, 'documents', snapshot.documents);
      await fs.rename(temporaryDirectory, this.projectDirectory);
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
  }
}

function stripRecordingArtifactPaths(recording: RecordingAsset): RecordingAsset {
  return {
    ...structuredClone(recording),
    steps: recording.steps.map(({ screenshotPath: _screenshotPath, ...step }) => ({ ...step })),
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

function sameIds(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length && expected.every((id) => actual.includes(id));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}
