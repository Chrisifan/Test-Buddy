import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createAcceptanceAttempt,
  type AcceptanceAttempt,
  type AcceptanceMatrix,
  type AcceptanceTarget,
  type AcceptanceTerminalStatus,
} from '../../shared/acceptance.js';
import {
  createInitialStudioState,
  type FixtureScriptTrustRecord,
  type RunDetail,
  type RunSuiteIntent,
  type RunSuiteResponse,
  type StudioState,
  type VersionedTestAssetReference,
} from '../../shared/studio.js';
import { executeCliCommand } from '../cli.js';
import { ProjectAssetStore } from '../projectAssetStore.js';
import { ProjectRepository } from '../projectRepository.js';
import { nodePngImageAdapter } from './node-png-image-adapter.js';
import { createControlledChromiumBrowserPool } from './browser-pool.js';
import { createRuntimeBundle } from './runtime-bundle.js';
import type { LazyModelConfigResolver } from './model-config-resolver.js';
import type { RuntimeBundle } from './runtime-bundle.js';
import { StudioStore } from '../studioStore.js';
import type { LocalAcceptanceFixture } from './acceptance-fixtures.js';

export interface AcceptanceAdapterMember {
  testCase: VersionedTestAssetReference;
  status: AcceptanceTerminalStatus;
  /** A redacted provenance record supplied by the public adapter boundary. */
  provenance: unknown;
  /** Durable artifact-manifest content hashes, never artifact paths. */
  manifestHashes: readonly string[];
}

export interface AcceptanceAdapterRun {
  projectRevision: string;
  reproducibility: 'versioned' | 'legacy';
  suite: VersionedTestAssetReference;
  members: readonly AcceptanceAdapterMember[];
}

export interface AcceptanceAdapterRequest {
  fixture: LocalAcceptanceFixture;
  attempt: number;
}

export interface AcceptanceHarnessDependencies {
  runDesktop(request: AcceptanceAdapterRequest): Promise<AcceptanceAdapterRun>;
  runCli(request: AcceptanceAdapterRequest): Promise<AcceptanceAdapterRun>;
}

export interface LocalAcceptanceReport {
  matrix: AcceptanceMatrix;
  attempts: readonly AcceptanceAttempt[];
}

export interface PublicLocalAcceptanceOptions {
  rootDir: string;
  target: AcceptanceTarget;
  fixture: LocalAcceptanceFixture;
  repetitions: number;
  executeDesktopSuite: DesktopSuiteExecutionBoundary;
}

export interface DesktopSuiteExecutionDependencies {
  loadState: () => Promise<StudioState>;
  saveState: (state: StudioState) => Promise<void>;
  createLazyModelConfigResolver: () => LazyModelConfigResolver;
  getRuntimeBundle: () => Pick<RuntimeBundle, 'runSuite' | 'browserRuntime'>;
  projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>;
  getFixtureScriptTrustContext: (projectId: string) => Promise<{
    projectDirectory?: string;
    records: FixtureScriptTrustRecord[];
  }>;
}

export type DesktopSuiteExecutionBoundary = (
  dependencies: DesktopSuiteExecutionDependencies,
  request: RunSuiteIntent,
) => Promise<RunSuiteResponse>;

/** Compares two public adapter runs without retaining endpoints, paths, or raw run data. */
export class AcceptanceHarness {
  constructor(private readonly dependencies: AcceptanceHarnessDependencies) {}

  async runLocalFixture(request: {
    target: AcceptanceTarget;
    fixture: LocalAcceptanceFixture;
    repetitions: number;
  }): Promise<LocalAcceptanceReport> {
    if (request.target.kind !== 'localFixture' || request.repetitions !== 10) {
      throw new Error('Local acceptance requires exactly ten localFixture attempts.');
    }
    const matrix: AcceptanceMatrix = { schemaVersion: 1, targets: [request.target] };
    const attempts: AcceptanceAttempt[] = [];
    for (let attempt = 1; attempt <= request.repetitions; attempt += 1) {
      const adapterRequest = { fixture: request.fixture, attempt };
      // Starting separate browser processes together is host-sensitive; the
      // acceptance contract measures adapter equivalence, not concurrency.
      // CLI owns the externally reproducible boundary, so it always starts
      // first and releases Chromium before the desktop adapter begins.
      const cli = await this.dependencies.runCli(adapterRequest);
      const desktop = await this.dependencies.runDesktop(adapterRequest);
      validateAdapterRun('desktop', desktop, request.fixture);
      validateAdapterRun('cli', cli, request.fixture);
      const desktopByCase = membersByReference(desktop.members);
      const cliByCase = membersByReference(cli.members);
      attempts.push(createAcceptanceAttempt({
        targetId: request.target.id,
        targetKind: request.target.kind,
        targetConfigFingerprint: request.target.configFingerprint,
        suite: { id: request.fixture.suite.id, version: request.fixture.suite.version },
        projectRevision: request.fixture.revision,
        attempt,
        pairs: request.fixture.suite.caseReferences.map((testCase) => {
          const key = referenceKey(testCase);
          const desktopMember = desktopByCase.get(key);
          const cliMember = cliByCase.get(key);
          if (!desktopMember || !cliMember) {
            throw new Error(`Acceptance adapter results are missing ${key}.`);
          }
          return {
            testCase: { id: testCase.id, version: testCase.version },
            desktop: toAcceptanceChildRun(desktopMember),
            cli: toAcceptanceChildRun(cliMember),
          };
        }),
        terminalSummary: terminalSummary(desktop.members),
        retries: 0,
        flaky: false,
        humanConclusion: 'accepted',
      }));
    }
    return { matrix, attempts };
  }
}

