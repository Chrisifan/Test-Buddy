import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  ProjectAssetBinding,
  ProjectAssetBindingStatus,
  PrdDocumentAsset,
  ProjectAssetMigrationPlan,
  ProjectAssetReloadPlan,
  ProjectAssetUpdatePlan,
  ProjectDraft,
  RecordingAsset,
  TestCaseDraft,
  FixtureAsset,
  SuiteAsset,
  VersionedTestAssetReference,
} from '../shared/studio.js';
import { hasValidFixtureHttpOutputConfiguration, normalizeFixtureHttpDeclaration, resolveSuiteTestCases } from '../shared/studio.js';

const projectAssetSchemaVersion = 2 as const;
const legacyProjectAssetSchemaVersion = 1 as const;

type ProjectAssetManifestMetadata = Omit<ProjectDraft, 'testCases' | 'recordings' | 'documents' | 'fixtures' | 'suites'>;

export interface ProjectAssetManifest extends ProjectAssetManifestMetadata {
  schemaVersion: typeof projectAssetSchemaVersion;
  revision?: string;
  assetIds: {
    cases: VersionedTestAssetReference[];
    recordings: string[];
    documents: string[];
    fixtures?: VersionedTestAssetReference[];
    suites?: VersionedTestAssetReference[];
  };
}

interface LegacyProjectAssetManifest extends ProjectAssetManifestMetadata {
  schemaVersion: typeof legacyProjectAssetSchemaVersion;
  revision?: string;
  assetIds: {
    cases: string[];
    recordings: string[];
    documents: string[];
    /** Absent only in snapshots written before fixtures were introduced. */
    fixtures?: VersionedTestAssetReference[];
    /** Absent only in snapshots written before Suites were introduced. */
    suites?: VersionedTestAssetReference[];
  };
}

type ProjectAssetReadManifest = ProjectAssetManifest | LegacyProjectAssetManifest;

export interface ProjectAssetSnapshot {
  manifest: ProjectAssetReadManifest;
  testCases: TestCaseDraft[];
  recordings: RecordingAsset[];
  documents: PrdDocumentAsset[];
  fixtures: FixtureAsset[];
  suites: SuiteAsset[];
}

export interface ProjectAssetReadResult {
  project: ProjectDraft;
  revision: string;
}

/**
 * Inspects a tracked snapshot without updating either storage location. The
 * caller decides when a local edit should become a new reviewed snapshot.
 */
export async function inspectProjectAssetBinding(
  project: ProjectDraft,
  binding: ProjectAssetBinding,
): Promise<ProjectAssetBindingStatus> {
  const localRevision = calculateProjectAssetRevision(project);
  try {
    const snapshot = await new ProjectAssetStore(binding.projectDirectory).loadWithRevision();
    if (snapshot.project.id !== project.id || snapshot.revision !== binding.revision) {
      return {
        projectId: project.id,
        projectDirectory: binding.projectDirectory,
        state: 'externalChanges',
        issues: snapshot.project.id !== project.id
          ? [{ path: 'project.json.id', message: '项目资产目录属于另一个项目。' }]
          : [{ path: 'project.json.revision', message: '项目资产已被外部修改。' }],
      };
    }

    return {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      state: localRevision === binding.revision ? 'inSync' : 'localChanges',
      issues: localRevision === binding.revision
        ? []
        : [{ path: 'studio-data', message: '本地项目存在尚未写入资产快照的修改。' }],
    };
  } catch (error) {
    return {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      state: 'unavailable',
      issues: error instanceof ProjectAssetStoreError
        ? error.issues
        : [{ path: binding.projectDirectory, message: errorMessage(error) }],
    };
  }
}

/**
 * Produces a read-only reload plan. A tracked directory is never authoritative
 * while the local project contains edits that have not been snapshotted.
 */
