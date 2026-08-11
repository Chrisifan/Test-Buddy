import type {
  RunDetail,
  RunArtifact,
  RunEventPayload,
  RunStepLog,
  FixtureAsset,
  FixtureHttpJsonValue,
  FixtureLifecycleEvidence,
  RunTestCaseRequest,
  RunTestCaseResponse,
  RunRecordingRequest,
  RunRecordingResponse,
  RunWorkflowRequest,
  RunWorkflowResponse,
  RecordingAsset,
  StepType,
  TestStepDraft,
} from '../../shared/studio.js';
import {
  getConfirmedDeterministicTestInputBinding,
  getConfirmedDeterministicTestStep,
  getConfirmedExplicitTestAssertion,
  getTestCaseFixtureRunBlocker,
  getTestCasePrdPath,
  normalizeFixtureHttpDeclaration,
  resolveTestCaseFixtures,
} from '../../shared/studio.js';
import type { AgentPlanStepDraft, AgentRunResult } from '../../shared/agent.js';
import type {
  DeterministicInputBindingResolver,
  RunDeterministicStepRequest,
  RunDeterministicStepResponse,
} from '../studioRuntime.js';
import {
  awaitWithRunCancellation,
  createUserRunCancellation,
  isRunCancelled,
  throwIfRunCancelled,
} from './run-cancellation.js';
import { createTestCaseAgentRun } from '../../shared/agentStub.js';
import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime } from './browser-runtime.js';
import type { FixtureLifecycleExecutor, FixtureLifecycleExecutionResult } from './fixture-http-executor.js';

interface RecordingReplayRunner {
  run(request: RunRecordingRequest): Promise<RunRecordingResponse>;
}

interface WorkflowSegmentRunner {
  runWorkflow(request: RunWorkflowRequest): Promise<RunWorkflowResponse>;
}

interface DeterministicStepRunner {
  runDeterministicStep(request: RunDeterministicStepRequest): Promise<RunDeterministicStepResponse>;
}

export class TestRunner {
  constructor(
    private readonly artifacts: ArtifactManager,
    private readonly browserRuntime: BrowserRuntime,
    private readonly emitRunEvent: (event: RunEventPayload) => void,
    private readonly recordingRunner?: RecordingReplayRunner,
    private readonly workflowRunner?: WorkflowSegmentRunner,
    private readonly deterministicRunner?: DeterministicStepRunner,
    private readonly fixtureExecutor?: FixtureLifecycleExecutor,
  ) {}

