import path from 'node:path';

import type {
  ProjectEnvironment,
  RecordingCapturedEvent,
  RunEventPayload,
  RunRecordingRequest,
  RunRecordingResponse,
  RunTestCaseRequest,
  RunTestCaseResponse,
  RunWorkflowRequest,
  RunWorkflowResponse,
  RuntimeProfile,
} from '../../shared/studio.js';
import {
  getExclusiveRecordingReplayId,
  isAgentRunnableTestCase,
  testCaseToWorkflow,
} from '../../shared/studio.js';
import { OpenAICompatibleAgentPlanner } from './agent-planner.js';
import { OpenAICompatibleAgentReporter } from './agent-reporter.js';
import { OpenAICompatibleAgentVerifier } from './agent-verifier.js';
import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime } from './browser-runtime.js';
import { RecordingRunner } from './recording-runner.js';
import { MidsceneSemanticActionRuntime } from './semantic-action-runtime.js';
import { TestRunner } from './test-runner.js';
import { PixelVisualDiffService, type VisualDiffImageAdapter } from './visual-diff.js';
import { StudioRuntime } from '../studioRuntime.js';

export interface RuntimeBundle {
  artifactManager: ArtifactManager;
  browserRuntime: BrowserRuntime;
  recordingRunner: RecordingRunner;
  studioRuntime: StudioRuntime;
  testRunner: TestRunner;
  ensureReady: () => Promise<void>;
  runTestCase: (request: RunTestCaseRequest) => Promise<RunTestCaseResponse>;
  runRecording: (request: RunRecordingRequest) => Promise<RunRecordingResponse>;
  runWorkflow: (request: RunWorkflowRequest) => Promise<RunWorkflowResponse>;
  cancelRun: (runId: string) => boolean;
  close: () => Promise<void>;
}

export interface RuntimeBundleOptions {
  rootDir: string;
  visualDiffImageAdapter: VisualDiffImageAdapter;
  emitRunEvent?: (event: RunEventPayload) => void;
  emitRecordingEvent?: (event: RecordingCapturedEvent) => void;
}

export function createRuntimeBundle(options: RuntimeBundleOptions): RuntimeBundle {
  const emitRunEvent = options.emitRunEvent ?? (() => undefined);
  const artifactManager = new ArtifactManager(options.rootDir);
  const browserRuntime = new BrowserRuntime(options.rootDir, artifactManager, options.emitRecordingEvent);
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
  );
  const activeRuns = new Map<string, AbortController>();

  const withActiveRun = async <T>(
    runId: string,
    execute: (cancellationSignal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    if (activeRuns.has(runId)) {
      throw new Error(`运行 ${runId} 已在执行中。`);
    }
    const controller = new AbortController();
    activeRuns.set(runId, controller);
    try {
      return await execute(controller.signal);
    } finally {
      activeRuns.delete(runId);
    }
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
      return withActiveRun(runId, async (cancellationSignal) => {
      const recordingId = getExclusiveRecordingReplayId(request.testCase);
      const documentId = request.testCase.prdPath?.documentId;
      const recording = recordingId
        ? request.project.recordings.find((item) => item.id === recordingId)
        : undefined;

      if (recording) {
        return recordingRunner.run({
          ...request,
          runId,
          cancellationSignal,
          project: request.project,
          environment: request.environment,
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
          project: request.project,
          environment: request.environment,
          ...(documentId ? { documentId } : {}),
        });
      }

      return testRunner.run({ ...request, runId, cancellationSignal });
      });
    },
    runRecording: async (request) => {
      const runId = request.runId ?? `agent-run-recording-${Date.now()}`;
      return withActiveRun(runId, (cancellationSignal) =>
        recordingRunner.run({ ...request, runId, cancellationSignal }),
      );
    },
    runWorkflow: async (request) => {
      const runId = request.runId ?? `agent-run-workflow-${Date.now()}`;
      return withActiveRun(runId, (cancellationSignal) =>
        studioRuntime.runWorkflow({ ...request, runId, cancellationSignal }),
      );
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