export async function planProjectAssetReload(
  project: ProjectDraft,
  binding: ProjectAssetBinding,
): Promise<ProjectAssetReloadPlan> {
  const localRevision = calculateProjectAssetRevision(project);
  try {
    const snapshot = await new ProjectAssetStore(binding.projectDirectory).loadWithRevision();
    const issues = [] as ProjectAssetReloadPlan['issues'];
    if (snapshot.project.id !== project.id) {
      issues.push({ path: 'project.json.id', message: '项目资产目录属于另一个项目。' });
    }
    if (snapshot.revision === binding.revision) {
      issues.push({ path: 'project.json.revision', message: '未检测到可重载的外部资产修改。' });
    }
    if (localRevision !== binding.revision) {
      issues.push({ path: 'studio-data', message: '本地项目存在未快照修改，不能覆盖。' });
    }
    return {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      ...(snapshot.revision !== binding.revision ? { snapshotRevision: snapshot.revision } : {}),
      status: issues.length ? 'requiresReview' : 'ready',
      issues,
    };
  } catch (error) {
    return {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      status: 'unavailable',
      issues: error instanceof ProjectAssetStoreError
        ? error.issues
        : [{ path: binding.projectDirectory, message: errorMessage(error) }],
    };
  }
}

/**
 * Produces a read-only CAS publish plan for local edits. It never writes the
 * bound directory and deliberately rejects a changed directory, an unchanged
 * local project, or unmanaged files beside the snapshot.
 */
export async function planProjectAssetUpdate(
  project: ProjectDraft,
  binding: ProjectAssetBinding,
): Promise<ProjectAssetUpdatePlan> {
  const nextSnapshot = createProjectAssetSnapshot(project);
  const localRevision = nextSnapshot.manifest.revision!;
  const files = listAssetFiles(nextSnapshot);
  const snapshotIssues = validateProjectAssetSnapshot(nextSnapshot);
  if (snapshotIssues.length) {
    return {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      snapshotRevision: localRevision,
      files,
      status: 'requiresReview',
      issues: snapshotIssues,
    };
  }

  try {
    const published = await new ProjectAssetStore(binding.projectDirectory).loadWithRevision();
    const issues = [] as ProjectAssetUpdatePlan['issues'];
    const layoutIssues = await validateProjectDirectoryLayout(
      binding.projectDirectory,
      createProjectAssetSnapshot(published.project),
    );
    issues.push(...layoutIssues);
    if (published.project.id !== project.id) {
      issues.push({ path: 'project.json.id', message: '项目资产目录属于另一个项目。' });
    }
    if (published.revision !== binding.revision) {
      issues.push({ path: 'project.json.revision', message: '项目资产已被外部修改，请先重载后再更新。' });
    }
    if (localRevision === binding.revision) {
      issues.push({ path: 'studio-data', message: '本地项目没有待发布的资产修改。' });
    }

    return {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      publishedRevision: published.revision,
      snapshotRevision: localRevision,
      files,
      status: issues.length ? 'requiresReview' : 'ready',
      issues,
    };
  } catch (error) {
    return {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      snapshotRevision: localRevision,
      files,
      status: 'unavailable',
      issues: error instanceof ProjectAssetStoreError
        ? error.issues
        : [{ path: binding.projectDirectory, message: errorMessage(error) }],
    };
  }
}

export interface ProjectAssetStoreFileSystem {
  rename(source: string, destination: string): Promise<void>;
  remove?(directory: string): Promise<void>;
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
  const { testCases, recordings, documents, fixtures, suites, ...projectMetadata } = sanitizedProject;
  return {
    manifest: {
      ...projectMetadata,
      schemaVersion: projectAssetSchemaVersion,
      revision: calculateProjectAssetRevision(sanitizedProject),
      assetIds: {
        cases: testCases.map((testCase) => ({ id: testCase.id, version: testCase.version ?? 0 })),
        recordings: recordings.map((recording) => recording.id),
        documents: documents.map((document) => document.id),
        fixtures: fixtures.map((fixture) => ({ id: fixture.id, version: fixture.version })),
        suites: suites.map((suite) => ({ id: suite.id, version: suite.version })),
      },
    },
    testCases,
    recordings,
    documents,
    fixtures,
    suites,
  };
}