/** Runs the repository-owned fixture through the public desktop-main and CLI boundaries. */
export async function runLocalAcceptanceWithPublicAdapters(
  options: PublicLocalAcceptanceOptions,
): Promise<LocalAcceptanceReport> {
  const harness = new AcceptanceHarness({
    runDesktop: ({ fixture, attempt }) => runDesktopAcceptanceAdapter(options.rootDir, fixture, attempt, options.executeDesktopSuite),
    runCli: ({ fixture, attempt }) => runCliAdapter(options.rootDir, fixture, attempt),
  });
  return harness.runLocalFixture(options);
}

async function runCliAdapter(rootDir: string, fixture: LocalAcceptanceFixture, attempt: number): Promise<AcceptanceAdapterRun> {
  const dataDir = await prepareAdapterDataRoot(rootDir, 'cli', fixture, attempt);
  await executeCliCommand({
    kind: 'run',
    dataDir,
    projectId: fixture.project.id,
    caseReferences: [],
    suiteReference: { id: fixture.suite.id, version: fixture.suite.version },
  });
  return adapterRunFromState(await new StudioStore(dataDir).loadExisting(), fixture);
}

export async function runDesktopAcceptanceAdapter(
  rootDir: string,
  fixture: LocalAcceptanceFixture,
  attempt: number,
  executeSuite: DesktopSuiteExecutionBoundary,
): Promise<AcceptanceAdapterRun> {
  const dataDir = await prepareAdapterDataRoot(rootDir, 'desktop', fixture, attempt);
  const store = new StudioStore(dataDir);
  const projectRepository = new ProjectRepository({ studioStore: store });
  const snapshot = await projectRepository.loadBound(fixture.project.id, fixture.revision);
  const runtime = createRuntimeBundle({
    rootDir: dataDir,
    visualDiffImageAdapter: nodePngImageAdapter,
    browserPool: createControlledChromiumBrowserPool(),
  });
  try {
    const response = await executeSuite({
      loadState: () => store.loadExisting(),
      saveState: async (state) => { await store.save(state); },
      createLazyModelConfigResolver: () => ({
        resolveMidsceneConfig: async () => {
          throw new Error('Local acceptance fixture must not resolve a model configuration.');
        },
        resolveAgentProviderConfig: async () => {
          throw new Error('Local acceptance fixture must not resolve a model configuration.');
        },
      }),
      getRuntimeBundle: () => runtime,
      projectRepository,
      getFixtureScriptTrustContext: async () => ({ records: [], projectDirectory: path.join(dataDir, 'project-assets') }),
    }, {
      runId: `acceptance-desktop-${attempt}`,
      projectId: fixture.project.id,
      expectedProjectRevision: fixture.revision,
      suite: { id: fixture.suite.id, version: fixture.suite.version },
    });
    return adapterRunFromDesktopDetails(response.detail.caseDetails, snapshot, fixture);
  } finally {
    await runtime.close();
  }
}

function adapterRunFromDesktopDetails(
  details: readonly RunDetail[],
  snapshot: { project: LocalAcceptanceFixture['project']; revision: string; reproducibility: 'versioned' | 'legacy'; source: 'projectDirectory' | 'legacyStudioStore' },
  fixture: LocalAcceptanceFixture,
): AcceptanceAdapterRun {
  if (snapshot.reproducibility !== 'versioned') {
    throw new Error('Desktop acceptance adapter must run a versioned project snapshot.');
  }
  const members = fixture.suite.caseReferences.map((reference) => {
    const detail = details.find((candidate) => candidate.testCaseId === reference.id);
    if (!detail || detail.testCaseVersion !== reference.version) {
      throw new Error(`Desktop acceptance adapter did not return ${referenceKey(reference)}.`);
    }
    return memberFromDetail(detail);
  });
  return { projectRevision: snapshot.revision, reproducibility: snapshot.reproducibility, suite: { id: fixture.suite.id, version: fixture.suite.version }, members };
}

