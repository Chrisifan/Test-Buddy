import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';

import type {
  FixtureScriptTrustRecord,
  ArtifactRetentionAudit,
  ArtifactRetentionPlan,
  HistoricalRerunExecutionResult,
  HistoricalRerunPlan,
  MaintenanceDraftRejectionRequest,
  MaintenanceEvidenceOpenRequest,
  ProjectEnvironment,
  RunIntentIpcErrorResponse,
  RunDetail,
  RunProvenance,
  RunSuiteResponse,
  RunSuiteIntent,
  RunTestCaseIntent,
  RunTestCaseResponse,
  RuntimeInfo,
  SuiteAsset,
  SuiteRunRecord,
  StudioState,
  TestCaseDraft,
} from '../../shared/studio.js';
import { findSuiteAsset, findTestCaseVersion, isAgentRunnableTestCase } from '../../shared/studio.js';
import { isSafeMaintenanceRationale } from '../../shared/maintenance.js';
import { ProjectRepositoryError, type ProjectRepository, type ProjectSnapshot } from '../projectRepository.js';
import {
  createRunProvenance,
  createSuiteRunProvenance,
  resolveRerunPlan,
  type RerunPlan,
  type RunProvenanceRuntimeMetadata,
} from '../runtime/run-provenance.js';
import { isRunCancelled } from '../runtime/run-cancellation.js';
import { appendRunToStudioState, appendSuiteRunToStudioState } from '../runtime/run-history.js';
import type { LazyModelConfigResolver } from '../runtime/model-config-resolver.js';
import type { MaintenanceService } from '../runtime/maintenance-service.js';
import type { ResolvedRunSuiteRequest, ResolvedRunTestCaseRequest, RuntimeBundle } from '../runtime/runtime-bundle.js';
import channelModule from './runtime-ipc-channels.cjs';

const { runtimeIpcChannels } = channelModule;

export { runtimeIpcChannels };

type RuntimeIpcChannel = (typeof runtimeIpcChannels)[keyof typeof runtimeIpcChannels];

interface RuntimeIpcArguments {
  [runtimeIpcChannels.getInfo]: [];
  [runtimeIpcChannels.runTestCase]: [RunTestCaseIntent];
  [runtimeIpcChannels.runSuite]: [RunSuiteIntent];
  [runtimeIpcChannels.cancelRun]: [string];
  [runtimeIpcChannels.loadRunDetail]: [string];
  [runtimeIpcChannels.loadSuiteRunRecord]: [string];
  [runtimeIpcChannels.listMaintenanceDrafts]: [];
  [runtimeIpcChannels.createMaintenanceDraft]: [unknown];
  [runtimeIpcChannels.acceptMaintenanceDraft]: [unknown];
  [runtimeIpcChannels.rejectMaintenanceDraft]: [unknown];
  [runtimeIpcChannels.openMaintenanceEvidence]: [unknown];
  [runtimeIpcChannels.planArtifactRetention]: [];
  [runtimeIpcChannels.confirmArtifactRetention]: [string];
  [runtimeIpcChannels.planHistoricalRerun]: [string];
  [runtimeIpcChannels.runHistoricalRerun]: [string];
  [runtimeIpcChannels.openArtifact]: [string];
  [runtimeIpcChannels.exportArtifact]: [string];
  [runtimeIpcChannels.attachManualEvidence]: [];
}

export interface RuntimeIpcRegistrar {
  handle<Channel extends RuntimeIpcChannel>(
    channel: Channel,
    listener: (event: unknown, ...args: RuntimeIpcArguments[Channel]) => unknown,
  ): void;
}

type RuntimeIpcBundle = Pick<RuntimeBundle, 'runTestCase' | 'runSuite' | 'cancelRun'> & {
  artifactManager: Pick<RuntimeBundle['artifactManager'],
    'isManagedArtifactPath' | 'exportArtifact' | 'importManualEvidence' | 'planArtifactRetention' | 'confirmArtifactRetention'>;
  browserRuntime: Pick<RuntimeBundle['browserRuntime'], 'getState'>;
};