export function validateProjectAssetSnapshot(snapshot: ProjectAssetSnapshot): ProjectAssetValidationIssue[] {
  const issues: ProjectAssetValidationIssue[] = [];
  const manifest = snapshot.manifest;
  if (!isNonEmptyString(manifest.id)) {
    issues.push({ path: 'project.json.id', message: '项目 ID 不能为空。' });
  }

  if (manifest.schemaVersion === legacyProjectAssetSchemaVersion) {
    validateAssetCollection('cases', snapshot.testCases, manifest.assetIds.cases, issues);
  } else if (manifest.schemaVersion === projectAssetSchemaVersion) {
    validateCaseCollection(snapshot.testCases, manifest.assetIds.cases, issues);
  } else {
    issues.push({ path: 'project.json.schemaVersion', message: '仅支持 project asset schema version 1 或 2。' });
  }
  validateAssetCollection('recordings', snapshot.recordings, manifest.assetIds.recordings, issues);
  validateAssetCollection('documents', snapshot.documents, manifest.assetIds.documents, issues);
  validateFixtureCollection(snapshot.fixtures, manifest.assetIds.fixtures, manifest, snapshot.testCases, issues);
  validateSuiteCollection(snapshot.suites, manifest.assetIds.suites, manifest, snapshot.testCases, issues);

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
      snapshotRevision: snapshot.manifest.revision!,
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
    const manifest = await readJson(this.manifestPath, 'project.json');
    validateManifest(manifest);

    const [testCases, storedRecordings, documents, fixtures, suites] = await Promise.all([
      manifest.schemaVersion === legacyProjectAssetSchemaVersion
        ? readAssetCollection<TestCaseDraft>(this.projectDirectory, 'cases', manifest.assetIds.cases)
        : readCaseCollection(this.projectDirectory, manifest.assetIds.cases),
      readAssetCollection<RecordingAsset>(this.projectDirectory, 'recordings', manifest.assetIds.recordings),
      readAssetCollection<PrdDocumentAsset>(this.projectDirectory, 'documents', manifest.assetIds.documents),
      readFixtureCollection(this.projectDirectory, manifest.assetIds.fixtures ?? []),
      readSuiteCollection(this.projectDirectory, manifest.assetIds.suites ?? []),
    ]);
    const recordings = manifest.revision === undefined
      ? storedRecordings.map(stripRecordingRuntimeData)
      : storedRecordings;
    const snapshot: ProjectAssetSnapshot = { manifest, testCases, recordings, documents, fixtures, suites };
    const issues = validateProjectAssetSnapshot(snapshot);
    if (manifest.schemaVersion === projectAssetSchemaVersion) {
      issues.push(...await validateV2CaseDirectoryLayout(this.projectDirectory, manifest.assetIds.cases));
    }
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
      await writeCaseCollection(temporaryDirectory, snapshot.testCases);
      await writeAssetCollection(temporaryDirectory, 'recordings', snapshot.recordings);
      await writeAssetCollection(temporaryDirectory, 'documents', snapshot.documents);
      await writeFixtureCollection(temporaryDirectory, snapshot.fixtures);
      await writeSuiteCollection(temporaryDirectory, snapshot.suites);

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

function validateCaseCollection(
  testCases: TestCaseDraft[],
  expectedReferences: unknown,
  issues: ProjectAssetValidationIssue[],
): void {
  const caseKeys = testCases.map((testCase) => caseReferenceKey(testCase));
  if (
    testCases.some((testCase) => !isNonEmptyString(testCase?.id) || !isPositiveInteger(testCase?.version)) ||
    new Set(caseKeys).size !== caseKeys.length
  ) {
    issues.push({ path: 'cases', message: 'Case ID 或版本缺失或重复。' });
  }
  if (!Array.isArray(expectedReferences)) {
    issues.push({ path: 'project.json.assetIds.cases', message: 'Case 版本引用必须是数组。' });
    return;
  }
  const expectedKeys = expectedReferences.map(caseReferenceKey);
  if (
    expectedReferences.some((reference) => !isVersionedAssetReference(reference)) ||
    new Set(expectedKeys).size !== expectedKeys.length
  ) {
    issues.push({ path: 'project.json.assetIds.cases', message: 'Case 版本引用必须唯一且有效。' });
  }
  if (!sameKeys(expectedKeys, caseKeys)) {
    issues.push({ path: 'project.json.assetIds.cases', message: 'manifest 与 Case 文件的版本引用不一致。' });
  }
}

function validateFixtureCollection(
  fixtures: FixtureAsset[],
  expectedReferences: VersionedTestAssetReference[] | undefined,
  manifest: ProjectAssetManifestMetadata,
  testCases: TestCaseDraft[],
  issues: ProjectAssetValidationIssue[],
): void {
  if (expectedReferences === undefined) {
    if (fixtures.length) {
      issues.push({ path: 'project.json.assetIds.fixtures', message: 'manifest 缺少 fixture 版本引用。' });
    }
    return;
  }
  if (!Array.isArray(expectedReferences)) {
    issues.push({ path: 'project.json.assetIds.fixtures', message: 'fixture 版本引用必须是数组。' });
    return;
  }
  const expectedKeys = expectedReferences.map(fixtureReferenceKey);
  if (
    expectedReferences.some((reference) => !isVersionedAssetReference(reference)) ||
    new Set(expectedKeys).size !== expectedKeys.length
  ) {
    issues.push({ path: 'project.json.assetIds.fixtures', message: 'fixture 版本引用必须唯一且有效。' });
  }

  const fixtureKeys = fixtures.map(fixtureReferenceKey);
  if (fixtureKeys.length !== fixtures.length || new Set(fixtureKeys).size !== fixtureKeys.length) {
    issues.push({ path: 'fixtures', message: 'fixture ID 或版本缺失或重复。' });
  }
  if (!sameKeys(expectedKeys, fixtureKeys)) {
    issues.push({ path: 'project.json.assetIds.fixtures', message: 'manifest 与 fixture 文件的版本引用不一致。' });
  }

  const environmentIds = new Set(manifest.environments.map((environment) => environment.id));
  const credentialIds = new Set(manifest.credentialRefs.map((credential) => credential.id));
  fixtures.forEach((fixture) => validateFixtureAsset(fixture, environmentIds, credentialIds, issues));

  const fixtureKeysSet = new Set(fixtureKeys);
  testCases.forEach((testCase) => {
    testCase.assetReferences?.fixtures.forEach((reference) => {
      if (!fixtureKeysSet.has(fixtureReferenceKey(reference))) {
        issues.push({
          path: `cases/${testCase.id}.assetReferences.fixtures`,
          message: `未找到 fixture ${reference.id}@${reference.version}。`,
        });
      }
    });
  });
}

function validateSuiteCollection(
  suites: SuiteAsset[],
  expectedReferences: VersionedTestAssetReference[] | undefined,
  manifest: ProjectAssetManifestMetadata,
  testCases: TestCaseDraft[],
  issues: ProjectAssetValidationIssue[],
): void {
  if (expectedReferences === undefined) {
    if (suites.length) {
      issues.push({ path: 'project.json.assetIds.suites', message: 'manifest 缺少 suite 版本引用。' });
    }
    return;
  }
  if (!Array.isArray(expectedReferences)) {
    issues.push({ path: 'project.json.assetIds.suites', message: 'suite 版本引用必须是数组。' });
    return;
  }
  const expectedKeys = expectedReferences.map(suiteReferenceKey);
  if (
    expectedReferences.some((reference) => !isVersionedAssetReference(reference)) ||
    new Set(expectedKeys).size !== expectedKeys.length
  ) {
    issues.push({ path: 'project.json.assetIds.suites', message: 'suite 版本引用必须唯一且有效。' });
  }
  const suiteKeys = suites.map(suiteReferenceKey);
  if (suiteKeys.length !== suites.length || new Set(suiteKeys).size !== suiteKeys.length) {
    issues.push({ path: 'suites', message: 'suite ID 或版本缺失或重复。' });
  }
  if (!sameKeys(expectedKeys, suiteKeys)) {
    issues.push({ path: 'project.json.assetIds.suites', message: 'manifest 与 suite 文件的版本引用不一致。' });
  }
  suites.forEach((suite) => validateSuiteAsset(suite, manifest.environments, testCases, issues));
}

function validateSuiteAsset(
  suite: SuiteAsset,
  environments: ProjectAssetManifestMetadata['environments'],
  testCases: TestCaseDraft[],
  issues: ProjectAssetValidationIssue[],
): void {
  const suitePath = suite?.id ? suiteRelativePath(suite) : 'suites';
  if (!suite || suite.schemaVersion !== 1 || !isNonEmptyString(suite.id) || !isPositiveInteger(suite.version)) {
    issues.push({ path: suitePath, message: 'suite 必须包含 schema version、稳定 ID 和正整数版本。' });
    return;
  }
  if (!isNonEmptyString(suite.name) || typeof suite.description !== 'string') {
    issues.push({ path: suitePath, message: 'suite 名称或描述无效。' });
  }
  if (!environments.some((environment) => environment.id === suite.environmentId)) {
    issues.push({ path: `${suitePath}.environmentId`, message: 'suite 引用了不存在的项目环境。' });
  }
  if (!Array.isArray(suite.tags) || suite.tags.some((tag) => !isNonEmptyString(tag)) || new Set(suite.tags).size !== suite.tags.length) {
    issues.push({ path: `${suitePath}.tags`, message: 'suite 标签必须是唯一的非空字符串。' });
  }
  if (
    !suite.execution ||
    !Number.isSafeInteger(suite.execution.concurrency) ||
    suite.execution.concurrency < 1 ||
    suite.execution.concurrency > 10 ||
    (suite.execution.failurePolicy !== 'continue' && suite.execution.failurePolicy !== 'failFast') ||
    !Number.isSafeInteger(suite.execution.retryLimit) ||
    suite.execution.retryLimit < 0 ||
    suite.execution.retryLimit > 3
  ) {
    issues.push({ path: `${suitePath}.execution`, message: 'suite 执行策略无效。' });
  }
  if (!Array.isArray(suite.caseReferences) || !suite.caseReferences.length) {
    issues.push({ path: `${suitePath}.caseReferences`, message: 'suite 至少需要一个用例引用。' });
    return;
  }
  const referenceKeys = suite.caseReferences.map(suiteReferenceKey);
  const validReferences = suite.caseReferences.every((reference) =>
    isVersionedAssetReference(reference) &&
    Array.isArray(reference.dependsOn) &&
    reference.dependsOn.every(isVersionedAssetReference),
  );
  if (!validReferences || new Set(referenceKeys).size !== referenceKeys.length) {
    issues.push({ path: `${suitePath}.caseReferences`, message: 'suite 用例引用或依赖声明无效。' });
    return;
  }
  if (Number.isNaN(Date.parse(suite.createdAt)) || Number.isNaN(Date.parse(suite.updatedAt))) {
    issues.push({ path: suitePath, message: 'suite 创建或更新时间无效。' });
  }
  resolveSuiteTestCases({ environments, testCases }, suite).issues.forEach((issue) => {
    issues.push({
      path: issue.kind === 'missingEnvironment' ? `${suitePath}.environmentId` : `${suitePath}.caseReferences`,
      message: issue.message,
    });
  });
}

function validateFixtureAsset(
  fixture: FixtureAsset,
  environmentIds: Set<string>,
  credentialIds: Set<string>,
  issues: ProjectAssetValidationIssue[],
): void {
  const fixturePath = fixture?.id ? fixtureRelativePath(fixture) : 'fixtures';
  if (!fixture || fixture.schemaVersion !== 1 || !isNonEmptyString(fixture.id) || !isPositiveInteger(fixture.version)) {
    issues.push({ path: fixturePath, message: 'fixture 必须包含 schema version、稳定 ID 和正整数版本。' });
    return;
  }
  if (!isNonEmptyString(fixture.name) || typeof fixture.description !== 'string') {
    issues.push({ path: fixturePath, message: 'fixture 名称或描述无效。' });
  }
  validateFixtureParameters(fixturePath, 'inputs', fixture.inputs, issues);
  validateFixtureParameters(fixturePath, 'outputs', fixture.outputs, issues);
  if (!hasValidFixtureHttpOutputConfiguration(fixture)) {
    issues.push({ path: fixturePath, message: 'fixture HTTP 输出映射必须指向已声明的 setup 输出，cleanup 不可声明输出。' });
  }
  if (!Array.isArray(fixture.credentialIds) || fixture.credentialIds.some((credentialId) => !credentialIds.has(credentialId))) {
    issues.push({ path: fixturePath, message: 'fixture 引用了不存在的项目凭据。' });
  }
  if (!Array.isArray(fixture.environmentIds) || fixture.environmentIds.some((environmentId) => !environmentIds.has(environmentId))) {
    issues.push({ path: fixturePath, message: 'fixture 引用了不存在的项目环境。' });
  }
  if (!Array.isArray(fixture.resourceLocks) || fixture.resourceLocks.some((resource) => !isNonEmptyString(resource))) {
    issues.push({ path: fixturePath, message: 'fixture 资源锁必须是非空字符串。' });
  }
  if (fixture.concurrency !== 'parallel' && fixture.concurrency !== 'exclusive') {
    issues.push({ path: fixturePath, message: 'fixture 并发策略无效。' });
  }
  validateFixtureLifecycle(fixturePath, 'setup', fixture.setup, issues);
  if (fixture.cleanup !== undefined) {
    validateFixtureLifecycle(fixturePath, 'cleanup', fixture.cleanup, issues);
  }
  if (Number.isNaN(Date.parse(fixture.createdAt)) || Number.isNaN(Date.parse(fixture.updatedAt))) {
    issues.push({ path: fixturePath, message: 'fixture 创建或更新时间无效。' });
  }
}

function validateFixtureParameters(
  fixturePath: string,
  label: 'inputs' | 'outputs',
  parameters: FixtureAsset['inputs'],
  issues: ProjectAssetValidationIssue[],
): void {
  if (!Array.isArray(parameters)) {
    issues.push({ path: `${fixturePath}.${label}`, message: 'fixture 参数必须是数组。' });
    return;
  }
  const names = parameters.map((parameter) => parameter?.name);
  if (
    names.some((name) => !isNonEmptyString(name) || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) ||
    new Set(names).size !== names.length ||
    parameters.some((parameter) =>
      !parameter ||
      (parameter.type !== 'string' && parameter.type !== 'number' && parameter.type !== 'boolean' && parameter.type !== 'json') ||
      typeof parameter.required !== 'boolean',
    )
  ) {
    issues.push({ path: `${fixturePath}.${label}`, message: 'fixture 参数名、类型或必填标记无效。' });
  }
}

function validateFixtureLifecycle(
  fixturePath: string,
  label: 'setup' | 'cleanup',
  lifecycle: FixtureAsset['setup'],
  issues: ProjectAssetValidationIssue[],
): void {
  if (
    !lifecycle ||
    !isNonEmptyString(lifecycle.summary) ||
    (lifecycle.mode !== 'http' && lifecycle.mode !== 'ui' && lifecycle.mode !== 'script')
  ) {
    issues.push({ path: `${fixturePath}.${label}`, message: 'fixture 生命周期声明无效。' });
    return;
  }
  if (lifecycle.mode === 'http') {
    if (lifecycle.script !== undefined) {
      issues.push({ path: `${fixturePath}.${label}.script`, message: '仅 script fixture 可以声明脚本。' });
    }
    if (lifecycle.http !== undefined && !normalizeFixtureHttpDeclaration(lifecycle.http)) {
      issues.push({ path: `${fixturePath}.${label}.http`, message: 'fixture HTTP 声明无效。' });
    }
    return;
  }
  if (lifecycle.mode !== 'script') {
    if (lifecycle.script !== undefined) {
      issues.push({ path: `${fixturePath}.${label}.script`, message: '仅 script fixture 可以声明脚本。' });
    }
    return;
  }
  const script = lifecycle.script;
  if (
    !script ||
    !isNonEmptyString(script.relativePath) ||
    script.relativePath.startsWith('/') ||
    script.relativePath.split(/[\\/]/u).includes('..') ||
    !isRevision(script.contentHash) ||
    !Array.isArray(script.requiredEnvironment) ||
    script.requiredEnvironment.some((name) => !isNonEmptyString(name))
  ) {
    issues.push({ path: `${fixturePath}.${label}.script`, message: 'fixture 脚本声明无效。' });
  }
}

function validateManifest(manifest: unknown): asserts manifest is ProjectAssetReadManifest {
  const issues: ProjectAssetValidationIssue[] = [];
  if (!manifest || typeof manifest !== 'object') {
    issues.push({ path: 'project.json', message: 'project manifest 必须是对象。' });
  } else {
    const candidate = manifest as {
      schemaVersion?: unknown;
      id?: unknown;
      revision?: unknown;
      assetIds?: unknown;
    };
    if (
      candidate.schemaVersion !== legacyProjectAssetSchemaVersion &&
      candidate.schemaVersion !== projectAssetSchemaVersion
    ) {
      issues.push({ path: 'project.json.schemaVersion', message: '不支持的 project asset schema version。' });
    }
    if (!isNonEmptyString(candidate.id)) {
      issues.push({ path: 'project.json.id', message: '项目 ID 不能为空。' });
    }
    if (candidate.revision !== undefined && !isRevision(candidate.revision)) {
      issues.push({ path: 'project.json.revision', message: '项目 revision 必须是 SHA-256 摘要。' });
    }
    const assetIds = candidate.assetIds;
    if (!assetIds || typeof assetIds !== 'object') {
      issues.push({ path: 'project.json.assetIds', message: 'manifest 缺少完整资产 ID 列表。' });
    } else {
      const collections = assetIds as Record<string, unknown>;
      if (!Array.isArray(collections.cases) || !Array.isArray(collections.recordings) || !Array.isArray(collections.documents)) {
        issues.push({ path: 'project.json.assetIds', message: 'manifest 缺少完整资产 ID 列表。' });
      }
      (['recordings', 'documents'] as const).forEach((kind) => {
        const ids = collections[kind];
        if (!Array.isArray(ids) || ids.some((id) => !isNonEmptyString(id)) || new Set(ids).size !== ids.length) {
          issues.push({ path: `project.json.assetIds.${kind}`, message: '资产 ID 必须为不重复的非空字符串。' });
        }
      });
      if (candidate.schemaVersion === legacyProjectAssetSchemaVersion) {
        const ids = collections.cases;
        if (!Array.isArray(ids) || ids.some((id) => !isNonEmptyString(id)) || new Set(ids).size !== ids.length) {
          issues.push({ path: 'project.json.assetIds.cases', message: '资产 ID 必须为不重复的非空字符串。' });
        }
      } else if (candidate.schemaVersion === projectAssetSchemaVersion) {
        const references = collections.cases;
        if (
          !Array.isArray(references) ||
          references.some((reference) => !isVersionedAssetReference(reference)) ||
          new Set(references.map(caseReferenceKey)).size !== references.length
        ) {
          issues.push({ path: 'project.json.assetIds.cases', message: 'Case 版本引用必须唯一且有效。' });
        }
      }
    }
  }
  if (issues.length) {
    throw new ProjectAssetStoreError('project manifest 无法读取。', issues);
  }
}

function listAssetFiles(snapshot: ProjectAssetSnapshot): string[] {
  return [
    'project.json',
    ...snapshot.testCases.map(caseRelativePath),
    ...snapshot.recordings.map((asset) => assetRelativePath('recordings', asset.id)),
    ...snapshot.documents.map((asset) => assetRelativePath('documents', asset.id)),
    ...snapshot.fixtures.map(fixtureRelativePath),
    ...snapshot.suites.map(suiteRelativePath),
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
    ...(snapshot.manifest.assetIds.fixtures === undefined ? [] : ['fixtures/']),
    ...(snapshot.manifest.assetIds.suites === undefined ? [] : ['suites/']),
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

async function validateV2CaseDirectoryLayout(
  directory: string,
  references: VersionedTestAssetReference[],
): Promise<ProjectAssetValidationIssue[]> {
  const expectedEntries = new Set([
    'cases/',
    ...references.map(caseRelativePath),
  ]);
  const actualEntries = (await listDirectoryTreeEntries(directory))
    .filter((entry) => entry === 'cases/' || entry.startsWith('cases/'));
  const actualEntrySet = new Set(actualEntries);
  const issues: ProjectAssetValidationIssue[] = [];
  actualEntrySet.forEach((entry) => {
    if (!expectedEntries.has(entry)) {
      issues.push({ path: entry, message: 'v2 Case 目录包含未被 manifest 管理的资产。' });
    }
  });
  expectedEntries.forEach((entry) => {
    if (!actualEntrySet.has(entry)) {
      issues.push({ path: entry, message: 'v2 Case 目录缺少 manifest 所需的资产。' });
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

function caseRelativePath(testCase: Pick<TestCaseDraft, 'id' | 'version'>): string {
  return path.posix.join('cases', `${encodeURIComponent(testCase.id)}@${testCase.version}.json`);
}

function fixtureRelativePath(fixture: Pick<FixtureAsset, 'id' | 'version'>): string {
  return path.posix.join('fixtures', `${encodeURIComponent(fixture.id)}@${fixture.version}.json`);
}

function suiteRelativePath(suite: Pick<SuiteAsset, 'id' | 'version'>): string {
  return path.posix.join('suites', `${encodeURIComponent(suite.id)}@${suite.version}.json`);
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
  kind: 'recordings' | 'documents',
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

async function writeCaseCollection(rootDirectory: string, testCases: TestCaseDraft[]): Promise<void> {
  const directory = path.join(rootDirectory, 'cases');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(testCases.map((testCase) => writeJson(path.join(rootDirectory, caseRelativePath(testCase)), testCase)));
}

async function readCaseCollection(
  rootDirectory: string,
  references: VersionedTestAssetReference[],
): Promise<TestCaseDraft[]> {
  return Promise.all(references.map(async (reference) => {
    const casePath = caseRelativePath(reference);
    const testCase = await readJson(path.join(rootDirectory, casePath), casePath) as TestCaseDraft;
    if (!testCase || testCase.id !== reference.id || testCase.version !== reference.version) {
      throw new ProjectAssetStoreError('Case 文件与 manifest 引用不一致。', [
        { path: casePath, message: 'Case ID 或版本不匹配。' },
      ]);
    }
    return testCase;
  }));
}

async function writeFixtureCollection(rootDirectory: string, fixtures: FixtureAsset[]): Promise<void> {
  const directory = path.join(rootDirectory, 'fixtures');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(fixtures.map((fixture) => writeJson(path.join(rootDirectory, fixtureRelativePath(fixture)), fixture)));
}

async function readFixtureCollection(
  rootDirectory: string,
  references: VersionedTestAssetReference[],
): Promise<FixtureAsset[]> {
  return Promise.all(references.map(async (reference) => {
    const fixturePath = fixtureRelativePath(reference);
    const fixture = await readJson(path.join(rootDirectory, fixturePath), fixturePath) as FixtureAsset;
    if (!fixture || fixture.id !== reference.id || fixture.version !== reference.version) {
      throw new ProjectAssetStoreError('fixture 文件与 manifest 引用不一致。', [
        { path: fixturePath, message: 'fixture ID 或版本不匹配。' },
      ]);
    }
    return fixture;
  }));
}

async function writeSuiteCollection(rootDirectory: string, suites: SuiteAsset[]): Promise<void> {
  const directory = path.join(rootDirectory, 'suites');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(suites.map((suite) => writeJson(path.join(rootDirectory, suiteRelativePath(suite)), suite)));
}

async function readSuiteCollection(
  rootDirectory: string,
  references: VersionedTestAssetReference[],
): Promise<SuiteAsset[]> {
  return Promise.all(references.map(async (reference) => {
    const suitePath = suiteRelativePath(reference);
    const suite = await readJson(path.join(rootDirectory, suitePath), suitePath) as SuiteAsset;
    if (!suite || suite.id !== reference.id || suite.version !== reference.version) {
      throw new ProjectAssetStoreError('suite 文件与 manifest 引用不一致。', [
        { path: suitePath, message: 'suite ID 或版本不匹配。' },
      ]);
    }
    return suite;
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
    fixtures: structuredClone(snapshot.fixtures),
    suites: structuredClone(snapshot.suites),
  };
}

export function calculateProjectAssetRevision(project: ProjectDraft): string {
  const canonicalProject = JSON.stringify(canonicalize(sanitizeProjectAsset(project)));
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

function fixtureReferenceKey(reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string {
  return `${reference.id}@${reference.version}`;
}

function caseReferenceKey(reference: unknown): string {
  if (!reference || typeof reference !== 'object') {
    return `${String(reference)}@`;
  }
  const candidate = reference as { id?: unknown; version?: unknown };
  return `${String(candidate.id)}@${String(candidate.version)}`;
}

function suiteReferenceKey(reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string {
  return `${reference.id}@${reference.version}`;
}

function sameKeys(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length && expected.every((key) => actual.includes(key));
}

function isVersionedAssetReference(value: unknown): value is VersionedTestAssetReference {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const reference = value as Partial<VersionedTestAssetReference>;
  return isNonEmptyString(reference.id) && isPositiveInteger(reference.version);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