  async run(request: RunTestCaseRequest): Promise<RunTestCaseResponse> {
    const runId = request.runId ?? `run-${Date.now()}`;
    const startedAt = new Date();
    const title = request.testCase.name;
    const documentId = getTestCasePrdPath(request.testCase)?.documentId;
    const logs = [
      `[${timeLabel(startedAt)}] Run queued: ${request.project.name} / ${request.testCase.name}`,
      `[${timeLabel(startedAt)}] Environment: ${request.environment.name} -> ${request.environment.url}`,
    ];

    this.emitRunEvent({
      runId,
      title,
      type: 'status',
      status: 'running',
      summary: `正在执行 ${request.testCase.steps.length} 个步骤。`,
    });

    logs.forEach((line) => this.emitRunEvent({ runId, title, type: 'log', line }));

    const fixtureEvidence: FixtureLifecycleEvidence[] = [];
    const preparedFixtures: FixtureAsset[] = [];
    // Response values live only for this invocation and never enter detail/log/artifact state.
    const fixtureOutputValues = new Map<string, Readonly<Record<string, FixtureHttpJsonValue>>>();
    let fixturesCleanedUp = false;
    const appendFixtureLog = (result: FixtureLifecycleExecutionResult) => {
      fixtureEvidence.push(result.evidence);
      const status = result.evidence.httpStatus === undefined
        ? result.evidence.outcome
        : `${result.evidence.outcome} (${result.evidence.httpStatus})`;
      const target = result.evidence.mode === 'script'
        ? `script ${result.evidence.scriptPath ?? '[unconfigured]'}`
        : `${result.evidence.method ?? 'HTTP'} ${result.evidence.path ?? '/'}`;
      const line = `[${timeLabel(new Date())}] Fixture ${result.evidence.fixtureId}@${result.evidence.fixtureVersion} ${result.evidence.lifecycle} ${target}: ${status}`;
      logs.push(line);
      this.emitRunEvent({ runId, title, type: 'log', line });
    };
    const cleanupPreparedFixtures = async () => {
      if (fixturesCleanedUp || !this.fixtureExecutor) {
        return;
      }
      fixturesCleanedUp = true;
      for (const fixture of [...preparedFixtures].reverse()) {
        if (!fixture.cleanup) {
          continue;
        }
        appendFixtureLog(await this.executeFixtureLifecycle(fixture, 'cleanup', request));
      }
    };

    const fixtureBlocker = getTestCaseFixtureRunBlocker(
      request.project,
      request.testCase,
      request.environment.id,
      {
        projectId: request.project.id,
        projectDirectory: request.fixtureScriptTrustDirectory,
        records: request.fixtureScriptTrustRecords,
        scriptExecutionEnabled: Boolean(this.fixtureExecutor?.supports?.('script')),
      },
    );
    if (fixtureBlocker) {
      return this.createPreflightBlockedResponse(request, runId, title, startedAt, logs, `Fixture 前置条件未满足：${fixtureBlocker.message}`);
    }

    const resolvedFixtures = resolveTestCaseFixtures(
      request.project,
      request.testCase.assetReferences?.fixtures ?? [],
      request.environment.id,
    ).fixtures;
    if (resolvedFixtures.length && !this.fixtureExecutor) {
      return this.createPreflightBlockedResponse(
        request,
        runId,
        title,
        startedAt,
        logs,
        'Fixture 前置条件未满足：HTTP Fixture 受控执行器不可用，当前不会执行。',
      );
    }
    for (const fixture of resolvedFixtures) {
      const result = await this.executeFixtureLifecycle(fixture, 'setup', request, request.cancellationSignal);
      appendFixtureLog(result);
      if (result.evidence.outcome !== 'passed') {
        await cleanupPreparedFixtures();
        if (request.cancellationSignal?.aborted) {
          return this.createCancelledResponse(request, runId, title, startedAt, logs, [], fixtureEvidence);
        }
        return this.createPreflightBlockedResponse(
          request,
          runId,
          title,
          startedAt,
          logs,
          `Fixture 前置条件未满足：${result.message}`,
          fixtureEvidence,
        );
      }
      if (result.outputValues) {
        fixtureOutputValues.set(fixtureReferenceKey(fixture), result.outputValues);
      }
      preparedFixtures.push(fixture);
    }

    const fixtureOutputBindingIssue = getFixtureOutputBindingIssue(request.testCase.steps, resolvedFixtures, fixtureOutputValues);
    if (fixtureOutputBindingIssue) {
      await cleanupPreparedFixtures();
      if (request.cancellationSignal?.aborted) {
        return this.createCancelledResponse(request, runId, title, startedAt, logs, [], fixtureEvidence);
      }
      return this.createPreflightBlockedResponse(
        request,
        runId,
        title,
        startedAt,
        logs,
        `Fixture 前置条件未满足：${fixtureOutputBindingIssue}`,
        fixtureEvidence,
      );
    }
    const fixtureOutputBindingResolver: DeterministicInputBindingResolver = {
      resolve: async ({ projectId, binding }) => {
        if (projectId !== request.project.id || binding.kind !== 'fixtureOutput') {
          throw new Error('Fixture 输出绑定不属于当前受控运行。');
        }
        const value = fixtureOutputValues.get(`${binding.fixtureId}@${binding.fixtureVersion}`)?.[binding.outputName];
        if (typeof value !== 'string') {
          throw new Error('Fixture 输出未在当前运行中生成可用于输入的字符串值。');
        }
        return value;
      },
    };

    let artifact: RunArtifact;
    try {
      throwIfRunCancelled(request.cancellationSignal);
      const session = await awaitWithRunCancellation(
        this.browserRuntime.start({
          project: request.project,
          environment: request.environment,
          record: false,
        }),
        request.cancellationSignal,
      );
      if (session.status === 'error') {
        await cleanupPreparedFixtures();
        return this.createPreflightBlockedResponse(
          request,
          runId,
          title,
          startedAt,
          logs,
          `浏览器会话未启动：${session.message}`,
          fixtureEvidence,
        );
      }
      artifact = await awaitWithRunCancellation(
        this.artifacts.createSnapshot(
          runId,
          '运行起始快照',
          request.testCase.name,
          session.currentUrl || request.environment.url,
        ),
        request.cancellationSignal,
      );
    } catch (error) {
      if (!isRunCancelled(error)) {
        await cleanupPreparedFixtures();
        throw error;
      }
      await cleanupPreparedFixtures();
      return this.createCancelledResponse(request, runId, title, startedAt, logs, [], fixtureEvidence);
    }

    const artifacts = [artifact];
    const steps: RunStepLog[] = [];
    const agentRuns: AgentRunResult[] = [];
    const agentStepRuns: Array<AgentRunResult | undefined> = Array.from({ length: request.testCase.steps.length });

    let hasFailure = false;
    let hasNeutral = false;
    let failureReason = '';
    let cancellation: RunDetail['cancellation'];

    for (const [index, step] of request.testCase.steps.entries()) {
      if (request.cancellationSignal?.aborted) {
        cancellation = createUserCancellation();
        hasNeutral = true;
        appendUnexecutedSteps(steps, request, index, runId, artifact.path, cancellation.message);
        break;
      }
      const replayStep = step.type === 'recordingReplay';

      if (replayStep) {
        const recording = findRecording(request, step.recordingId);
        if (!recording) {
          hasFailure = true;
          failureReason = `未找到录制资产：${step.recordingId ?? step.title}`;
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'failed',
            message: failureReason,
            screenshotPath: artifact.path,
          });
          appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, failureReason);
          break;
        }

