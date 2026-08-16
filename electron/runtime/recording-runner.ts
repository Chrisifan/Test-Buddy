import path from 'node:path';

import type {
  BrowserSessionRequest,
  BrowserSessionState,
  BrowserNavigateRequest,
  RecordingStepDraft,
  RunDetail,
  RunArtifact,
  RunEventPayload,
  RunReason,
  RunStatus,
  RunRecordingRequest,
  RunRecordingResponse,
} from '../../shared/studio.js';
import type { AgentArtifact, AgentRunResult } from '../../shared/agent.js';
import { createRecordingAgentRun } from '../../shared/recordingAgent.js';
import type { RecordingVisualComparison } from '../../shared/recordingAgent.js';
import type { RecordingReplayResult } from './browser-runtime.js';
import type { VisualDiffRequest, VisualDiffResult } from './visual-diff.js';
import {
  awaitWithRunCancellation,
  createUserRunCancellation,
  isRunCancelled,
  markAgentRunCancelled,
  throwIfRunCancelled,
} from './run-cancellation.js';

interface RecordingBrowserRuntime {
  start: (request: BrowserSessionRequest) => Promise<BrowserSessionState>;
  navigate: (request: BrowserNavigateRequest) => Promise<BrowserSessionState>;
  replayRecordingSteps: (
    steps: RecordingStepDraft[],
    sessionId: string,
    cancellationSignal?: AbortSignal,
  ) => Promise<RecordingReplayResult[]>;
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
    const runId = request.runId ?? `agent-run-recording-${Date.now()}`;
    const title = `${request.recording.name} 回放`;
    const documentId = request.documentId ?? request.recording.prdPath?.documentId;
    const startedAt = new Date();
    const emitEvents = !request.parentRunId;

    if (emitEvents) {
      this.emitRunEvent({
        runId,
        title,
        type: 'status',
        status: 'running',
        summary: `正在回放 ${request.recording.steps.length} 个录制节点。`,
      });
    }