export interface RuntimeIpcDependencies extends RuntimeIpcRegistrar {
  loadState: () => Promise<StudioState>;
  saveState: (state: StudioState) => Promise<void>;
  createLazyModelConfigResolver: () => LazyModelConfigResolver;
  getRuntimeBundle: () => RuntimeIpcBundle;
  projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>;
  getFixtureScriptTrustContext: (projectId: string) => Promise<{
    projectDirectory?: string;
    records: FixtureScriptTrustRecord[];
  }>;
  openPath: (artifactPath: string) => Promise<string>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  getDownloadsPath: () => string;
  showOpenDialog: (event: unknown, options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  getRuntimeInfo: () => RuntimeInfo;
  maintenanceService: Pick<MaintenanceService, 'createFromRun' | 'accept' | 'reject' | 'openEvidence'>;
}

export class RunIntentResolutionError extends Error {
  constructor(
    readonly code: 'missingAssetVersion',
    message: string,
  ) {
    super(message);
    this.name = 'RunIntentResolutionError';
  }
}

/** Public desktop-main execution boundary shared by IPC and local acceptance adapters. */
export type DesktopSuiteExecutionDependencies = Pick<RuntimeIpcDependencies,
  'loadState' | 'saveState' | 'createLazyModelConfigResolver' | 'getRuntimeBundle' |
  'projectRepository' | 'getFixtureScriptTrustContext'>;

export const executeDesktopSuiteIntent = async (
  dependencies: DesktopSuiteExecutionDependencies,
  request: RunSuiteIntent,
): Promise<RunSuiteResponse> => {
  const projectSnapshot = await loadProjectSnapshot(dependencies.projectRepository, request.projectId, request.expectedProjectRevision);
  const suite = findSuiteAsset(projectSnapshot.project, request.suite);
  if (!suite) {
    throw new RunIntentResolutionError('missingAssetVersion', `未找到 Suite：${request.suite.id}@${request.suite.version}。`);
  }
  const environment = findEnvironment(projectSnapshot, suite.environmentId, `Suite ${suite.id}@${suite.version}`);
  const historyEnvironmentsById = new Map(
    projectSnapshot.project.environments.map((candidate) => [candidate.id, structuredClone(candidate)]),
  );
  const state = await dependencies.loadState();
  const parentRunId = request.runId ?? createSuiteRunId();
  const metadata = runtimeProvenanceMetadata(state, environment);
  const parentRecord = createRunningSuiteRecord(
    parentRunId,
    createSuiteRunProvenance(projectSnapshot, suite, environment, metadata, parentRunId),
  );
  await dependencies.saveState(
    appendSuiteRunToStudioState(await dependencies.loadState(), parentRecord),
  );
  let currentParentRecord = parentRecord;
  let memberProvenanceByTestCaseReference: ReadonlyMap<string, readonly RunProvenance[]> = new Map();
  let runtime: RuntimeIpcBundle | undefined;
  let result: RunSuiteResponse | undefined;
  try {
    memberProvenanceByTestCaseReference = createSuiteMemberProvenanceByTestCaseReference(
      projectSnapshot,
      suite,
      environment,
      metadata,
      parentRunId,
    );
    const scriptTrust = await dependencies.getFixtureScriptTrustContext(request.projectId);
    runtime = dependencies.getRuntimeBundle();
    const resolvedRequest: ResolvedRunSuiteRequest = {
      runId: parentRunId,
      projectSnapshot,
      suite,
      environment,
      runtimeProfile: state.runtimeProfile,
      modelConfigResolver: dependencies.createLazyModelConfigResolver(),
      browserSession: state.browserSession,
      fixtureScriptTrustRecords: scriptTrust.records,
      ...(scriptTrust.projectDirectory ? { fixtureScriptTrustDirectory: scriptTrust.projectDirectory } : {}),
      onCaseCompleted: async (detail, attempt) => {
        const historyEnvironment = historyEnvironmentsById.get(detail.environmentId);
        if (!historyEnvironment) {
          return;
        }
        const persistedChild = withCaseProvenance(
          toCaseRunResponse(detail),
          suiteCaseProvenance(memberProvenanceByTestCaseReference, detail),
        );
        currentParentRecord = appendCompletedSuiteMember(
          currentParentRecord,
          persistedChild.detail,
          attempt,
        );
        const latestState = await dependencies.loadState();
        const stateWithParent = appendSuiteRunToStudioState(latestState, currentParentRecord);
        await dependencies.saveState(
          appendRunToStudioState(
            stateWithParent,
            persistedChild,
            historyEnvironment,
            runtime!.browserRuntime.getState(),
          ),
        );
      },
    };
    result = await runtime.runSuite(resolvedRequest);
  } catch (error) {
    try {
      await dependencies.saveState(
        appendSuiteRunToStudioState(
          await dependencies.loadState(),
          terminalizeRejectedSuiteRunRecord(currentParentRecord, error),
        ),
      );
    } catch {
      // Terminal history is best-effort once execution has already failed.
    }
    throw error;
  }
  if (!result || !runtime) {
    throw new Error('Suite runtime completed without a result.');
  }
  const resultWithMemberProvenance: RunSuiteResponse = {
    ...result,
    detail: {
      ...result.detail,
      caseDetails: result.detail.caseDetails.map((detail) => withCaseProvenance(
        toCaseRunResponse(detail),
        suiteCaseProvenance(memberProvenanceByTestCaseReference, detail),
      ).detail),
    },
  };
  const completedParent = completeSuiteRunRecord(
    currentParentRecord,
    resultWithMemberProvenance,
    memberProvenanceByTestCaseReference,
    historyEnvironmentsById,
  );
  const persistedResult: RunSuiteResponse = {
    ...resultWithMemberProvenance,
    suiteRunRecord: completedParent,
  };
  const latestState = await dependencies.loadState();
  const stateWithParent = appendSuiteRunToStudioState(
    latestState,
    completedParent,
  );
  const nextState = persistedResult.detail.caseDetails.reduce((current, detail) => {
    const historyEnvironment = historyEnvironmentsById.get(detail.environmentId);
    if (!historyEnvironment) {
      return current;
    }
    return appendRunToStudioState(
      current,
      toCaseRunResponse(detail),
      historyEnvironment,
      runtime.browserRuntime.getState(),
    );
  }, stateWithParent);
  await dependencies.saveState(nextState);
  return persistedResult;
};

export const registerRuntimeIpcHandlers = (dependencies: RuntimeIpcDependencies): void => {
  dependencies.handle(runtimeIpcChannels.getInfo, async () => dependencies.getRuntimeInfo());

  dependencies.handle(runtimeIpcChannels.runTestCase, (_event, request) => serializeRunIntentError(async () => {
    const projectSnapshot = await loadProjectSnapshot(dependencies.projectRepository, request.projectId, request.expectedProjectRevision);
    const testCase = findTestCaseVersion(projectSnapshot.project, request.testCase);
    if (!testCase) {
      throw new RunIntentResolutionError('missingAssetVersion', `未找到 Case：${request.testCase.id}@${request.testCase.version}。`);
    }
    const environment = findEnvironment(projectSnapshot, testCase.environmentId, `Case ${testCase.id}@${testCase.version}`);
    const historyEnvironment = structuredClone(environment);
    const state = await dependencies.loadState();
    const modelConfigResolver = requiresModelConfiguration(testCase)
      ? dependencies.createLazyModelConfigResolver()
      : undefined;
    const provenance = createRunProvenance(
      projectSnapshot,
      testCase,
      environment,
      runtimeProvenanceMetadata(state, environment),
    );
    const scriptTrust = await dependencies.getFixtureScriptTrustContext(request.projectId);
    const runtime = dependencies.getRuntimeBundle();
    const resolvedRequest: ResolvedRunTestCaseRequest = {
      ...(request.runId ? { runId: request.runId } : {}),
      projectSnapshot,
      testCase,
      environment,
      runtimeProfile: state.runtimeProfile,
      ...(modelConfigResolver ? { modelConfigResolver } : {}),
      browserSession: state.browserSession,
      fixtureScriptTrustRecords: scriptTrust.records,
      ...(scriptTrust.projectDirectory ? { fixtureScriptTrustDirectory: scriptTrust.projectDirectory } : {}),
    };
    const result = await runtime.runTestCase(resolvedRequest);
    const latestState = await dependencies.loadState();
    const persistedResult = withCaseProvenance(result, provenance);
    await dependencies.saveState(
      appendRunToStudioState(
        latestState,
        persistedResult,
        historyEnvironment,
        runtime.browserRuntime.getState(),
      ),
    );
    return persistedResult;
  }));

  dependencies.handle(runtimeIpcChannels.runSuite, (_event, request) =>
    serializeRunIntentError(() => executeDesktopSuiteIntent(dependencies, request)));

  dependencies.handle(runtimeIpcChannels.cancelRun, async (_event, runId): Promise<boolean> => {
    if (typeof runId !== 'string' || !runId.trim()) {
      throw new Error('运行 ID 无效。');
    }
    return dependencies.getRuntimeBundle().cancelRun(runId);
  });

  dependencies.handle(runtimeIpcChannels.loadRunDetail, async (_event, runId) => {
    const state = await dependencies.loadState();
    return state.runDetails.find((run) => run.id === runId) ?? null;
  });

  dependencies.handle(runtimeIpcChannels.loadSuiteRunRecord, async (_event, runId) => {
    const state = await dependencies.loadState();
    return state.suiteRunRecords.find((record) => record.id === runId) ?? null;
  });

  dependencies.handle(runtimeIpcChannels.listMaintenanceDrafts, async () => {
    return (await dependencies.loadState()).maintenanceDrafts;
  });

  dependencies.handle(runtimeIpcChannels.createMaintenanceDraft, async (_event, request) => {
    return dependencies.maintenanceService.createFromRun(parseMaintenanceCreateRequest(request));
  });

  dependencies.handle(runtimeIpcChannels.acceptMaintenanceDraft, async (_event, request) => {
    return dependencies.maintenanceService.accept(parseMaintenanceAcceptRequest(request));
  });

  dependencies.handle(runtimeIpcChannels.rejectMaintenanceDraft, async (_event, draftId) => {
    return dependencies.maintenanceService.reject(parseMaintenanceRejectRequest(draftId));
  });

  dependencies.handle(runtimeIpcChannels.openMaintenanceEvidence, async (_event, request) => {
    const artifactPath = await dependencies.maintenanceService.openEvidence(parseMaintenanceEvidenceOpenRequest(request));
    return openManagedArtifact(dependencies, artifactPath);
  });

  dependencies.handle(runtimeIpcChannels.planArtifactRetention, async (): Promise<ArtifactRetentionPlan> => {
    return dependencies.getRuntimeBundle().artifactManager.planArtifactRetention();
  });

  dependencies.handle(runtimeIpcChannels.confirmArtifactRetention, async (_event, planId): Promise<ArtifactRetentionAudit> => {
    if (typeof planId !== 'string' || !planId.trim()) {
      throw new Error('证据保留确认请求无效。');
    }
    return dependencies.getRuntimeBundle().artifactManager.confirmArtifactRetention(planId);
  });

  dependencies.handle(runtimeIpcChannels.planHistoricalRerun, async (_event, runId): Promise<HistoricalRerunPlan> => {
    const resolved = await resolveStoredHistoricalRerun(dependencies, runId);
    return historicalRerunPlanForRenderer(runId, resolved.plan);
  });

  dependencies.handle(runtimeIpcChannels.runHistoricalRerun, async (_event, runId): Promise<HistoricalRerunExecutionResult> => {
    const resolved = await resolveStoredHistoricalRerun(dependencies, runId);
    const rendererPlan = historicalRerunPlanForRenderer(runId, resolved.plan);
    if (rendererPlan.status === 'blocked' || !resolved.run?.provenance || resolved.plan.status === 'blocked') {
      return rendererPlan as Extract<HistoricalRerunPlan, { status: 'blocked' }>;
    }

    const state = await dependencies.loadState();
    const modelConfigResolver = requiresModelConfiguration(resolved.plan.testCase)
      ? dependencies.createLazyModelConfigResolver()
      : undefined;
    const runtime = dependencies.getRuntimeBundle();
    const provenance = createRunProvenance(
      resolved.plan.snapshot,
      resolved.plan.testCase,
      resolved.plan.environment,
      runtimeProvenanceMetadata(state, resolved.plan.environment),
    );
    const scriptTrust = await dependencies.getFixtureScriptTrustContext(provenance.projectId);
    const result = await runtime.runTestCase({
      projectSnapshot: resolved.plan.snapshot,
      testCase: resolved.plan.testCase,
      environment: resolved.plan.environment,
      runtimeProfile: state.runtimeProfile,
      ...(modelConfigResolver ? { modelConfigResolver } : {}),
      browserSession: state.browserSession,
      fixtureScriptTrustRecords: scriptTrust.records,
      ...(scriptTrust.projectDirectory ? { fixtureScriptTrustDirectory: scriptTrust.projectDirectory } : {}),
    });
    const persistedResult = withCaseProvenance(result, provenance);
    await dependencies.saveState(
      appendRunToStudioState(
        await dependencies.loadState(),
        persistedResult,
        structuredClone(resolved.plan.environment),
        runtime.browserRuntime.getState(),
      ),
    );
    return { status: 'completed', response: persistedResult };
  });

  dependencies.handle(runtimeIpcChannels.openArtifact, async (_event, artifactPath) => {
    return openManagedArtifact(dependencies, artifactPath);
  });

  dependencies.handle(runtimeIpcChannels.exportArtifact, async (_event, artifactPath): Promise<boolean> => {
    const runtime = dependencies.getRuntimeBundle();
    if (typeof artifactPath !== 'string' || !runtime.artifactManager.isManagedArtifactPath(artifactPath)) {
      throw new Error('只能导出应用生成的证据文件。');
    }
    const result = await dependencies.showSaveDialog({
      defaultPath: path.join(dependencies.getDownloadsPath(), path.basename(artifactPath)),
      title: '导出测试报告',
    });
    if (result.canceled || !result.filePath) {
      return false;
    }
    await runtime.artifactManager.exportArtifact(artifactPath, result.filePath);
    return true;
  });

  dependencies.handle(runtimeIpcChannels.attachManualEvidence, async (event) => {
    const result = await dependencies.showOpenDialog(event, {
      title: '附加人工检查证据',
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return dependencies.getRuntimeBundle().artifactManager.importManualEvidence(result.filePaths[0]);
  });
};

const parseMaintenanceCreateRequest = (value: unknown): {
  runId: string;
  target: { kind: 'case'; id: string; version: number };
  proposedCase: TestCaseDraft;
  citations: Array<{ artifactId: string; contentHash: string }>;
} => {
  if (!isRecord(value) || !hasExactKeys(value, ['runId', 'target', 'proposedCase', 'citations']) || containsForbiddenMaintenanceData(value)) {
    throw new Error('Maintenance request is invalid.');
  }
  const target = value.target;
  const citations = value.citations;
  if (
    typeof value.runId !== 'string' || !value.runId.trim() ||
    !isRecord(target) || !hasExactKeys(target, ['kind', 'id', 'version']) ||
    target.kind !== 'case' || typeof target.id !== 'string' || !target.id.trim() ||
    typeof target.version !== 'number' || !Number.isInteger(target.version) || target.version < 1 ||
    !isRecord(value.proposedCase) || !Array.isArray(citations) ||
    !citations.every((citation) => (
      isRecord(citation) && hasExactKeys(citation, ['artifactId', 'contentHash']) &&
      typeof citation.artifactId === 'string' && citation.artifactId.trim() &&
      typeof citation.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(citation.contentHash)
    ))
  ) {
    throw new Error('Maintenance request is invalid.');
  }
  return {
    runId: value.runId,
    target: { kind: 'case', id: target.id, version: target.version },
    proposedCase: structuredClone(value.proposedCase) as unknown as TestCaseDraft,
    citations: citations.map((citation) => ({ artifactId: citation.artifactId as string, contentHash: citation.contentHash as string })),
  };
};

const parseMaintenanceAcceptRequest = (value: unknown): { draftId: string; expectedRevision: string } => {
  if (
    !isRecord(value) || !hasExactKeys(value, ['draftId', 'expectedRevision']) ||
    typeof value.draftId !== 'string' || !value.draftId.trim() ||
    typeof value.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/i.test(value.expectedRevision)
  ) {
    throw new Error('Maintenance request is invalid.');
  }
  return { draftId: value.draftId, expectedRevision: value.expectedRevision };
};

const parseMaintenanceRejectRequest = (value: unknown): MaintenanceDraftRejectionRequest => {
  if (
    !isRecord(value) || !hasExactKeys(value, ['draftId', 'rationale']) || containsForbiddenMaintenanceData(value) ||
    typeof value.draftId !== 'string' || !value.draftId.trim() || !isSafeMaintenanceRationale(value.rationale)
  ) {
    throw new Error('Maintenance request is invalid.');
  }
  return { draftId: value.draftId, rationale: value.rationale.trim() };
};

const parseMaintenanceEvidenceOpenRequest = (value: unknown): MaintenanceEvidenceOpenRequest => {
  if (!isRecord(value) || !hasExactKeys(value, ['draftId', 'citation']) || containsForbiddenMaintenanceData(value)) {
    throw new Error('Maintenance request is invalid.');
  }
  const citation = value.citation;
  if (
    typeof value.draftId !== 'string' || !value.draftId.trim() ||
    !isRecord(citation) || !hasExactKeys(citation, ['runId', 'artifactId', 'contentHash']) ||
    typeof citation.runId !== 'string' || !citation.runId.trim() ||
    typeof citation.artifactId !== 'string' || !citation.artifactId.trim() ||
    typeof citation.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(citation.contentHash)
  ) {
    throw new Error('Maintenance request is invalid.');
  }
  return {
    draftId: value.draftId,
    citation: {
      runId: citation.runId,
      artifactId: citation.artifactId,
      contentHash: citation.contentHash,
    },
  };
};

const openManagedArtifact = async (
  dependencies: Pick<RuntimeIpcDependencies, 'getRuntimeBundle' | 'openPath'>,
  artifactPath: unknown,
): Promise<void> => {
  const runtime = dependencies.getRuntimeBundle();
  if (typeof artifactPath !== 'string' || !runtime.artifactManager.isManagedArtifactPath(artifactPath)) {
    throw new Error('只能打开应用生成的证据文件。');
  }
  const error = await dependencies.openPath(artifactPath);
  if (error) {
    throw new Error(`打开证据文件失败：${error}`);
  }
};

const containsForbiddenMaintenanceData = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenMaintenanceData);
  }
  if (!isRecord(value)) {
    return false;
  }
  const forbidden = new Set([
    'artifactPath',
    'artifactContent',
    'path',
    'project',
    'projectSnapshot',
    'modelConfig',
    'midsceneConfig',
    'agentModelConfig',
    'apiKey',
    'modelApiKey',
  ]);
  return Object.entries(value).some(([key, child]) => forbidden.has(key) || containsForbiddenMaintenanceData(child));
};

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const serializeRunIntentError = async <T>(operation: () => Promise<T>): Promise<T | RunIntentIpcErrorResponse> => {
  try {
    return await operation();
  } catch (error) {
    if (!isRunIntentError(error)) {
      throw error;
    }
    return {
      type: 'testBuddy.runtimeError',
      code: error.code,
      message: error.message,
    };
  }
};

