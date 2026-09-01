import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import type {
  ArtifactEvidenceKind,
  ArtifactManifest,
  ArtifactManifestEntry,
  ArtifactRetentionAudit,
  ArtifactRetentionAuditEntry,
  ArtifactRetentionErrorCode,
  ArtifactRetentionPlan,
  ArtifactRetentionPreviewEntry,
  ArtifactRetentionClass,
  ProjectReportLocale,
  ProjectRunReport,
  RunArtifact,
  RunCoverageRiskStatus,
  RunStatus,
  StudioState,
} from '../../shared/studio.js';
import { DurableAtomicFileCommitError, writeDurableAtomicFile } from '../durable-atomic-file.js';

export interface ArtifactRegistration {
  path: string;
  type: RunArtifact['type'];
  label: string;
  evidenceKind: ArtifactEvidenceKind;
  retentionClass: ArtifactRetentionClass;
  protectedBy: string[];
  ownerRunId?: string;
  ownerSuiteRunId?: string;
  id?: string;
  createdAt?: string;
}

/** Main-process hook for persisted references not represented by renderer claims. */
export interface ArtifactProtectionResolver {
  resolve(entry: ArtifactManifestEntry, state: StudioState | undefined): Promise<readonly string[]> | readonly string[];
}

export interface ArtifactRetentionPolicy {
  maxBytes: number;
  keepDays: number;
}

export interface ArtifactManagerOptions {
  /** Reads the authoritative persisted StudioState when planning or confirming retention. */
  loadStudioState?: () => Promise<StudioState>;
  /** Extends the default persisted-reference protection policy (for maintenance citations, etc.). */
  protectionResolver?: ArtifactProtectionResolver;
  /** Main-process policy for explicit, review-only artifact retention plans. */
  retentionPolicy?: ArtifactRetentionPolicy;
  /** Injectable main-process clock for deterministic retention planning. */
  now?: () => Date;
}

interface PlannedArtifactSnapshot {
  id: string;
  path: string;
  contentHash: string;
  byteCount: number;
  createdAt: string;
  retentionClass: ArtifactRetentionClass;
  protectedBy: string[];
}

interface RetentionPlanRecord {
  confirmed: boolean;
  plannedAt: string;
  keepDays: number;
  candidates: PlannedArtifactSnapshot[];
}

export class ArtifactRetentionError extends Error {
  constructor(
    readonly code: ArtifactRetentionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactRetentionError';
  }
}

const MANIFEST_FILE_NAME = 'manifest.json';
const TOMBSTONES_DIRECTORY_NAME = '.tombstones';
const TOMBSTONE_JOURNAL_SUFFIX = '.pending.json';
const TOMBSTONE_ID_PATTERN = /^[0-9a-f-]{36}$/;
const DEFAULT_RETENTION_POLICY: Readonly<ArtifactRetentionPolicy> = {
  maxBytes: 512 * 1024 * 1024,
  keepDays: 30,
};

interface ArtifactDeletionTombstone {
  path: string;
  journalPath: string;
}

interface ArtifactDeletionJournal {
  schemaVersion: 1;
  originalPath: string;
}

export class ArtifactManager {
  private readonly artifactsDir: string;
  private readonly manifestPath: string;
  private readonly tombstonesDir: string;
  private readonly loadStudioState?: () => Promise<StudioState>;
  private readonly protectionResolver?: ArtifactProtectionResolver;
  private readonly retentionPolicy: ArtifactRetentionPolicy;
  private readonly now: () => Date;
  private readonly activeTombstoneJournals = new Set<string>();
  private readonly activeExportPaths = new Set<string>();
  private readonly retentionPlans = new Map<string, RetentionPlanRecord>();
  private manifestMutation: Promise<void> = Promise.resolve();

