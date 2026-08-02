import path from 'node:path';

import type {
  BrowserSessionRequest,
  BrowserSessionState,
  BrowserNavigateRequest,
  RecordingStepDraft,
  RunDetail,
  RunArtifact,
  RunEventPayload,
  RunRecordingRequest,
  RunRecordingResponse,
} from '../../shared/studio.js';
import type { AgentArtifact, AgentRunResult } from '../../shared/agent.js';
import { createRecordingAgentRun } from '../../shared/recordingAgent.js';
import type { RecordingVisualComparison } from '../../shared/recordingAgent.js';
import type { RecordingReplayResult } from './browser-runtime.js';
import type { VisualDiffRequest, VisualDiffResult } from './visual-diff.js';

interface RecordingBrowserRuntime {
  start: (request: BrowserSessionRequest) => Promise<BrowserSessionState>;
  navigate: (request: BrowserNavigateRequest) => Promise<BrowserSessionState>;
  replayRecordingSteps: (steps: RecordingStepDraft[], sessionId: string) => Promise<RecordingReplayResult[]>;
  beginTrace?: (runId: string) => Promise<boolean>;
  finishTrace?: () => Promise<RunArtifact | undefined>;
}

interface RecordingVisualDiff {
  compare: (request: VisualDiffRequest) => Promise<VisualDiffResult>;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = durationMs > 0 ? Math.ceil(durationMs / 1_000) : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function diffPathFor(actualPath: string): string {
  const extension = path.extname(actualPath) || '.png';
  return path.join(path.dirname(actualPath), `${path.basename(actualPath, extension)}-diff${extension}`);
}

export class RecordingRunner {
  constructor(
    private readonly browserRuntime: RecordingBrowserRuntime,
    private readonly emitRunEvent: (event: RunEventPayload) => void,
    private readonly visualDiff?: RecordingVisualDiff,
  ) {}

  async run(request: RunRecordingRequest): Promise<RunRecordingResponse> {
    const runId = `agent-run-recording-${Date.now()}`;
    const title = `${request.recording.name} 回放`;
    const documentId = request.documentId ?? request.recording.prdPath?.documentId;
    const startedAt = new Date();
    const emitEvents = !request.parentRunId;

    await this.browserRuntime.beginTrace?.(runId);

    if (emitEvents) {
      this.emitRunEvent({
        runId,
        title,
        type: 'status',
        status: 'running',
        summary: `正在回放 ${request.recording.steps.length} 个录制节点。`,
      });
    }

    let session = await this.browserRuntime.start({
      project: request.project,
      environment: request.environment,
      record: false,
    });
    if (session.status !== 'error' && request.recording.startUrl && session.currentUrl !== request.recording.startUrl) {
      session = await this.browserRuntime.navigate({ url: request.recording.startUrl });
    }
    if (emitEvents) {
      this.emitRunEvent({
        runId,
        title,
        type: 'log',
        line: `Recording context: ${session.currentUrl || request.recording.startUrl}`,
      });
    }
    const replayResults = await this.browserRuntime.replayRecordingSteps(request.recording.steps, runId);
    const visualComparisons = await this.compareScreenshots(request, replayResults);
    const endedAt = new Date();
    const traceArtifact = await this.browserRuntime.finishTrace?.();
    const baseAgentRun = createRecordingAgentRun({
      recording: request.recording,
      replayResults,
      projectId: request.project.id,
      ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
      ...(documentId ? { documentId } : {}),
      runId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      visualComparisons,
    });
    const agentRun = traceArtifact ? appendTraceArtifact(baseAgentRun, traceArtifact) : baseAgentRun;
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCaseId ?? request.recording.id,
      ...(documentId ? { documentId } : {}),
      environmentId: request.environment.id,
      title,
      status: agentRun.status,
      startedAt: agentRun.startedAt,
      endedAt: agentRun.endedAt,
      duration: formatDuration(endedAt.getTime() - startedAt.getTime()),
      summary: agentRun.summary,
      logs: agentRun.events.map((event) => `${event.type}: ${event.message}`),
      steps: request.recording.steps.map((step, index) => {
        const result = replayResults[index];
        return {
          id: `${runId}-step-${index}`,
          stepId: step.id,
          title: step.title,
          status: result?.status ?? 'neutral',
          message: result?.message ?? '该录制节点因前序失败尚未执行。',
          ...(result?.screenshotPath ? { screenshotPath: result.screenshotPath } : {}),
        };
      }),
      artifacts: agentRun.artifacts,
      agentRun,
      ...(agentRun.failureReason ? { failureReason: agentRun.failureReason } : {}),
    };

    if (emitEvents) {
      this.emitRunEvent({
        runId,
        title,
        type: 'complete',
        status: agentRun.status,
        duration: detail.duration,
        summary: detail.summary,
        detail,
      });
    }

    return { runId, title, detail, agentRun };
  }

  private async compareScreenshots(
    request: RunRecordingRequest,
    replayResults: RecordingReplayResult[],
  ): Promise<RecordingVisualComparison[]> {
    const visualDiff = this.visualDiff;
    if (!visualDiff) {
      return [];
    }

    const comparisons = await Promise.all(
      request.recording.steps.map(async (step, index) => {
        const result = replayResults[index];
        if (!step.screenshotPath || !result?.screenshotPath || result.status !== 'passed') {
          return undefined;
        }

        const actualPath = result.screenshotPath;
        const comparison = await visualDiff.compare({
          baselinePath: step.screenshotPath,
          actualPath,
          diffPath: diffPathFor(actualPath),
          differenceThreshold: request.recording.visualDiffThreshold ?? 0,
          ignoredRegions: request.recording.visualDiffMasks ?? [],
        });
        return {
          ...comparison,
          stepId: step.id,
          baselinePath: step.screenshotPath,
          actualPath,
        };
      }),
    );
    return comparisons.filter((comparison): comparison is NonNullable<typeof comparison> => Boolean(comparison));
  }
}

function appendTraceArtifact(agentRun: AgentRunResult, trace: RunArtifact): AgentRunResult {
  const artifact: AgentArtifact = {
    id: `${agentRun.runId}-artifact-trace`,
    type: 'trace',
    label: trace.label,
    path: trace.path,
  };
  return {
    ...agentRun,
    events: [
      ...agentRun.events,
      {
        id: `${agentRun.runId}-event-trace`,
        runId: agentRun.runId,
        type: 'agent:artifact-created',
        message: 'Playwright Trace 已归档。',
        status: agentRun.status,
        artifact,
        createdAt: new Date().toISOString(),
      },
    ],
    artifacts: [...agentRun.artifacts, artifact],
  };
}
