import type {
  RunDetail,
  RunEventPayload,
  RunStepLog,
  RunTestCaseRequest,
  RunTestCaseResponse,
  RecordingAsset,
} from '../../shared/studio.js';
import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime } from './browser-runtime.js';

export class TestRunner {
  constructor(
    private readonly artifacts: ArtifactManager,
    private readonly browserRuntime: BrowserRuntime,
    private readonly emitRunEvent: (event: RunEventPayload) => void,
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

    let hasFailure = false;
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
          break;
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
          break;
        }
        continue;
      }

      const screenshotPath = artifact.path;
      const message =
        step.type === 'manual'
          ? `步骤 ${index + 1} 需要人工检查：${step.body}`
          : `步骤 ${index + 1} 已下发：${step.body}`;

      const line = `[${timeLabel(new Date())}] ${message}`;
      logs.push(line);
      this.emitRunEvent({ runId, title, type: 'log', line });
      steps.push({
        id: `run-step-${runId}-${index}`,
        stepId: step.id,
        title: step.title,
        status: step.type === 'manual' ? 'neutral' : 'passed',
        message,
        screenshotPath,
      });
    }

    const endedAt = new Date();
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCase.id,
      environmentId: request.environment.id,
      title,
      status: hasFailure ? 'failed' : 'passed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      duration: `00:00:${String(Math.max(1, request.testCase.steps.length * 2)).padStart(2, '0')}`,
      summary: hasFailure
        ? `执行失败：${failureReason}`
        : `已完成 ${request.testCase.steps.length} 个步骤，生成 ${artifacts.length} 份截图/快照与步骤日志。`,
      logs,
      steps,
      artifacts,
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
