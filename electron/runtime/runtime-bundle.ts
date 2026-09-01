import path from 'node:path';

import type {
  BrowserSessionState,
  FixtureScriptTrustRecord,
  ProjectDraft,
  ProjectEnvironment,
  RecordingCapturedEvent,
  RunEventPayload,
  RunDetail,
  RunReason,
  RunRecordingRequest,
  RunRecordingResponse,
  RunSuiteResponse,
  RunTestCaseResponse,
  RunWorkflowResponse,
  RuntimeProfile,
  SuiteAsset,
  TestCaseDraft,
  StudioState,
} from '../../shared/studio.js';
import {
  getExclusiveRecordingReplayId,
  getTestCasePrdPath,
  isAgentRunnableTestCase,
  testCaseToWorkflow,
} from '../../shared/studio.js';
import type { ProjectSnapshot } from '../projectRepository.js';
import { OpenAICompatibleAgentPlanner } from './agent-planner.js';
import { OpenAICompatibleAgentReporter } from './agent-reporter.js';
import { OpenAICompatibleAgentVerifier } from './agent-verifier.js';
import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime, type BrowserStorageStateResolver } from './browser-runtime.js';
import type { BrowserPool, BrowserPoolLease } from './browser-pool.js';
import { RecordingRunner } from './recording-runner.js';
import { MidsceneSemanticActionRuntime } from './semantic-action-runtime.js';
import { TestRunner } from './test-runner.js';
import { FixtureHttpExecutor } from './fixture-http-executor.js';
import { FixtureScriptExecutor } from './fixture-script-executor.js';
import { DefaultFixtureLifecycleExecutor } from './default-fixture-lifecycle-executor.js';
import { SuiteRunner } from './suite-runner.js';
import { PixelVisualDiffService, type VisualDiffImageAdapter } from './visual-diff.js';
import { StudioRuntime, type DeterministicInputBindingResolver } from '../studioRuntime.js';
import { createStubAgentRun } from '../../shared/agentStub.js';
import { isRunCancelled } from './run-cancellation.js';
import { createSecretRedactor, type SecretRedactor } from './secret-redactor.js';
import type { DeterministicInteractionPreflightPolicyProvider } from './deterministic-step-contract.js';
import type {
  ResolvedAgentModelConfig,
  ResolvedMidsceneConfig,
  ResolvedModelConfigs,
  ResolvedRunWorkflowRequest,
  LazyModelConfigResolver,
} from './model-config-resolver.js';

export interface RuntimeBundle {
  artifactManager: ArtifactManager;
  browserRuntime: BrowserRuntime;
  /** Worker-only pool used only by eligible versioned Suite runs. */
  browserPool?: BrowserPool;
  recordingRunner: RecordingRunner;
  studioRuntime: StudioRuntime;
  testRunner: TestRunner;
  ensureReady: () => Promise<void>;
  runTestCase: (request: ResolvedRunTestCaseRequest) => Promise<RunTestCaseResponse>;
  runSuite: (request: ResolvedRunSuiteRequest) => Promise<RunSuiteResponse>;
  runRecording: (request: RunRecordingRequest) => Promise<RunRecordingResponse>;
  runWorkflow: (request: ResolvedRunWorkflowRequest) => Promise<RunWorkflowResponse>;
  cancelRun: (runId: string) => boolean;
  close: () => Promise<void>;
}

/** Main-process-only Case execution input assembled from authoritative assets. */
export interface ResolvedRunTestCaseRequest {
  runId?: string;
  cancellationSignal?: AbortSignal;
  fixtureScriptTrustRecords?: FixtureScriptTrustRecord[];
  fixtureScriptTrustDirectory?: string;
  projectSnapshot: ProjectSnapshot;
  testCase: TestCaseDraft;
  environment: ProjectEnvironment;
  runtimeProfile?: RuntimeProfile;
  midsceneConfig?: ResolvedMidsceneConfig;
  agentModelConfig?: ResolvedAgentModelConfig;
  /** Private lazy secret resolver supplied by Electron main or the CLI. */
  modelConfigResolver?: LazyModelConfigResolver;
  resolveModelConfigs?: () => Promise<ResolvedModelConfigs>;
  browserSession?: BrowserSessionState;
  /** Internal Suite worker lease; never populated from renderer IPC. */
  workerLease?: BrowserPoolLease;
}