        if (this.recordingRunner) {
          const replay = await this.recordingRunner.run({
            project: request.project,
            environment: request.environment,
            recording,
            testCaseId: request.testCase.id,
            ...(documentId
              ? { documentId }
              : recording.prdPath?.documentId
                ? { documentId: recording.prdPath.documentId }
                : {}),
            parentRunId: runId,
            ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
          });
          if (isAgentRunResult(replay.agentRun)) {
            agentRuns.push(replay.agentRun);
            agentStepRuns[index] = replay.agentRun;
          }
          replay.detail.logs.forEach((message) => {
            const line = `[${timeLabel(new Date())}] ${message}`;
            logs.push(line);
            this.emitRunEvent({ runId, title, type: 'log', line });
          });
          artifacts.push(...replay.detail.artifacts);

          const screenshotPath = replay.detail.steps.at(-1)?.screenshotPath ?? artifact.path;
          const message = `步骤 ${index + 1} ${replay.detail.summary}`;
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: replay.detail.status,
            message,
            screenshotPath,
          });

          if (replay.detail.status !== 'passed') {
            if (replay.detail.cancellation) {
              cancellation = replay.detail.cancellation;
            }
            if (replay.detail.status === 'failed') {
              hasFailure = true;
              failureReason = replay.detail.failureReason ?? replay.detail.summary;
            } else {
              hasNeutral = true;
            }
            appendUnexecutedSteps(steps, request, index + 1, runId, screenshotPath, message);
            break;
          }
          continue;
        }

        let replayResults: Awaited<ReturnType<BrowserRuntime['replayRecordingSteps']>>;
        try {
          const replay = request.cancellationSignal
            ? this.browserRuntime.replayRecordingSteps(
                recording.steps,
                `${runId}-${index}`,
                request.cancellationSignal,
              )
            : this.browserRuntime.replayRecordingSteps(recording.steps, `${runId}-${index}`);
          replayResults = await awaitWithRunCancellation(replay, request.cancellationSignal);
        } catch (error) {
          if (!isRunCancelled(error)) {
            await cleanupPreparedFixtures();
            throw error;
          }
          cancellation = createUserCancellation();
          hasNeutral = true;
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'neutral',
            message: cancellation.message,
            screenshotPath: artifact.path,
          });
          appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, cancellation.message);
          break;
        }
        replayResults.forEach((result, replayIndex) => {
          if (result.screenshotPath) {
            artifacts.push({
              id: `artifact-${runId}-${index}-${replayIndex}`,
              type: 'snapshot',
              label: `${recording.name} / ${result.step.title}`,
              path: result.screenshotPath,
            });
          }
          const line = `[${timeLabel(new Date())}] ${result.message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
        });

        const failed = replayResults.find((result) => result.status === 'failed');
        if (failed) {
          hasFailure = true;
          failureReason = failed.message;
        }

        const screenshotPath = replayResults.at(-1)?.screenshotPath ?? artifact.path;
        const message = failed
          ? `步骤 ${index + 1} 回放失败：${failed.message}`
          : `步骤 ${index + 1} 已真实回放 ${replayResults.length} 个录制节点。`;
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: failed ? 'failed' : 'passed',
          message,
          screenshotPath,
        });

        if (failed) {
          appendUnexecutedSteps(steps, request, index + 1, runId, screenshotPath, failureReason);
          break;
        }
        continue;
      }

      const deterministicAction = getConfirmedDeterministicTestStep(step);
      const deterministicInputBinding = getConfirmedDeterministicTestInputBinding(step);
      const deterministicAssertion = getConfirmedExplicitTestAssertion(step);
      const deterministicStep = deterministicAction ?? (deterministicAssertion ? toDeterministicAssertionPlanStep(step) : undefined);
      if (deterministicStep) {
        if (!this.deterministicRunner) {
          hasNeutral = true;
          const message = `步骤 ${index + 1} 已确认的结构化${deterministicAssertion ? '断言' : '动作'}等待确定性运行器接入。`;
          const line = `[${timeLabel(new Date())}] ${message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'neutral',
            message,
            screenshotPath: artifact.path,
          });
          appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, message);
          break;
        }

        const deterministic = await this.deterministicRunner.runDeterministicStep({
          sourceStep: step,
          plannedStep: deterministicStep,
          ...(deterministicInputBinding ? { inputBinding: deterministicInputBinding } : {}),
          ...(deterministicInputBinding?.kind === 'fixtureOutput' ? { inputBindingResolver: fixtureOutputBindingResolver } : {}),
          ...(deterministicAssertion ? { assertion: deterministicAssertion } : {}),
          testCaseId: request.testCase.id,
          targetEnvironment: request.environment.name,
          runtimeProfile: request.runtimeProfile ?? {
            browser: request.environment.browser,
            baseUrl: request.environment.url,
            viewport: request.environment.viewport,
            locale: request.environment.locale,
            headless: request.environment.headless,
          },
          project: request.project,
          environment: request.environment,
          ...(documentId ? { documentId } : {}),
          parentRunId: runId,
          ...(request.browserSession ? { browserSession: request.browserSession } : {}),
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
        });
        if (isAgentRunResult(deterministic.agentRun)) {
          agentRuns.push(deterministic.agentRun);
          agentStepRuns[index] = deterministic.agentRun;
        }
        deterministic.detail.logs.forEach((message) => {
          const line = `[${timeLabel(new Date())}] ${message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
        });
        artifacts.push(...deterministic.detail.artifacts);

        const deterministicRunStep = deterministic.detail.steps[0];
        const screenshotPath = deterministicRunStep?.screenshotPath ?? artifact.path;
        const message = `步骤 ${index + 1} ${deterministicRunStep?.message ?? deterministic.detail.summary}`;
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: deterministic.detail.status,
          message,
          screenshotPath,
        });
        if (deterministic.detail.status !== 'passed') {
          if (deterministic.detail.cancellation) {
            cancellation = deterministic.detail.cancellation;
          }
          if (deterministic.detail.status === 'failed') {
            hasFailure = true;
            failureReason = deterministic.detail.failureReason ?? deterministic.detail.summary;
          } else {
            hasNeutral = true;
          }
          appendUnexecutedSteps(steps, request, index + 1, runId, screenshotPath, message);
          break;
        }
        continue;
      }

      if ((step.type === 'ai' || step.type === 'aiAssert') && step.execution?.reviewStatus === 'confirmed') {
        hasNeutral = true;
        const message = `步骤 ${index + 1} 已确认的结构化${step.type === 'aiAssert' ? '断言' : '动作'}不在当前确定性执行范围内，未调用模型。`;
        const line = `[${timeLabel(new Date())}] ${message}`;
        logs.push(line);
        this.emitRunEvent({ runId, title, type: 'log', line });
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: 'neutral',
          message,
          screenshotPath: artifact.path,
        });
        appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, message);
        break;
      }

      if (this.workflowRunner && isAgentStep(step)) {
        const workflow = await this.workflowRunner.runWorkflow({
          workflow: {
            id: request.testCase.id,
            kind: request.testCase.kind === 'recording' ? 'scenario' : request.testCase.kind,
            name: request.testCase.name,
            category: request.testCase.category,
            lastEdited: request.testCase.lastEdited,
            url: request.testCase.url,
            notes: request.testCase.notes,
            steps: [step],
          },
          targetEnvironment: request.environment.name,
          runtimeProfile: request.runtimeProfile ?? {
            browser: request.environment.browser,
            baseUrl: request.environment.url,
            viewport: request.environment.viewport,
            locale: request.environment.locale,
            headless: request.environment.headless,
          },
          ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
          ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
          ...(request.browserSession ? { browserSession: request.browserSession } : {}),
          project: request.project,
          environment: request.environment,
          ...(documentId ? { documentId } : {}),
          parentRunId: runId,
          preserveCurrentPage: index > 0,
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
        });
        if (isAgentRunResult(workflow.agentRun)) {
          agentRuns.push(workflow.agentRun);
          agentStepRuns[index] = workflow.agentRun;
        }
        workflow.detail.logs.forEach((message) => {
          const line = `[${timeLabel(new Date())}] ${message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
        });
        artifacts.push(...workflow.detail.artifacts);

        const workflowStep = workflow.detail.steps[0];
        const screenshotPath = workflowStep?.screenshotPath ?? artifact.path;
        const message = `步骤 ${index + 1} ${workflowStep?.message ?? workflow.detail.summary}`;
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: workflow.detail.status,
          message,
          screenshotPath,
        });

        if (workflow.detail.status !== 'passed') {
          if (workflow.detail.cancellation) {
            cancellation = workflow.detail.cancellation;
          }
          if (workflow.detail.status === 'failed') {
            hasFailure = true;
            failureReason = workflow.detail.failureReason ?? workflow.detail.summary;
          } else {
            hasNeutral = true;
          }
          appendUnexecutedSteps(steps, request, index + 1, runId, screenshotPath, message);
          break;
        }
        continue;
      }

      const screenshotPath = artifact.path;
      hasNeutral = true;
      const message =
        step.type === 'manual'
          ? `步骤 ${index + 1} 需要人工检查：${step.body}`
          : `步骤 ${index + 1} 等待 Agent Runtime 执行：${step.body}`;

      const line = `[${timeLabel(new Date())}] ${message}`;
      logs.push(line);
      this.emitRunEvent({ runId, title, type: 'log', line });
      steps.push({
        id: `run-step-${runId}-${index}`,
        stepId: step.id,
        title: step.title,
        status: 'neutral',
        message,
        screenshotPath,
      });
      appendUnexecutedSteps(steps, request, index + 1, runId, screenshotPath, message);
      break;
    }

    await cleanupPreparedFixtures();
    const endedAt = new Date();
    const agentRun = agentRuns.length
      ? createTestCaseAgentRun({
          testCase: request.testCase,
          stepRuns: agentStepRuns,
          runId,
          projectId: request.project.id,
          environmentId: request.environment.id,
        })
      : undefined;
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCase.id,
      ...(documentId ? { documentId } : {}),
      environmentId: request.environment.id,
      title,
      status: cancellation ? 'neutral' : hasFailure ? 'failed' : hasNeutral ? 'neutral' : 'passed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      duration: `00:00:${String(Math.max(1, request.testCase.steps.length * 2)).padStart(2, '0')}`,
      summary: cancellation
        ? cancellation.message
        : hasFailure
        ? `执行失败：${failureReason}`
        : hasNeutral
          ? `已完成录制回放并保留 ${request.testCase.steps.length} 个步骤，其中部分步骤等待 Agent Runtime 或人工检查。`
          : `已完成 ${request.testCase.steps.length} 个步骤，生成 ${artifacts.length} 份截图/快照与步骤日志。`,
      logs,
      steps,
      artifacts,
      ...(fixtureEvidence.length ? { fixtureLifecycles: fixtureEvidence } : {}),
      ...(agentRun ? { agentRun } : {}),
      ...(agentRuns.length ? { agentRuns } : {}),
      ...(hasFailure && !cancellation ? { failureReason } : {}),
      ...(cancellation ? { cancellation } : {}),
    };

    this.emitRunEvent({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });

    return { runId, title, detail };
  }

  private createCancelledResponse(
    request: RunTestCaseRequest,
    runId: string,
    title: string,
    startedAt: Date,
    logs: string[],
    artifacts: RunArtifact[],
    fixtureLifecycles: FixtureLifecycleEvidence[] = [],
  ): RunTestCaseResponse {
    const cancellation = createUserCancellation();
    const documentId = getTestCasePrdPath(request.testCase)?.documentId;
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCase.id,
      ...(documentId ? { documentId } : {}),
      environmentId: request.environment.id,
      title,
      status: 'neutral',
      startedAt: startedAt.toISOString(),
      endedAt: cancellation.cancelledAt,
      duration: '00:00:00',
      summary: cancellation.message,
      logs: [...logs, `[${timeLabel(new Date())}] ${cancellation.message}`],
      steps: request.testCase.steps.map((step, index) => ({
        id: `run-step-${runId}-${index}`,
        stepId: step.id,
        title: step.title,
        status: 'neutral',
        message: cancellation.message,
      })),
      artifacts,
      ...(fixtureLifecycles.length ? { fixtureLifecycles } : {}),
      cancellation,
    };
    this.emitRunEvent({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });
    return { runId, title, detail };
  }

  private createPreflightBlockedResponse(
    request: RunTestCaseRequest,
    runId: string,
    title: string,
    startedAt: Date,
    logs: string[],
    reason: string,
    fixtureLifecycles: FixtureLifecycleEvidence[] = [],
  ): RunTestCaseResponse {
    const message = reason;
    const documentId = getTestCasePrdPath(request.testCase)?.documentId;
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCase.id,
      ...(documentId ? { documentId } : {}),
      environmentId: request.environment.id,
      title,
      status: 'neutral',
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      duration: '00:00:00',
      summary: message,
      logs: [...logs, `[${timeLabel(new Date())}] ${message}`],
      steps: request.testCase.steps.map((step, index) => ({
        id: `run-step-${runId}-${index}`,
        stepId: step.id,
        title: step.title,
        status: 'neutral',
        message,
      })),
      artifacts: [],
      ...(fixtureLifecycles.length ? { fixtureLifecycles } : {}),
    };
    this.emitRunEvent({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });
    return { runId, title, detail };
  }

  private async executeFixtureLifecycle(
    fixture: FixtureAsset,
    lifecycle: 'setup' | 'cleanup',
    request: RunTestCaseRequest,
    cancellationSignal?: AbortSignal,
  ): Promise<FixtureLifecycleExecutionResult> {
    const declaration = lifecycle === 'setup' ? fixture.setup : fixture.cleanup;
    if (!this.fixtureExecutor || !declaration) {
      return {
        evidence: {
          fixtureId: fixture.id,
          fixtureVersion: fixture.version,
          lifecycle,
          ...(declaration?.mode === 'script'
            ? { mode: 'script' as const, scriptPath: declaration.script?.relativePath }
            : {
                mode: 'http' as const,
                method: declaration?.mode === 'http' ? declaration.http?.method ?? 'POST' : 'POST',
                path: declaration?.mode === 'http' ? declaration.http?.path ?? '/' : '/',
                expectedStatuses: declaration?.mode === 'http' ? declaration.http?.expectedStatuses ?? [] : [],
              }),
          outcome: 'neutral',
          durationMs: 0,
        },
        message: 'Fixture lifecycle is not executable.',
      };
    }
    try {
      return await this.fixtureExecutor.execute({
        fixture,
        lifecycle,
        environment: request.environment,
        projectId: request.project.id,
        projectDirectory: request.fixtureScriptTrustDirectory,
        scriptTrustRecords: request.fixtureScriptTrustRecords,
        ...(cancellationSignal ? { cancellationSignal } : {}),
      });
    } catch {
      return {
        evidence: {
          fixtureId: fixture.id,
          fixtureVersion: fixture.version,
          lifecycle,
          ...(declaration.mode === 'script'
            ? { mode: 'script' as const, scriptPath: declaration.script?.relativePath }
            : {
                mode: 'http' as const,
                method: declaration.http?.method ?? 'POST',
                path: declaration.http?.path ?? '/',
                expectedStatuses: declaration.http?.expectedStatuses ?? [],
              }),
          outcome: 'failed',
          durationMs: 0,
        },
        message: `Fixture ${declaration.mode === 'script' ? 'script' : 'HTTP'} lifecycle failed.`,
      };
    }
  }
}