const isRunIntentError = (
  error: unknown,
): error is Error & { code: RunIntentIpcErrorResponse['code'] } => {
  return error instanceof Error &&
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'staleProjectRevision' ||
      error.code === 'projectRevisionChanged' ||
      error.code === 'missingAssetVersion');
};

const loadProjectSnapshot = async (
  projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>,
  projectId: string,
  expectedProjectRevision?: string,
): Promise<ProjectSnapshot> => {
  try {
    return await projectRepository.loadBound(projectId, expectedProjectRevision);
  } catch (error) {
    if (isProjectUnboundError(error)) {
      if (expectedProjectRevision !== undefined) {
        throw new ProjectRepositoryError(
          'projectRevisionChanged',
          `项目 ${projectId} 的资产绑定已变化。`,
        );
      }
      return projectRepository.load(projectId);
    }
    throw error;
  }
};

const isProjectUnboundError = (error: unknown): error is { code: 'projectUnbound' } => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'projectUnbound';
};

const findEnvironment = (
  projectSnapshot: ProjectSnapshot,
  environmentId: string,
  assetLabel: string,
): ProjectEnvironment => {
  const environment = projectSnapshot.project.environments.find((candidate) => candidate.id === environmentId);
  if (!environment) {
    throw new RunIntentResolutionError('missingAssetVersion', `${assetLabel} 引用了不存在的环境：${environmentId}。`);
  }
  return environment;
};