/** Main-process-only Suite execution input assembled from authoritative assets. */
export interface ResolvedRunSuiteRequest {
  runId?: string;
  cancellationSignal?: AbortSignal;
  fixtureScriptTrustRecords?: FixtureScriptTrustRecord[];
  fixtureScriptTrustDirectory?: string;
  projectSnapshot: ProjectSnapshot;
  suite: SuiteAsset;
  environment: ProjectEnvironment;
  runtimeProfile?: RuntimeProfile;
  midsceneConfig?: ResolvedMidsceneConfig;
  agentModelConfig?: ResolvedAgentModelConfig;
  /** Private lazy secret resolver supplied by Electron main or the CLI. */
  modelConfigResolver?: LazyModelConfigResolver;
  resolveModelConfigs?: () => Promise<ResolvedModelConfigs>;
  browserSession?: BrowserSessionState;
  /** Main-process progress hook invoked after each terminal Case detail is finalized. */
  onCaseCompleted?: (detail: RunDetail, attempt: number) => void | Promise<void>;
}

export interface RuntimeBundleOptions {
  rootDir: string;
  visualDiffImageAdapter: VisualDiffImageAdapter;
  storageStateResolver?: BrowserStorageStateResolver;
  /** Injected worker-only pool; it is never BrowserRuntime's interactive session. */
  browserPool?: BrowserPool;
  emitRunEvent?: (event: RunEventPayload) => void;
  emitRecordingEvent?: (event: RecordingCapturedEvent) => void;
  deterministicInputBindingResolver?: DeterministicInputBindingResolver;
  /** Main-process-only approvals and resolved values for deterministic interaction preflight. */
  deterministicInteractionPreflightPolicy?: DeterministicInteractionPreflightPolicyProvider;
  /** Main-process persisted state used to protect retained evidence references. */
  loadStudioState?: () => Promise<StudioState>;
}

const createManagedInteractionPreflightPolicy = (
  artifactManager: ArtifactManager,
  policy: DeterministicInteractionPreflightPolicyProvider | undefined,
): DeterministicInteractionPreflightPolicyProvider | undefined => {
  if (!policy) {
    return undefined;
  }
  return {
    resolve: (request) => policy.resolve(request),
    resolveUpload: async (request) => {
      if (policy.resolveUpload) {
        return policy.resolveUpload(request);
      }
      if (request.reference.kind !== 'attachment') {
        throw new Error('Only managed attachment references may be resolved for upload.');
      }
      const entry = await artifactManager.findManifestEntry(request.reference.id);
      if (!entry || entry.evidenceKind !== 'attachment') {
        throw new Error('The approved upload attachment is unavailable.');
      }
      const artifactPath = await artifactManager.resolveManifestEntryPath(entry);
      if (!artifactPath) {
        throw new Error('The approved upload attachment is unavailable.');
      }
      return { path: artifactPath, byteCount: entry.byteCount };
    },
  };
};