function createUserCancellation(): NonNullable<RunDetail['cancellation']> {
  return createUserRunCancellation();
}

function appendUnexecutedSteps(
  steps: RunStepLog[],
  request: RunTestCaseRequest,
  firstIndex: number,
  runId: string,
  screenshotPath: string,
  reason: string,
): void {
  request.testCase.steps.slice(firstIndex).forEach((step, offset) => {
    steps.push({
      id: `run-step-${runId}-${firstIndex + offset}`,
      stepId: step.id,
      title: step.title,
      status: 'neutral',
      message: `前序步骤未形成可继续执行的结论：${reason}`,
      screenshotPath,
    });
  });
}

function getFixtureOutputBindingIssue(
  steps: TestStepDraft[],
  fixtures: FixtureAsset[],
  outputValues: ReadonlyMap<string, Readonly<Record<string, FixtureHttpJsonValue>>>,
): string | undefined {
  for (const step of steps) {
    const binding = getConfirmedDeterministicTestInputBinding(step);
    if (binding?.kind !== 'fixtureOutput') {
      continue;
    }
    const fixture = fixtures.find((candidate) => (
      candidate.id === binding.fixtureId && candidate.version === binding.fixtureVersion
    ));
    if (!fixture) {
      return `步骤“${step.title}”引用的 fixture ${binding.fixtureId}@${binding.fixtureVersion} 未绑定到当前用例。`;
    }
    const output = fixture.outputs.find((candidate) => candidate.name === binding.outputName);
    if (output?.type !== 'string') {
      return `步骤“${step.title}”引用的 fixture 输出 ${binding.outputName} 未声明为可输入的字符串。`;
    }
    const setupHttp = fixture.setup.mode === 'http' ? normalizeFixtureHttpDeclaration(fixture.setup.http) : undefined;
    if (
      fixture.setup.mode !== 'script' &&
      !setupHttp?.responseOutputs?.some((mapping) => mapping.outputName === binding.outputName)
    ) {
      return `步骤“${step.title}”引用的 fixture 输出 ${binding.outputName} 没有受控 setup 响应映射。`;
    }
    const value = outputValues.get(fixtureReferenceKey(fixture))?.[binding.outputName];
    if (typeof value !== 'string') {
      return `步骤“${step.title}”引用的 fixture 输出 ${binding.outputName} 未在当前准备请求中生成。`;
    }
  }
  return undefined;
}