    let replayResults: RecordingReplayResult[] = [];
    let visualComparisons: RecordingVisualComparison[] = [];
    let cancelledAt: string | undefined;
    let preflightReason: string | undefined;
    let traceRequested = false;
    try {
      traceRequested = true;
      await awaitWithRunCancellation(Promise.resolve(this.browserRuntime.beginTrace?.(runId)), request.cancellationSignal);
      throwIfRunCancelled(request.cancellationSignal);
      let session = await awaitWithRunCancellation(
        this.browserRuntime.start({
          project: request.project,
          environment: request.environment,
          record: false,
        }),
        request.cancellationSignal,
      );
      if (session.status === 'error') {
        preflightReason = `浏览器会话未启动：${session.message}`;
      } else if (request.recording.startUrl && session.currentUrl !== request.recording.startUrl) {
        session = await awaitWithRunCancellation(
          this.browserRuntime.navigate({ url: request.recording.startUrl }),
          request.cancellationSignal,
        );
      }
      if (emitEvents && !preflightReason) {
        this.emitRunEvent({
          runId,
          title,
          type: 'log',
          line: `Recording context: ${session.currentUrl || request.recording.startUrl}`,
        });
      }
      if (!preflightReason) {
        const replay = request.cancellationSignal
          ? this.browserRuntime.replayRecordingSteps(request.recording.steps, runId, request.cancellationSignal)
          : this.browserRuntime.replayRecordingSteps(request.recording.steps, runId);
        replayResults = await awaitWithRunCancellation(replay, request.cancellationSignal);
        visualComparisons = await this.compareScreenshots(request, replayResults, request.cancellationSignal);
      }
    } catch (error) {
      if (!isRunCancelled(error)) {
        throw error;
      }
      cancelledAt = new Date().toISOString();
    }
    const endedAt = new Date();
    const traceArtifact = traceRequested ? await this.browserRuntime.finishTrace?.() : undefined;
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
    const preflightAgentRun = preflightReason ? markAgentRunPreflightBlocked(baseAgentRun, preflightReason) : baseAgentRun;
    const tracedAgentRun = traceArtifact ? appendTraceArtifact(preflightAgentRun, traceArtifact) : preflightAgentRun;
    const cancellation = cancelledAt ? createUserRunCancellation(cancelledAt) : undefined;
    const agentRun = cancellation ? markAgentRunCancelled(tracedAgentRun, cancellation) : tracedAgentRun;
    const outcome = terminalRecordingOutcome(agentRun, cancellation, preflightReason);
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCaseId ?? request.recording.id,
      ...(documentId ? { documentId } : {}),
      environmentId: request.environment.id,
      title,
      status: outcome.status,
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
          status: outcome.status === 'cancelled'
            ? 'cancelled'
            : result?.status ?? (outcome.status === 'blocked' ? 'blocked' : 'skipped'),
          message: result?.message ?? outcome.reason?.message ?? '该录制节点因前序失败尚未执行。',
          ...(result?.screenshotPath ? { screenshotPath: result.screenshotPath } : {}),
        };
      }),
      artifacts: agentRun.artifacts,
      agentRun,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(agentRun.failureReason ? { failureReason: agentRun.failureReason } : {}),
      ...(cancellation ? { cancellation } : {}),
    };

    if (emitEvents) {
      this.emitRunEvent({
        runId,
        title,
        type: 'complete',
        status: detail.status,
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
    cancellationSignal?: AbortSignal,
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
        let comparison: VisualDiffResult;
        try {
          comparison = await awaitWithRunCancellation(visualDiff.compare({
            baselinePath: step.screenshotPath,
            actualPath,
            diffPath: diffPathFor(actualPath),
            differenceThreshold: request.recording.visualDiffThreshold ?? 0,
            ignoredRegions: request.recording.visualDiffMasks ?? [],
          }), cancellationSignal);
        } catch (error) {
          if (isRunCancelled(error)) {
            throw error;
          }
          comparison = {
            status: 'neutral',
            message: `视觉对比不可用，未生成结论：${(error as Error).message || '未知错误'}`,
            changedPixels: 0,
            totalPixels: 0,
            maskedPixels: 0,
            differenceRatio: 0,
          };
        }
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

function markAgentRunPreflightBlocked(agentRun: AgentRunResult, reason: string): AgentRunResult {
  return {
    ...agentRun,
    status: 'neutral',
    summary: reason,
    events: [
      ...agentRun.events,
      {
        id: `${agentRun.runId}-event-preflight-blocked`,
        runId: agentRun.runId,
        type: 'agent:browser-action',
        message: reason,
        status: 'neutral',
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

interface TerminalRecordingOutcome {
  status: Exclude<RunStatus, 'running'>;
  reason?: RunReason;
}

function terminalRecordingOutcome(
  agentRun: AgentRunResult,
  cancellation: RunDetail['cancellation'],
  preflightReason: string | undefined,
): TerminalRecordingOutcome {
  if (cancellation) {
    return { status: 'cancelled', reason: runReason('userCancelled', cancellation.message) };
  }
  if (preflightReason) {
    return {
      status: 'blocked',
      reason: runReason(isCredentialUnavailable(preflightReason) ? 'credentialUnavailable' : 'unsupportedAction', preflightReason),
    };
  }
  if (agentRun.status === 'passed') {
    return { status: 'passed' };
  }
  if (agentRun.status === 'failed') {
    return { status: 'failed', reason: runReason('actionFailed', agentRun.failureReason ?? agentRun.summary) };
  }
  if (agentRun.status === 'neutral') {
    return { status: 'blocked', reason: runReason('unsupportedAction', agentRun.summary) };
  }
  return { status: 'error', reason: runReason('executorError', 'Recording executor did not produce a terminal result.') };
}

function runReason(code: RunReason['code'], message: string): RunReason {
  return { code, message };
}

function isCredentialUnavailable(message: string): boolean {
  return /认证|凭据|credential|storage state/i.test(message);
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
