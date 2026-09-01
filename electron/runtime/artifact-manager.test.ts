import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArtifactManager, renderProjectRunReportHtml } from './artifact-manager.js';
import { createDemoStudioState, createInitialStudioState } from '../../shared/studio.js';

const retentionReviewOptions = {
  now: () => new Date('2026-02-01T00:00:00.000Z'),
  retentionPolicy: { maxBytes: 0, keepDays: 7 },
};

describe('ArtifactManager', () => {
  it('finds an immutable manifest entry by its managed artifact ID', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'maintenance.png');
    await fs.writeFile(evidencePath, 'maintenance evidence', 'utf8');
    const artifact = await artifacts.registerExisting({
      id: 'maintenance-evidence',
      path: evidencePath,
      type: 'screenshot',
      label: 'Maintenance evidence',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
    });

    const entry = await artifacts.findManifestEntry('maintenance-evidence');

    expect(entry).toEqual(artifact.manifest);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(await artifacts.findManifestEntry('missing-evidence')).toBeUndefined();
  });

  it('resolves an unchanged manifest entry to a verified absolute managed path', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'maintenance-open.png');
    await fs.writeFile(evidencePath, 'original maintenance evidence', 'utf8');
    const artifact = await artifacts.registerExisting({
      id: 'maintenance-open-evidence',
      path: evidencePath,
      type: 'screenshot',
      label: 'Maintenance evidence',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
    });
    const entry = await artifacts.findManifestEntry(artifact.id);
    if (!entry) {
      throw new Error('Expected registered manifest entry.');
    }

    await expect(artifacts.resolveManifestEntryPath(entry)).resolves.toBe(evidencePath);

    await fs.writeFile(evidencePath, 'changed maintenance evidence', 'utf8');
    await expect(artifacts.resolveManifestEntryPath(entry)).resolves.toBeUndefined();
  });

  it('plans only old unprotected excess entries and resolves persisted RunDetail references in main-owned state', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const state = createInitialStudioState();
    const artifacts = new ArtifactManager(rootDir, {
      ...retentionReviewOptions,
      loadStudioState: async () => state,
      retentionPolicy: { maxBytes: 80, keepDays: 7 },
    });
    await artifacts.ensureReady();
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const recent = new Date('2026-01-31T00:00:00.000Z').toISOString();

    const register = async (id: string, contents: string, createdAt: string, protectedBy: string[] = []) => {
      const evidencePath = path.join(artifactsDir, `${id}.txt`);
      await fs.writeFile(evidencePath, contents, 'utf8');
      return artifacts.registerExisting({
        id,
        path: evidencePath,
        type: 'report',
        label: id,
        evidenceKind: 'report',
        retentionClass: 'standard',
        protectedBy,
        createdAt,
      });
    };

    const candidate = await register('candidate', 'c'.repeat(60), old);
    const referenced = await register('referenced', 'r'.repeat(30), old);
    await register('explicitly-protected', 'p'.repeat(30), old, ['acceptedMaintenanceDraft']);
    await register('recent', 'n'.repeat(10), recent);
    state.runDetails = [{
      id: 'run-retention-reference',
      projectId: 'project-1',
      testCaseId: 'case-1',
      environmentId: 'environment-1',
      title: 'Persisted evidence owner',
      status: 'passed',
      startedAt: old,
      duration: '00:00:01',
      summary: 'Evidence remains referenced.',
      logs: [],
      steps: [],
      artifacts: [referenced],
    }];
    state.maintenanceDrafts = [{
      evidence: [{ runId: 'run-maintenance', artifactId: candidate.id, contentHash: candidate.manifest!.contentHash }],
    }] as never;

    const plan = await artifacts.planArtifactRetention();

    expect(plan.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: candidate.id, deletionCandidate: false, protectedReasons: ['maintenanceDraftReference'] }),
      expect.objectContaining({ id: referenced.id, deletionCandidate: false, protectedReasons: ['persistedRunDetail'] }),
      expect.objectContaining({ id: 'explicitly-protected', deletionCandidate: false, protectedReasons: ['protectedBy:acceptedMaintenanceDraft'] }),
    ]));
    expect(plan.entries.find((entry) => entry.id === 'recent')).toBeUndefined();
    expect(plan.protectedCount).toBe(3);
  });

  it('confirms an unchanged reviewed plan once and returns an immutable deletion audit', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir, retentionReviewOptions);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'expired.txt');
    await fs.writeFile(evidencePath, 'expired evidence', 'utf8');
    const artifact = await artifacts.registerExisting({
      id: 'expired-evidence',
      path: evidencePath,
      type: 'report',
      label: 'expired evidence',
      evidenceKind: 'report',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const plan = await artifacts.planArtifactRetention();

    const audit = await artifacts.confirmArtifactRetention(plan.id);

    expect(audit.deleted).toEqual([expect.objectContaining({
      id: artifact.id,
      contentHash: artifact.manifest?.contentHash,
      byteCount: artifact.manifest?.byteCount,
    })]);
    expect(Object.isFrozen(audit.deleted)).toBe(true);
    expect(Object.isFrozen(audit.deleted[0]!)).toBe(true);
    await expect(fs.access(evidencePath)).rejects.toThrow();
    await expect(artifacts.confirmArtifactRetention(plan.id)).rejects.toMatchObject({ code: 'retentionPlanAlreadyConfirmed' });
  });

  it('rejects a reviewed plan when only the manifest creation timestamp changed', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir, retentionReviewOptions);
    await artifacts.ensureReady();
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const evidencePath = path.join(artifactsDir, 'timestamped.txt');
    const manifestPath = path.join(artifactsDir, 'manifest.json');
    await fs.writeFile(evidencePath, 'timestamped evidence', 'utf8');
    await artifacts.registerExisting({
      id: 'timestamped-evidence',
      path: evidencePath,
      type: 'report',
      label: 'timestamped evidence',
      evidenceKind: 'report',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const plan = await artifacts.planArtifactRetention();
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.entries[0].createdAt = '2026-02-01T00:00:00.000Z';
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    await expect(artifacts.confirmArtifactRetention(plan.id)).rejects.toMatchObject({ code: 'plannedArtifactChanged' });
    await expect(fs.readFile(evidencePath, 'utf8')).resolves.toBe('timestamped evidence');
  });

  it('keeps confirmation queued until an active export has finished copying the reviewed source', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir, retentionReviewOptions);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'exported.txt');
    const destinationPath = path.join(rootDir, 'exports', 'exported.txt');
    await fs.writeFile(evidencePath, 'exported evidence', 'utf8');
    await artifacts.registerExisting({
      id: 'exported-evidence',
      path: evidencePath,
      type: 'report',
      label: 'exported evidence',
      evidenceKind: 'report',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const plan = await artifacts.planArtifactRetention();
    const unsafeFs = fs as unknown as { copyFile: typeof fs.copyFile };
    const originalCopyFile = unsafeFs.copyFile.bind(fs);
    let releaseCopy: () => void = () => undefined;
    const copyBarrier = new Promise<void>((resolve) => { releaseCopy = resolve; });
    let markCopyStarted: () => void = () => undefined;
    const copyStarted = new Promise<void>((resolve) => { markCopyStarted = resolve; });
    unsafeFs.copyFile = async (source, destination, mode) => {
      if (destination === destinationPath) {
        markCopyStarted();
        await copyBarrier;
      }
      return originalCopyFile(source, destination, mode);
    };

    try {
      const exporting = artifacts.exportArtifact(evidencePath, destinationPath);
      await copyStarted;
      const confirming = artifacts.confirmArtifactRetention(plan.id);
      let confirmationSettled = false;
      void confirming.finally(() => { confirmationSettled = true; });
      await Promise.resolve();
      await Promise.resolve();

      expect(confirmationSettled).toBe(false);
      await expect(fs.readFile(evidencePath, 'utf8')).resolves.toBe('exported evidence');
      releaseCopy();
      await exporting;
      await expect(fs.readFile(destinationPath, 'utf8')).resolves.toBe('exported evidence');
      await expect(confirming).resolves.toMatchObject({ planId: plan.id });
    } finally {
      unsafeFs.copyFile = originalCopyFile;
    }
  });

  it('rejects confirmation when an entry changed or became protected after review', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    let protectedNow = false;
    const artifacts = new ArtifactManager(rootDir, {
      ...retentionReviewOptions,
      protectionResolver: {
        resolve: async () => protectedNow ? ['maintenanceCitation'] : [],
      },
    });
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'reviewed.txt');
    await fs.writeFile(evidencePath, 'reviewed evidence', 'utf8');
    await artifacts.registerExisting({
      id: 'reviewed-evidence',
      path: evidencePath,
      type: 'report',
      label: 'reviewed evidence',
      evidenceKind: 'report',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const plan = await artifacts.planArtifactRetention();
    protectedNow = true;

    await expect(artifacts.confirmArtifactRetention(plan.id)).rejects.toMatchObject({ code: 'plannedArtifactProtected' });
    await expect(fs.readFile(evidencePath, 'utf8')).resolves.toBe('reviewed evidence');
  });

  it('conservatively protects a manifest path shared by more than one entry', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir, retentionReviewOptions);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'shared.txt');
    await fs.writeFile(evidencePath, 'shared evidence', 'utf8');
    const registration = {
      path: evidencePath,
      type: 'report' as const,
      label: 'shared evidence',
      evidenceKind: 'report' as const,
      retentionClass: 'standard' as const,
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await artifacts.registerExisting({ ...registration, id: 'shared-a' });
    await artifacts.registerExisting({ ...registration, id: 'shared-b' });

    const plan = await artifacts.planArtifactRetention();

    expect(plan.candidateCount).toBe(0);
    expect(plan.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'shared-a', protectedReasons: ['sharedManifestPath'] }),
      expect.objectContaining({ id: 'shared-b', protectedReasons: ['sharedManifestPath'] }),
    ]));
  });

  it('owns the retention review policy in ArtifactManager', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir, retentionReviewOptions);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'main-owned-policy.txt');
    await fs.writeFile(evidencePath, 'main owned policy', 'utf8');
    await artifacts.registerExisting({
      id: 'main-owned-policy-evidence',
      path: evidencePath,
      type: 'report',
      label: 'main owned policy',
      evidenceKind: 'report',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const plan = await artifacts.planArtifactRetention();

    expect(plan).toMatchObject({
      plannedAt: '2026-02-01T00:00:00.000Z',
      maxBytes: 0,
      keepDays: 7,
      candidateCount: 1,
    });
  });

  it('protects persisted recording visual baseline screenshots during retention planning', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const state = createDemoStudioState();
    const artifacts = new ArtifactManager(rootDir, { ...retentionReviewOptions, loadStudioState: async () => state });
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'recording-baseline.png');
    await fs.writeFile(evidencePath, 'recording visual baseline', 'utf8');
    const artifact = await artifacts.registerExisting({
      id: 'recording-visual-baseline',
      path: evidencePath,
      type: 'screenshot',
      label: 'recording visual baseline',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const recording = state.projects[0]!.recordings[0]!;
    recording.steps = [{ ...recording.steps[0]!, screenshotPath: evidencePath }, ...recording.steps.slice(1)];

    const plan = await artifacts.planArtifactRetention();

    expect(plan.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: artifact.id,
        deletionCandidate: false,
        protectedReasons: ['recordingVisualBaseline'],
      }),
    ]));
  });

  it('rejects retention confirmation when a recording starts referencing the reviewed screenshot', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const state = createDemoStudioState();
    const artifacts = new ArtifactManager(rootDir, { ...retentionReviewOptions, loadStudioState: async () => state });
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'new-recording-baseline.png');
    await fs.writeFile(evidencePath, 'new recording visual baseline', 'utf8');
    await artifacts.registerExisting({
      id: 'new-recording-visual-baseline',
      path: evidencePath,
      type: 'screenshot',
      label: 'new recording visual baseline',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const plan = await artifacts.planArtifactRetention();
    const recording = state.projects[0]!.recordings[0]!;
    recording.steps = [{ ...recording.steps[0]!, screenshotPath: evidencePath }, ...recording.steps.slice(1)];

    await expect(artifacts.confirmArtifactRetention(plan.id)).rejects.toMatchObject({ code: 'plannedArtifactProtected' });
    await expect(fs.readFile(evidencePath, 'utf8')).resolves.toBe('new recording visual baseline');
  });

  it('confirms retention after a post-commit tombstone purge failure', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir, retentionReviewOptions);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'purge-recovery.txt');
    await fs.writeFile(evidencePath, 'purge recovery', 'utf8');
    await artifacts.registerExisting({
      id: 'purge-recovery-evidence',
      path: evidencePath,
      type: 'report',
      label: 'purge recovery',
      evidenceKind: 'report',
      retentionClass: 'standard',
      protectedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const plan = await artifacts.planArtifactRetention();
    const unsafeArtifacts = artifacts as unknown as { purgeTombstone: () => Promise<void> };
    unsafeArtifacts.purgeTombstone = async () => {
      throw new Error('tombstone purge failed');
    };

    await expect(artifacts.confirmArtifactRetention(plan.id)).resolves.toMatchObject({ planId: plan.id });
    await expect(fs.access(evidencePath)).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(path.join(rootDir, 'studio-data', 'artifacts', 'manifest.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      entries: [],
    });
    await expect(artifacts.confirmArtifactRetention(plan.id)).rejects.toMatchObject({ code: 'retentionPlanAlreadyConfirmed' });
  });

  it('registers a managed file with hashed, relative manifest metadata', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    await artifacts.ensureReady();
    const evidencePath = path.join(rootDir, 'studio-data', 'artifacts', 'run-17-pre-step.png');
    await fs.writeFile(evidencePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const artifact = await artifacts.registerExisting({
      path: evidencePath,
      type: 'screenshot',
      label: '步骤前页面截图',
      evidenceKind: 'pageScreenshot',
      ownerRunId: 'run-17',
      retentionClass: 'standard',
      protectedBy: [],
    });

    expect(artifact).toMatchObject({
      type: 'screenshot',
      path: evidencePath,
      manifest: {
        id: artifact.id,
        path: 'run-17-pre-step.png',
        contentHash: '0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543',
        byteCount: 4,
        ownerRunId: 'run-17',
        evidenceKind: 'pageScreenshot',
        retentionClass: 'standard',
        protectedBy: [],
      },
    });
    const manifest = JSON.parse(await fs.readFile(path.join(rootDir, 'studio-data', 'artifacts', 'manifest.json'), 'utf8'));
    expect(manifest.entries).toEqual([artifact.manifest]);
    expect(JSON.stringify(manifest)).not.toContain(rootDir);
  });

  it('does not create a manifest entry when file registration fails', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    await expect(artifacts.registerExisting({
      path: path.join(rootDir, 'outside.png'),
      type: 'screenshot',
      label: '不应注册',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
    })).rejects.toThrow('只能登记应用生成的证据文件。');
    await expect(fs.access(path.join(rootDir, 'studio-data', 'artifacts', 'manifest.json'))).rejects.toThrow();
  });

  it('rejects reserved manifest paths and symlinks outside managed artifact storage', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    await artifacts.ensureReady();
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const manifestPath = path.join(artifactsDir, 'manifest.json');
    const stagingPath = path.join(artifactsDir, '.manifest.json-staging.tmp');
    await fs.writeFile(manifestPath, '{"schemaVersion":1,"entries":[]}\n', 'utf8');
    await fs.writeFile(stagingPath, 'staging', 'utf8');
    const outsidePath = path.join(rootDir, 'outside-evidence.png');
    const symlinkPath = path.join(artifactsDir, 'outside-link.png');
    await fs.writeFile(outsidePath, 'outside', 'utf8');
    await fs.symlink(outsidePath, symlinkPath);

    for (const reservedPath of [manifestPath, stagingPath]) {
      await expect(artifacts.registerExisting({
        path: reservedPath,
        type: 'report',
        label: '保留文件',
        evidenceKind: 'report',
        retentionClass: 'standard',
        protectedBy: [],
      })).rejects.toThrow('不能登记保留的证据文件。');
    }
    await expect(artifacts.registerExisting({
      path: symlinkPath,
      type: 'screenshot',
      label: '外部链接',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
    })).rejects.toThrow('只能登记解析后仍位于应用证据目录中的常规文件。');
    await expect(fs.readFile(manifestPath, 'utf8')).resolves.toBe('{"schemaVersion":1,"entries":[]}\n');
  });

  it('serializes concurrent registrations so each manifest entry is retained', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    await artifacts.ensureReady();
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const firstPath = path.join(artifactsDir, 'first.png');
    const secondPath = path.join(artifactsDir, 'second.png');
    await fs.writeFile(firstPath, 'first', 'utf8');
    await fs.writeFile(secondPath, 'second', 'utf8');

    const unsafeArtifacts = artifacts as unknown as {
      writeManifest: (manifest: unknown) => Promise<void>;
    };
    const originalWriteManifest = unsafeArtifacts.writeManifest.bind(artifacts);
    let releaseFirstWrite: () => void;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let notifyFirstWrite: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
      notifyFirstWrite = resolve;
    });
    let writeCalls = 0;
    unsafeArtifacts.writeManifest = async (manifest) => {
      if (writeCalls++ === 0) {
        notifyFirstWrite();
        await firstWriteBlocked;
      }
      await originalWriteManifest(manifest);
    };

    const firstRegistration = artifacts.registerExisting({
      path: firstPath,
      type: 'screenshot',
      label: 'first',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
    });
    await firstWriteStarted;
    const secondRegistration = artifacts.registerExisting({
      path: secondPath,
      type: 'screenshot',
      label: 'second',
      evidenceKind: 'pageScreenshot',
      retentionClass: 'standard',
      protectedBy: [],
    });
    releaseFirstWrite!();

    const [first, second] = await Promise.all([firstRegistration, secondRegistration]);
    const manifest = JSON.parse(await fs.readFile(path.join(artifactsDir, 'manifest.json'), 'utf8'));
    expect(manifest.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, contentHash: first.manifest?.contentHash }),
      expect.objectContaining({ id: second.id, contentHash: second.manifest?.contentHash }),
    ]));
    expect(manifest.entries).toHaveLength(2);
  });

  it('allocates all run-derived artifacts with safe names independent of a supplied run ID', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    const maliciousRunId = '../../escaped-artifact';

    const snapshot = await artifacts.createSnapshot(maliciousRunId, 'synthetic diagnostic', 'title', 'https://example.test');
    const tracePath = await artifacts.createTracePath(maliciousRunId);
    const markdown = await artifacts.createMarkdownReport(maliciousRunId, 'report', '# first');
    const reporter = await artifacts.createReporterReport(maliciousRunId, 'reporter', '# second');

    for (const artifactPath of [snapshot.path, tracePath, markdown.path, reporter.markdown.path, reporter.html.path]) {
      expect(artifacts.isManagedArtifactPath(artifactPath)).toBe(true);
      expect(path.basename(artifactPath)).not.toContain('escaped-artifact');
    }
    await expect(fs.access(path.join(rootDir, 'escaped-artifact-reporter.md'))).rejects.toThrow();
  });

  it('keeps repeated reports for one run as distinct immutable evidence files', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    const first = await artifacts.createMarkdownReport('run-repeated', 'first', '# first report');
    const second = await artifacts.createMarkdownReport('run-repeated', 'second', '# second report');

    expect(first.path).not.toBe(second.path);
    await expect(fs.readFile(first.path, 'utf8')).resolves.toBe('# first report');
    await expect(fs.readFile(second.path, 'utf8')).resolves.toBe('# second report');
    const manifest = JSON.parse(await fs.readFile(path.join(rootDir, 'studio-data', 'artifacts', 'manifest.json'), 'utf8'));
    expect(manifest.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, path: first.manifest?.path, contentHash: first.manifest?.contentHash }),
      expect.objectContaining({ id: second.id, path: second.manifest?.path, contentHash: second.manifest?.contentHash }),
    ]));
  });

  it('rejects reserved deletion targets', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    await artifacts.ensureReady();
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const manifestPath = path.join(artifactsDir, 'manifest.json');
    const stagingPath = path.join(artifactsDir, '.manifest.json-staging.tmp');
    const tombstonePath = path.join(artifactsDir, '.tombstones', 'internal.pending');
    await fs.writeFile(manifestPath, '{"schemaVersion":1,"entries":[]}\n', 'utf8');
    await fs.writeFile(stagingPath, 'staging', 'utf8');
    await fs.mkdir(path.dirname(tombstonePath), { recursive: true });
    await fs.writeFile(tombstonePath, 'tombstone', 'utf8');

    await expect(artifacts.removeArtifact(manifestPath)).rejects.toThrow('不能清理保留的证据文件。');
    await expect(artifacts.removeArtifact(stagingPath)).rejects.toThrow('不能清理保留的证据文件。');
    await expect(artifacts.removeArtifact(tombstonePath)).rejects.toThrow('不能清理保留的证据文件。');
    await expect(fs.readFile(manifestPath, 'utf8')).resolves.toBe('{"schemaVersion":1,"entries":[]}\n');
  });

  it('restores an artifact when its manifest deletion fails and keeps the mutation queue usable', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    const artifact = await artifacts.createMarkdownReport('run-delete', 'report', '# recoverable');
    const unsafeArtifacts = artifacts as unknown as {
      writeManifest: (manifest: unknown) => Promise<void>;
    };
    const originalWriteManifest = unsafeArtifacts.writeManifest.bind(artifacts);
    let failOnce = true;
    unsafeArtifacts.writeManifest = async (manifest) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('manifest deletion failed');
      }
      await originalWriteManifest(manifest);
    };

    await expect(artifacts.removeArtifact(artifact.path)).rejects.toThrow('manifest deletion failed');
    await expect(fs.readFile(artifact.path, 'utf8')).resolves.toBe('# recoverable');
    const afterFailure = JSON.parse(await fs.readFile(path.join(rootDir, 'studio-data', 'artifacts', 'manifest.json'), 'utf8'));
    expect(afterFailure.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: artifact.id })]));

    await artifacts.removeArtifact(artifact.path);
    await expect(fs.access(artifact.path)).rejects.toThrow();
    const afterDelete = JSON.parse(await fs.readFile(path.join(rootDir, 'studio-data', 'artifacts', 'manifest.json'), 'utf8'));
    expect(afterDelete.entries).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: artifact.id })]));
  });

  it('restores a tombstoned artifact after a crash before its manifest deletion commits', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const tombstonesDir = path.join(artifactsDir, '.tombstones');
    const sourcePath = path.join(artifactsDir, 'crash-before-commit.md');
    const tombstoneId = '95f2c620-8a9f-4f5f-92a6-7f97d33b5b1d';
    const tombstonePath = path.join(tombstonesDir, `${tombstoneId}.pending`);
    const journalPath = path.join(tombstonesDir, `${tombstoneId}.pending.json`);
    const entry = {
      id: 'artifact-crash-before-commit',
      path: path.basename(sourcePath),
      contentHash: 'a'.repeat(64),
      byteCount: 9,
      createdAt: new Date(0).toISOString(),
      evidenceKind: 'report' as const,
      retentionClass: 'standard' as const,
      protectedBy: [],
    };
    await fs.mkdir(tombstonesDir, { recursive: true });
    await fs.writeFile(sourcePath, 'recover me', 'utf8');
    await fs.rename(sourcePath, tombstonePath);
    await fs.writeFile(journalPath, JSON.stringify({ schemaVersion: 1, originalPath: entry.path }), 'utf8');
    await fs.writeFile(path.join(artifactsDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, entries: [entry] }), 'utf8');

    await new ArtifactManager(rootDir).ensureReady();

    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe('recover me');
    await expect(fs.access(tombstonePath)).rejects.toThrow();
    await expect(fs.access(journalPath)).rejects.toThrow();
  });

  it('purges a tombstoned artifact after a crash once its manifest deletion committed', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const tombstonesDir = path.join(artifactsDir, '.tombstones');
    const sourcePath = path.join(artifactsDir, 'crash-after-commit.md');
    const tombstoneId = '0e9f1bc8-a6a5-4d57-9789-3a9bdc78e47f';
    const tombstonePath = path.join(tombstonesDir, `${tombstoneId}.pending`);
    const journalPath = path.join(tombstonesDir, `${tombstoneId}.pending.json`);
    await fs.mkdir(tombstonesDir, { recursive: true });
    await fs.writeFile(tombstonePath, 'purge me', 'utf8');
    await fs.writeFile(journalPath, JSON.stringify({ schemaVersion: 1, originalPath: path.basename(sourcePath) }), 'utf8');
    await fs.writeFile(path.join(artifactsDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, entries: [] }), 'utf8');

    await new ArtifactManager(rootDir).ensureReady();

    await expect(fs.access(sourcePath)).rejects.toThrow();
    await expect(fs.access(tombstonePath)).rejects.toThrow();
    await expect(fs.access(journalPath)).rejects.toThrow();
  });

  it('does not let an invalid deletion journal target files outside artifact storage', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
    const tombstonesDir = path.join(artifactsDir, '.tombstones');
    const tombstoneId = 'e2385a4c-32ed-4644-8f21-97aecbe66a1a';
    const tombstonePath = path.join(tombstonesDir, `${tombstoneId}.pending`);
    const journalPath = path.join(tombstonesDir, `${tombstoneId}.pending.json`);
    const outsidePath = path.join(rootDir, 'outside.md');
    await fs.mkdir(tombstonesDir, { recursive: true });
    await fs.writeFile(outsidePath, 'outside stays', 'utf8');
    await fs.writeFile(tombstonePath, 'must not move', 'utf8');
    await fs.writeFile(journalPath, JSON.stringify({ schemaVersion: 1, originalPath: '../../outside.md' }), 'utf8');
    await fs.writeFile(path.join(artifactsDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      entries: [{ path: '../../outside.md' }],
    }), 'utf8');

    await new ArtifactManager(rootDir).ensureReady();

    await expect(fs.readFile(outsidePath, 'utf8')).resolves.toBe('outside stays');
    await expect(fs.readFile(tombstonePath, 'utf8')).resolves.toBe('must not move');
    await expect(fs.readFile(journalPath, 'utf8')).resolves.toContain('../../outside.md');
  });

  it('persists reporter markdown and html reports under the artifacts directory', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    const report = await artifacts.createReporterReport(
      'agent-run-1',
      'Reporter 失败分析',
      '# Reporter 判断\n\n## 失败归因\n图表 <未刷新>。',
    );

    expect(report.markdown).toEqual(
      expect.objectContaining({
        type: 'report',
        label: 'Reporter 失败分析',
        path: expect.stringMatching(/artifacts\/report-.+\.md$/),
      }),
    );
    expect(report.html).toEqual(
      expect.objectContaining({
        type: 'report',
        label: 'Reporter HTML 报告',
        path: expect.stringMatching(/artifacts\/report-.+\.html$/),
      }),
    );
    await expect(fs.readFile(report.markdown.path, 'utf8')).resolves.toContain('图表 <未刷新>');
    const html = await fs.readFile(report.html.path, 'utf8');
    expect(html).toContain('<h1>Reporter 判断</h1>');
    expect(html).toContain('<h2>失败归因</h2>');
    expect(html).toContain('图表 &lt;未刷新&gt;');
  });

  it('accepts only paths inside the managed artifacts directory', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    const report = await artifacts.createMarkdownReport('agent-run-2', 'Reporter 失败分析', '# Report');

    expect(artifacts.isManagedArtifactPath(report.path)).toBe(true);
    expect(artifacts.isManagedArtifactPath(path.join(rootDir, 'studio-data', 'state.json'))).toBe(false);
    expect(artifacts.isManagedArtifactPath(path.join(rootDir, 'studio-data', 'artifacts-copy', 'report.html'))).toBe(false);
    expect(artifacts.isManagedArtifactPath('/tmp/unrelated-report.html')).toBe(false);
  });

  it('renders an escaped project management report without local artifact paths', async () => {
    const report = {
      generatedAt: '2026-08-04T00:00:00.000Z',
      projectName: '订单 <回归>',
      runStats: { running: 0, passed: 1, failed: 1, blocked: 1, skipped: 1, cancelled: 1, error: 1 },
      coverageRisk: {
        total: 6,
        verified: 0,
        risks: [
          { testCaseName: '从未 <执行>', groupName: '交易', environmentName: 'Staging', status: 'neverExecuted' as const },
          { testCaseName: '失败 <确认>', groupName: '交易', environmentName: 'Staging', status: 'failed' as const },
          { testCaseName: '错误 <确认>', groupName: '交易', environmentName: 'Staging', status: 'error' as const },
          { testCaseName: '阻断 <确认>', groupName: '交易', environmentName: 'Staging', status: 'blocked' as const },
          { testCaseName: '跳过 <确认>', groupName: '交易', environmentName: 'Staging', status: 'skipped' as const },
          { testCaseName: '取消 <确认>', groupName: '交易', environmentName: 'Staging', status: 'cancelled' as const },
        ],
      },
      prdCoverage: {
        paths: 1,
        targets: {
          case: { pending: 0, deferred: 0, ignored: 0, resolved: 1 },
          recording: { pending: 1, deferred: 0, ignored: 0, resolved: 0 },
        },
      },
      problemRuns: [{
        id: 'run-1', testCaseName: '支付 <确认>', environmentName: 'Staging', status: 'error' as const, startedAt: '2026-08-04T00:00:00.000Z', duration: '00:00:01', summary: '失败 <详情>', artifactLabels: ['报告 <HTML>'],
      }],
      nonExecutedRuns: [{
        id: 'run-2', testCaseName: '准备 <夹具>', environmentName: 'Staging', status: 'blocked' as const, startedAt: '2026-08-04T00:01:00.000Z', duration: '00:00:01', summary: '夹具尚未准备。', reason: { code: 'fixturePreflight' as const, message: '夹具 <未准备>' }, artifactLabels: ['准备 <记录>'],
      }],
    };
    const html = renderProjectRunReportHtml(report, 'zh-CN');
    const englishHtml = renderProjectRunReportHtml(report, 'en-US');

    expect(html).toContain('订单 &lt;回归&gt;');
    expect(html).toContain('支付 &lt;确认&gt;');
    expect(html).toContain('报告 &lt;HTML&gt;');
    expect(html).toContain('准备 &lt;夹具&gt;');
    expect(html).toContain('fixturePreflight · 夹具 &lt;未准备&gt;');
    expect(html).toContain('运行中');
    expect(html).toContain('通过');
    expect(html).toContain('失败');
    expect(html).toContain('阻断');
    expect(html).toContain('跳过');
    expect(html).toContain('已取消');
    expect(html).toContain('错误');
    expect(html).toContain('从未执行');
    expect(html).toContain('最近失败');
    expect(html).toContain('最近错误');
    expect(html).toContain('最近阻断');
    expect(html).toContain('最近跳过');
    expect(html).toContain('最近取消');
    expect(englishHtml).toContain('Running');
    expect(englishHtml).toContain('Passed');
    expect(englishHtml).toContain('Failed');
    expect(englishHtml).toContain('Blocked');
    expect(englishHtml).toContain('Skipped');
    expect(englishHtml).toContain('Cancelled');
    expect(englishHtml).toContain('Error');
    expect(englishHtml).toContain('Never executed');
    expect(englishHtml).toContain('Last run failed');
    expect(englishHtml).toContain('Last run errored');
    expect(englishHtml).toContain('Last run blocked');
    expect(englishHtml).toContain('Last run skipped');
    expect(englishHtml).toContain('Last run cancelled');
    expect(html).not.toContain('artifact.path');
    expect(html).not.toContain('modelApiKey');
  });

  it('allocates trace archives only inside managed artifact storage', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    const tracePath = await artifacts.createTracePath('agent/run:1');

    expect(tracePath).toMatch(
      new RegExp(`^${escapeRegExp(path.join(rootDir, 'studio-data', 'artifacts'))}.+trace-.+\\.zip$`),
    );
    expect(artifacts.isManagedArtifactPath(tracePath)).toBe(true);
  });

  it('exports a managed artifact to a user-selected destination', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    const report = await artifacts.createMarkdownReport('agent-run-3', 'Reporter 失败分析', '# Exported report');
    const destinationPath = path.join(rootDir, 'exports', 'agent-run-3-report.md');

    await artifacts.exportArtifact(report.path, destinationPath);

    await expect(fs.readFile(destinationPath, 'utf8')).resolves.toBe('# Exported report');
    await expect(artifacts.exportArtifact('/tmp/unrelated-report.md', destinationPath)).rejects.toThrow(
      '只能导出应用生成的证据文件。',
    );
  });

  it('imports a user-selected manual evidence file into managed storage', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const sourcePath = path.join(rootDir, 'selected-evidence.txt');
    await fs.writeFile(sourcePath, '订单号和付款金额已核对。', 'utf8');
    const artifacts = new ArtifactManager(rootDir);

    const attachment = await artifacts.importManualEvidence(sourcePath);

    expect(attachment).toMatchObject({
      type: 'attachment',
      label: 'selected-evidence.txt',
    });
    expect(attachment.path).toMatch(new RegExp(`^${escapeRegExp(path.join(rootDir, 'studio-data', 'artifacts'))}.+\\.txt$`));
    expect(artifacts.isManagedArtifactPath(attachment.path)).toBe(true);
    await expect(fs.readFile(attachment.path, 'utf8')).resolves.toBe('订单号和付款金额已核对。');
  });

  it('rejects directories as manual evidence', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    await expect(artifacts.importManualEvidence(rootDir)).rejects.toThrow('只能附加文件证据。');
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
