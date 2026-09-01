import { createHash, randomUUID } from 'node:crypto';
import { constants as fileSystemConstants, type Dirent } from 'node:fs';
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
  ReusableFlowAsset,
  SuiteAsset,
  VersionedTestAssetReference,
} from '../shared/studio.js';
import {
  hasValidFixtureHttpOutputConfiguration,
  normalizeFixtureHttpDeclaration,
  resolveSuiteTestCases,
  validateReusableFlow,
} from '../shared/studio.js';

const projectAssetSchemaVersion = 2 as const;
const legacyProjectAssetSchemaVersion = 1 as const;

type ProjectAssetManifestMetadata = Omit<ProjectDraft, 'testCases' | 'recordings' | 'documents' | 'fixtures' | 'reusableFlows' | 'suites'>;

/** One immutable legacy Case file retained below a migration backup directory. */
export interface LegacyCaseBackupFileRecord {
  path: string;
  contentHash: string;
}

/** Immutable inventory retained from one legacy v1 Case directory. */
export interface LegacyCaseBackupDeclaration {
  directory: string;
  files: LegacyCaseBackupFileRecord[];
}

export interface ProjectAssetManifest extends ProjectAssetManifestMetadata {
  schemaVersion: typeof projectAssetSchemaVersion;
  revision?: string;
  /** Migration bookkeeping; never becomes part of the hydrated ProjectDraft. */
  legacyCaseBackupDirectory?: string;
  /** Immutable inventory for the Case files retained below the declared directory. */
  legacyCaseBackupFiles?: LegacyCaseBackupFileRecord[];
  assetIds: {
    cases: VersionedTestAssetReference[];
    recordings: string[];
    documents: string[];
    fixtures?: VersionedTestAssetReference[];
    reusableFlows?: VersionedTestAssetReference[];
    suites?: VersionedTestAssetReference[];
  };
}

/** The inventory format written before backup content hashes were introduced. */
interface PreviousLegacyCaseBackupManifest extends Omit<ProjectAssetManifest, 'legacyCaseBackupFiles'> {
  legacyCaseBackupFiles: string[];
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
    /** Absent only in snapshots written before reusable Flows were introduced. */
    reusableFlows?: VersionedTestAssetReference[];
    /** Absent only in snapshots written before Suites were introduced. */
    suites?: VersionedTestAssetReference[];
  };
}

type ProjectAssetV2ReadManifest = ProjectAssetManifest | PreviousLegacyCaseBackupManifest;
type ProjectAssetReadManifest = ProjectAssetV2ReadManifest | LegacyProjectAssetManifest;