  constructor(rootDir: string, options: ArtifactManagerOptions = {}) {
    this.artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    this.manifestPath = path.join(this.artifactsDir, MANIFEST_FILE_NAME);
    this.tombstonesDir = path.join(this.artifactsDir, TOMBSTONES_DIRECTORY_NAME);
    this.loadStudioState = options.loadStudioState;
    this.protectionResolver = options.protectionResolver;
    this.retentionPolicy = validateRetentionPolicy(options.retentionPolicy ?? DEFAULT_RETENTION_POLICY);
    this.now = options.now ?? (() => new Date());
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.artifactsDir, { recursive: true });
    await this.reconcileTombstones();
  }

  /** Returns one cloned, immutable manifest record without exposing its filesystem path. */
  async findManifestEntry(id: string): Promise<ArtifactManifestEntry | undefined> {
    await this.ensureReady();
    const entry = (await this.readManifest()).entries.find((candidate) => candidate.id === id);
    return entry ? deepFreeze(structuredClone(entry)) : undefined;
  }

  /**
   * Main-process-only resolution for a previously read manifest entry. The
   * renderer never receives the returned workstation-local path.
   */
  async resolveManifestEntryPath(entry: Pick<ArtifactManifestEntry, 'id' | 'path' | 'contentHash'>): Promise<string | undefined> {
    await this.ensureReady();
    const current = (await this.readManifest()).entries.find((candidate) => candidate.id === entry.id);
    if (!current || current.path !== entry.path || current.contentHash !== entry.contentHash) {
      return undefined;
    }

    const artifactPath = this.resolveDeletionOriginalPath(current.path);
    if (!artifactPath) {
      return undefined;
    }

    try {
      const entryStats = await fs.lstat(artifactPath);
      if (!entryStats.isFile() && !entryStats.isSymbolicLink()) {
        return undefined;
      }
      const realArtifactsDir = await fs.realpath(this.artifactsDir);
      const realArtifactPath = await fs.realpath(artifactPath);
      if (!isPathInside(realArtifactsDir, realArtifactPath) || this.isReservedArtifactPath(realArtifactPath)) {
        return undefined;
      }
      if (!(await fs.stat(realArtifactPath)).isFile()) {
        return undefined;
      }
      const contentHash = createHash('sha256').update(await fs.readFile(realArtifactPath)).digest('hex');
      return contentHash === current.contentHash ? artifactPath : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  isManagedArtifactPath(candidatePath: string): boolean {
    const relativePath = path.relative(this.artifactsDir, path.resolve(candidatePath));
    return Boolean(relativePath) && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
  }

  async exportArtifact(artifactPath: string, destinationPath: string): Promise<void> {
    if (!this.isManagedArtifactPath(artifactPath)) {
      throw new Error('只能导出应用生成的证据文件。');
    }

    const manifestPath = this.toManifestPath(path.resolve(artifactPath));
    await this.enqueueManifestMutation(async () => {
      this.activeExportPaths.add(manifestPath);
      try {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(artifactPath, destinationPath);
      } finally {
        this.activeExportPaths.delete(manifestPath);
      }
    });
  }

  async importManualEvidence(sourcePath: string): Promise<RunArtifact> {
    const source = path.resolve(sourcePath);
    const sourceStats = await fs.stat(source);
    if (!sourceStats.isFile()) {
      throw new Error('只能附加文件证据。');
    }

    await this.ensureReady();
    const sourceName = path.basename(source);
    const extension = getSafeExtension(sourceName);
    const artifactPath = this.allocateArtifactPath('manual', extension);
    await fs.copyFile(source, artifactPath);

    return this.registerExisting({
      path: artifactPath,
      type: 'attachment',
      label: sourceName || '人工检查附件',
      evidenceKind: 'attachment',
      retentionClass: 'protected',
      protectedBy: ['manualEvidence'],
      id: `artifact-manual-${randomUUID()}`,
    });
  }

  async createSnapshot(runId: string, label: string, title: string, url: string): Promise<RunArtifact> {
    await this.ensureReady();
    const artifactPath = this.allocateArtifactPath('synthetic-diagnostic', '.svg');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#050505"/>
  <rect x="64" y="64" width="1152" height="592" rx="24" fill="#101010" stroke="#3d3d3d"/>
  <text x="104" y="140" fill="#d6ff42" font-family="Avenir Next, sans-serif" font-size="28" font-weight="700">${escapeXml(title)}</text>
  <text x="104" y="198" fill="#f4f4f4" font-family="Avenir Next, sans-serif" font-size="20">${escapeXml(label)}</text>
  <text x="104" y="250" fill="#8d8d8d" font-family="Avenir Next, sans-serif" font-size="18">${escapeXml(url || 'No URL')}</text>
  <circle cx="1110" cy="134" r="10" fill="#d6ff42" opacity="0.65"/>
</svg>`;
    await fs.writeFile(artifactPath, svg, 'utf8');
    return this.registerExisting({
      path: artifactPath,
      type: 'snapshot',
      label,
      evidenceKind: 'syntheticDiagnostic',
      ownerRunId: runId,
      retentionClass: 'standard',
      protectedBy: [],
    });
  }

  async createTracePath(_runId: string): Promise<string> {
    await this.ensureReady();
    return this.allocateArtifactPath('trace', '.zip');
  }

  async createPageScreenshotPath(): Promise<string> {
    await this.ensureReady();
    return this.allocateArtifactPath('page-screenshot', '.png');
  }

  /** Reserves a main-owned destination for a browser download before it is registered. */
  async createDownloadPath(suggestedFileName: string): Promise<string> {
    await this.ensureReady();
    return this.allocateArtifactPath('download', getSafeExtension(suggestedFileName));
  }

  /** Persists a deliberately small diagnostic record, never raw browser/network output. */
  async createDiagnosticArtifact(
    runId: string,
    label: string,
    diagnostic: Readonly<Record<string, string | number | boolean | undefined>>,
  ): Promise<RunArtifact> {
    await this.ensureReady();
    const artifactPath = this.allocateArtifactPath('interaction-diagnostic', '.json');
    const content = JSON.stringify(
      Object.fromEntries(Object.entries(diagnostic).filter(([, value]) => value !== undefined)),
    );
    await fs.writeFile(artifactPath, content, 'utf8');
    try {
      return await this.registerExisting({
        path: artifactPath,
        type: 'attachment',
        label,
        evidenceKind: 'syntheticDiagnostic',
        ownerRunId: runId,
        retentionClass: 'standard',
        protectedBy: [],
      });
    } catch (error) {
      if (!(error instanceof DurableAtomicFileCommitError)) {
        await fs.rm(artifactPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  async createMarkdownReport(runId: string, label: string, markdown: string): Promise<RunArtifact> {
    await this.ensureReady();
    const artifactPath = this.allocateArtifactPath('report', '.md');
    await fs.writeFile(artifactPath, markdown, 'utf8');
    return this.registerExisting({
      path: artifactPath,
      type: 'report',
      label,
      evidenceKind: 'report',
      ownerRunId: runId,
      retentionClass: 'standard',
      protectedBy: [],
    });
  }

  async createReporterReport(
    runId: string,
    label: string,
    markdown: string,
  ): Promise<{ markdown: RunArtifact; html: RunArtifact }> {
    await this.ensureReady();
    const markdownPath = this.allocateArtifactPath('report', '.md');
    const htmlPath = this.allocateArtifactPath('report', '.html');
    await fs.writeFile(markdownPath, markdown, 'utf8');
    await fs.writeFile(htmlPath, renderReporterHtml(markdown), 'utf8');
    return {
      markdown: await this.registerExisting({
        path: markdownPath,
        type: 'report',
        label,
        evidenceKind: 'report',
        ownerRunId: runId,
        retentionClass: 'standard',
        protectedBy: [],
      }),
      html: await this.registerExisting({
        path: htmlPath,
        type: 'report',
        label: 'Reporter HTML 报告',
        evidenceKind: 'report',
        ownerRunId: runId,
        retentionClass: 'standard',
        protectedBy: [],
      }),
    };
  }

  async createProjectRunReport(report: ProjectRunReport, locale: ProjectReportLocale): Promise<string> {
    await this.ensureReady();
    const artifactPath = this.allocateArtifactPath('project-report', '.html');
    await fs.writeFile(artifactPath, renderProjectRunReportHtml(report, locale), 'utf8');
    return (await this.registerExisting({
      path: artifactPath,
      type: 'report',
      label: 'Project Run Report',
      evidenceKind: 'report',
      retentionClass: 'temporary',
      protectedBy: [],
    })).path;
  }

  async removeArtifact(artifactPath: string): Promise<void> {
    const resolvedPath = path.resolve(artifactPath);
    if (!this.isManagedArtifactPath(resolvedPath)) {
      throw new Error('只能清理应用生成的证据文件。');
    }
    if (this.isReservedArtifactPath(resolvedPath)) {
      throw new Error('不能清理保留的证据文件。');
    }
    await this.enqueueManifestMutation(async () => {
      const manifest = await this.readManifest();
      const relativePath = this.toManifestPath(resolvedPath);
      const entries = manifest.entries.filter((entry) => entry.path !== relativePath);
      const tombstone = await this.moveToTombstone(resolvedPath);
      if (tombstone) {
        this.activeTombstoneJournals.add(tombstone.journalPath);
      }
      try {
        if (entries.length !== manifest.entries.length) {
          await this.writeManifest({ ...manifest, entries });
        }
      } catch (error) {
        await this.restoreTombstone(tombstone, resolvedPath);
        await this.restoreManifestAfterFailedDeletion(manifest);
        throw error;
      } finally {
        if (tombstone) {
          this.activeTombstoneJournals.delete(tombstone.journalPath);
        }
      }
      await this.purgeTombstone(tombstone);
    });
  }

  /**
   * Calculates a review-only retention plan. Plans live only in this main
   * process instance; no background job can execute one implicitly.
   */
  async planArtifactRetention(): Promise<ArtifactRetentionPlan> {
    const now = validateRetentionNow(this.now());
    const { keepDays, maxBytes } = this.retentionPolicy;
    await this.ensureReady();
    return this.enqueueManifestMutation(async () => {
      const manifest = await this.readManifest();
      const state = await this.loadAuthoritativeStudioState();
      const totalByteCount = manifest.entries.reduce((total, entry) => total + entry.byteCount, 0);
      const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1_000;
      const manifestPathCounts = countManifestPaths(manifest.entries);
      const classified = await Promise.all(manifest.entries.map(async (entry) => ({
        entry,
        protectedReasons: withSharedManifestPathProtection(
          await this.resolveProtectionReasons(entry, state),
          manifestPathCounts.get(entry.path) ?? 0,
        ),
      })));
      const protectedEntries = classified.filter((item) => item.protectedReasons.length > 0);
      const agedUnprotected = classified
        .filter((item) => item.protectedReasons.length === 0 && Date.parse(item.entry.createdAt) <= cutoff)
        .sort(compareRetentionEntries);
      let projectedByteCount = totalByteCount;
      const candidates: typeof agedUnprotected = [];
      for (const item of agedUnprotected) {
        if (projectedByteCount <= maxBytes) {
          break;
        }
        candidates.push(item);
        projectedByteCount -= item.entry.byteCount;
      }

      const previewEntries: ArtifactRetentionPreviewEntry[] = [
        ...protectedEntries.map(({ entry, protectedReasons }) => toRetentionPreviewEntry(entry, false, 'protected', protectedReasons)),
        ...candidates.map(({ entry }) => toRetentionPreviewEntry(entry, true, 'overByteBudgetAfterKeepDays', [])),
      ].sort(compareRetentionPreviewEntries);
      const planId = `retention-${randomUUID()}`;
      this.retentionPlans.set(planId, {
        confirmed: false,
        plannedAt: now.toISOString(),
        keepDays,
        candidates: candidates.map(({ entry }) => toPlannedArtifactSnapshot(entry)),
      });
      return {
        id: planId,
        plannedAt: now.toISOString(),
        maxBytes,
        keepDays,
        totalByteCount,
        projectedByteCount,
        protectedCount: protectedEntries.length,
        candidateCount: candidates.length,
        entries: previewEntries,
      };
    });
  }

  /** Confirms one unchanged main-memory plan through the existing tombstone flow. */
  async confirmArtifactRetention(planId: string): Promise<ArtifactRetentionAudit> {
    if (typeof planId !== 'string' || !planId.trim()) {
      throw new ArtifactRetentionError('retentionPlanNotFound', '证据保留计划不存在。');
    }
    return this.enqueueManifestMutation(async () => {
      const plan = this.retentionPlans.get(planId);
      if (!plan) {
        throw new ArtifactRetentionError('retentionPlanNotFound', '证据保留计划不存在。');
      }
      if (plan.confirmed) {
        throw new ArtifactRetentionError('retentionPlanAlreadyConfirmed', '证据保留计划已确认。');
      }

      const manifest = await this.readManifest();
      const state = await this.loadAuthoritativeStudioState();
      const manifestPathCounts = countManifestPaths(manifest.entries);
      const currentEntries: ArtifactManifestEntry[] = [];
      for (const snapshot of plan.candidates) {
        const current = manifest.entries.find((entry) => entry.id === snapshot.id);
        if (!current) {
          throw new ArtifactRetentionError('plannedArtifactMissing', `计划中的证据 ${snapshot.id} 已不存在。`);
        }
        if (
          current.path !== snapshot.path ||
          current.contentHash !== snapshot.contentHash ||
          current.byteCount !== snapshot.byteCount ||
          current.createdAt !== snapshot.createdAt ||
          current.retentionClass !== snapshot.retentionClass ||
          !sameStringSet(current.protectedBy, snapshot.protectedBy) ||
          !isEligibleForRetention(current.createdAt, plan.plannedAt, plan.keepDays)
        ) {
          throw new ArtifactRetentionError('plannedArtifactChanged', `计划中的证据 ${snapshot.id} 已发生变化。`);
        }
        await this.assertArtifactBytesMatch(current);
        const protectedReasons = withSharedManifestPathProtection(
          await this.resolveProtectionReasons(current, state),
          manifestPathCounts.get(current.path) ?? 0,
        );
        if (protectedReasons.length) {
          throw new ArtifactRetentionError('plannedArtifactProtected', `计划中的证据 ${snapshot.id} 已受保护。`);
        }
        currentEntries.push(current);
      }

      await this.removeManifestEntries(currentEntries, manifest);
      plan.confirmed = true;
      const confirmedAt = new Date().toISOString();
      const deleted = Object.freeze(currentEntries.map((entry) => Object.freeze({
        id: entry.id,
        contentHash: entry.contentHash,
        byteCount: entry.byteCount,
        deletedAt: confirmedAt,
      } satisfies ArtifactRetentionAuditEntry)));
      return Object.freeze({
        planId,
        confirmedAt,
        deleted,
      }) as ArtifactRetentionAudit;
    });
  }

  /**
   * Records an existing managed file only after its final bytes can be read.
   * The manifest is replaced atomically, so a failed registration cannot add
   * a partial or misleading evidence entry.
   */
  async registerExisting(registration: ArtifactRegistration): Promise<RunArtifact> {
    const artifactPath = path.resolve(registration.path);
    if (!this.isManagedArtifactPath(artifactPath)) {
      throw new Error('只能登记应用生成的证据文件。');
    }
    if (this.isReservedArtifactPath(artifactPath)) {
      throw new Error('不能登记保留的证据文件。');
    }

    const stats = await fs.lstat(artifactPath);
    if (!stats.isFile() && !stats.isSymbolicLink()) {
      throw new Error('只能登记文件证据。');
    }
    const realArtifactsDir = await fs.realpath(this.artifactsDir);
    const realArtifactPath = await fs.realpath(artifactPath);
    if (!isPathInside(realArtifactsDir, realArtifactPath)) {
      throw new Error('只能登记解析后仍位于应用证据目录中的常规文件。');
    }
    const resolvedStats = await fs.stat(realArtifactPath);
    if (!resolvedStats.isFile()) {
      throw new Error('只能登记文件证据。');
    }
    if (this.isReservedArtifactPath(realArtifactPath)) {
      throw new Error('不能登记保留的证据文件。');
    }
    const bytes = await fs.readFile(artifactPath);
    const id = registration.id ?? `artifact-${randomUUID()}`;

    const entry: ArtifactManifestEntry = {
      id,
      path: this.toManifestPath(artifactPath),
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      byteCount: bytes.byteLength,
      createdAt: registration.createdAt ?? new Date().toISOString(),
      ...(registration.ownerRunId ? { ownerRunId: registration.ownerRunId } : {}),
      ...(registration.ownerSuiteRunId ? { ownerSuiteRunId: registration.ownerSuiteRunId } : {}),
      evidenceKind: registration.evidenceKind,
      retentionClass: registration.retentionClass,
      protectedBy: [...registration.protectedBy],
    };
    await this.enqueueManifestMutation(async () => {
      const manifest = await this.readManifest();
      if (manifest.entries.some((candidate) => candidate.id === id)) {
        throw new Error('证据文件 ID 已存在。');
      }
      await this.writeManifest({ ...manifest, entries: [...manifest.entries, entry] });
    });

    return {
      id,
      type: registration.type,
      label: registration.label,
      path: artifactPath,
      manifest: entry,
    };
  }

  /** Backward-compatible alias for callers introduced before the public API name settled. */
  async registerArtifact(registration: ArtifactRegistration): Promise<RunArtifact> {
    return this.registerExisting(registration);
  }

  private async loadAuthoritativeStudioState(): Promise<StudioState | undefined> {
    return this.loadStudioState ? this.loadStudioState() : undefined;
  }

  private async resolveProtectionReasons(
    entry: ArtifactManifestEntry,
    state: StudioState | undefined,
  ): Promise<string[]> {
    const reasons = new Set<string>();
    if (entry.retentionClass === 'protected') {
      reasons.add('retentionClass:protected');
    }
    entry.protectedBy.forEach((value) => reasons.add(`protectedBy:${value}`));
    if (this.activeExportPaths.has(entry.path)) {
      reasons.add('exportLock');
    }
    if (state && isReferencedByPersistedRunDetail(entry, state)) {
      reasons.add('persistedRunDetail');
    }
    if (state && isReferencedByBaseline(entry, state)) {
      reasons.add('baselineReference');
    }
    if (state && isReferencedByRecordingVisualBaseline(entry, state)) {
      reasons.add('recordingVisualBaseline');
    }
    if (state && isReferencedByMaintenanceDraft(entry, state)) {
      reasons.add('maintenanceDraftReference');
    }
    if (this.protectionResolver) {
      (await this.protectionResolver.resolve(entry, state)).forEach((reason) => reasons.add(reason));
    }
    return [...reasons].sort();
  }

  private async assertArtifactBytesMatch(entry: ArtifactManifestEntry): Promise<void> {
    const artifactPath = this.resolveDeletionOriginalPath(entry.path);
    if (!artifactPath) {
      throw new ArtifactRetentionError('plannedArtifactChanged', `计划中的证据 ${entry.id} 路径无效。`);
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(artifactPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ArtifactRetentionError('plannedArtifactMissing', `计划中的证据 ${entry.id} 已不存在。`);
      }
      throw error;
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    if (contentHash !== entry.contentHash || bytes.byteLength !== entry.byteCount) {
      throw new ArtifactRetentionError('plannedArtifactChanged', `计划中的证据 ${entry.id} 已发生变化。`);
    }
  }

  private async removeManifestEntries(entries: ArtifactManifestEntry[], manifest: ArtifactManifest): Promise<void> {
    const tombstones: Array<{ artifactPath: string; tombstone: ArtifactDeletionTombstone }> = [];
    try {
      for (const entry of entries) {
        const artifactPath = this.resolveDeletionOriginalPath(entry.path);
        if (!artifactPath) {
          throw new ArtifactRetentionError('plannedArtifactChanged', `计划中的证据 ${entry.id} 路径无效。`);
        }
        const tombstone = await this.moveToTombstone(artifactPath);
        if (!tombstone) {
          throw new ArtifactRetentionError('plannedArtifactMissing', `计划中的证据 ${entry.id} 已不存在。`);
        }
        this.activeTombstoneJournals.add(tombstone.journalPath);
        tombstones.push({ artifactPath, tombstone });
      }
      const removedIds = new Set(entries.map((entry) => entry.id));
      await this.writeManifest({
        ...manifest,
        entries: manifest.entries.filter((entry) => !removedIds.has(entry.id)),
      });
    } catch (error) {
      await Promise.all(tombstones.reverse().map(({ artifactPath, tombstone }) =>
        this.restoreTombstone(tombstone, artifactPath).catch(() => undefined),
      ));
      await this.restoreManifestAfterFailedDeletion(manifest);
      throw error;
    } finally {
      tombstones.forEach(({ tombstone }) => this.activeTombstoneJournals.delete(tombstone.journalPath));
    }
    await Promise.all(tombstones.map(({ tombstone }) => this.purgeTombstone(tombstone).catch(() => undefined)));
  }

  private async readManifest(): Promise<ArtifactManifest> {
    try {
      const raw = JSON.parse(await fs.readFile(this.manifestPath, 'utf8')) as Partial<ArtifactManifest>;
      if (raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) {
        throw new Error('证据清单格式无效。');
      }
      return { schemaVersion: 1, entries: raw.entries as ArtifactManifestEntry[] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: 1, entries: [] };
      }
      throw error;
    }
  }

  private async writeManifest(manifest: ArtifactManifest): Promise<void> {
    await this.ensureReady();
    await writeDurableAtomicFile({
      directory: this.artifactsDir,
      stagingPath: path.join(this.artifactsDir, `.${MANIFEST_FILE_NAME}-${randomUUID()}.tmp`),
      destinationPath: this.manifestPath,
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    });
  }

  private toManifestPath(artifactPath: string): string {
    return path.relative(this.artifactsDir, artifactPath).split(path.sep).join('/');
  }

  private allocateArtifactPath(prefix: string, extension: string): string {
    return path.join(this.artifactsDir, `${prefix}-${randomUUID()}${extension}`);
  }

  private async moveToTombstone(artifactPath: string): Promise<ArtifactDeletionTombstone | undefined> {
    await fs.mkdir(this.tombstonesDir, { recursive: true });
    const tombstoneId = randomUUID();
    const tombstonePath = path.join(this.tombstonesDir, `${tombstoneId}.pending`);
    const journalPath = path.join(this.tombstonesDir, `${tombstoneId}${TOMBSTONE_JOURNAL_SUFFIX}`);
    await writeDurableAtomicFile({
      directory: this.tombstonesDir,
      stagingPath: path.join(this.tombstonesDir, `.${tombstoneId}.tmp`),
      destinationPath: journalPath,
      content: `${JSON.stringify({ schemaVersion: 1, originalPath: this.toManifestPath(artifactPath) } satisfies ArtifactDeletionJournal)}\n`,
    });
    try {
      await fs.rename(artifactPath, tombstonePath);
      return { path: tombstonePath, journalPath };
    } catch (error) {
      await fs.rm(journalPath, { force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  private async restoreTombstone(tombstone: ArtifactDeletionTombstone | undefined, artifactPath: string): Promise<void> {
    if (!tombstone) {
      return;
    }
    await fs.rename(tombstone.path, artifactPath);
    await fs.rm(tombstone.journalPath, { force: true });
  }

  private async purgeTombstone(tombstone: ArtifactDeletionTombstone | undefined): Promise<void> {
    if (!tombstone) {
      return;
    }
    await fs.rm(tombstone.path, { force: true });
    await fs.rm(tombstone.journalPath, { force: true });
  }

  private async restoreManifestAfterFailedDeletion(originalManifest: ArtifactManifest): Promise<void> {
    try {
      const currentManifest = await this.readManifest();
      if (JSON.stringify(currentManifest) !== JSON.stringify(originalManifest)) {
        await this.writeManifest(originalManifest);
      }
    } catch {
      // The artifact has already been restored; retain the original mutation error.
    }
  }

  private isReservedArtifactPath(artifactPath: string): boolean {
    const fileName = path.basename(artifactPath);
    return this.isPathInsideTombstones(artifactPath)
      || fileName === MANIFEST_FILE_NAME
      || (fileName.startsWith(`.${MANIFEST_FILE_NAME}-`) && fileName.endsWith('.tmp'));
  }

  private async reconcileTombstones(): Promise<void> {
    await fs.mkdir(this.tombstonesDir, { recursive: true });
    const entries = await fs.readdir(this.tombstonesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(TOMBSTONE_JOURNAL_SUFFIX)) {
        continue;
      }
      const journalPath = path.join(this.tombstonesDir, entry.name);
      if (this.activeTombstoneJournals.has(journalPath)) {
        continue;
      }
      const tombstone = this.tombstoneFromJournalPath(journalPath, entry.name);
      if (!tombstone) {
        continue;
      }
      const journal = await this.readDeletionJournal(journalPath);
      if (!journal) {
        continue;
      }
      const originalPath = this.resolveDeletionOriginalPath(journal.originalPath);
      if (!originalPath) {
        continue;
      }

      let manifest: ArtifactManifest;
      try {
        manifest = await this.readManifest();
      } catch {
        continue;
      }
      const isReferenced = manifest.entries.some((candidate) =>
        typeof candidate?.path === 'string' && candidate.path === journal.originalPath,
      );
      const tombstoneState = await this.getRegularFileState(tombstone.path);
      if (isReferenced) {
        if (tombstoneState === 'missing' && await this.getRegularFileState(originalPath) === 'file') {
          await fs.rm(journalPath, { force: true });
        } else if (tombstoneState === 'file' && await this.getRegularFileState(originalPath) === 'missing') {
          await fs.rename(tombstone.path, originalPath);
          await fs.rm(journalPath, { force: true });
        }
        continue;
      }

      if (tombstoneState === 'file' || tombstoneState === 'missing') {
        await fs.rm(tombstone.path, { force: true });
        await fs.rm(journalPath, { force: true });
      }
    }
  }

  private tombstoneFromJournalPath(journalPath: string, fileName: string): ArtifactDeletionTombstone | undefined {
    const tombstoneId = fileName.slice(0, -TOMBSTONE_JOURNAL_SUFFIX.length);
    if (!TOMBSTONE_ID_PATTERN.test(tombstoneId)) {
      return undefined;
    }
    return {
      path: path.join(this.tombstonesDir, `${tombstoneId}.pending`),
      journalPath,
    };
  }

  private async readDeletionJournal(journalPath: string): Promise<ArtifactDeletionJournal | undefined> {
    try {
      const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as Partial<ArtifactDeletionJournal>;
      if (journal.schemaVersion !== 1 || typeof journal.originalPath !== 'string') {
        return undefined;
      }
      return { schemaVersion: 1, originalPath: journal.originalPath };
    } catch {
      return undefined;
    }
  }

  private resolveDeletionOriginalPath(relativePath: string): string | undefined {
    const artifactPath = path.resolve(this.artifactsDir, relativePath);
    if (
      !this.isManagedArtifactPath(artifactPath)
      || this.isReservedArtifactPath(artifactPath)
      || this.isPathInsideTombstones(artifactPath)
      || this.toManifestPath(artifactPath) !== relativePath
    ) {
      return undefined;
    }
    return artifactPath;
  }

  private isPathInsideTombstones(candidatePath: string): boolean {
    const relativePath = path.relative(this.tombstonesDir, path.resolve(candidatePath));
    return !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
  }

  private async getRegularFileState(candidatePath: string): Promise<'file' | 'missing' | 'other'> {
    try {
      return (await fs.lstat(candidatePath)).isFile() ? 'file' : 'other';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 'missing';
      }
      throw error;
    }
  }

  private enqueueManifestMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.manifestMutation.then(mutation);
    this.manifestMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const validateRetentionNow = (now: Date): Date => {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error('证据保留计划请求无效。');
  }
  return now;
};

const validateRetentionPolicy = (policy: ArtifactRetentionPolicy): ArtifactRetentionPolicy => {
  if (
    !Number.isFinite(policy.maxBytes) || policy.maxBytes < 0 ||
    !Number.isFinite(policy.keepDays) || policy.keepDays < 0
  ) {
    throw new Error('证据保留策略无效。');
  }
  return { maxBytes: policy.maxBytes, keepDays: policy.keepDays };
};

const toPlannedArtifactSnapshot = (entry: ArtifactManifestEntry): PlannedArtifactSnapshot => {
  return {
    id: entry.id,
    path: entry.path,
    contentHash: entry.contentHash,
    byteCount: entry.byteCount,
    createdAt: entry.createdAt,
    retentionClass: entry.retentionClass,
    protectedBy: [...entry.protectedBy].sort(),
  };
};

const sameStringSet = (left: string[], right: string[]): boolean => {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
};

const isEligibleForRetention = (createdAt: string, plannedAt: string, keepDays: number): boolean => {
  const createdAtTimestamp = Date.parse(createdAt);
  const plannedAtTimestamp = Date.parse(plannedAt);
  return Number.isFinite(createdAtTimestamp) &&
    Number.isFinite(plannedAtTimestamp) &&
    createdAtTimestamp <= plannedAtTimestamp - keepDays * 24 * 60 * 60 * 1_000;
};

const countManifestPaths = (entries: ArtifactManifestEntry[]): Map<string, number> => {
  const counts = new Map<string, number>();
  entries.forEach((entry) => counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1));
  return counts;
};

const withSharedManifestPathProtection = (reasons: string[], pathCount: number): string[] => {
  return pathCount > 1 ? [...new Set([...reasons, 'sharedManifestPath'])].sort() : reasons;
};

const toRetentionPreviewEntry = (
  entry: ArtifactManifestEntry,
  deletionCandidate: boolean,
  reason: ArtifactRetentionPreviewEntry['reason'],
  protectedReasons: string[],
): ArtifactRetentionPreviewEntry => {
  return {
    id: entry.id,
    contentHash: entry.contentHash,
    retentionClass: entry.retentionClass,
    evidenceKind: entry.evidenceKind,
    byteCount: entry.byteCount,
    createdAt: entry.createdAt,
    timestamps: { createdAt: entry.createdAt },
    deletionCandidate,
    reason,
    protectedReasons,
  };
};

const compareRetentionEntries = (
  left: { entry: ArtifactManifestEntry },
  right: { entry: ArtifactManifestEntry },
): number => {
  return compareArtifactTimestamp(left.entry.createdAt, right.entry.createdAt) || left.entry.id.localeCompare(right.entry.id);
};

const compareRetentionPreviewEntries = (left: ArtifactRetentionPreviewEntry, right: ArtifactRetentionPreviewEntry): number => {
  return compareArtifactTimestamp(left.createdAt, right.createdAt) || left.id.localeCompare(right.id);
};

const compareArtifactTimestamp = (left: string, right: string): number => {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return (Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY) -
    (Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY);
};

const isReferencedByPersistedRunDetail = (entry: ArtifactManifestEntry, state: StudioState): boolean => {
  return state.runDetails.some((detail) => {
    const artifacts = [
      ...detail.artifacts,
      ...(detail.manualEvidence ?? []).flatMap((evidence) => evidence.attachments ?? []),
      ...(detail.agentRun ? [detail.agentRun] : []),
      ...(detail.agentRuns ?? []),
    ];
    return artifacts.some((artifact) => entryMatchesPersistedReference(entry, artifact)) ||
      (detail.agentRun ? agentRunReferencesEntry(entry, detail.agentRun) : false) ||
      (detail.agentRuns ?? []).some((agentRun) => agentRunReferencesEntry(entry, agentRun));
  });
};

const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
};

const agentRunReferencesEntry = (entry: ArtifactManifestEntry, agentRun: StudioState['runDetails'][number]['agentRun']): boolean => {
  if (!agentRun) {
    return false;
  }
  return agentRun.artifacts.some((artifact) => entryMatchesPersistedReference(entry, artifact)) ||
    agentRun.events.some((event) => entryMatchesPersistedReference(entry, event.artifact));
};

const isReferencedByBaseline = (entry: ArtifactManifestEntry, state: StudioState): boolean => {
  return state.projects.some((project) => project.testCases.some((testCase) =>
    entryMatchesPersistedReference(entry, testCase.assetReferences?.baseline),
  ));
};

const isReferencedByRecordingVisualBaseline = (entry: ArtifactManifestEntry, state: StudioState): boolean => {
  return state.projects.some((project) => project.recordings.some((recording) => recording.steps.some((step) =>
    typeof step.screenshotPath === 'string' && entryMatchesPersistedReference(entry, { path: step.screenshotPath }),
  )));
};

const isReferencedByMaintenanceDraft = (entry: ArtifactManifestEntry, state: StudioState): boolean => {
  return state.maintenanceDrafts.some((draft) => draft.evidence.some((citation) => (
    citation.artifactId === entry.id && citation.contentHash === entry.contentHash
  )));
};

const entryMatchesPersistedReference = (entry: ArtifactManifestEntry, reference: unknown): boolean => {
  if (!reference || typeof reference !== 'object') {
    return false;
  }
  const candidate = reference as {
    id?: unknown;
    path?: unknown;
    contentHash?: unknown;
    manifest?: { id?: unknown; path?: unknown; contentHash?: unknown };
  };
  if (candidate.id === entry.id || candidate.contentHash === entry.contentHash || candidate.path === entry.path) {
    return true;
  }
  if (typeof candidate.path === 'string' && normalizeArtifactPath(candidate.path).endsWith(`/${normalizeArtifactPath(entry.path)}`)) {
    return true;
  }
  return candidate.manifest?.id === entry.id ||
    candidate.manifest?.path === entry.path ||
    candidate.manifest?.contentHash === entry.contentHash;
};

const normalizeArtifactPath = (candidatePath: string): string => {
  return candidatePath.replaceAll('\\', '/').replace(/\/+$/, '');
};

const isPathInside = (rootPath: string, candidatePath: string): boolean => {
  const relativePath = path.relative(rootPath, candidatePath);
  return Boolean(relativePath) && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
};

export const renderProjectRunReportHtml = (report: ProjectRunReport, locale: ProjectReportLocale): string => {
  const labels = projectReportLabels(locale);
  const stats = (Object.entries(report.runStats) as Array<[keyof ProjectRunReport['runStats'], number]>)
    .map(([status, count]) => `<li><span>${escapeXml(labels.status[status])}</span><strong>${count}</strong></li>`)
    .join('');
  const risks = report.coverageRisk.risks.length
    ? report.coverageRisk.risks
        .map((risk) => `<tr><td>${escapeXml(risk.testCaseName)}</td><td>${escapeXml(risk.groupName)}</td><td>${escapeXml(risk.environmentName)}</td><td>${escapeXml(labels.risk[risk.status])}</td></tr>`)
        .join('')
    : `<tr><td colspan="4" class="muted">${escapeXml(labels.noRisks)}</td></tr>`;
  const triageRows = (['case', 'recording'] as const)
    .map((target) => {
      const statuses = report.prdCoverage.targets[target];
      return `<tr><td>${escapeXml(labels.target[target])}</td><td>${statuses.pending}</td><td>${statuses.deferred}</td><td>${statuses.ignored}</td><td>${statuses.resolved}</td></tr>`;
    })
    .join('');
  const problemRuns = report.problemRuns.length
    ? report.problemRuns
        .map((run) => `<article class="problem"><div><strong>${escapeXml(run.testCaseName)}</strong><span>${escapeXml(run.environmentName)} · ${escapeXml(labels.status[run.status])}</span></div><p>${escapeXml(run.failureReason || run.summary)}</p><small>${escapeXml(run.startedAt || labels.unknownTime)} · ${escapeXml(run.duration)}${run.artifactLabels.length ? ` · ${escapeXml(run.artifactLabels.join(' / '))}` : ''}</small></article>`)
        .join('')
    : `<p class="muted">${escapeXml(labels.noProblemRuns)}</p>`;
  const nonExecutedRuns = report.nonExecutedRuns.length
    ? report.nonExecutedRuns
        .map((run) => `<article class="non-executed"><div><strong>${escapeXml(run.testCaseName)}</strong><span>${escapeXml(run.environmentName)} · ${escapeXml(labels.status[run.status])}</span></div><p>${escapeXml(run.reason ? `${run.reason.code} · ${run.reason.message}` : run.summary)}</p><small>${escapeXml(run.startedAt || labels.unknownTime)} · ${escapeXml(run.duration)}${run.artifactLabels.length ? ` · ${escapeXml(run.artifactLabels.join(' / '))}` : ''}</small></article>`)
        .join('')
    : `<p class="muted">${escapeXml(labels.noNonExecutedRuns)}</p>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeXml(labels.title)} · ${escapeXml(report.projectName)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f8fb; }
    body { margin: 0; padding: 32px; background: #f6f8fb; }
    main { max-width: 960px; margin: 0 auto; background: #fff; border: 1px solid #dfe5ee; padding: 36px; }
    h1 { margin: 0; font-size: 28px; } h2 { margin: 32px 0 12px; font-size: 16px; } p { line-height: 1.6; }
    .meta, .muted, small { color: #667085; } .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 0; list-style: none; }
    .grid li { border: 1px solid #dfe5ee; padding: 14px; display: flex; justify-content: space-between; gap: 12px; } strong { color: #172033; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; } th, td { padding: 10px; border-bottom: 1px solid #e8edf4; text-align: left; vertical-align: top; }
    th { color: #667085; font-weight: 600; } .problem, .non-executed { border: 1px solid #dfe5ee; padding: 14px; margin-bottom: 10px; } .problem div, .non-executed div { display: flex; justify-content: space-between; gap: 12px; } .problem div span, .non-executed div span { color: #667085; font-size: 13px; }
  </style>
</head>
<body><main>
  <h1>${escapeXml(labels.title)}</h1>
  <p class="meta">${escapeXml(report.projectName)} · ${escapeXml(labels.generatedAt)} ${escapeXml(report.generatedAt)}</p>
  <h2>${escapeXml(labels.runSummary)}</h2><ul class="grid">${stats}</ul>
  <h2>${escapeXml(labels.coverageRisk)}</h2><p class="meta">${escapeXml(labels.verified)} ${report.coverageRisk.verified} / ${report.coverageRisk.total}</p>
  <table><thead><tr><th>${escapeXml(labels.testCase)}</th><th>${escapeXml(labels.group)}</th><th>${escapeXml(labels.environment)}</th><th>${escapeXml(labels.riskStatus)}</th></tr></thead><tbody>${risks}</tbody></table>
  <h2>${escapeXml(labels.prdCoverage)}</h2><p class="meta">${escapeXml(labels.prdPaths)} ${report.prdCoverage.paths}</p>
  <table><thead><tr><th>${escapeXml(labels.targetLabel)}</th><th>${escapeXml(labels.triage.pending)}</th><th>${escapeXml(labels.triage.deferred)}</th><th>${escapeXml(labels.triage.ignored)}</th><th>${escapeXml(labels.triage.resolved)}</th></tr></thead><tbody>${triageRows}</tbody></table>
  <h2>${escapeXml(labels.problemRuns)}</h2>${problemRuns}
  <h2>${escapeXml(labels.nonExecutedRuns)}</h2>${nonExecutedRuns}
</main></body></html>`;
};

const projectReportLabels = (locale: ProjectReportLocale): ProjectReportLabels => {
  if (locale === 'en-US') {
    return {
      title: 'TestBuddy Project Report', generatedAt: 'Generated at', runSummary: 'Run summary', coverageRisk: 'Coverage risk', verified: 'Verified', testCase: 'Test case', group: 'Group', environment: 'Environment', riskStatus: 'Risk', noRisks: 'No coverage risks.', prdCoverage: 'PRD coverage governance', prdPaths: 'Requirement paths', targetLabel: 'Target', problemRuns: 'Recent failed runs', noProblemRuns: 'No failed runs.', nonExecutedRuns: 'Recent non-executed runs', noNonExecutedRuns: 'No non-executed runs.', unknownTime: 'Unknown time',
      status: { running: 'Running', passed: 'Passed', failed: 'Failed', blocked: 'Blocked', skipped: 'Skipped', cancelled: 'Cancelled', error: 'Error' },
      risk: { neverExecuted: 'Never executed', failed: 'Last run failed', error: 'Last run errored', blocked: 'Last run blocked', skipped: 'Last run skipped', cancelled: 'Last run cancelled' },
      target: { case: 'Test case', recording: 'Recording' },
      triage: { pending: 'Pending', deferred: 'Deferred', ignored: 'Ignored', resolved: 'Resolved' },
    };
  }
  return {
    title: 'TestBuddy 项目报告', generatedAt: '生成时间', runSummary: '运行汇总', coverageRisk: '覆盖风险', verified: '已验证', testCase: '用例', group: '分组', environment: '环境', riskStatus: '风险', noRisks: '当前没有覆盖风险。', prdCoverage: 'PRD 覆盖治理', prdPaths: '需求路径', targetLabel: '目标', problemRuns: '最近失败运行', noProblemRuns: '当前没有失败运行。', nonExecutedRuns: '最近未执行运行', noNonExecutedRuns: '当前没有未执行运行。', unknownTime: '未知时间',
    status: { running: '运行中', passed: '通过', failed: '失败', blocked: '阻断', skipped: '跳过', cancelled: '已取消', error: '错误' },
    risk: { neverExecuted: '从未执行', failed: '最近失败', error: '最近错误', blocked: '最近阻断', skipped: '最近跳过', cancelled: '最近取消' },
    target: { case: '用例', recording: '录制' },
    triage: { pending: '待处理', deferred: '延后', ignored: '忽略', resolved: '已解决' },
  };
};

interface ProjectReportLabels {
  title: string;
  generatedAt: string;
  runSummary: string;
  coverageRisk: string;
  verified: string;
  testCase: string;
  group: string;
  environment: string;
  riskStatus: string;
  noRisks: string;
  prdCoverage: string;
  prdPaths: string;
  targetLabel: string;
  problemRuns: string;
  noProblemRuns: string;
  nonExecutedRuns: string;
  noNonExecutedRuns: string;
  unknownTime: string;
  status: Record<RunStatus, string>;
  risk: Record<RunCoverageRiskStatus, string>;
  target: Record<'case' | 'recording', string>;
  triage: Record<'pending' | 'deferred' | 'ignored' | 'resolved', string>;
}

const getSafeExtension = (sourceName: string): string => {
  const extension = path.extname(sourceName).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '';
};

const renderReporterHtml = (markdown: string): string => {
  const body = markdown
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith('# ')) {
        return `<h1>${escapeXml(line.slice(2).trim())}</h1>`;
      }
      if (line.startsWith('## ')) {
        return `<h2>${escapeXml(line.slice(3).trim())}</h2>`;
      }
      if (line.startsWith('- ')) {
        return `<li>${escapeXml(line.slice(2).trim())}</li>`;
      }
      if (!line.trim()) {
        return '';
      }
      return `<p>${escapeXml(line.trim())}</p>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reporter 失败分析</title>
  <style>
    body { margin: 0; background: #0b0f14; color: #eef5f8; font-family: Avenir Next, PingFang SC, sans-serif; }
    main { max-width: 920px; margin: 0 auto; padding: 48px 32px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 28px; }
    h2 { color: #9ce7ff; font-size: 16px; margin: 28px 0 12px; text-transform: uppercase; letter-spacing: .08em; }
    p, li { color: #c7d2da; font-size: 15px; line-height: 1.75; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>`;
};

const escapeXml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
};