const toCaseRunResponse = (detail: RunDetail): RunTestCaseResponse => {
  return {
    runId: detail.id,
    title: detail.title,
    detail,
  };
};

const resolveStoredHistoricalRerun = async (
  dependencies: Pick<RuntimeIpcDependencies, 'loadState' | 'projectRepository'>,
  runId: string,
): Promise<{ run?: RunDetail; plan: RerunPlan }> => {
  const state = await dependencies.loadState();
  const run = state.runDetails.find((candidate) => candidate.id === runId);
  if (!run?.provenance) {
    return {
      ...(run ? { run } : {}),
      plan: {
        status: 'blocked',
        reason: {
          code: 'legacyAmbiguousNeutral',
          message: run
            ? 'Historical rerun is unavailable because this record has no frozen provenance.'
            : 'Historical rerun is unavailable because the recorded run no longer exists.',
        },
        missingReferences: [],
      },
    };
  }
  return {
    run,
    plan: await resolveRerunPlan(dependencies.projectRepository, run.provenance),
  };
};

const historicalRerunPlanForRenderer = (runId: string, plan: RerunPlan): HistoricalRerunPlan => {
  if (plan.status === 'blocked') {
    return {
      status: 'blocked',
      runId,
      reason: structuredClone(plan.reason),
      missingReferences: plan.missingReferences.map((reference) => ({ ...reference })),
    };
  }
  return { status: 'ready', runId };
};