async function prepareAdapterDataRoot(
  rootDir: string,
  adapter: 'cli' | 'desktop',
  fixture: LocalAcceptanceFixture,
  attempt: number,
): Promise<string> {
  const dataDir = path.join(rootDir, adapter, `attempt-${attempt}`);
  const projectDirectory = path.join(dataDir, 'project-assets');
  await fs.mkdir(dataDir, { recursive: true });
  const assetStore = new ProjectAssetStore(projectDirectory);
  await assetStore.saveInitial(fixture.project);
  const snapshot = await assetStore.loadWithRevision();
  if (snapshot.revision !== fixture.revision) {
    throw new Error('Acceptance fixture asset revision changed while preparing an adapter root.');
  }
  const state = createInitialStudioState();
  state.selectedProjectId = fixture.project.id;
  state.projects = [structuredClone(fixture.project)];
  state.projectAssetBindings = [{
    projectId: fixture.project.id,
    projectDirectory,
    revision: fixture.revision,
    boundAt: new Date(0).toISOString(),
  }];
  await new StudioStore(dataDir).save(state);
  return dataDir;
}

function adapterRunFromState(state: StudioState, fixture: LocalAcceptanceFixture): AcceptanceAdapterRun {
  const expectedReferences = fixture.suite.caseReferences.map(referenceKey);
  const members = expectedReferences.map((expectedReference) => {
    const detail = state.runDetails.find((candidate) => (
      candidate.provenance?.projectRevision === fixture.revision &&
      candidate.provenance.testCase && referenceKey(candidate.provenance.testCase) === expectedReference
    ));
    if (!detail) {
      throw new Error(`Acceptance adapter did not persist ${expectedReference}.`);
    }
    return memberFromDetail(detail);
  });
  return {
    projectRevision: fixture.revision,
    reproducibility: 'versioned',
    suite: { id: fixture.suite.id, version: fixture.suite.version },
    members,
  };
}

function memberFromDetail(detail: RunDetail): AcceptanceAdapterMember {
  if (!detail.provenance?.testCase) {
    throw new Error(`Acceptance adapter persisted ${detail.testCaseId} without frozen provenance.`);
  }
  if (detail.status === 'running') {
    throw new Error(`Acceptance adapter persisted ${detail.testCaseId} without a terminal status.`);
  }
  const manifestHashes = detail.artifacts.flatMap((artifact) => artifact.manifest ? [artifact.manifest.contentHash] : []);
  if (!manifestHashes.length) {
    throw new Error(`Acceptance adapter persisted ${detail.testCaseId} without manifest evidence.`);
  }
  return {
    testCase: detail.provenance.testCase,
    status: detail.status,
    provenance: detail.provenance,
    manifestHashes,
  };
}

function validateAdapterRun(adapter: string, run: AcceptanceAdapterRun, fixture: LocalAcceptanceFixture): void {
  if (run.reproducibility !== 'versioned') {
    throw new Error(`${adapter} acceptance adapter must run a versioned project snapshot.`);
  }
  if (run.projectRevision !== fixture.revision || referenceKey(run.suite) !== referenceKey(fixture.suite)) {
    throw new Error(`${adapter} acceptance adapter did not use the pinned fixture revision.`);
  }
  if (run.members.length !== fixture.suite.caseReferences.length) {
    throw new Error(`${adapter} acceptance adapter did not return all fixture members.`);
  }
  const expected = new Set(fixture.suite.caseReferences.map(referenceKey));
  const actual = new Set(run.members.map((member) => referenceKey(member.testCase)));
  if (actual.size !== expected.size || [...expected].some((reference) => !actual.has(reference))) {
    throw new Error(`${adapter} acceptance adapter returned a non-fixture member.`);
  }
}

function membersByReference(members: readonly AcceptanceAdapterMember[]): Map<string, AcceptanceAdapterMember> {
  return new Map(members.map((member) => [referenceKey(member.testCase), member]));
}

function toAcceptanceChildRun(member: AcceptanceAdapterMember) {
  return {
    status: member.status,
    provenanceHash: canonicalProvenanceHash(member.provenance),
    manifestHashes: [...member.manifestHashes].sort(),
  };
}

function terminalSummary(members: readonly AcceptanceAdapterMember[]) {
  return members.reduce(
    (summary, member) => ({ ...summary, [member.status]: summary[member.status] + 1 }),
    { passed: 0, failed: 0, blocked: 0, error: 0, cancelled: 0, skipped: 0 },
  );
}

function canonicalProvenanceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalizeProvenance(value))).digest('hex');
}

function canonicalizeProvenance(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeProvenance);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  // An inactive provider identifies no configured model. Keep only the
  // hasKey=false fact so adapter-specific defaults cannot split local pairs.
  const omitInactiveModelFields = record.hasKey === false;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !['adapter', 'attempt', 'createdAt', 'executor', 'parentRunId'].includes(key))
      .filter(([key]) => !omitInactiveModelFields || !['provider', 'model', 'endpointFingerprint'].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeProvenance(child)]),
  );
}

function referenceKey(reference: VersionedTestAssetReference): string {
  return `${reference.id}@${reference.version}`;
}
