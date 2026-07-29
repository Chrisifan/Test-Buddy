import type {
  RunDetail,
  RunEventPayload,
  RunStepLog,
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
import type { AgentRunResult } from '../../shared/agent.js';
import { createTestCaseAgentRun } from '../../shared/agentStub.js';
import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime } from './browser-runtime.js';

interface RecordingReplayRunner {
  run(request: RunRecordingRequest): Promise<RunRecordingResponse>;
}

interface WorkflowSegmentRunner {
  runWorkflow(request: RunWorkflowRequest): Promise<RunWorkflowResponse>;
}

export class TestRunner {
  constructor(
    private readonly artifacts: ArtifactManager,
    private readonly browserRuntime: BrowserRuntime,
    private readonly emitRunEvent: (event: RunEventPayload) => void,
    private readonly recordingRunner?: RecordingReplayRunner,
    private readonly workflowRunner?: WorkflowSegmentRunner,
  ) {}

  async run(request: RunTestCaseRequest): Promise<RunTestCaseResponse> {
    const runId = `run-${Date.now()}`;
    const startedAt = new Date();
    const title = request.testCase.name;
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

    const session = await this.browserRuntime.start({
      project: request.project,
      environment: request.environment,
      record: false,
    });
    const artifact = await this.artifacts.createSnapshot(
      runId,
      '运行起始快照',
      request.testCase.name,
      session.currentUrl || request.environment.url,
    );

    const artifacts = [artifact];
    const steps: RunStepLog[] = [];
    const agentRuns: AgentRunResult[] = [];
    const agentStepRuns: Array<AgentRunResult | undefined> = Array.from({ length: request.testCase.steps.length });

    let hasFailure = false;
    let hasNeutral = false;
    let failureReason = '';

    for (const [index, step] of request.testCase.steps.entries()) {
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
            parentRunId: runId,
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

        const replayResults = await this.browserRuntime.replayRecordingSteps(recording.steps, `${runId}-${index}`);
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
          parentRunId: runId,
          preserveCurrentPage: index > 0,
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
      environmentId: request.environment.id,
      title,
      status: hasFailure ? 'failed' : hasNeutral ? 'neutral' : 'passed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      duration: `00:00:${String(Math.max(1, request.testCase.steps.length * 2)).padStart(2, '0')}`,
      summary: hasFailure
        ? `执行失败：${failureReason}`
        : hasNeutral
          ? `已完成录制回放并保留 ${request.testCase.steps.length} 个步骤，其中部分步骤等待 Agent Runtime 或人工检查。`
          : `已完成 ${request.testCase.steps.length} 个步骤，生成 ${artifacts.length} 份截图/快照与步骤日志。`,
      logs,
      steps,
      artifacts,
      ...(agentRun ? { agentRun } : {}),
      ...(agentRuns.length ? { agentRuns } : {}),
      failureReason: hasFailure ? failureReason : undefined,
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