function fixtureReferenceKey(fixture: Pick<FixtureAsset, 'id' | 'version'>): string {
  return `${fixture.id}@${fixture.version}`;
}

function isAgentStep(step: TestStepDraft): step is TestStepDraft & { type: StepType } {
  return step.type === 'ai' || step.type === 'aiAssert' || step.type === 'aiQuery';
}

function isAgentRunResult(value: unknown): value is AgentRunResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'runId' in value &&
      'intent' in value &&
      'plan' in value &&
      'events' in value,
  );
}

function toDeterministicAssertionPlanStep(step: TestStepDraft): AgentPlanStepDraft {
  const assertion = step.execution?.assertion;
  const expected =
    assertion?.kind === 'locatorVisible'
      ? assertion.locator.selector
      : assertion && 'expected' in assertion
        ? assertion.expected
        : undefined;

  return {
    action: 'assert',
    title: step.title,
    instruction: step.body,
    ...(expected ? { expected } : {}),
  };
}

function findRecording(request: RunTestCaseRequest, recordingId?: string): RecordingAsset | undefined {
  if (recordingId) {
    return request.project.recordings.find((recording) => recording.id === recordingId);
  }

  return request.project.recordings.find(
    (recording) =>
      recording.groupId === request.testCase.groupId &&
      recording.environmentId === request.testCase.environmentId,
  );
}

function timeLabel(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}