export interface ProjectAssetSnapshot {
  manifest: ProjectAssetReadManifest;
  testCases: TestCaseDraft[];
  recordings: RecordingAsset[];
  documents: PrdDocumentAsset[];
  fixtures: FixtureAsset[];
  reusableFlows: ReusableFlowAsset[];
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
export const inspectProjectAssetBinding = async (
  project: ProjectDraft,
  binding: ProjectAssetBinding,
): Promise<ProjectAssetBindingStatus> => {
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
};

/**
 * Produces a read-only reload plan. A tracked directory is never authoritative
 * while the local project contains edits that have not been snapshotted.
 */
export const planProjectAssetReload = async (
  project: ProjectDraft,
  binding: ProjectAssetBinding,
): Promise<ProjectAssetReloadPlan> => {
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
};

/**
 * Produces a read-only CAS publish plan for local edits. It never writes the
 * bound directory and deliberately rejects a changed directory, an unchanged
 * local project, or unmanaged files beside the snapshot.
 */
export const planProjectAssetUpdate = async (
  project: ProjectDraft,
  binding: ProjectAssetBinding,
): Promise<ProjectAssetUpdatePlan> => {
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
    const publishedManifest = await readJson(binding.projectDirectory, 'project.json');
    validateManifest(publishedManifest);
    const legacyCaseBackup = await readLegacyCaseBackupDeclaration(binding.projectDirectory, publishedManifest);
    const layoutIssues = await validateProjectDirectoryLayout(
      binding.projectDirectory,
      createProjectAssetSnapshot(
        published.project,
        legacyCaseBackup,
      ),
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
};

export interface ProjectAssetStoreFileSystem {
  rename(source: string, destination: string): Promise<void>;
  remove?(directory: string): Promise<void>;
  /** Runs after the first displaced-target validation and immediately before the second. */
  afterDisplacedTargetValidation?(directory: string): Promise<void>;
  /** Test hook between any asset-path inspection and its no-follow descriptor open. */
  afterProjectAssetPathValidation?(rootDirectory: string, relativePath: string): Promise<void>;
}

interface LegacyCaseBackupFile {
  relativePath: string;
  content: string;
  contentHash: string;
}

interface PreparedLegacyCaseMigration {
  plan: ProjectAssetMigrationPlan;
  snapshot?: ProjectAssetSnapshot;
  backupFiles?: LegacyCaseBackupFile[];
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

export const createProjectAssetSnapshot = (
  project: ProjectDraft,
  legacyCaseBackup?: LegacyCaseBackupDeclaration,
): ProjectAssetSnapshot => {
  const sanitizedProject = sanitizeProjectAsset(project);
  const { testCases, recordings, documents, fixtures, reusableFlows, suites, ...projectMetadata } = sanitizedProject;
  return {
    manifest: {
      ...projectMetadata,
      schemaVersion: projectAssetSchemaVersion,
      revision: calculateProjectAssetRevision(sanitizedProject),
      ...(legacyCaseBackup === undefined ? {} : {
        legacyCaseBackupDirectory: legacyCaseBackup.directory,
        legacyCaseBackupFiles: structuredClone(legacyCaseBackup.files),
      }),
      assetIds: {
        cases: testCases.map((testCase) => ({ id: testCase.id, version: testCase.version ?? 0 })),
        recordings: recordings.map((recording) => recording.id),
        documents: documents.map((document) => document.id),
        fixtures: fixtures.map((fixture) => ({ id: fixture.id, version: fixture.version })),
        reusableFlows: reusableFlows.map((flow) => ({ id: flow.id, version: flow.version })),
        suites: suites.map((suite) => ({ id: suite.id, version: suite.version })),
      },
    },
    testCases,
    recordings,
    documents,
    fixtures,
    reusableFlows,
    suites,
  };
};

export const validateProjectAssetSnapshot = (snapshot: ProjectAssetSnapshot): ProjectAssetValidationIssue[] => {
  const issues: ProjectAssetValidationIssue[] = [];
  const manifest = snapshot.manifest;
  if (!isNonEmptyString(manifest.id)) {
    issues.push({ path: 'project.json.id', message: '项目 ID 不能为空。' });
  }

  if (manifest.schemaVersion === legacyProjectAssetSchemaVersion) {
    validateAssetCollection('cases', snapshot.testCases, manifest.assetIds.cases, issues);
  } else if (manifest.schemaVersion === projectAssetSchemaVersion) {
    validateCaseCollection(snapshot.testCases, manifest.assetIds.cases, issues);
    if (
      !isValidLegacyCaseBackupManifestDeclaration(
        manifest.legacyCaseBackupDirectory,
        manifest.legacyCaseBackupFiles,
      )
    ) {
      issues.push({ path: 'project.json.legacyCaseBackupDirectory', message: 'legacy Case 备份声明必须包含安全的相对路径和固定文件清单。' });
    }
  } else {
    issues.push({ path: 'project.json.schemaVersion', message: '仅支持 project asset schema version 1 或 2。' });
  }
  validateAssetCollection('recordings', snapshot.recordings, manifest.assetIds.recordings, issues);
  validateAssetCollection('documents', snapshot.documents, manifest.assetIds.documents, issues);
  validateFixtureCollection(snapshot.fixtures, manifest.assetIds.fixtures, manifest, snapshot.testCases, issues);
  validateReusableFlowCollection(snapshot.reusableFlows, manifest.assetIds.reusableFlows, snapshot.testCases, issues);
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
};

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

  /**
   * Builds a read-only conversion plan for a schema-v1 Case layout. The plan
   * carries a content revision rather than trusting a caller to describe the
   * source directory again at confirmation time.
  */
  async planLegacyCaseMigration(): Promise<ProjectAssetMigrationPlan> {
    try {
      return (await this.prepareLegacyCaseMigration(this.projectDirectory)).plan;
    } catch (error) {
      const blockedPlan = await this.createBlockedLegacyCaseMigrationPlan(error);
      if (blockedPlan) {
        return blockedPlan;
      }
      throw error;
    }
  }

  /** Applies only the exact ready plan that was reviewed against this directory. */
  async confirmLegacyCaseMigration(plan: ProjectAssetMigrationPlan): Promise<void> {
    if (plan.projectDirectory !== this.projectDirectory) {
      throw new ProjectAssetStoreError('legacy Case 迁移计划不属于当前项目目录。', [
        { path: this.projectDirectory, message: '迁移计划的项目目录不匹配。' },
      ]);
    }
    if (plan.status === 'alreadyMigrated') {
      return;
    }
    if (
      plan.status !== 'ready' ||
      plan.targetSchemaVersion !== projectAssetSchemaVersion ||
      !isRevision(plan.sourceRevision) ||
      !isNonEmptyString(plan.migrationId) ||
      !isSafeLegacyCaseBackupDirectory(plan.backupDirectory)
    ) {
      throw new ProjectAssetStoreError('legacy Case 迁移计划不可确认。', [
        { path: 'migration-plan', message: '只能确认当前、完整且可写入的迁移预览。' },
      ]);
    }

    const prepared = await this.prepareLegacyCaseMigration(this.projectDirectory);
    const currentPlan = prepared.plan;
    if (
      currentPlan.status !== 'ready' ||
      currentPlan.sourceRevision !== plan.sourceRevision ||
      currentPlan.migrationId !== plan.migrationId ||
      currentPlan.backupDirectory !== plan.backupDirectory ||
      !prepared.snapshot ||
      !prepared.backupFiles
    ) {
      throw new ProjectAssetStoreError('legacy Case 迁移源已变化，请重新预览。', [
        { path: 'project.json', message: '迁移预览的 source revision 已过期。' },
      ]);
    }

    await this.writeSnapshotAtomically(prepared.snapshot, {
      allowMissingTarget: false,
      legacyCaseBackupFiles: prepared.backupFiles,
      validateDisplacedTarget: async (directory) => {
        const displaced = await this.prepareLegacyCaseMigration(directory);
        if (displaced.plan.status !== 'ready' || displaced.plan.sourceRevision !== plan.sourceRevision) {
          throw new ProjectAssetStoreError('legacy Case 迁移源在确认期间发生变化。', [
            { path: 'project.json', message: '迁移 source revision 已变化，已拒绝提交。' },
          ]);
        }
      },
    });
    await this.loadWithRevision();
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
    const manifest = await readJson(
      this.projectDirectory,
      'project.json',
      this.fileSystem.afterProjectAssetPathValidation,
    );
    validateManifest(manifest);

    const [testCases, storedRecordings, documents, fixtures, reusableFlows, suites] = await Promise.all([
      manifest.schemaVersion === legacyProjectAssetSchemaVersion
        ? readLegacyCaseCollectionWithContent(
          this.projectDirectory,
          manifest.assetIds.cases,
          this.fileSystem.afterProjectAssetPathValidation,
        ).then((legacyCases) => legacyCases.map(({ testCase }) => testCase))
        : readCaseCollection(this.projectDirectory, manifest.assetIds.cases, this.fileSystem.afterProjectAssetPathValidation),
      readAssetCollection<RecordingAsset>(this.projectDirectory, 'recordings', manifest.assetIds.recordings, this.fileSystem.afterProjectAssetPathValidation),
      readAssetCollection<PrdDocumentAsset>(this.projectDirectory, 'documents', manifest.assetIds.documents, this.fileSystem.afterProjectAssetPathValidation),
      readFixtureCollection(this.projectDirectory, manifest.assetIds.fixtures ?? [], this.fileSystem.afterProjectAssetPathValidation),
      readReusableFlowCollection(this.projectDirectory, manifest.assetIds.reusableFlows ?? [], this.fileSystem.afterProjectAssetPathValidation),
      readSuiteCollection(this.projectDirectory, manifest.assetIds.suites ?? [], this.fileSystem.afterProjectAssetPathValidation),
    ]);
    const recordings = manifest.revision === undefined
      ? storedRecordings.map(stripRecordingRuntimeData)
      : storedRecordings;
    const snapshot: ProjectAssetSnapshot = { manifest, testCases, recordings, documents, fixtures, reusableFlows, suites };
    const issues = validateProjectAssetSnapshot(snapshot);
    if (manifest.schemaVersion === projectAssetSchemaVersion) {
      issues.push(...await validateV2CaseDirectoryLayout(this.projectDirectory, manifest.assetIds.cases));
      issues.push(...await validateLegacyCaseBackupDirectoryLayout(
        this.projectDirectory,
        manifest,
        this.fileSystem.afterProjectAssetPathValidation,
      ));
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
    const legacyCaseBackup = await this.assertUpdatePreconditions(
      this.projectDirectory,
      project.id,
      expectedRevision,
    );
    const snapshot = createProjectAssetSnapshot(project, legacyCaseBackup);
    await this.writeSnapshotAtomically(snapshot, {
      allowMissingTarget: false,
      validateDisplacedTarget: async (directory) => {
        await this.assertUpdatePreconditions(directory, project.id, expectedRevision, legacyCaseBackup);
      },
    });
  }

  private async prepareLegacyCaseMigration(directory: string): Promise<PreparedLegacyCaseMigration> {
    const sourceRevision = await calculateDirectoryContentRevision(directory, this.fileSystem.afterProjectAssetPathValidation);
    const { value: manifestValue } = await readJsonWithText(
      directory,
      'project.json',
      this.fileSystem.afterProjectAssetPathValidation,
    );
    validateManifest(manifestValue);
    const manifest = manifestValue;

    if (manifest.schemaVersion === projectAssetSchemaVersion) {
      const current = await new ProjectAssetStore(directory, this.fileSystem).loadWithRevision();
      const legacyCaseBackup = await readLegacyCaseBackupDeclaration(
        directory,
        manifest,
        this.fileSystem.afterProjectAssetPathValidation,
      );
      return {
        plan: {
          projectId: current.project.id,
          projectDirectory: this.projectDirectory,
          snapshotRevision: current.revision,
          files: listAssetFiles(createProjectAssetSnapshot(current.project, legacyCaseBackup)),
          status: 'alreadyMigrated',
          conflicts: [],
          ...(legacyCaseBackup === undefined
            ? {}
            : { backupDirectory: legacyCaseBackup.directory }),
        },
      };
    }

    const [legacyCases, storedRecordings, documents, fixtures, reusableFlows, suites] = await Promise.all([
      readLegacyCaseCollectionWithContent(
        directory,
        manifest.assetIds.cases,
        this.fileSystem.afterProjectAssetPathValidation,
      ),
      readAssetCollection<RecordingAsset>(directory, 'recordings', manifest.assetIds.recordings, this.fileSystem.afterProjectAssetPathValidation),
      readAssetCollection<PrdDocumentAsset>(directory, 'documents', manifest.assetIds.documents, this.fileSystem.afterProjectAssetPathValidation),
      readFixtureCollection(directory, manifest.assetIds.fixtures ?? [], this.fileSystem.afterProjectAssetPathValidation),
      readReusableFlowCollection(directory, manifest.assetIds.reusableFlows ?? [], this.fileSystem.afterProjectAssetPathValidation),
      readSuiteCollection(directory, manifest.assetIds.suites ?? [], this.fileSystem.afterProjectAssetPathValidation),
    ]);
    const layoutIssues = await validateLegacyProjectDirectoryLayout(directory, manifest);
    const finalSourceRevision = await calculateDirectoryContentRevision(directory, this.fileSystem.afterProjectAssetPathValidation);
    if (finalSourceRevision !== sourceRevision) {
      throw new ProjectAssetStoreError('legacy Case 迁移预览期间源目录发生变化。', [
        { path: this.projectDirectory, message: '无法为变化中的 v1 快照创建可确认的迁移计划。' },
      ]);
    }

    const migrationId = `legacy-cases-${sourceRevision.slice(0, 16)}`;
    const backupDirectory = path.posix.join('migration-backup', migrationId);
    const normalizedCases = legacyCases.map(({ testCase }) => ({
      ...structuredClone(testCase),
      schemaVersion: 2 as const,
      version: isPositiveInteger(testCase.version) ? testCase.version : 1,
    }));
    const project = projectFromSnapshot({
      manifest,
      testCases: normalizedCases,
      recordings: manifest.revision === undefined ? storedRecordings.map(stripRecordingRuntimeData) : storedRecordings,
      documents,
      fixtures,
      reusableFlows,
      suites,
    });
    const snapshot = createProjectAssetSnapshot(project, {
      directory: backupDirectory,
      files: legacyCases.map(({ relativePath, content }) => ({
        path: relativePath,
        contentHash: calculateContentHash(content),
      })),
    });
    const issues = [...layoutIssues, ...validateProjectAssetSnapshot(snapshot)];
    const targetPaths = normalizedCases.map(caseRelativePath);
    const duplicateTarget = targetPaths.find((targetPath, index) => targetPaths.indexOf(targetPath) !== index);
    if (duplicateTarget) {
      issues.push({ path: duplicateTarget, message: '多个 legacy Case 将写入同一个 v2 目标。' });
    }
    await Promise.all(targetPaths.map(async (targetPath) => {
      if (await pathExists(path.join(directory, targetPath))) {
        issues.push({ path: targetPath, message: 'v2 Case 目标已存在，必须先审阅冲突。' });
      }
    }));

    const plan: ProjectAssetMigrationPlan = {
      projectId: project.id,
      projectDirectory: this.projectDirectory,
      snapshotRevision: snapshot.manifest.revision!,
      files: listAssetFiles(snapshot),
      status: issues.length ? 'blocked' : 'ready',
      conflicts: issues.map((issue) => issue.path),
      sourceRevision,
      migrationId,
      targetSchemaVersion: projectAssetSchemaVersion,
      backupDirectory,
      issues,
    };
    return {
      plan,
      ...(issues.length ? {} : {
        snapshot,
        backupFiles: legacyCases.map(({ relativePath, content }) => ({
          relativePath,
          content,
          contentHash: calculateContentHash(content),
        })),
      }),
    };
  }

  private async createBlockedLegacyCaseMigrationPlan(error: unknown): Promise<ProjectAssetMigrationPlan | undefined> {
    if (!(error instanceof ProjectAssetStoreError)) {
      return undefined;
    }
    const manifest = await readLegacyManifestForBlockedPlan(this.projectDirectory);
    let sourceRevision: string | undefined;
    try {
      sourceRevision = await calculateDirectoryContentRevision(this.projectDirectory);
    } catch {
      // The original structured read error is more useful than a second filesystem error.
    }
    return {
      projectId: manifest?.id ?? 'unavailable-legacy-project',
      projectDirectory: this.projectDirectory,
      snapshotRevision: sourceRevision ?? '',
      files: [],
      status: 'blocked',
      conflicts: error.issues.map((issue) => issue.path),
      ...(sourceRevision === undefined ? {} : { sourceRevision }),
      issues: error.issues,
    };
  }

  private async assertUpdatePreconditions(
    directory: string,
    projectId: string,
    expectedRevision: string,
    expectedLegacyCaseBackup?: LegacyCaseBackupDeclaration,
  ): Promise<LegacyCaseBackupDeclaration | undefined> {
    const current = await new ProjectAssetStore(directory, this.fileSystem).loadWithRevision();
    const manifest = await readJson(directory, 'project.json', this.fileSystem.afterProjectAssetPathValidation);
    validateManifest(manifest);
    const legacyCaseBackup = await readLegacyCaseBackupDeclaration(
      directory,
      manifest,
      this.fileSystem.afterProjectAssetPathValidation,
    );
    const issues = await validateProjectDirectoryLayout(
      directory,
      createProjectAssetSnapshot(current.project, legacyCaseBackup),
    );
    if (current.project.id !== projectId) {
      issues.push({ path: 'project.json.id', message: '目标目录属于另一个项目，拒绝覆盖。' });
    }
    if (current.revision !== expectedRevision) {
      issues.push({ path: 'project.json.revision', message: '项目资产已被外部修改，请重新加载后再保存。' });
    }
    if (
      expectedLegacyCaseBackup !== undefined &&
      !sameLegacyCaseBackupDeclaration(legacyCaseBackup, expectedLegacyCaseBackup)
    ) {
      issues.push({ path: 'project.json.legacyCaseBackup', message: 'legacy Case 备份声明已被外部修改。' });
    }
    if (issues.length) {
      throw new ProjectAssetStoreError('项目资产更新前置校验失败。', issues);
    }
    return legacyCaseBackup;
  }

  private async writeSnapshotAtomically(
    snapshot: ProjectAssetSnapshot,
    options: {
      allowMissingTarget: boolean;
      validateDisplacedTarget: (directory: string) => Promise<void>;
      legacyCaseBackupFiles?: LegacyCaseBackupFile[];
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
      await writeReusableFlowCollection(temporaryDirectory, snapshot.reusableFlows);
      await writeSuiteCollection(temporaryDirectory, snapshot.suites);
      await writeOrCopyLegacyCaseBackup(
        temporaryDirectory,
        this.projectDirectory,
        snapshot.manifest,
        options.legacyCaseBackupFiles,
        this.fileSystem.afterProjectAssetPathValidation,
      );

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
        await this.fileSystem.afterDisplacedTargetValidation?.(backupDirectory);
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

const sanitizeProjectAsset = (project: ProjectDraft): ProjectDraft => {
  const clonedProject = structuredClone(project);
  return {
    ...clonedProject,
    recordings: clonedProject.recordings.map(stripRecordingRuntimeData),
  };
};

const stripRecordingRuntimeData = (recording: RecordingAsset): RecordingAsset => {
  return {
    ...structuredClone(recording),
    steps: recording.steps.map(({
      screenshotPath: _screenshotPath,
      value: _value,
      ...step
    }) => ({ ...step })),
  };
};

const validateAssetCollection = (
  kind: 'cases' | 'recordings' | 'documents',
  assets: Array<{ id: string }>,
  expectedIds: string[],
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateCaseCollection = (
  testCases: TestCaseDraft[],
  expectedReferences: unknown,
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateFixtureCollection = (
  fixtures: FixtureAsset[],
  expectedReferences: VersionedTestAssetReference[] | undefined,
  manifest: ProjectAssetManifestMetadata,
  testCases: TestCaseDraft[],
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateReusableFlowCollection = (
  reusableFlows: ReusableFlowAsset[],
  expectedReferences: VersionedTestAssetReference[] | undefined,
  testCases: TestCaseDraft[],
  issues: ProjectAssetValidationIssue[],
): void => {
  if (expectedReferences === undefined) {
    if (reusableFlows.length) {
      issues.push({ path: 'project.json.assetIds.reusableFlows', message: 'manifest 缺少可复用流程版本引用。' });
    }
    return;
  }
  if (!Array.isArray(expectedReferences)) {
    issues.push({ path: 'project.json.assetIds.reusableFlows', message: '可复用流程版本引用必须是数组。' });
    return;
  }
  const expectedKeys = expectedReferences.map(reusableFlowReferenceKey);
  if (
    expectedReferences.some((reference) => !isVersionedAssetReference(reference)) ||
    new Set(expectedKeys).size !== expectedKeys.length
  ) {
    issues.push({ path: 'project.json.assetIds.reusableFlows', message: '可复用流程版本引用必须唯一且有效。' });
  }
  const flowKeys = reusableFlows.map(reusableFlowReferenceKey);
  if (flowKeys.length !== reusableFlows.length || new Set(flowKeys).size !== flowKeys.length) {
    issues.push({ path: 'reusable-flows', message: '可复用流程 ID 或版本缺失或重复。' });
  }
  if (!sameKeys(expectedKeys, flowKeys)) {
    issues.push({ path: 'project.json.assetIds.reusableFlows', message: 'manifest 与可复用流程文件的版本引用不一致。' });
  }
  reusableFlows.forEach((flow) => {
    const flowPath = flow?.id ? reusableFlowRelativePath(flow) : 'reusable-flows';
    validateReusableFlow(flow).forEach((issue) => {
      issues.push({ path: flowPath, message: issue.message });
    });
  });

  const availableReferences = new Set(flowKeys);
  testCases.forEach((testCase) => {
    const references = testCase.assetReferences?.reusableFlows;
    if (references === undefined) {
      return;
    }
    if (!Array.isArray(references)) {
      issues.push({
        path: `cases/${testCase.id}.assetReferences.reusableFlows`,
        message: '可复用流程引用必须是数组。',
      });
      return;
    }
    const referencedFlowIds = references.map((reference) => reference?.id);
    if (referencedFlowIds.some((id) => !isNonEmptyString(id)) || new Set(referencedFlowIds).size !== referencedFlowIds.length) {
      issues.push({
        path: `cases/${testCase.id}.assetReferences.reusableFlows`,
        message: '一个用例最多只能引用一个同 ID 的可复用流程版本。',
      });
      return;
    }
    references.forEach((reference) => {
      if (!isVersionedAssetReference(reference) || !availableReferences.has(reusableFlowReferenceKey(reference))) {
        issues.push({
          path: `cases/${testCase.id}.assetReferences.reusableFlows`,
          message: `未找到可复用流程 ${reference?.id ?? 'unknown'}@${reference?.version ?? 'unknown'}。`,
        });
      }
    });
  });
};

const validateSuiteCollection = (
  suites: SuiteAsset[],
  expectedReferences: VersionedTestAssetReference[] | undefined,
  manifest: ProjectAssetManifestMetadata,
  testCases: TestCaseDraft[],
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateSuiteAsset = (
  suite: SuiteAsset,
  environments: ProjectAssetManifestMetadata['environments'],
  testCases: TestCaseDraft[],
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateFixtureAsset = (
  fixture: FixtureAsset,
  environmentIds: Set<string>,
  credentialIds: Set<string>,
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateFixtureParameters = (
  fixturePath: string,
  label: 'inputs' | 'outputs',
  parameters: FixtureAsset['inputs'],
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateFixtureLifecycle = (
  fixturePath: string,
  label: 'setup' | 'cleanup',
  lifecycle: FixtureAsset['setup'],
  issues: ProjectAssetValidationIssue[],
): void => {
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
};

const validateManifest: (manifest: unknown) => asserts manifest is ProjectAssetReadManifest = (manifest) => {
  const issues: ProjectAssetValidationIssue[] = [];
  if (!manifest || typeof manifest !== 'object') {
    issues.push({ path: 'project.json', message: 'project manifest 必须是对象。' });
  } else {
    const candidate = manifest as {
      schemaVersion?: unknown;
      id?: unknown;
      revision?: unknown;
      legacyCaseBackupDirectory?: unknown;
      legacyCaseBackupFiles?: unknown;
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
    if (
      candidate.schemaVersion === projectAssetSchemaVersion &&
      !isValidLegacyCaseBackupManifestDeclaration(
        candidate.legacyCaseBackupDirectory,
        candidate.legacyCaseBackupFiles,
      )
    ) {
      issues.push({ path: 'project.json.legacyCaseBackupDirectory', message: 'legacy Case 备份声明必须包含安全的相对路径和固定文件清单。' });
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
      const reusableFlowReferences = collections.reusableFlows;
      if (
        reusableFlowReferences !== undefined &&
        (!Array.isArray(reusableFlowReferences) ||
          reusableFlowReferences.some((reference) => !isVersionedAssetReference(reference)) ||
          new Set(reusableFlowReferences.map(reusableFlowReferenceKey)).size !== reusableFlowReferences.length)
      ) {
        issues.push({ path: 'project.json.assetIds.reusableFlows', message: '可复用流程版本引用必须唯一且有效。' });
      }
    }
  }
  if (issues.length) {
    throw new ProjectAssetStoreError('project manifest 无法读取。', issues);
  }
};

const listAssetFiles = (snapshot: ProjectAssetSnapshot): string[] => {
  return [
    'project.json',
    ...snapshot.testCases.map(caseRelativePath),
    ...snapshot.recordings.map((asset) => assetRelativePath('recordings', asset.id)),
    ...snapshot.documents.map((asset) => assetRelativePath('documents', asset.id)),
    ...snapshot.fixtures.map(fixtureRelativePath),
    ...snapshot.reusableFlows.map(reusableFlowRelativePath),
    ...snapshot.suites.map(suiteRelativePath),
    ...legacyCaseBackupFiles(snapshot),
  ];
};

const validateProjectDirectoryLayout = async (
  directory: string,
  snapshot: ProjectAssetSnapshot,
): Promise<ProjectAssetValidationIssue[]> => {
  const expectedEntries = new Set([
    'cases/',
    'documents/',
    'recordings/',
    ...(snapshot.manifest.assetIds.fixtures === undefined ? [] : ['fixtures/']),
    ...(snapshot.manifest.assetIds.reusableFlows === undefined ? [] : ['reusable-flows/']),
    ...(snapshot.manifest.assetIds.suites === undefined ? [] : ['suites/']),
    ...legacyCaseBackupEntries(snapshot),
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
};

const validateLegacyProjectDirectoryLayout = async (
  directory: string,
  manifest: LegacyProjectAssetManifest,
): Promise<ProjectAssetValidationIssue[]> => {
  const expectedEntries = new Set([
    'cases/',
    'documents/',
    'recordings/',
    ...(manifest.assetIds.fixtures === undefined ? [] : ['fixtures/']),
    ...(manifest.assetIds.reusableFlows === undefined ? [] : ['reusable-flows/']),
    ...(manifest.assetIds.suites === undefined ? [] : ['suites/']),
    'project.json',
    ...manifest.assetIds.cases.map((id) => assetRelativePath('cases', id)),
    ...manifest.assetIds.recordings.map((id) => assetRelativePath('recordings', id)),
    ...manifest.assetIds.documents.map((id) => assetRelativePath('documents', id)),
    ...(manifest.assetIds.fixtures ?? []).map(fixtureRelativePath),
    ...(manifest.assetIds.reusableFlows ?? []).map(reusableFlowRelativePath),
    ...(manifest.assetIds.suites ?? []).map(suiteRelativePath),
  ]);
  const actualEntries = new Set(await listDirectoryTreeEntries(directory));
  const issues: ProjectAssetValidationIssue[] = [];
  actualEntries.forEach((entry) => {
    if (!expectedEntries.has(entry)) {
      issues.push({ path: entry, message: 'legacy 项目目录包含未被 manifest 管理的外部条目，拒绝迁移。' });
    }
  });
  expectedEntries.forEach((entry) => {
    if (!actualEntries.has(entry)) {
      issues.push({ path: entry, message: 'legacy 项目目录缺少 manifest 所需的资产条目。' });
    }
  });
  return issues;
};

const validateLegacyCaseBackupDirectoryLayout = async (
  directory: string,
  manifest: ProjectAssetV2ReadManifest,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<ProjectAssetValidationIssue[]> => {
  const expectedEntries = new Set(legacyCaseBackupEntriesFor(
    manifest.legacyCaseBackupDirectory,
    manifest.legacyCaseBackupFiles,
  ));
  const issues: ProjectAssetValidationIssue[] = [];
  let actualEntries: string[];
  let filesToVerify: Array<{ path: string; contentHash?: string }> = [];
  const backupDirectory = manifest.legacyCaseBackupDirectory;
  if (backupDirectory === undefined) {
    actualEntries = (await listDirectoryTreeEntries(directory))
      .filter((entry) => entry === 'migration-backup/' || entry.startsWith('migration-backup/'));
  } else {
    try {
      const declaredEntries = await listSafeProjectAssetTreeEntries(directory, backupDirectory);
      actualEntries = [
        'migration-backup/',
        `${backupDirectory}/`,
        ...declaredEntries,
      ];
      if (manifest.legacyCaseBackupFiles === undefined) {
        const discoveredFiles = declaredEntries
          .filter((entry) => !entry.endsWith('/'))
          .map((entry) => entry.slice(backupDirectory.length + 1));
        if (!discoveredFiles.every(isSafeLegacyCaseBackupFile) || new Set(discoveredFiles).size !== discoveredFiles.length) {
          issues.push({
            path: backupDirectory,
            message: '旧备份目录包含未受支持的条目。',
          });
        } else {
          discoveredFiles.forEach((file) => expectedEntries.add(path.posix.join(backupDirectory, file)));
          filesToVerify = discoveredFiles.map((file) => ({ path: file }));
        }
      } else {
        filesToVerify = manifest.legacyCaseBackupFiles.map((file) => ({
          path: legacyCaseBackupFilePath(file),
          contentHash: legacyCaseBackupFileContentHash(file),
        }));
      }
    } catch (error) {
      if (error instanceof ProjectAssetStoreError) {
        issues.push(...error.issues);
      } else {
        issues.push({ path: backupDirectory, message: errorMessage(error) });
      }
      actualEntries = (await listDirectoryTreeEntries(directory))
        .filter((entry) => entry === 'migration-backup/' || entry.startsWith('migration-backup/'));
    }
  }
  const actualEntrySet = new Set(actualEntries);
  actualEntrySet.forEach((entry) => {
    if (!expectedEntries.has(entry)) {
      issues.push({ path: entry, message: 'legacy Case 备份目录未被 manifest 声明。' });
    }
  });
  expectedEntries.forEach((entry) => {
    if (!actualEntrySet.has(entry)) {
      issues.push({ path: entry, message: 'manifest 声明的 legacy Case 备份内容缺失。' });
    }
  });
  if (backupDirectory) {
    const verification = await Promise.allSettled(filesToVerify.map(({ path: relativePath, contentHash }) => (
      readVerifiedLegacyCaseBackupFile(
        directory,
        backupDirectory,
        relativePath,
        contentHash,
        afterPathValidation,
      )
    )));
    verification.forEach((result) => {
      if (result.status === 'rejected') {
        if (result.reason instanceof ProjectAssetStoreError) {
          issues.push(...result.reason.issues);
        } else {
          issues.push({ path: manifest.legacyCaseBackupDirectory!, message: errorMessage(result.reason) });
        }
      }
    });
  }
  return issues;
};

const legacyCaseBackupEntries = (snapshot: ProjectAssetSnapshot): string[] => {
  return snapshot.manifest.schemaVersion === projectAssetSchemaVersion
    ? legacyCaseBackupEntriesFor(
      snapshot.manifest.legacyCaseBackupDirectory,
      snapshot.manifest.legacyCaseBackupFiles,
    )
    : [];
};

const legacyCaseBackupEntriesFor = (
  legacyCaseBackupDirectory: string | undefined,
  legacyCaseBackupFiles: LegacyCaseBackupFileRecord[] | string[] | undefined,
): string[] => {
  if (!isValidLegacyCaseBackupManifestDeclaration(legacyCaseBackupDirectory, legacyCaseBackupFiles)) {
    return [];
  }
  if (legacyCaseBackupDirectory === undefined) {
    return [];
  }
  return [
    'migration-backup/',
    `${legacyCaseBackupDirectory}/`,
    `${legacyCaseBackupDirectory}/cases/`,
    ...(legacyCaseBackupFiles ?? []).map((file) => path.posix.join(legacyCaseBackupDirectory, legacyCaseBackupFilePath(file))),
  ];
};

const legacyCaseBackupFiles = (snapshot: ProjectAssetSnapshot): string[] => {
  return legacyCaseBackupEntries(snapshot).filter((entry) => !entry.endsWith('/'));
};

const validateV2CaseDirectoryLayout = async (
  directory: string,
  references: VersionedTestAssetReference[],
): Promise<ProjectAssetValidationIssue[]> => {
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
};

const listDirectoryTreeEntries = async (
  rootDirectory: string,
): Promise<string[]> => {
  return listSafeProjectAssetTreeEntries(rootDirectory, '');
};

interface ProjectAssetPathIdentity {
  device: number | bigint;
  inode: number | bigint;
}

interface ProjectAssetPathComponent extends ProjectAssetPathIdentity {
  name: string;
  relativePath: string;
  directory: boolean;
  file: boolean;
}

interface ProjectAssetPathInspection {
  root: ProjectAssetPathIdentity;
  components: ProjectAssetPathComponent[];
}

type ProjectAssetFileHandle = Awaited<ReturnType<typeof fs.open>>;

interface OpenProjectAssetPath {
  rootDirectory: string;
  inspection: ProjectAssetPathInspection;
  handles: ProjectAssetFileHandle[];
}

const projectAssetPathIdentity = (fileInfo: Awaited<ReturnType<typeof fs.lstat>>): ProjectAssetPathIdentity => {
  return { device: fileInfo.dev, inode: fileInfo.ino };
};

const hasProjectAssetPathIdentity = (
  fileInfo: Awaited<ReturnType<typeof fs.lstat>>,
  expected: ProjectAssetPathIdentity,
): boolean => {
  return fileInfo.dev === expected.device && fileInfo.ino === expected.inode;
};

const projectAssetPathIssue = (relativePath: string, message: string): ProjectAssetStoreError => {
  return new ProjectAssetStoreError('项目资产路径无法安全读取。', [{ path: relativePath, message }]);
};

/**
 * Pure TypeScript platform policy: Node does not expose POSIX openat or
 * fdopendir on every supported desktop platform (including macOS). Every
 * component is therefore opened with O_NOFOLLOW | O_NONBLOCK, its descriptor
 * is matched to this full snapshot, and the snapshot is revalidated before
 * any content or directory names are accepted.
 */
const inspectProjectAssetPath = async (
  rootDirectory: string,
  relativePath: string,
): Promise<ProjectAssetPathInspection> => {
  let rootInfo: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    rootInfo = await fs.lstat(rootDirectory);
  } catch (error) {
    throw projectAssetPathIssue(rootDirectory, errorMessage(error));
  }
  if (rootInfo.isSymbolicLink()) {
    throw projectAssetPathIssue(rootDirectory, '拒绝符号链接或非普通项目资产路径。');
  }
  if (!rootInfo.isDirectory()) {
    throw projectAssetPathIssue(rootDirectory, '项目资产根目录必须是目录。');
  }
  const segments = relativePath === '' ? [] : relativePath.split('/');
  let checkedPath = '';
  const components: ProjectAssetPathComponent[] = [];
  for (const [index, segment] of segments.entries()) {
    checkedPath = path.posix.join(checkedPath, segment);
    let fileInfo: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      fileInfo = await fs.lstat(path.join(rootDirectory, checkedPath));
    } catch (error) {
      throw projectAssetPathIssue(checkedPath, errorMessage(error));
    }
    if (fileInfo.isSymbolicLink()) {
      throw projectAssetPathIssue(checkedPath, '拒绝符号链接或非普通项目资产路径。');
    }
    if (index < segments.length - 1 && !fileInfo.isDirectory()) {
      throw projectAssetPathIssue(checkedPath, '项目资产路径的父级必须是目录。');
    }
    components.push({
      name: segment,
      relativePath: checkedPath,
      directory: fileInfo.isDirectory(),
      file: fileInfo.isFile(),
      ...projectAssetPathIdentity(fileInfo),
    });
  }
  return { root: projectAssetPathIdentity(rootInfo), components };
};

const assertProjectAssetPathInspectionCurrent = async (
  rootDirectory: string,
  inspection: ProjectAssetPathInspection,
): Promise<void> => {
  const relativePath = inspection.components.at(-1)?.relativePath ?? '';
  const current = await inspectProjectAssetPath(rootDirectory, relativePath);
  if (
    current.root.device !== inspection.root.device ||
    current.root.inode !== inspection.root.inode ||
    current.components.length !== inspection.components.length ||
    current.components.some((component, index) => {
      const expected = inspection.components[index]!;
      return (
        component.relativePath !== expected.relativePath ||
        component.directory !== expected.directory ||
        component.file !== expected.file ||
        component.device !== expected.device ||
        component.inode !== expected.inode
      );
    })
  ) {
    throw projectAssetPathIssue(relativePath || rootDirectory, '项目资产路径在读取期间发生变化。');
  }
};

const projectAssetOpenFlags = (kind: 'directory' | 'file'): number => {
  return fileSystemConstants.O_RDONLY |
    fileSystemConstants.O_NOFOLLOW |
    fileSystemConstants.O_NONBLOCK |
    (kind === 'directory' ? fileSystemConstants.O_DIRECTORY : 0);
};

const inspectionTargetMatchesKind = (
  inspection: ProjectAssetPathInspection,
  kind: 'directory' | 'file',
): boolean => {
  const target = inspection.components.at(-1);
  return kind === 'directory'
    ? (target?.directory ?? true)
    : target?.file === true;
};

const assertOpenProjectAssetPathCurrent = async (openPath: OpenProjectAssetPath): Promise<void> => {
  const expected: Array<ProjectAssetPathIdentity & { directory: boolean; file: boolean; relativePath: string }> = [
    { ...openPath.inspection.root, directory: true, file: false, relativePath: openPath.rootDirectory },
    ...openPath.inspection.components,
  ];
  if (openPath.handles.length !== expected.length) {
    throw projectAssetPathIssue('', '项目资产 descriptor 链不完整。');
  }
  await Promise.all(openPath.handles.map(async (handle, index) => {
    const fileInfo = await handle.stat();
    const component = expected[index]!;
    if (
      !hasProjectAssetPathIdentity(fileInfo, component) ||
      (component.directory ? !fileInfo.isDirectory() : !component.file || !fileInfo.isFile())
    ) {
      throw projectAssetPathIssue(component.relativePath, '项目资产路径在读取期间发生变化。');
    }
  }));
  await assertProjectAssetPathInspectionCurrent(openPath.rootDirectory, openPath.inspection);
};

const closeOpenProjectAssetPath = async (openPath: OpenProjectAssetPath): Promise<void> => {
  await Promise.all([...openPath.handles].reverse().map((handle) => handle.close().catch(() => undefined)));
};

const openInspectedProjectAssetPath = async (
  rootDirectory: string,
  inspection: ProjectAssetPathInspection,
  kind: 'directory' | 'file',
): Promise<OpenProjectAssetPath> => {
  if (!inspectionTargetMatchesKind(inspection, kind)) {
    throw projectAssetPathIssue(
      inspection.components.at(-1)?.relativePath ?? rootDirectory,
      kind === 'directory' ? '项目资产路径必须是目录。' : '项目资产路径必须是普通文件。',
    );
  }
  const handles: ProjectAssetFileHandle[] = [];
  try {
    const rootHandle = await fs.open(rootDirectory, projectAssetOpenFlags('directory'));
    handles.push(rootHandle);
    if (!hasProjectAssetPathIdentity(await rootHandle.stat(), inspection.root)) {
      throw projectAssetPathIssue(rootDirectory, '项目资产根目录在读取期间发生变化。');
    }
    for (const [index, component] of inspection.components.entries()) {
      const componentKind = index === inspection.components.length - 1 ? kind : 'directory';
      const handle = await fs.open(
        path.join(rootDirectory, component.relativePath),
        projectAssetOpenFlags(componentKind),
      );
      handles.push(handle);
      const fileInfo = await handle.stat();
      if (
        !hasProjectAssetPathIdentity(fileInfo, component) ||
        (componentKind === 'directory' ? !fileInfo.isDirectory() : !fileInfo.isFile())
      ) {
        throw projectAssetPathIssue(component.relativePath, '项目资产路径在读取期间发生变化。');
      }
    }
    const openPath = { rootDirectory, inspection, handles };
    await assertOpenProjectAssetPathCurrent(openPath);
    return openPath;
  } catch (error) {
    await Promise.all([...handles].reverse().map((handle) => handle.close().catch(() => undefined)));
    if (error instanceof ProjectAssetStoreError) {
      throw error;
    }
    if (
      (error as NodeJS.ErrnoException).code === 'ELOOP' ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    ) {
      // O_NOFOLLOW reports ELOOP for a final link but a swapped parent can
      // surface as ENOTDIR. Re-run the full snapshot so the caller receives
      // the component that became unsafe rather than an opaque open error.
      await assertProjectAssetPathInspectionCurrent(rootDirectory, inspection);
    }
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw projectAssetPathIssue(inspection.components.at(-1)?.relativePath ?? rootDirectory, '拒绝符号链接或非普通项目资产路径。');
    }
    throw projectAssetPathIssue(
      inspection.components.at(-1)?.relativePath ?? rootDirectory,
      `项目资产路径在读取期间发生变化：${errorMessage(error)}`,
    );
  }
};

const readInspectedProjectAssetFile = async (
  rootDirectory: string,
  relativePath: string,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<Buffer> => {
  const inspection = await inspectProjectAssetPath(rootDirectory, relativePath);
  const finalComponent = inspection.components.at(-1);
  if (!finalComponent?.file) {
    throw projectAssetPathIssue(relativePath, '项目资产路径必须是普通文件。');
  }
  await afterPathValidation?.(rootDirectory, relativePath);
  const openPath = await openInspectedProjectAssetPath(rootDirectory, inspection, 'file');
  try {
    await assertOpenProjectAssetPathCurrent(openPath);
    return await openPath.handles.at(-1)!.readFile();
  } finally {
    await closeOpenProjectAssetPath(openPath);
  }
};

/** Lists one project-owned tree without ever following links below its root. */
const listSafeProjectAssetTreeEntries = async (
  rootDirectory: string,
  relativeDirectory: string,
): Promise<string[]> => {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const directoryInspection = await inspectProjectAssetPath(rootDirectory, directory);
    const openPath = await openInspectedProjectAssetPath(rootDirectory, directoryInspection, 'directory');
    let entries: Dirent[];
    try {
      await assertOpenProjectAssetPathCurrent(openPath);
      // Node exposes no fdopendir equivalent on every supported desktop
      // platform. The verified directory FD plus immediate pre/post snapshot
      // checks ensure a swapped parent cannot contribute accepted names to
      // the returned tree.
      entries = await fs.readdir(path.join(rootDirectory, directory), {
        encoding: 'utf8',
        withFileTypes: true,
      });
      await assertOpenProjectAssetPathCurrent(openPath);
    } catch (error) {
      if (error instanceof ProjectAssetStoreError) {
        throw error;
      }
      throw projectAssetPathIssue(directory || rootDirectory, `项目资产目录在读取期间发生变化：${errorMessage(error)}`);
    } finally {
      await closeOpenProjectAssetPath(openPath);
    }
    for (const entry of entries) {
      const entryPath = path.posix.join(directory, entry.name);
      const entryInspection = await inspectProjectAssetPath(rootDirectory, entryPath);
      const fileInfo = entryInspection.components.at(-1)!;
      if (fileInfo.directory) {
        result.push(`${entryPath}/`);
        await visit(entryPath);
      } else if (fileInfo.file) {
        result.push(entryPath);
      } else {
        throw projectAssetPathIssue(entryPath, '项目资产树只能包含目录和普通文件。');
      }
    }
  };
  await visit(relativeDirectory);
  return result.sort();
};

const assetRelativePath = (kind: 'cases' | 'recordings' | 'documents', id: string): string => {
  return path.posix.join(kind, `${encodeURIComponent(id)}.json`);
};

const caseRelativePath = (testCase: Pick<TestCaseDraft, 'id' | 'version'>): string => {
  return path.posix.join('cases', `${encodeURIComponent(testCase.id)}@${testCase.version}.json`);
};

const fixtureRelativePath = (fixture: Pick<FixtureAsset, 'id' | 'version'>): string => {
  return path.posix.join('fixtures', `${encodeURIComponent(fixture.id)}@${fixture.version}.json`);
};

const reusableFlowRelativePath = (flow: Pick<ReusableFlowAsset, 'id' | 'version'>): string => {
  return path.posix.join('reusable-flows', `${encodeURIComponent(flow.id)}@${flow.version}.json`);
};

const suiteRelativePath = (suite: Pick<SuiteAsset, 'id' | 'version'>): string => {
  return path.posix.join('suites', `${encodeURIComponent(suite.id)}@${suite.version}.json`);
};

const listDirectoryEntries = async (directory: string): Promise<string[]> => {
  try {
    const treeEntries = await listSafeProjectAssetTreeEntries(directory, '');
    return [...new Set(treeEntries.map((entry) => entry.split('/')[0]!))].sort();
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error instanceof ProjectAssetStoreError && error.issues.some((issue) => issue.message.includes('ENOENT')))
    ) {
      return [];
    }
    throw error;
  }
};

const writeAssetCollection = async (
  rootDirectory: string,
  kind: 'recordings' | 'documents',
  assets: Array<{ id: string }>,
): Promise<void> => {
  const directory = path.join(rootDirectory, kind);
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(assets.map((asset) => writeJson(path.join(rootDirectory, assetRelativePath(kind, asset.id)), asset)));
};

const readAssetCollection = async <T extends { id: string }>(
  rootDirectory: string,
  kind: 'cases' | 'recordings' | 'documents',
  ids: string[],
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<T[]> => {
  return Promise.all(ids.map(async (id) => {
    const relativePath = assetRelativePath(kind, id);
    const asset = await readJson(rootDirectory, relativePath, afterPathValidation) as T;
    if (!asset || asset.id !== id) {
      throw new ProjectAssetStoreError('资产文件 ID 与 manifest 引用不一致。', [
        { path: assetRelativePath(kind, id), message: '资产 ID 不匹配。' },
      ]);
    }
    return asset;
  }));
};

const writeCaseCollection = async (rootDirectory: string, testCases: TestCaseDraft[]): Promise<void> => {
  const directory = path.join(rootDirectory, 'cases');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(testCases.map((testCase) => writeJson(path.join(rootDirectory, caseRelativePath(testCase)), testCase)));
};

const readCaseCollection = async (
  rootDirectory: string,
  references: VersionedTestAssetReference[],
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<TestCaseDraft[]> => {
  return Promise.all(references.map(async (reference) => {
    const casePath = caseRelativePath(reference);
    const testCase = await readJson(rootDirectory, casePath, afterPathValidation) as TestCaseDraft;
    if (!testCase || testCase.id !== reference.id || testCase.version !== reference.version) {
      throw new ProjectAssetStoreError('Case 文件与 manifest 引用不一致。', [
        { path: casePath, message: 'Case ID 或版本不匹配。' },
      ]);
    }
    return testCase;
  }));
};

const readLegacyCaseCollectionWithContent = async (
  rootDirectory: string,
  ids: string[],
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<Array<{ testCase: TestCaseDraft; relativePath: string; content: string }>> => {
  return Promise.all(ids.map(async (id) => {
    const relativePath = assetRelativePath('cases', id);
    let content: string;
    let value: unknown;
    try {
      content = (await readInspectedProjectAssetFile(rootDirectory, relativePath, afterPathValidation)).toString('utf8');
      value = JSON.parse(content) as unknown;
    } catch (error) {
      if (error instanceof ProjectAssetStoreError) {
        throw error;
      }
      throw new ProjectAssetStoreError('legacy Case 文件无法读取。', [
        { path: relativePath, message: errorMessage(error) },
      ]);
    }
    const testCase = value as TestCaseDraft;
    const issues: ProjectAssetValidationIssue[] = [];
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      issues.push({ path: relativePath, message: 'legacy Case 必须是对象。' });
    } else {
      if (testCase.id !== id) {
        issues.push({ path: relativePath, message: 'Case ID 不匹配。' });
      }
      if (testCase.schemaVersion !== undefined && testCase.schemaVersion !== 2) {
        issues.push({ path: relativePath, message: 'legacy Case schema version 无效。' });
      }
      if (!Array.isArray(testCase.steps)) {
        issues.push({ path: relativePath, message: 'legacy Case steps 必须是数组。' });
      }
      if (typeof testCase.version === 'number' && Number.isInteger(testCase.version) && !Number.isSafeInteger(testCase.version)) {
        issues.push({ path: relativePath, message: 'legacy Case version 必须是安全整数。' });
      }
    }
    if (issues.length) {
      throw new ProjectAssetStoreError('legacy Case 文件无效。', issues);
    }
    return { testCase, relativePath, content };
  }));
};

const writeFixtureCollection = async (rootDirectory: string, fixtures: FixtureAsset[]): Promise<void> => {
  const directory = path.join(rootDirectory, 'fixtures');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(fixtures.map((fixture) => writeJson(path.join(rootDirectory, fixtureRelativePath(fixture)), fixture)));
};

const readFixtureCollection = async (
  rootDirectory: string,
  references: VersionedTestAssetReference[],
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<FixtureAsset[]> => {
  return Promise.all(references.map(async (reference) => {
    const fixturePath = fixtureRelativePath(reference);
    const fixture = await readJson(rootDirectory, fixturePath, afterPathValidation) as FixtureAsset;
    if (!fixture || fixture.id !== reference.id || fixture.version !== reference.version) {
      throw new ProjectAssetStoreError('fixture 文件与 manifest 引用不一致。', [
        { path: fixturePath, message: 'fixture ID 或版本不匹配。' },
      ]);
    }
    return fixture;
  }));
};

const writeReusableFlowCollection = async (rootDirectory: string, reusableFlows: ReusableFlowAsset[]): Promise<void> => {
  const directory = path.join(rootDirectory, 'reusable-flows');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(reusableFlows.map((flow) => writeJson(path.join(rootDirectory, reusableFlowRelativePath(flow)), flow)));
};

const readReusableFlowCollection = async (
  rootDirectory: string,
  references: VersionedTestAssetReference[],
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<ReusableFlowAsset[]> => {
  return Promise.all(references.map(async (reference) => {
    const flowPath = reusableFlowRelativePath(reference);
    const flow = await readJson(rootDirectory, flowPath, afterPathValidation) as ReusableFlowAsset;
    if (!flow || flow.id !== reference.id || flow.version !== reference.version) {
      throw new ProjectAssetStoreError('可复用流程文件与 manifest 引用不一致。', [
        { path: flowPath, message: '可复用流程 ID 或版本不匹配。' },
      ]);
    }
    return flow;
  }));
};

const writeSuiteCollection = async (rootDirectory: string, suites: SuiteAsset[]): Promise<void> => {
  const directory = path.join(rootDirectory, 'suites');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(suites.map((suite) => writeJson(path.join(rootDirectory, suiteRelativePath(suite)), suite)));
};

const readSuiteCollection = async (
  rootDirectory: string,
  references: VersionedTestAssetReference[],
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<SuiteAsset[]> => {
  return Promise.all(references.map(async (reference) => {
    const suitePath = suiteRelativePath(reference);
    const suite = await readJson(rootDirectory, suitePath, afterPathValidation) as SuiteAsset;
    if (!suite || suite.id !== reference.id || suite.version !== reference.version) {
      throw new ProjectAssetStoreError('suite 文件与 manifest 引用不一致。', [
        { path: suitePath, message: 'suite ID 或版本不匹配。' },
      ]);
    }
    return suite;
  }));
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const readLegacyCaseBackupDeclaration = async (
  directory: string,
  manifest: ProjectAssetReadManifest,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<LegacyCaseBackupDeclaration | undefined> => {
  if (manifest.schemaVersion !== projectAssetSchemaVersion || !manifest.legacyCaseBackupDirectory) {
    return undefined;
  }
  const declaredFiles = manifest.legacyCaseBackupFiles ?? (await listSafeProjectAssetTreeEntries(
    directory,
    manifest.legacyCaseBackupDirectory,
  ))
    .filter((entry) => entry.startsWith(`${manifest.legacyCaseBackupDirectory}/`) && !entry.endsWith('/'))
    .map((entry) => entry.slice(manifest.legacyCaseBackupDirectory!.length + 1));
  const paths = declaredFiles.map(legacyCaseBackupFilePath);
  if (!paths.every(isSafeLegacyCaseBackupFile) || new Set(paths).size !== paths.length) {
    throw new ProjectAssetStoreError('legacy Case 备份目录无法安全升级。', [
      { path: manifest.legacyCaseBackupDirectory, message: '旧备份目录包含未受支持的条目。' },
    ]);
  }
  const files = await Promise.all(paths.map(async (filePath, index) => {
    const expectedHash = legacyCaseBackupFileContentHash(declaredFiles[index]!);
    const content = await readVerifiedLegacyCaseBackupFile(
      directory,
      manifest.legacyCaseBackupDirectory!,
      filePath,
      expectedHash,
      afterPathValidation,
    );
    return { path: filePath, contentHash: calculateContentHash(content) };
  }));
  return { directory: manifest.legacyCaseBackupDirectory, files };
};

const readVerifiedLegacyCaseBackupFile = async (
  rootDirectory: string,
  backupDirectory: string,
  relativePath: string,
  expectedHash?: string,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<Buffer> => {
  const backupFilePath = path.posix.join(backupDirectory, relativePath);
  const content = await readInspectedProjectAssetFile(rootDirectory, backupFilePath, afterPathValidation);
  const actualHash = calculateContentHash(content);
  if (expectedHash !== undefined && actualHash !== expectedHash) {
    throw new ProjectAssetStoreError('legacy Case 备份内容已变化。', [
      { path: path.posix.join(backupDirectory, relativePath), message: '备份内容摘要与 manifest 声明不一致。' },
    ]);
  }
  return content;
};

const writeOrCopyLegacyCaseBackup = async (
  stagingDirectory: string,
  sourceDirectory: string,
  manifest: ProjectAssetReadManifest,
  legacyCaseBackupFiles: LegacyCaseBackupFile[] | undefined,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<void> => {
  if (manifest.schemaVersion !== projectAssetSchemaVersion || !manifest.legacyCaseBackupDirectory) {
    return;
  }
  const backupDirectory = manifest.legacyCaseBackupDirectory;
  if (legacyCaseBackupFiles) {
    await fs.mkdir(path.join(stagingDirectory, backupDirectory, 'cases'), { recursive: true });
    await Promise.all(legacyCaseBackupFiles.map(async ({ relativePath, content, contentHash }) => {
      if (calculateContentHash(content) !== contentHash) {
        throw new ProjectAssetStoreError('legacy Case 迁移备份内容已变化。', [
          { path: relativePath, message: '待写入备份内容摘要不一致。' },
        ]);
      }
      const targetPath = path.join(stagingDirectory, backupDirectory, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf8');
    }));
    return;
  }
  const declaration = await readLegacyCaseBackupDeclaration(sourceDirectory, manifest, afterPathValidation);
  if (!declaration) {
    return;
  }
  await fs.mkdir(path.join(stagingDirectory, declaration.directory, 'cases'), { recursive: true });
  await Promise.all(declaration.files.map(async ({ path: relativePath, contentHash }) => {
    const content = await readVerifiedLegacyCaseBackupFile(
      sourceDirectory,
      declaration.directory,
      relativePath,
      contentHash,
      afterPathValidation,
    );
    const targetPath = path.join(stagingDirectory, declaration.directory, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);
  }));
};

const readJson = async (
  rootDirectory: string,
  relativePath: string,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<unknown> => {
  return (await readJsonWithText(rootDirectory, relativePath, afterPathValidation)).value;
};

const readJsonWithText = async (
  rootDirectory: string,
  relativePath: string,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<{ value: unknown; text: string }> => {
  try {
    const text = (await readInspectedProjectAssetFile(rootDirectory, relativePath, afterPathValidation)).toString('utf8');
    return { value: JSON.parse(text) as unknown, text };
  } catch (error) {
    throw new ProjectAssetStoreError(`无法读取项目资产文件：${relativePath}。`, [
      ...(error instanceof ProjectAssetStoreError
        ? error.issues
        : [{ path: relativePath, message: (error as Error).message || 'JSON 文件损坏或不存在。' }]),
    ]);
  }
};

const readLegacyManifestForBlockedPlan = async (rootDirectory: string): Promise<{ id: string } | undefined> => {
  try {
    const candidate = (await readJson(rootDirectory, 'project.json')) as {
      schemaVersion?: unknown;
      id?: unknown;
    };
    return candidate.schemaVersion === legacyProjectAssetSchemaVersion && isNonEmptyString(candidate.id)
      ? { id: candidate.id }
      : undefined;
  } catch {
    return undefined;
  }
};

const projectFromSnapshot = (snapshot: ProjectAssetSnapshot): ProjectDraft => {
  const {
    schemaVersion: _schemaVersion,
    revision: _revision,
    legacyCaseBackupDirectory: _legacyCaseBackupDirectory,
    legacyCaseBackupFiles: _legacyCaseBackupFiles,
    assetIds: _assetIds,
    ...projectMetadata
  } = snapshot.manifest as ProjectAssetManifest;
  return {
    ...structuredClone(projectMetadata),
    testCases: structuredClone(snapshot.testCases),
    recordings: structuredClone(snapshot.recordings),
    documents: structuredClone(snapshot.documents),
    fixtures: structuredClone(snapshot.fixtures),
    reusableFlows: structuredClone(snapshot.reusableFlows),
    suites: structuredClone(snapshot.suites),
  };
};

export const calculateProjectAssetRevision = (project: ProjectDraft): string => {
  const canonicalProject = JSON.stringify(canonicalize(sanitizeProjectAsset(project)));
  return createHash('sha256').update(canonicalProject, 'utf8').digest('hex');
};

const calculateContentHash = (content: string | Buffer): string => {
  return createHash('sha256').update(content).digest('hex');
};

const calculateDirectoryContentRevision = async (
  directory: string,
  afterPathValidation?: (rootDirectory: string, relativePath: string) => Promise<void>,
): Promise<string> => {
  const hash = createHash('sha256');
  const entries = await listDirectoryTreeEntries(directory);
  for (const entry of entries) {
    if (entry.endsWith('/')) {
      continue;
    }
    hash.update(entry, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(await readInspectedProjectAssetFile(directory, entry, afterPathValidation));
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex');
};

const canonicalize = (value: unknown): unknown => {
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
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error && error.message ? error.message : String(error);
};

const sameIds = (expected: string[], actual: string[]): boolean => {
  return expected.length === actual.length && expected.every((id) => actual.includes(id));
};

const fixtureReferenceKey = (reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string => {
  return `${reference.id}@${reference.version}`;
};

const reusableFlowReferenceKey = (reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string => {
  return `${reference.id}@${reference.version}`;
};

const caseReferenceKey = (reference: unknown): string => {
  if (!reference || typeof reference !== 'object') {
    return `${String(reference)}@`;
  }
  const candidate = reference as { id?: unknown; version?: unknown };
  return `${String(candidate.id)}@${String(candidate.version)}`;
};

const suiteReferenceKey = (reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string => {
  return `${reference.id}@${reference.version}`;
};

const sameKeys = (expected: string[], actual: string[]): boolean => {
  return expected.length === actual.length && expected.every((key) => actual.includes(key));
};

const isVersionedAssetReference = (value: unknown): value is VersionedTestAssetReference => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const reference = value as Partial<VersionedTestAssetReference>;
  return isNonEmptyString(reference.id) && isPositiveInteger(reference.version);
};

const isPositiveInteger = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
};

const isSafeLegacyCaseBackupDirectory = (value: unknown): value is string => {
  if (typeof value !== 'string' || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.length === 2 &&
    segments[0] === 'migration-backup' &&
    /^[a-z0-9][a-z0-9-]*$/u.test(segments[1] ?? '') &&
    !value.includes('\\') &&
    path.posix.normalize(value) === value
  );
};

const isSafeLegacyCaseBackupFile = (value: unknown): value is string => {
  if (typeof value !== 'string' || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\')) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.length === 2 &&
    segments[0] === 'cases' &&
    segments[1] !== '' &&
    segments[1] !== '.' &&
    segments[1] !== '..' &&
    segments[1]!.endsWith('.json') &&
    path.posix.normalize(value) === value
  );
};

const isLegacyCaseBackupFileRecord = (value: unknown): value is LegacyCaseBackupFileRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<LegacyCaseBackupFileRecord>;
  return isSafeLegacyCaseBackupFile(record.path) && isRevision(record.contentHash);
};

const legacyCaseBackupFilePath = (file: LegacyCaseBackupFileRecord | string): string => {
  return typeof file === 'string' ? file : file.path;
};

const legacyCaseBackupFileContentHash = (file: LegacyCaseBackupFileRecord | string): string | undefined => {
  return typeof file === 'string' ? undefined : file.contentHash;
};

const isValidLegacyCaseBackupManifestDeclaration = (
  directory: unknown,
  files: unknown,
): boolean => {
  if (directory === undefined && files === undefined) {
    return true;
  }
  return (
    isSafeLegacyCaseBackupDirectory(directory) &&
    (files === undefined || (
      Array.isArray(files) &&
      (files.every(isLegacyCaseBackupFileRecord) || files.every(isSafeLegacyCaseBackupFile)) &&
      new Set(files.map(legacyCaseBackupFilePath)).size === files.length
    ))
  );
};

const sameLegacyCaseBackupDeclaration = (
  left: LegacyCaseBackupDeclaration | undefined,
  right: LegacyCaseBackupDeclaration | undefined,
): boolean => {
  return JSON.stringify(left) === JSON.stringify(right);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && Boolean(value.trim());
};

const isRevision = (value: unknown): value is string => {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
};
