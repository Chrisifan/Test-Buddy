import {
  createAgentIntent,
  type AgentArtifact,
  type AgentPlan,
  type AgentRunEvent,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentStepAction,
} from './agent.js';
import type { RecordingAsset, RecordingStepDraft } from './studio.js';

export interface RecordingReplayEvidence {
  step: RecordingStepDraft;
  status: 'passed' | 'failed';
  message: string;
  screenshotPath?: string;
}

export interface RecordingVisualComparison {
  stepId: string;
  status: 'passed' | 'failed' | 'neutral';
  message: string;
  changedPixels: number;
  totalPixels: number;
  maskedPixels?: number;
  differenceRatio: number;
  baselinePath: string;
  actualPath: string;
  diffPath?: string;
}

export interface RecordingAgentRunRequest {
  recording: RecordingAsset;
  replayResults: RecordingReplayEvidence[];
  projectId?: string;
  testCaseId?: string;
  documentId?: string;
  runId?: string;
  startedAt?: string;
  endedAt?: string;
  visualComparisons?: RecordingVisualComparison[];
}

const recordingAction = (kind: RecordingStepDraft['kind']): AgentStepAction => {
  if (kind === 'snapshot') return 'observe';
  return kind;
};

export const createRecordingAgentRun = (request: RecordingAgentRunRequest): AgentRunResult => {
  const now = new Date().toISOString();
  const runId = request.runId ?? `agent-run-recording-${Date.now()}`;
  const documentId = request.documentId ?? request.recording.prdPath?.documentId;
  const visualComparisons = request.visualComparisons ?? [];
  const visualComparisonByStepId = new Map(visualComparisons.map((comparison) => [comparison.stepId, comparison]));
  const hasBaseline = request.recording.steps.some((step) => Boolean(step.screenshotPath));
  const failedResult = request.replayResults.find((result) => result.status === 'failed');
  const failedVisualComparison = visualComparisons.find((comparison) => comparison.status === 'failed');
  const hasIncompleteReplay = request.replayResults.length < request.recording.steps.length;
  const comparisonPending = hasBaseline
    ? request.recording.steps.some(
        (step) => Boolean(step.screenshotPath) && visualComparisonByStepId.get(step.id)?.status !== 'passed',
      )
    : Boolean(request.recording.comparisonGoal.trim());
  const intent = createAgentIntent({
    source: 'recording',
    prompt: `回放录制资产「${request.recording.name}」并检查：${request.recording.comparisonGoal || '路径可重复执行'}`,
    recordingId: request.recording.id,
    targetUrl: request.recording.startUrl,
    page: 'recording',
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
    ...(documentId ? { documentId } : {}),
    environmentId: request.recording.environmentId,
    groupId: request.recording.groupId,
  });
  const plan: AgentPlan = {
    id: `agent-plan-recording-${Date.now()}`,
    intentId: intent.id,
    title: `${request.recording.name} 回放`,
    summary: `录制资产已转换为 ${request.recording.steps.length} 个可追踪的 Agent 回放步骤。`,
    steps: request.recording.steps.map((step) => ({
      id: step.id,
      action: recordingAction(step.kind),
      title: step.title,
      instruction: step.detail,
      expected: step.screenshotPath
        ? '保留实际截图并与录制基线建立证据对。'
        : '真实执行该录制节点并保存执行证据。',
      sourceStepType: 'recordingReplay',
      ...(step.selector ? { selector: step.selector } : {}),
      ...(step.value !== undefined ? { value: step.value } : {}),
      ...(step.pageUrl ? { url: step.pageUrl } : {}),
    })),
    risks: hasBaseline
      ? failedVisualComparison
        ? ['视觉基线对比发现差异，需要检查差异图和对应节点。']
        : comparisonPending
          ? ['基线截图尚未完成可比的视觉差异计算。']
          : ['已完成基线像素对比；仍建议为动态区域配置遮罩与阈值。']
      : ['当前录制没有截图基线，只能验证路径是否可重复执行。'],
    createdAt: now,
  };
  const status: AgentRunStatus = failedResult || failedVisualComparison
    ? 'failed'
    : comparisonPending || hasIncompleteReplay
      ? 'neutral'
      : 'passed';
  const failureReason = failedResult?.message ?? failedVisualComparison?.message;
  const events: AgentRunEvent[] = [
    {
      id: `${runId}-event-plan`,
      runId,
      type: 'agent:plan-created',
      message: plan.summary,
      status: 'running',
      plan,
      createdAt: now,
    },
  ];
  const artifacts: AgentArtifact[] = [
    {
      id: `${runId}-artifact-plan`,
      type: 'report',
      label: 'Recording Agent 计划摘要',
      path: `memory://agent/${runId}/plan.md`,
    },
  ];

  request.recording.steps.forEach((step, index) => {
    const result = request.replayResults[index];
    events.push({
      id: `${runId}-event-step-${index}-started`,
      runId,
      type: 'agent:step-started',
      stepId: step.id,
      message: result ? `执行录制节点：${step.title}` : `录制节点尚未执行：${step.title}`,
      status: result ? 'running' : 'neutral',
      createdAt: now,
    });

    if (step.screenshotPath) {
      const baselineArtifact: AgentArtifact = {
        id: `${runId}-artifact-${index}-baseline`,
        type: 'snapshot',
        label: `基线 · ${step.title}`,
        path: step.screenshotPath,
      };
      artifacts.push(baselineArtifact);
      events.push({
        id: `${runId}-event-${index}-baseline`,
        runId,
        type: 'agent:artifact-created',
        stepId: step.id,
        message: `已关联录制基线：${step.title}`,
        status: 'running',
        artifact: baselineArtifact,
        createdAt: now,
      });
    }

    if (!result) {
      return;
    }

    events.push({
      id: `${runId}-event-${index}-action`,
      runId,
      type: 'agent:browser-action',
      stepId: step.id,
      message: result.message,
      status: result.status,
      createdAt: now,
    });

    if (result.screenshotPath) {
      const actualArtifact: AgentArtifact = {
        id: `${runId}-artifact-${index}-actual`,
        type: 'screenshot',
        label: `实际 · ${step.title}`,
        path: result.screenshotPath,
      };
      artifacts.push(actualArtifact);
      events.push({
        id: `${runId}-event-${index}-actual`,
        runId,
        type: 'agent:artifact-created',
        stepId: step.id,
        message: `已保存回放截图：${step.title}`,
        status: result.status,
        artifact: actualArtifact,
        createdAt: now,
      });
      events.push({
        id: `${runId}-event-${index}-observation`,
        runId,
        type: 'agent:observation-created',
        stepId: step.id,
        message: `已捕获录制节点回放后的页面状态：${step.title}`,
        status: result.status,
        observation: {
          id: `${runId}-observation-${index}`,
          stepId: step.id,
          url: step.pageUrl ?? request.recording.startUrl,
          title: step.title,
          screenshotPath: result.screenshotPath,
          domSummary: result.message,
          createdAt: now,
        },
        createdAt: now,
      });
    }

    if (step.screenshotPath && result.screenshotPath && result.status === 'passed') {
      const comparison = visualComparisonByStepId.get(step.id);
      const evidence = comparison
        ? `基线与实际截图：${comparison.baselinePath} -> ${comparison.actualPath}；${comparison.message}；变化像素 ${comparison.changedPixels}/${comparison.totalPixels}（${(comparison.differenceRatio * 100).toFixed(2)}%）${comparison.maskedPixels ? `；已遮罩 ${comparison.maskedPixels} 个像素` : ''}。`
        : `基线与实际截图证据已配对：${step.screenshotPath} -> ${result.screenshotPath}`;
      if (comparison?.diffPath) {
        const diffArtifact: AgentArtifact = {
          id: `${runId}-artifact-${index}-diff`,
          type: 'snapshot',
          label: `差异 · ${step.title}`,
          path: comparison.diffPath,
        };
        artifacts.push(diffArtifact);
        events.push({
          id: `${runId}-event-${index}-diff`,
          runId,
          type: 'agent:artifact-created',
          stepId: step.id,
          message: `已生成视觉差异图：${step.title}`,
          status: comparison.status,
          artifact: diffArtifact,
          createdAt: now,
        });
      }
      events.push({
        id: `${runId}-event-${index}-comparison`,
        runId,
        type: 'agent:assertion-result',
        stepId: step.id,
        message: comparison?.message ?? '截图证据已配对，等待视觉差异计算。',
        status: comparison?.status ?? 'neutral',
        verification: {
          id: `${runId}-verification-${index}`,
          stepId: step.id,
          status: comparison?.status ?? 'neutral',
          summary: comparison?.message ?? '视觉基线对比尚未计算。',
          evidence,
          createdAt: now,
        },
        createdAt: now,
      });
    }

    if (result.status === 'failed') {
      events.push({
        id: `${runId}-event-${index}-failed`,
        runId,
        type: 'agent:step-failed',
        stepId: step.id,
        message: result.message,
        status: 'failed',
        createdAt: now,
      });
    }
  });

  events.push({
    id: `${runId}-event-finished`,
    runId,
    type: 'agent:run-finished',
    message:
      status === 'failed'
        ? `Recording Agent 回放失败：${failureReason ?? '未知错误'}`
        : status === 'neutral'
          ? 'Recording Agent 已完成可执行节点，视觉基线判断仍在等待。'
          : `Recording Agent 已完成 ${request.replayResults.length} 个节点。`,
    status,
    createdAt: now,
  });

  return {
    runId,
    intent,
    plan,
    status,
    summary:
      status === 'failed'
        ? `录制回放失败：${failureReason ?? '未知错误'}`
        : status === 'neutral'
          ? `已回放 ${request.replayResults.length}/${request.recording.steps.length} 个节点，视觉基线差异等待计算。`
          : `已成功回放全部 ${request.recording.steps.length} 个节点。`,
    events,
    artifacts,
    startedAt: request.startedAt ?? now,
    endedAt: request.endedAt ?? now,
    ...(failureReason ? { failureReason } : {}),
  };
};
