import path from 'node:path';

import type {
  AgentModelConfig,
  BrowserSessionState,
  FixtureScriptTrustRecord,
  ProjectEnvironment,
  RecordingCapturedEvent,
  RunEventPayload,
  RunDetail,
  RunReason,
  RunRecordingRequest,
  RunRecordingResponse,
  RunSuiteResponse,
  RunTestCaseResponse,
  RunWorkflowRequest,
  RunWorkflowResponse,
  RuntimeProfile,
  SuiteAsset,
  TestCaseDraft,
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

export interface RuntimeBundle {
  artifactManager: ArtifactManager;
  browserRuntime: BrowserRuntime;
  recordingRunner: RecordingRunner;
  studioRuntime: StudioRuntime;
  testRunner: TestRunner;
  ensureReady: () => Promise<void>;
  runTestCase: (request: ResolvedRunTestCaseRequest) => Promise<RunTestCaseResponse>;
  runSuite: (request: ResolvedRunSuiteRequest) => Promise<RunSuiteResponse>;
  runRecording: (request: RunRecordingRequest) => Promise<RunRecordingResponse>;
  runWorkflow: (request: RunWorkflowRequest) => Promise<RunWorkflowResponse>;
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
  midsceneConfig?: import('../../shared/studio.js').MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
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
  midsceneConfig?: import('../../shared/studio.js').MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
}

export interface RuntimeBundleOptions {
  rootDir: string;
  visualDiffImageAdapter: VisualDiffImageAdapter;
  storageStateResolver?: BrowserStorageStateResolver;
  emitRunEvent?: (event: RunEventPayload) => void;
  emitRecordingEvent?: (event: RecordingCapturedEvent) => void;
  deterministicInputBindingResolver?: DeterministicInputBindingResolver;
}

export function createRuntimeBundle(options: RuntimeBundleOptions): RuntimeBundle {
  const emitRunEvent = options.emitRunEvent ?? (() => undefined);
  const artifactManager = new ArtifactManager(options.rootDir);
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
  );
  const activeRuns = new Map<string, AbortController>();

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
  ): Promise<RunTestCaseResponse> => {
    const project = request.projectSnapshot.project;
    const recordingId = getExclusiveRecordingReplayId(request.testCase);
    const documentId = getTestCasePrdPath(request.testCase)?.documentId;
    const recording = recordingId
      ? project.recordings.find((item) => item.id === recordingId)
      : undefined;

    if (request.testCase.assetReferences?.fixtures.length) {
      return testRunner.run({
        runId,
        cancellationSignal,
        project,
        testCase: request.testCase,
        environment: request.environment,
        ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
        ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
        ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
        ...(request.browserSession ? { browserSession: request.browserSession } : {}),
        ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
        ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
      });
    }

    if (recording) {
      return recordingRunner.run({
        ...request,
        runId,
        cancellationSignal,
        project,
        environment: request.environment,
        ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
        ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
        ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
        ...(request.browserSession ? { browserSession: request.browserSession } : {}),
        ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
        ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
        recording,
        testCaseId: request.testCase.id,
        ...(documentId ? { documentId } : {}),
      });
    }

    if (isAgentRunnableTestCase(request.testCase)) {
      return studioRuntime.runWorkflow({
        runId,
        cancellationSignal,
        workflow: testCaseToWorkflow(request.testCase),
        targetEnvironment: request.environment.name,
        runtimeProfile: resolveRuntimeProfile(request.runtimeProfile, request.environment),
        ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
        ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
        ...(request.browserSession ? { browserSession: request.browserSession } : {}),
        project,
        environment: request.environment,
        ...(documentId ? { documentId } : {}),
      });
    }

    return testRunner.run({
      runId,
      cancellationSignal,
      project,
      testCase: request.testCase,
      environment: request.environment,
      ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
      ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
      ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
      ...(request.browserSession ? { browserSession: request.browserSession } : {}),
      ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
      ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
    });
  };

  const executorErrorDetail = (
    runId: string,
    projectId: string,
    testCaseId: string,
    environment: Pick<ProjectEnvironment, 'id' | 'name'>,
    title: string,
    error: unknown,
  ): RunDetail => {
    const message = executorErrorMessage(error);
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
    emitRunEvent({ runId, title, type: 'complete', status: detail.status, duration: detail.duration, summary: detail.summary, detail });
    return detail;
  };

  const executorErrorAgentRun = (
    runId: string,
    projectId: string,
    testCaseId: string,
    environment: Pick<ProjectEnvironment, 'id' | 'name'>,
    title: string,
    error: unknown,
  ) => {
    const message = executorErrorMessage(error);
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
    return { agentRun, detail: executorErrorDetail(runId, projectId, testCaseId, environment, title, error) };
  };

  return {
    artifactManager,
    browserRuntime,
    recordingRunner,
    studioRuntime,
    testRunner,
    ensureReady: () => artifactManager.ensureReady(),
    runTestCase: async (request) => {
      const runId = request.runId ?? `run-${Date.now()}`;
      try {
        return await withActiveRun(runId, (cancellationSignal) => executeTestCase(request, runId, cancellationSignal));
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
          ),
        };
      }
    },
    runSuite: async (request) => {
      const runId = request.runId ?? `suite-run-${Date.now()}`;
      try {
        return await withActiveRun(runId, async (cancellationSignal) => {
        const { suite } = request;
        const caseDetails: RunTestCaseResponse['detail'][] = [];
        const suiteResult = await new SuiteRunner({
          execute: async ({ testCase, environment, attempt }) => {
            const response = await executeTestCase({
              runId: `${runId}-${testCase.id}-attempt-${attempt}`,
              projectSnapshot: request.projectSnapshot,
              testCase,
              environment,
              ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
              ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
              ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
              ...(request.browserSession ? { browserSession: request.browserSession } : {}),
              ...(request.fixtureScriptTrustRecords ? { fixtureScriptTrustRecords: request.fixtureScriptTrustRecords } : {}),
              ...(request.fixtureScriptTrustDirectory ? { fixtureScriptTrustDirectory: request.fixtureScriptTrustDirectory } : {}),
              cancellationSignal,
            }, `${runId}-${testCase.id}-attempt-${attempt}`, cancellationSignal);
            caseDetails.push(response.detail);
            return {
              status: response.detail.status === 'running' ? 'error' : response.detail.status,
              summary: response.detail.summary,
              ...(response.detail.status === 'running'
                ? { reason: { code: 'executorError' as const, message: 'Case executor returned a running result.' } }
                : response.detail.reason ? { reason: response.detail.reason } : {}),
              runId: response.runId,
            };
          },
        }, { maxConcurrency: 1 }).run(request.projectSnapshot.project, suite, cancellationSignal);
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
        const message = executorErrorMessage(error);
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
        );
        return { runId, title: `${request.recording.name} 回放`, ...response };
      }
    },
    runWorkflow: async (request) => {
      const runId = request.runId ?? `agent-run-workflow-${Date.now()}`;
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
    close: () => browserRuntime.close(),
  };
}

function resolveRuntimeProfile(
  requestedProfile: RuntimeProfile | undefined,
  environment: ProjectEnvironment,
): RuntimeProfile {
  return requestedProfile ?? {
    browser: environment.browser,
    baseUrl: environment.url,
    viewport: environment.viewport,
    locale: environment.locale,
    headless: environment.headless,
  };
}

function executorErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? `Runtime executor failed: ${error.message}`
    : 'Runtime executor failed before producing a result.';
}