const runtimeProvenanceMetadata = (
  state: StudioState,
  environment: ProjectEnvironment,
): RunProvenanceRuntimeMetadata => {
  return {
    browserProfile: {
      engine: environment.browser,
      headless: environment.headless,
    },
    // RuntimeInfo has no version contract yet. These fixed local labels keep
    // provenance stable without broadening IPC or exposing package metadata.
    executor: {
      appVersion: 'test-buddy-desktop',
      runnerVersion: 'runtime-bundle-v1',
    },
    model: {
      provider: 'midscene',
      name: state.midsceneConfig.modelName,
      endpoint: state.midsceneConfig.modelBaseUrl,
      hasKey: state.midsceneConfig.modelSecret.hasKey,
    },
    createdAt: new Date().toISOString(),
  };
};

const withCaseProvenance = (
  response: RunTestCaseResponse,
  provenance: RunProvenance,
): RunTestCaseResponse => {
  return {
    ...response,
    detail: {
      ...response.detail,
      provenance: deepFreeze(structuredClone(provenance)),
    },
  };
};

const createSuiteMemberProvenanceByTestCaseReference = (
  snapshot: ProjectSnapshot,
  suite: SuiteAsset,
  environment: ProjectEnvironment,
  metadata: RunProvenanceRuntimeMetadata,
  parentRunId: string,
): ReadonlyMap<string, readonly RunProvenance[]> => {
  const members = new Map<string, RunProvenance[]>();
  suite.caseReferences.forEach((reference) => {
    const testCase = findTestCaseVersion(snapshot.project, reference);
    if (!testCase) {
      return;
    }
    const provenance = deepFreeze({
      ...createRunProvenance(snapshot, testCase, environment, metadata),
      suite: {
        reference: { id: suite.id, version: suite.version },
        parentRunId,
      },
    });
    const key = versionedTestCaseKey(testCase.id, reference.version);
    members.set(key, [...(members.get(key) ?? []), provenance]);
  });
  return members;
};