export const createRuntimeBundle = (options: RuntimeBundleOptions): RuntimeBundle => {
  const emitRunEvent = options.emitRunEvent ?? (() => undefined);
  const browserPool = options.browserPool;
  const artifactManager = new ArtifactManager(options.rootDir, {
    loadStudioState: options.loadStudioState,
  });
  const interactionPreflightPolicy = createManagedInteractionPreflightPolicy(
    artifactManager,
    options.deterministicInteractionPreflightPolicy,
  );
  const browserRuntime = new BrowserRuntime(
    options.rootDir,
    artifactManager,
    options.emitRecordingEvent,
    options.storageStateResolver,
  );
  const semanticActionRuntime = new MidsceneSemanticActionRuntime(browserRuntime, undefined, {
    reportDirectory: path.join(options.rootDir, 'studio-data', 'artifacts'),
  });
  const studioRuntime = new StudioRuntime(
    emitRunEvent,
    browserRuntime,
    semanticActionRuntime,
    new OpenAICompatibleAgentPlanner(),
    new OpenAICompatibleAgentVerifier(),
    new OpenAICompatibleAgentReporter(),
    {
      writeReporterReport: async ({ runId, markdown }) => {
        const reportArtifacts = await artifactManager.createReporterReport(
          runId,
          'Reporter 失败分析',
          markdown,
        );
        return {
          markdownPath: reportArtifacts.markdown.path,
          htmlPath: reportArtifacts.html.path,
        };
      },
    },
    options.deterministicInputBindingResolver,
  );
  const recordingRunner = new RecordingRunner(
    browserRuntime,
    emitRunEvent,
    new PixelVisualDiffService(options.visualDiffImageAdapter),
  );
  const testRunner = new TestRunner(
    artifactManager,
    browserRuntime,
    emitRunEvent,
    recordingRunner,
    studioRuntime,
    studioRuntime,
    new DefaultFixtureLifecycleExecutor(
      new FixtureHttpExecutor(),
      new FixtureScriptExecutor(),
    ),
    interactionPreflightPolicy,
  );
  const activeRuns = new Map<string, AbortController>();

  const createSuiteWorkerRuntime = (workerLease: BrowserPoolLease) => {
    const workerBrowserRuntime = browserRuntime.createWorker(workerLease);
    const workerSemanticActionRuntime = new MidsceneSemanticActionRuntime(workerBrowserRuntime, undefined, {
      reportDirectory: path.join(options.rootDir, 'studio-data', 'artifacts'),
    });
    const workerStudioRuntime = new StudioRuntime(
      emitRunEvent,
      workerBrowserRuntime,
      workerSemanticActionRuntime,
      new OpenAICompatibleAgentPlanner(),
      new OpenAICompatibleAgentVerifier(),
      new OpenAICompatibleAgentReporter(),
      {
        writeReporterReport: async ({ runId, markdown }) => {
          const reportArtifacts = await artifactManager.createReporterReport(
            runId,
            'Reporter 失败分析',
            markdown,
          );
          return {
            markdownPath: reportArtifacts.markdown.path,
            htmlPath: reportArtifacts.html.path,
          };
        },
      },
      options.deterministicInputBindingResolver,
    );
    const workerRecordingRunner = new RecordingRunner(
      workerBrowserRuntime,
      emitRunEvent,
      new PixelVisualDiffService(options.visualDiffImageAdapter),
    );
    return {
      browserRuntime: workerBrowserRuntime,
      recordingRunner: workerRecordingRunner,
      studioRuntime: workerStudioRuntime,
      testRunner: new TestRunner(
        artifactManager,
        workerBrowserRuntime,
        emitRunEvent,
        workerRecordingRunner,
        workerStudioRuntime,
        workerStudioRuntime,
        new DefaultFixtureLifecycleExecutor(
          new FixtureHttpExecutor(),
          new FixtureScriptExecutor(),
        ),
        interactionPreflightPolicy,
      ),
    };
  };

  const withActiveRun = async <T>(
    runId: string,
    execute: (cancellationSignal: AbortSignal) => Promise<T>,
    externalCancellationSignal?: AbortSignal,
  ): Promise<T> => {
    if (activeRuns.has(runId)) {
      throw new Error(`运行 ${runId} 已在执行中。`);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (externalCancellationSignal?.aborted) {
      controller.abort();
    } else {
      externalCancellationSignal?.addEventListener('abort', abort, { once: true });
    }
    activeRuns.set(runId, controller);
    try {
      return await execute(controller.signal);
    } finally {
      externalCancellationSignal?.removeEventListener('abort', abort);
      activeRuns.delete(runId);
    }
  };

  const executeTestCase = async (
    request: ResolvedRunTestCaseRequest,
    runId: string,
    cancellationSignal: AbortSignal,
    workerLease?: BrowserPoolLease,
  ): Promise<RunTestCaseResponse> => {
    const workerRuntime = workerLease ? createSuiteWorkerRuntime(workerLease) : undefined;
    const activeTestRunner = workerRuntime?.testRunner ?? testRunner;
    const activeRecordingRunner = workerRuntime?.recordingRunner ?? recordingRunner;
    const activeStudioRuntime = workerRuntime?.studioRuntime ?? studioRuntime;
    const browserSession = workerLease ? undefined : request.browserSession;
    try {
    const project = request.projectSnapshot.project;
    const modelConfigs = isAgentRunnableTestCase(request.testCase) && !request.modelConfigResolver
      ? await resolveModelConfigs(request)
      : undefined;
    const recordingId = getExclusiveRecordingReplayId(request.testCase);
    const documentId = getTestCasePrdPath(request.testCase)?.documentId;
    const recording = recordingId
      ? project.recordings.find((item) => item.id === recordingId)
      : undefined;

    if (request.testCase.assetReferences?.fixtures.length || request.testCase.assetReferences?.reusableFlows.length) {
      return await activeTestRunner.run({
        runId,
        cancellationSignal,
        project,
        testCase: request.testCase,
        environment: request.environment,
        ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
        ...(modelConfigs?.midsceneConfig ? { midsceneConfig: modelConfigs.midsceneConfig } : {}),
        ...(modelConfigs?.agentModelConfig ? { agentModelConfig: modelConfigs.agentModelConfig } : {}),
        ...(request.modelConfigResolver ? { modelConfigResolver: request.modelConfigResolver } : {}),
        ...(browserSession ? { browserSession } : {}),
        ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
        ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
      });
    }

    if (recording) {
      return await activeRecordingRunner.run({
        ...request,
        runId,
        cancellationSignal,
        project,
        environment: request.environment,
        ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
        ...(modelConfigs?.midsceneConfig ? { midsceneConfig: modelConfigs.midsceneConfig } : {}),
        ...(modelConfigs?.agentModelConfig ? { agentModelConfig: modelConfigs.agentModelConfig } : {}),
        ...(request.modelConfigResolver ? { modelConfigResolver: request.modelConfigResolver } : {}),
        ...(browserSession ? { browserSession } : {}),
        ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
        ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
        recording,
        testCaseId: request.testCase.id,
        ...(documentId ? { documentId } : {}),
      });
    }

    if (isAgentRunnableTestCase(request.testCase)) {
      return await activeStudioRuntime.runWorkflow({
        runId,
        cancellationSignal,
        workflow: testCaseToWorkflow(request.testCase),
        targetEnvironment: request.environment.name,
        runtimeProfile: resolveRuntimeProfile(request.runtimeProfile, request.environment),
        ...(modelConfigs?.midsceneConfig ? { midsceneConfig: modelConfigs.midsceneConfig } : {}),
        ...(modelConfigs?.agentModelConfig ? { agentModelConfig: modelConfigs.agentModelConfig } : {}),
        ...(request.modelConfigResolver ? { modelConfigResolver: request.modelConfigResolver } : {}),
        ...(browserSession ? { browserSession } : {}),
        project,
        environment: request.environment,
        ...(documentId ? { documentId } : {}),
      });
    }

    return await activeTestRunner.run({
      runId,
      cancellationSignal,
      project,
      testCase: request.testCase,
      environment: request.environment,
      ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
      ...(modelConfigs?.midsceneConfig ? { midsceneConfig: modelConfigs.midsceneConfig } : {}),
      ...(modelConfigs?.agentModelConfig ? { agentModelConfig: modelConfigs.agentModelConfig } : {}),
      ...(request.modelConfigResolver ? { modelConfigResolver: request.modelConfigResolver } : {}),
      ...(browserSession ? { browserSession } : {}),
      ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
      ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
    });
    } finally {
      await workerRuntime?.browserRuntime.close();
    }
  };

  const executorErrorDetail = (
    runId: string,
    projectId: string,
    testCaseId: string,
    environment: Pick<ProjectEnvironment, 'id' | 'name'>,
    title: string,
    error: unknown,
    redactor: SecretRedactor,
  ): RunDetail => {
    const message = executorErrorMessage(error, redactor);
    const now = new Date().toISOString();
    const reason: RunReason = { code: 'executorError', message };
    const detail: RunDetail = {
      id: runId,
      projectId,
      testCaseId,
      environmentId: environment.id,
      title,
      status: 'error',
      startedAt: now,
      endedAt: now,
      duration: '00:00:00',
      summary: message,
      reason,
      logs: [message],
      steps: [{
        id: `${runId}-executor-error`,
        stepId: testCaseId,
        title,
        status: 'error',
        message,
      }],
      artifacts: [],
    };
    emitRunEvent(redactor.redactValue({ runId, title, type: 'complete', status: detail.status, duration: detail.duration, summary: detail.summary, detail }));
    return detail;
  };

  const executorErrorAgentRun = (
    runId: string,
    projectId: string,
    testCaseId: string,
    environment: Pick<ProjectEnvironment, 'id' | 'name'>,
    title: string,
    error: unknown,
    redactor: SecretRedactor,
  ) => {
    const message = executorErrorMessage(error, redactor);
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: title,
      runtimeDescription: 'RuntimeBundle executor boundary',
      targetEnvironment: environment.name,
      projectId,
      environmentId: environment.id,
      testCaseId,
      verificationStatus: 'failed',
      verificationSummary: message,
      verificationFailureReason: message,
    });
    return { agentRun, detail: executorErrorDetail(runId, projectId, testCaseId, environment, title, error, redactor) };
  };

  return {
    artifactManager,
    browserRuntime,
    ...(browserPool ? { browserPool } : {}),
    recordingRunner,
    studioRuntime,
    testRunner,
    ensureReady: () => artifactManager.ensureReady(),
    runTestCase: async (request) => {
      const runId = request.runId ?? `run-${Date.now()}`;
      const redactor = createSecretRedactor(request.midsceneConfig, request.agentModelConfig);
      try {
        return await withActiveRun(runId, (cancellationSignal) => executeTestCase(
          request,
          runId,
          cancellationSignal,
          request.workerLease,
        ));
      } catch (error) {
        if (isRunCancelled(error)) {
          throw error;
        }
        return {
          runId,
          title: request.testCase.name,
          detail: executorErrorDetail(
            runId,
            request.projectSnapshot.project.id,
            request.testCase.id,
            request.environment,
            request.testCase.name,
            error,
            redactor,
          ),
        };
      }
    },
    runSuite: async (request) => {
      const runId = request.runId ?? `suite-run-${Date.now()}`;
      const redactor = createSecretRedactor(request.midsceneConfig, request.agentModelConfig);
      try {
        return await withActiveRun(runId, async (cancellationSignal) => {
        const { suite } = request;
        const poolQualified = isPoolQualifiedSuiteRun(request, browserPool);
        const caseDetails: RunTestCaseResponse['detail'][] = [];
        const suiteResult = await new SuiteRunner({
          execute: async ({ testCase, environment, attempt, workerLease }) => {
            const memberRunId = `${runId}-${testCase.id}@${testCase.version}-attempt-${attempt}`;
            const response = await executeTestCase({
              runId: memberRunId,
              projectSnapshot: request.projectSnapshot,
              testCase,
              environment,
              ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
              ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
              ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
              ...(request.modelConfigResolver ? { modelConfigResolver: request.modelConfigResolver } : {}),
              ...(request.resolveModelConfigs ? { resolveModelConfigs: request.resolveModelConfigs } : {}),
              ...(request.browserSession ? { browserSession: request.browserSession } : {}),
              ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
              ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
              cancellationSignal,
            }, memberRunId, cancellationSignal, workerLease);
            const completedDetail = {
              ...response.detail,
              testCaseVersion: testCase.version,
            };
            caseDetails.push(completedDetail);
            await request.onCaseCompleted?.(completedDetail, attempt);
            return {
              status: response.detail.status === 'running' ? 'error' : response.detail.status,
              summary: response.detail.summary,
              ...(response.detail.status === 'running'
                ? { reason: { code: 'executorError' as const, message: 'Case executor returned a running result.' } }
                : response.detail.reason ? { reason: response.detail.reason } : {}),
              runId: response.runId,
            };
          },
        }, {
          maxConcurrency: poolQualified ? browserPool!.maxConcurrency : 1,
          ...(poolQualified ? { browserPool } : {}),
        }).run(request.projectSnapshot.project, suite, cancellationSignal);
        return {
          runId,
          title: suite.name,
          detail: {
            suite: suiteResult,
            caseDetails,
          },
        };
        }, request.cancellationSignal);
      } catch (error) {
        if (isRunCancelled(error)) {
          throw error;
        }
        const message = executorErrorMessage(error, redactor);
        const now = new Date().toISOString();
        return {
          runId,
          title: request.suite.name,
          detail: {
            suite: {
              suiteId: request.suite.id,
              suiteVersion: request.suite.version,
              environmentId: request.suite.environmentId,
              status: 'error',
              reason: { code: 'executorError', message },
              startedAt: now,
              endedAt: now,
              effectiveConcurrency: 1,
              results: [],
              issues: [message],
            },
            caseDetails: [],
          },
        };
      }
    },
    runRecording: async (request) => {
      const runId = request.runId ?? `agent-run-recording-${Date.now()}`;
      const redactor = createSecretRedactor();
      try {
        return await withActiveRun(runId, (cancellationSignal) =>
          recordingRunner.run({ ...request, runId, cancellationSignal }),
        );
      } catch (error) {
        if (isRunCancelled(error)) {
          throw error;
        }
        const response = executorErrorAgentRun(
          runId,
          request.project.id,
          request.testCaseId ?? request.recording.id,
          request.environment,
          `${request.recording.name} 回放`,
          error,
          redactor,
        );
        return { runId, title: `${request.recording.name} 回放`, ...response };
      }
    },
    runWorkflow: async (request) => {
      const runId = request.runId ?? `agent-run-workflow-${Date.now()}`;
      const redactor = createSecretRedactor(request.midsceneConfig, request.agentModelConfig);
      try {
        return await withActiveRun(runId, (cancellationSignal) =>
          studioRuntime.runWorkflow({ ...request, runId, cancellationSignal }),
        );
      } catch (error) {
        if (isRunCancelled(error)) {
          throw error;
        }
        const environment = request.environment ?? {
          id: request.targetEnvironment,
          name: request.targetEnvironment,
        };
        const response = executorErrorAgentRun(
          runId,
          request.project?.id ?? '',
          request.workflow.id,
          environment,
          request.workflow.name,
          error,
          redactor,
        );
        return { runId, title: request.workflow.name, ...response };
      }
    },
    cancelRun: (runId) => {
      const controller = activeRuns.get(runId);
      if (!controller || controller.signal.aborted) {
        return false;
      }
      controller.abort();
      return true;
    },
    close: async () => {
      await Promise.all([browserRuntime.close(), browserPool?.close()]);
    },
  };
};

const isPoolQualifiedSuiteRun = (
  request: ResolvedRunSuiteRequest,
  browserPool: BrowserPool | undefined,
): boolean => {
  return Boolean(browserPool) && isChromiumHeadlessVersionedSuite(
    request.projectSnapshot.project,
    request.projectSnapshot.reproducibility,
    request.suite,
  );
};

export const isChromiumHeadlessVersionedSuite = (
  project: Pick<ProjectDraft, 'environments'>,
  reproducibility: ProjectSnapshot['reproducibility'],
  suite: SuiteAsset,
): boolean => {
  if (reproducibility !== 'versioned') {
    return false;
  }
  if (!Number.isSafeInteger(suite.version) || suite.version < 1) {
    return false;
  }
  const environment = project.environments.find((candidate) => candidate.id === suite.environmentId);
  if (!environment || environment.browser !== 'chromium' || !environment.headless) {
    return false;
  }
  return suite.caseReferences.every((reference) =>
    Boolean(reference.id) && Number.isSafeInteger(reference.version) && reference.version >= 1,
  );
};

const resolveModelConfigs = async (request: ResolvedRunTestCaseRequest): Promise<ResolvedModelConfigs | undefined> => {
  if (request.midsceneConfig && request.agentModelConfig) {
    return {
      midsceneConfig: request.midsceneConfig,
      agentModelConfig: request.agentModelConfig,
    };
  }
  return request.resolveModelConfigs?.();
};

const resolveRuntimeProfile = (
  requestedProfile: RuntimeProfile | undefined,
  environment: ProjectEnvironment,
): RuntimeProfile => {
  return requestedProfile ?? {
    browser: environment.browser,
    baseUrl: environment.url,
    viewport: environment.viewport,
    locale: environment.locale,
    headless: environment.headless,
  };
};

const executorErrorMessage = (error: unknown, redactor: SecretRedactor): string => {
  const detail = redactor.redactError(error);
  return detail
    ? `Runtime executor failed: ${detail}`
    : 'Runtime executor failed before producing a result.';
};