const suiteCaseProvenance = (
  memberProvenanceByTestCaseReference: ReadonlyMap<string, readonly RunProvenance[]>,
  detail: Pick<RunDetail, 'testCaseId' | 'testCaseVersion'>,
): RunProvenance => {
  const version = detail.testCaseVersion;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new Error(`Suite Case provenance is missing an exact version for ${detail.testCaseId}.`);
  }
  const matches = memberProvenanceByTestCaseReference.get(versionedTestCaseKey(detail.testCaseId, version)) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Suite Case provenance is unavailable or ambiguous for ${detail.testCaseId}.`);
  }
  return matches[0]!;
};

const versionedTestCaseKey = (id: string, version: number): string => {
  return JSON.stringify([id, version]);
};

const createRunningSuiteRecord = (
  id: string,
  provenance: SuiteRunRecord['provenance'],
): SuiteRunRecord => {
  return {
    id,
    provenance: deepFreeze(structuredClone(provenance)),
    startedAt: provenance.createdAt,
    status: 'running',
    memberRunIds: [],
    members: [],
    summary: emptySuiteSummary(),
  };
};

const completeSuiteRunRecord = (
  record: SuiteRunRecord,
  result: RunSuiteResponse,
  memberProvenanceByTestCaseReference: ReadonlyMap<string, readonly RunProvenance[]>,
  historyEnvironmentsById: ReadonlyMap<string, ProjectEnvironment>,
): SuiteRunRecord => {
  const suite = result.detail.suite;
  const persistedChildIds = new Set(
    result.detail.caseDetails
      .filter((detail) => historyEnvironmentsById.has(detail.environmentId))
      .map((detail) => detail.id),
  );
  return {
    ...record,
    startedAt: suite.startedAt,
    finishedAt: suite.endedAt,
    status: suite.status,
    ...(suite.reason ? { reasonCode: suite.reason.code } : {}),
    memberRunIds: [...persistedChildIds],
    members: suite.results.map((member) => ({
      testCaseId: member.testCaseId,
      testCaseVersion: member.testCaseVersion,
      status: member.status,
      summary: member.summary,
      ...(member.reason ? { reason: structuredClone(member.reason) } : {}),
      attempts: member.attempts,
      flaky: member.flaky,
      ...(member.runId && persistedChildIds.has(member.runId) ? { runId: member.runId } : {}),
      provenance: suiteCaseProvenance(memberProvenanceByTestCaseReference, member),
    })),
    summary: suite.results.reduce((summary, member) => ({
      ...summary,
      [member.status]: summary[member.status] + 1,
    }), emptySuiteSummary()),
  };
};

const appendCompletedSuiteMember = (
  record: SuiteRunRecord,
  detail: RunDetail,
  attempt: number,
): SuiteRunRecord => {
  const members = record.members ?? [];
  const existing = members.find((member) =>
    member.testCaseId === detail.testCaseId && member.testCaseVersion === detail.testCaseVersion,
  );
  const status = detail.status === 'running' ? 'error' : detail.status;
  const member = {
    testCaseId: detail.testCaseId,
    testCaseVersion: detail.testCaseVersion!,
    status,
    summary: detail.summary,
    ...(detail.reason ? { reason: structuredClone(detail.reason) } : {}),
    attempts: Math.max(attempt, existing?.attempts ?? 0),
    flaky: Boolean(existing?.flaky || (existing?.status === 'failed' && status === 'passed')),
    runId: detail.id,
    provenance: detail.provenance!,
  };
  const nextMembers = [member, ...members.filter((candidate) => candidate !== existing)];
  return {
    ...record,
    memberRunIds: [detail.id, ...record.memberRunIds.filter((id) => id !== detail.id)],
    members: nextMembers,
    summary: nextMembers.reduce((summary, candidate) => ({
      ...summary,
      [candidate.status]: summary[candidate.status] + 1,
    }), emptySuiteSummary()),
  };
};

const terminalizeRejectedSuiteRunRecord = (
  record: SuiteRunRecord,
  error: unknown,
): SuiteRunRecord => {
  const cancelled = isRunCancelled(error);
  return {
    ...record,
    status: cancelled ? 'cancelled' : 'error',
    reasonCode: cancelled ? 'userCancelled' : 'executorError',
    finishedAt: new Date().toISOString(),
  };
};

const emptySuiteSummary = (): SuiteRunRecord['summary'] => {
  return {
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    error: 0,
  };
};

const createSuiteRunId = (): string => {
  return `suite-run-${randomUUID()}`;
};

const requiresModelConfiguration = (testCase: TestCaseDraft): boolean => {
  return isAgentRunnableTestCase(testCase) || testCase.steps.some((step) =>
    (step.type === 'ai' || step.type === 'aiAssert' || step.type === 'aiQuery') &&
    !((step.type === 'ai' || step.type === 'aiAssert') && step.execution?.reviewStatus === 'confirmed'),
  );
};

const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
};

export type { RuntimeIpcChannel };
