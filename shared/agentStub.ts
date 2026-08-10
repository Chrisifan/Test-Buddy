import {
  createAgentIntent,
  type AgentPlan,
  type AgentPlanDraft,
  type AgentPlanProvenance,
  type AgentPlanRevision,
  type AgentReporterSummary,
  type AgentArtifact,
  type AgentAssertionReference,
  type AgentDynamicWaitAttempt,
  type AgentExecutionMetrics,
  type AgentFailureCategory,
  type AgentBrowserSessionSnapshot,
  type AgentObservation,
  type AgentModelAssignment,
  type AgentRecoveryStrategy,
  type AgentRunEvent,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentSelectorFallbackAttempt,
  type AgentStep,
  type AgentStepAction,
  type AgentSourceStepType,
  type AgentUsageBucket,
} from './agent.js';
import type { TestCaseDraft } from './studio.js';

export interface AgentStubRequest {
  mode: 'ai' | 'aiAssert' | 'aiQuery';
  prompt: string;
  runtimeDescription: string;
  targetEnvironment: string;
  projectId?: string;
  groupId?: string;
  environmentId?: string;
  testCaseId?: string;
  documentId?: string;
  targetUrl?: string;
  browserSession?: AgentBrowserSessionSnapshot;
  browserActionMessage?: string;
  primaryAction?: AgentStepAction;
  primaryInstruction?: string;
  primaryExpected?: string;
  primarySelector?: string;
  primaryValue?: string;
  observation?: Partial<
    Pick<
      AgentObservation,
      | 'domSummary'
      | 'textSummary'
      | 'interactiveElements'
      | 'consoleMessages'
      | 'networkHints'
      | 'tables'
      | 'charts'
    >
  >;
  verificationStatus?: AgentRunStatus;
  verificationSummary?: string;
  verificationEvidence?: string;
  verificationFailureReason?: string;
  reportArtifactPath?: string;
  executionMetrics?: AgentExecutionMetrics;
  modelAssignments?: AgentModelAssignment[];
  plannedPlan?: AgentPlanDraft;
  planner?: AgentPlanProvenance;
}

interface WorkflowAgentStepInput {
  id: string;
  type: 'ai' | 'aiAssert' | 'aiQuery';
  title: string;
  body: string;
}

export interface WorkflowAgentRunRequest {
  workflow: {
    id: string;
    name: string;
    url: string;
    steps: WorkflowAgentStepInput[];
  };
  stepRuns: AgentRunResult[];
  runId?: string;
  projectId?: string;
  environmentId?: string;
  documentId?: string;
}

export interface TestCaseAgentRunRequest {
  testCase: TestCaseDraft;
  stepRuns: Array<AgentRunResult | undefined>;
  runId?: string;
  projectId?: string;
  environmentId?: string;
}

export interface PlannedAgentStepExecution {
  stepIndex: number;
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
  failureCategory?: AgentFailureCategory;
  recoveryStrategy?: AgentRecoveryStrategy;
  browserActionMessage?: string;
  browserSession?: AgentBrowserSessionSnapshot;
  observation?: Partial<
    Pick<
      AgentObservation,
      | 'domSummary'
      | 'textSummary'
      | 'interactiveElements'
      | 'consoleMessages'
      | 'networkHints'
      | 'tables'
      | 'charts'
    >
  >;
  reportArtifactPath?: string;
  dynamicWaitAttempts?: AgentDynamicWaitAttempt[];
  retryAttempts?: Array<{
    status: AgentRunStatus;
    summary: string;
    evidence: string;
    failureReason?: string;
    failureCategory?: AgentFailureCategory;
    recoveryStrategy?: AgentRecoveryStrategy;
  }>;
  selectorFallbackAttempts?: AgentSelectorFallbackAttempt[];
  metrics?: AgentExecutionMetrics;
}

export interface PlannedAgentReplanningRecord {
  cycle: number;
  previousPlan: AgentPlanDraft;
  revisedPlan: AgentPlanDraft;
  executions: PlannedAgentStepExecution[];
  failedStepIndex: number;
  completedStepCount?: number;
  planningMetrics?: AgentExecutionMetrics;
}

export interface PlannedAgentRunRequest {
  mode: AgentStubRequest['mode'];
  prompt: string;
  runtimeDescription: string;
  targetEnvironment: string;
  targetUrl?: string;
  projectId?: string;
  groupId?: string;
  environmentId?: string;
  testCaseId?: string;
  documentId?: string;
  plannedPlan: AgentPlanDraft;
  planner: AgentPlanProvenance;
  executions: PlannedAgentStepExecution[];
  /** Present only for a user-confirmed, explicit Case assertion. */
  assertion?: AgentAssertionReference;
  replanningHistory?: PlannedAgentReplanningRecord[];
  planningMetrics?: AgentExecutionMetrics;
  executionMetrics?: AgentExecutionMetrics;
  modelAssignments?: AgentModelAssignment[];
}

function modeToAction(mode: AgentStubRequest['mode']): AgentStepAction {
  if (mode === 'aiAssert') {
    return 'assert';
  }

  if (mode === 'aiQuery') {
    return 'extract';
  }

  return 'observe';
}

function modeToSourceStepType(mode: AgentStubRequest['mode']): AgentSourceStepType {
  return mode;
}

function formatModelAssignments(assignments: AgentModelAssignment[] | undefined): string {
  if (!assignments?.length) {
    return '';
  }

  return assignments
    .map((assignment) => {
      const modelName = assignment.modelName || '未配置';
      const status = assignment.enabled ? modelName : `${modelName} / paused`;
      return `${assignment.role[0]!.toUpperCase()}${assignment.role.slice(1)}: ${status}`;
    })
    .join('；');
}

function formatPlannerProvenance(planner: AgentPlanProvenance | undefined): string {
  if (!planner) {
    return '';
  }
  if (planner.source === 'model') {
    return `Planner 模型：${planner.modelName || '未命名模型'}`;
  }
  return planner.fallbackReason ? `Planner 已降级为规则规划：${planner.fallbackReason}` : 'Planner：规则规划';
}

export function createStubAgentRun(request: AgentStubRequest): AgentRunResult {
  const now = new Date().toISOString();
  const runId = `agent-run-${Date.now()}`;
  const intent = createAgentIntent({
    source: 'naturalLanguage',
    prompt: request.prompt,
    page: 'nl',
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.groupId ? { groupId: request.groupId } : {}),
    ...(request.environmentId ? { environmentId: request.environmentId } : {}),
    ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
    ...(request.documentId ? { documentId: request.documentId } : {}),
    ...(request.targetUrl ? { targetUrl: request.targetUrl } : {}),
  });
  const primaryAction = request.primaryAction ?? modeToAction(request.mode);
  const primaryStepType = modeToSourceStepType(request.mode);
  const observedUrl = request.browserSession?.currentUrl || request.targetUrl || '';
  const observedTitle = request.browserSession?.pageTitle || 'Agent observation';
  const verificationStatus = request.verificationStatus ?? 'passed';
  const verificationSummary =
    request.verificationSummary ??
    (request.verificationStatus
      ? request.verificationStatus === 'passed'
        ? 'Agent 已完成真实断言验证。'
        : 'Agent 断言验证未通过。'
      : 'Agent stub 已完成结构化验证。');
  const rulePrimaryStep: AgentStep = {
    id: `${runId}-step-main`,
    action: primaryAction,
    title: '执行用户目标',
    instruction: request.primaryInstruction ?? request.prompt,
    expected:
      request.primaryExpected ??
      (request.mode === 'aiQuery' ? '返回结构化提取结果。' : '页面状态符合用户描述。'),
    sourceStepType: primaryStepType,
    ...(request.primarySelector ? { selector: request.primarySelector } : {}),
    ...(request.primaryValue !== undefined ? { value: request.primaryValue } : {}),
  };
  const plannedSteps: AgentStep[] = request.plannedPlan?.steps.length
    ? request.plannedPlan.steps.map((step, index) => ({
        ...step,
        id: `${runId}-step-planned-${index + 1}`,
        sourceStepType: primaryStepType,
      }))
    : [rulePrimaryStep];
  const primaryStep = plannedSteps[0]!;
  const prepareStep: AgentStep = {
    id: `${runId}-step-prepare`,
    action: 'observe',
    title: '准备执行上下文',
    instruction: `使用环境「${request.targetEnvironment}」和运行配置 ${request.runtimeDescription}。`,
    expected: '确认项目、环境和浏览器配置可用于 Agent 执行。',
  };
  const verificationStep: AgentStep = {
    id: `${runId}-step-verify`,
    action: 'assert',
    title: '验证执行结果',
    instruction: '根据观察结果判断本次目标是否达成。',
    expected: '生成通过/失败结论和证据摘要。',
  };
  const plan: AgentPlan = {
    id: `agent-plan-${Date.now()}`,
    intentId: intent.id,
    title: request.plannedPlan?.title ?? '自然语言 Agent 计划',
    summary:
      request.plannedPlan?.summary ??
      `根据用户目标生成 3 个阶段：准备上下文、执行 ${primaryAction}、验证结果。`,
    risks:
      request.plannedPlan?.risks ??
      (request.reportArtifactPath
        ? [
            '当前语义动作已由 Midscene 执行，但多步骤动态规划和重试仍待完善。',
            'Midscene 报告已归档，后续还需要补充模型 usage 和失败归因。',
          ]
        : [
            '当前仍为结构化 stub，尚未调用 Midscene 执行真实页面动作。',
            '真实执行前需要补充浏览器观察、语义定位和失败归因。',
          ]),
    ...(request.planner ? { planner: request.planner } : {}),
    createdAt: now,
    steps: [prepareStep, ...plannedSteps, verificationStep],
  };
  const observation: AgentObservation = {
    id: `${runId}-observation-main`,
    stepId: primaryStep.id,
    url: observedUrl,
    title: observedTitle,
    ...(request.observation?.textSummary ? { textSummary: request.observation.textSummary } : {}),
    domSummary: request.browserSession
      ? (request.observation?.domSummary ??
        `浏览器状态：${request.browserSession.status}；当前页面：${observedTitle || observedUrl || '未知页面'}。`)
      : '尚未收到浏览器会话快照，真实 Observer 接入后会填充 DOM 摘要。',
    ...(request.observation?.interactiveElements?.length
      ? { interactiveElements: request.observation.interactiveElements }
      : {}),
    ...(request.observation?.consoleMessages?.length ? { consoleMessages: request.observation.consoleMessages } : {}),
    ...(request.observation?.networkHints?.length ? { networkHints: request.observation.networkHints } : {}),
    ...(request.observation?.tables?.length ? { tables: request.observation.tables } : {}),
    ...(request.observation?.charts?.length ? { charts: request.observation.charts } : {}),
    createdAt: now,
  };
  if (request.browserSession?.screenshotPath) {
    observation.screenshotPath = request.browserSession.screenshotPath;
  }

  const observationEvent: AgentRunEvent = {
    id: `${runId}-event-observation`,
    runId,
    type: 'agent:observation-created',
    stepId: primaryStep.id,
    message: observation.domSummary ?? '已生成页面观察结果。',
    status: 'running',
    observation,
    createdAt: now,
  };
  if (request.browserSession) {
    observationEvent.browserSession = request.browserSession;
  }

  const midsceneReportArtifact: AgentArtifact | undefined = request.reportArtifactPath
    ? {
        id: `${runId}-artifact-midscene-report`,
        type: 'report',
        label: 'Midscene 执行报告',
        path: request.reportArtifactPath,
      }
    : undefined;

  const events: AgentRunEvent[] = [
    {
      id: `${runId}-event-plan`,
      runId,
      type: 'agent:plan-created',
      message: [
        plan.summary,
        formatPlannerProvenance(request.planner),
        formatModelAssignments(request.modelAssignments),
      ]
        .filter(Boolean)
        .join('；'),
      status: 'running',
      plan,
      createdAt: now,
    },
    {
      id: `${runId}-event-step-main`,
      runId,
      type: 'agent:step-started',
      stepId: primaryStep.id,
      message: `准备执行：${primaryStep.instruction}`,
      status: 'running',
      createdAt: now,
    },
    {
      id: `${runId}-event-browser-action`,
      runId,
      type: 'agent:browser-action',
      stepId: prepareStep.id,
      message: request.browserActionMessage ?? 'Agent 已准备浏览器执行上下文。',
      status: 'running',
      ...(request.executionMetrics ? { metrics: request.executionMetrics } : {}),
      createdAt: now,
    },
    observationEvent,
    ...(midsceneReportArtifact
      ? [
          {
            id: `${runId}-event-midscene-report`,
            runId,
            type: 'agent:artifact-created' as const,
            stepId: primaryStep.id,
            message: 'Midscene 执行报告已生成。',
            status: 'running' as const,
            artifact: midsceneReportArtifact,
            createdAt: now,
          },
        ]
      : []),
    {
      id: `${runId}-event-verification`,
      runId,
      type: 'agent:assertion-result',
      stepId: verificationStep.id,
      message: request.verificationStatus
        ? verificationSummary
        : '当前为 Agent stub 验证结果：计划和观察链路已生成，真实断言等待 Verifier 接入。',
      status: verificationStatus,
      verification: {
        id: `${runId}-verification-main`,
        stepId: verificationStep.id,
        status: verificationStatus,
        summary: verificationSummary,
        evidence: request.verificationEvidence ?? observation.domSummary ?? '',
        ...(request.verificationFailureReason ? { failureReason: request.verificationFailureReason } : {}),
        createdAt: now,
      },
      createdAt: now,
    },
    {
      id: `${runId}-event-finished`,
      runId,
      type: 'agent:run-finished',
      message:
        verificationStatus === 'passed'
          ? 'Agent 已生成计划并完成当前可执行验证。'
          : verificationStatus === 'failed'
            ? `Agent 运行结束，存在未通过断言：${request.verificationFailureReason ?? verificationSummary}`
            : `Agent 计划已生成，当前动作仍在等待执行：${verificationSummary}`,
      status: verificationStatus,
      createdAt: now,
    },
  ];

  return {
    runId,
    intent,
    plan,
    status: verificationStatus,
    events,
    artifacts: [
      {
        id: `${runId}-artifact-plan`,
        type: 'report',
        label: 'Agent 计划摘要',
        path: `memory://agent/${runId}/plan.md`,
      },
      ...(request.browserSession?.screenshotPath
        ? [
            {
              id: `${runId}-artifact-snapshot`,
              type: 'screenshot' as const,
              label: '浏览器观察截图',
              path: request.browserSession.screenshotPath,
            },
          ]
        : []),
      ...(midsceneReportArtifact ? [midsceneReportArtifact] : []),
    ],
    ...(request.executionMetrics ? { metrics: request.executionMetrics } : {}),
    ...(request.modelAssignments ? { modelAssignments: request.modelAssignments } : {}),
    startedAt: now,
    endedAt: now,
    ...(verificationStatus === 'failed' && request.verificationFailureReason
      ? { failureReason: request.verificationFailureReason }
      : {}),
    summary:
      verificationStatus === 'passed'
        ? request.verificationSummary ?? `Agent 已生成执行计划：${plan.steps.map((step) => step.title).join(' -> ')}。`
        : verificationSummary,
  };
}

export function createPlannedAgentRun(request: PlannedAgentRunRequest): AgentRunResult {
  const now = new Date().toISOString();
  const runId = `agent-run-${Date.now()}`;
  const intent = createAgentIntent({
    source: 'naturalLanguage',
    prompt: request.prompt,
    page: 'nl',
    ...(request.targetUrl ? { targetUrl: request.targetUrl } : {}),
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.groupId ? { groupId: request.groupId } : {}),
    ...(request.environmentId ? { environmentId: request.environmentId } : {}),
    ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
    ...(request.documentId ? { documentId: request.documentId } : {}),
  });
  const prepareStep: AgentStep = {
    id: `${runId}-step-prepare`,
    action: 'observe',
    title: '准备执行上下文',
    instruction: `使用环境「${request.targetEnvironment}」和运行配置 ${request.runtimeDescription}。`,
    expected: '确认项目、环境和浏览器配置可用于 Agent 执行。',
  };
  const plannedSteps: AgentStep[] = request.plannedPlan.steps.map((step, index) => ({
    ...step,
    id: `${runId}-step-planned-${index + 1}`,
    sourceStepType: modeToSourceStepType(request.mode),
  }));
  const verificationStep: AgentStep = {
    id: `${runId}-step-verify`,
    action: 'assert',
    title: '验证执行结果',
    instruction: '根据每个计划步骤的真实执行证据判断本次目标是否达成。',
    expected: '仅在全部计划步骤产生通过证据时标记运行通过。',
  };
  const plan: AgentPlan = {
    id: `agent-plan-${Date.now()}`,
    intentId: intent.id,
    title: request.plannedPlan.title,
    summary: request.plannedPlan.summary,
    steps: [prepareStep, ...plannedSteps, verificationStep],
    risks: request.plannedPlan.risks,
    planner: request.planner,
    createdAt: now,
  };
  const replanningHistory = request.replanningHistory ?? [];
  const historicalStepsByCycle = new Map<number, AgentStep[]>(
    replanningHistory.map((record) => [
      record.cycle,
      record.previousPlan.steps.map((step, index) => ({
        ...step,
        id: `${runId}-replan-${record.cycle}-step-${index + 1}`,
        sourceStepType: modeToSourceStepType(request.mode),
      })),
    ]),
  );
  const initialHistory = replanningHistory[0];
  const initialPlan: AgentPlan = initialHistory
    ? {
        ...plan,
        title: initialHistory.previousPlan.title,
        summary: initialHistory.previousPlan.summary,
        steps: [prepareStep, ...(historicalStepsByCycle.get(initialHistory.cycle) ?? []), verificationStep],
        risks: initialHistory.previousPlan.risks,
      }
    : plan;
  const failedExecution = request.executions.find((execution) => execution.status === 'failed');
  const executedStepIndexes = new Set(request.executions.map((execution) => execution.stepIndex));
  const hasPending =
    executedStepIndexes.size < request.plannedPlan.steps.length ||
    request.executions.some((execution) => execution.status !== 'passed');
  const status: AgentRunStatus = failedExecution ? 'failed' : hasPending ? 'neutral' : 'passed';
  const failureReason = failedExecution?.failureReason ?? (failedExecution ? failedExecution.summary : undefined);
  const events: AgentRunEvent[] = [
    {
      id: `${runId}-event-plan`,
      runId,
      type: 'agent:plan-created',
      message: [
        initialPlan.summary,
        formatPlannerProvenance(request.planner),
        formatModelAssignments(request.modelAssignments),
      ]
        .filter(Boolean)
        .join('；'),
      status: 'running',
      plan: initialPlan,
      ...(request.planningMetrics ? { metrics: request.planningMetrics } : {}),
      createdAt: now,
    },
  ];
  const artifacts: AgentArtifact[] = [
    {
      id: `${runId}-artifact-plan`,
      type: 'report',
      label: 'Agent 计划摘要',
      path: `memory://agent/${runId}/plan.md`,
    },
  ];
  const artifactPaths = new Set<string>();

  const appendExecutionEvents = (
    steps: AgentStep[],
    executions: PlannedAgentStepExecution[],
    idNamespace?: string,
  ) => {
    executions.forEach((execution) => {
      const step = steps[execution.stepIndex];
      if (!step) {
        return;
      }
      const stepIdentifier = idNamespace
        ? `${idNamespace}-step-${execution.stepIndex + 1}`
        : `step-${execution.stepIndex}`;
      const entityIdentifier = idNamespace ? stepIdentifier : `${execution.stepIndex}`;
      const eventId = (suffix: string) => `${runId}-event-${stepIdentifier}-${suffix}`;
      const observationId = `${runId}-observation-${entityIdentifier}`;
      const verificationId = `${runId}-verification-${entityIdentifier}`;
      events.push({
        id: eventId('started'),
        runId,
        type: 'agent:step-started',
        stepId: step.id,
        message: `执行计划步骤：${step.title}`,
        status: 'running',
        createdAt: now,
      });
      execution.dynamicWaitAttempts?.forEach((attempt, attemptIndex) => {
        const waitTarget =
          attempt.strategy === 'response' && attempt.urlPattern
            ? `等待接口响应 ${attempt.urlPattern}`
            : attempt.strategy === 'selector' && attempt.selector
              ? `等待 selector ${attempt.selector} 可见`
              : attempt.strategy === 'dataReady'
                ? '等待页面数据就绪'
                : attempt.strategy === 'networkIdle'
                  ? '等待页面网络空闲'
                  : '等待页面稳定';
        events.push({
          id: eventId(`dynamic-wait-${attemptIndex + 1}`),
          runId,
          type: 'agent:dynamic-wait',
          stepId: step.id,
          message: `计划步骤「${step.title}」${waitTarget} ${attempt.timeoutMs}ms；${attempt.summary}`,
          status: attempt.status === 'failed' ? 'failed' : 'running',
          dynamicWait: attempt,
          createdAt: now,
        });
      });
      execution.retryAttempts?.forEach((attempt, attemptIndex) => {
        events.push({
          id: eventId(`retry-${attemptIndex + 1}`),
          runId,
          type: 'agent:step-retried',
          stepId: step.id,
          message: `计划步骤「${step.title}」开始第 ${attemptIndex + 1} 次重试；上次结果：${attempt.summary}`,
          status: 'running',
          retryAttempt: attempt,
          createdAt: now,
        });
      });
      execution.selectorFallbackAttempts?.forEach((attempt, attemptIndex) => {
        events.push({
          id: eventId(`selector-fallback-${attemptIndex + 1}`),
          runId,
          type: 'agent:selector-fallback',
          stepId: step.id,
          message: `计划步骤「${step.title}」尝试 selector fallback：${attempt.originalSelector} -> ${attempt.candidateSelector}；${attempt.summary}`,
          status: attempt.status === 'failed' ? 'failed' : 'running',
          selectorFallback: attempt,
          createdAt: now,
        });
      });
      events.push({
        id: eventId('browser-action'),
        runId,
        type: 'agent:browser-action',
        stepId: step.id,
        message: execution.browserActionMessage ?? execution.summary,
        status: execution.status === 'failed' ? 'failed' : 'running',
        ...(execution.browserSession ? { browserSession: execution.browserSession } : {}),
        ...(execution.metrics ? { metrics: execution.metrics } : {}),
        createdAt: now,
      });

      if (execution.browserSession || execution.observation) {
        const observation: AgentObservation = {
          id: observationId,
          stepId: step.id,
          url: execution.browserSession?.currentUrl ?? request.targetUrl ?? '',
          title: execution.browserSession?.pageTitle ?? step.title,
          ...(execution.browserSession?.screenshotPath
            ? { screenshotPath: execution.browserSession.screenshotPath }
            : {}),
          ...execution.observation,
          createdAt: now,
        };
        events.push({
          id: eventId('observation'),
          runId,
          type: 'agent:observation-created',
          stepId: step.id,
          message: observation.domSummary ?? execution.summary,
          status: execution.status === 'failed' ? 'failed' : 'running',
          observation,
          ...(execution.browserSession ? { browserSession: execution.browserSession } : {}),
          createdAt: now,
        });
      }

      const stepArtifactCandidates: Array<Omit<AgentArtifact, 'id'>> = [
        ...(execution.browserSession?.screenshotPath
          ? [
              {
                type: 'screenshot' as const,
                label: `${step.title} · 页面截图`,
                path: execution.browserSession.screenshotPath,
              },
            ]
          : []),
        ...(execution.reportArtifactPath
          ? [
              {
                type: 'report' as const,
                label: `${step.title} · Midscene 报告`,
                path: execution.reportArtifactPath,
              },
            ]
          : []),
      ];
      stepArtifactCandidates.forEach((candidate, artifactIndex) => {
        if (artifactPaths.has(candidate.path)) {
          return;
        }
        artifactPaths.add(candidate.path);
        const artifact: AgentArtifact = {
          ...candidate,
          id: `${runId}-artifact-${entityIdentifier}-${artifactIndex}`,
        };
        artifacts.push(artifact);
        events.push({
          id: eventId(`artifact-${artifactIndex}`),
          runId,
          type: 'agent:artifact-created',
          stepId: step.id,
          message: `${artifact.label}已归档。`,
          status: execution.status === 'failed' ? 'failed' : 'running',
          artifact,
          createdAt: now,
        });
      });

      events.push({
        id: eventId('verification'),
        runId,
        type: 'agent:assertion-result',
        stepId: step.id,
        message: execution.summary,
        status: execution.status,
        verification: {
          id: verificationId,
          stepId: step.id,
          status: execution.status,
          summary: execution.summary,
          evidence: execution.evidence,
          ...(request.assertion && step.action === 'assert' ? { assertion: request.assertion } : {}),
          ...(execution.failureReason ? { failureReason: execution.failureReason } : {}),
          ...(execution.failureCategory ? { failureCategory: execution.failureCategory } : {}),
          ...(execution.recoveryStrategy ? { recoveryStrategy: execution.recoveryStrategy } : {}),
          createdAt: now,
        },
        createdAt: now,
      });
      if (execution.status === 'failed') {
        events.push({
          id: eventId('failed'),
          runId,
          type: 'agent:step-failed',
          stepId: step.id,
          message: execution.failureReason ?? execution.summary,
          status: 'failed',
          createdAt: now,
        });
      }
    });
  };

  replanningHistory.forEach((record) => {
    const historicalSteps = historicalStepsByCycle.get(record.cycle) ?? [];
    appendExecutionEvents(historicalSteps, record.executions, `replan-${record.cycle}`);
    const triggerExecution = record.executions.find((execution) => execution.stepIndex === record.failedStepIndex);
    const triggerStep = historicalSteps[record.failedStepIndex];
    if (!triggerExecution || !triggerStep) {
      return;
    }
    const planRevision: AgentPlanRevision = {
      cycle: record.cycle,
      previousPlanTitle: record.previousPlan.title,
      revisedPlanTitle: record.revisedPlan.title,
      triggerStepId: triggerStep.id,
      triggerStepTitle: triggerStep.title,
      triggerStatus: triggerExecution.status,
      ...(record.completedStepCount ? { completedStepCount: record.completedStepCount } : {}),
      ...(triggerExecution.failureReason ? { failureReason: triggerExecution.failureReason } : {}),
      ...(triggerExecution.failureCategory ? { failureCategory: triggerExecution.failureCategory } : {}),
      ...(triggerExecution.recoveryStrategy ? { recoveryStrategy: triggerExecution.recoveryStrategy } : {}),
    };
    events.push({
      id: `${runId}-event-plan-revised-${record.cycle}`,
      runId,
      type: 'agent:plan-revised',
      message: `第 ${record.cycle} 次重规划：${record.previousPlan.title} -> ${record.revisedPlan.title}`,
      status: 'neutral',
      stepId: triggerStep.id,
      planRevision,
      ...(record.planningMetrics ? { metrics: record.planningMetrics } : {}),
      createdAt: now,
    });
  });
  appendExecutionEvents(plannedSteps, request.executions);

  const verificationSummary =
    status === 'passed'
      ? `全部 ${plannedSteps.length} 个计划步骤均已产生通过证据。`
      : status === 'failed'
        ? `计划执行失败：${failureReason ?? '未知错误'}`
        : `已执行 ${executedStepIndexes.size}/${plannedSteps.length} 个计划步骤，运行尚未完成。`;
  events.push({
    id: `${runId}-event-final-verification`,
    runId,
    type: 'agent:assertion-result',
    stepId: verificationStep.id,
    message: verificationSummary,
    status,
    verification: {
      id: `${runId}-verification-final`,
      stepId: verificationStep.id,
      status,
      summary: verificationSummary,
      evidence: request.executions.map((execution) => execution.evidence).filter(Boolean).join('\n'),
      ...(failureReason ? { failureReason } : {}),
      createdAt: now,
    },
    createdAt: now,
  });
  events.push({
    id: `${runId}-event-finished`,
    runId,
    type: 'agent:run-finished',
    message: verificationSummary,
    status,
    createdAt: now,
  });

  return {
    runId,
    intent,
    plan,
    status,
    summary: verificationSummary,
    events,
    artifacts,
    ...(request.executionMetrics ? { metrics: request.executionMetrics } : {}),
    ...(request.modelAssignments ? { modelAssignments: request.modelAssignments } : {}),
    startedAt: now,
    endedAt: now,
    ...(failureReason ? { failureReason } : {}),
  };
}

function addUsageBucket(target: AgentUsageBucket, source: AgentUsageBucket): AgentUsageBucket {
  return {
    promptTokens: target.promptTokens + source.promptTokens,
    completionTokens: target.completionTokens + source.completionTokens,
    totalTokens: target.totalTokens + source.totalTokens,
    calls: target.calls + source.calls,
  };
}

function mergeUsageBuckets(
  metrics: AgentExecutionMetrics[],
  key: 'byIntent' | 'byModel',
): Record<string, AgentUsageBucket> {
  const merged: Record<string, AgentUsageBucket> = {};
  metrics.forEach((metric) => {
    Object.entries(metric[key]).forEach(([bucketKey, bucket]) => {
      merged[bucketKey] = addUsageBucket(
        merged[bucketKey] ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
        bucket,
      );
    });
  });
  return merged;
}

function mergeExecutionMetrics(stepRuns: AgentRunResult[]): AgentExecutionMetrics | undefined {
  const metrics = stepRuns.flatMap((run) => (run.metrics ? [run.metrics] : []));
  if (!metrics.length) {
    return undefined;
  }

  const replanningCycleLimits = metrics.flatMap((metric) =>
    metric.replanningCycleLimit ? [metric.replanningCycleLimit] : [],
  );
  const replanningCycles = metrics.reduce((total, metric) => total + (metric.replanningCycles ?? 0), 0);
  const retryAttempts = metrics.reduce((total, metric) => total + (metric.retryAttempts ?? 0), 0);
  const dynamicWaitAttempts = metrics.reduce((total, metric) => total + (metric.dynamicWaitAttempts ?? 0), 0);
  const selectorFallbackAttempts = metrics.reduce((total, metric) => total + (metric.selectorFallbackAttempts ?? 0), 0);
  return {
    durationMs: metrics.reduce((total, metric) => total + metric.durationMs, 0),
    modelTimeCostMs: metrics.reduce((total, metric) => total + metric.modelTimeCostMs, 0),
    calls: metrics.reduce((total, metric) => total + metric.calls, 0),
    promptTokens: metrics.reduce((total, metric) => total + metric.promptTokens, 0),
    completionTokens: metrics.reduce((total, metric) => total + metric.completionTokens, 0),
    totalTokens: metrics.reduce((total, metric) => total + metric.totalTokens, 0),
    cachedInputTokens: metrics.reduce((total, metric) => total + metric.cachedInputTokens, 0),
    ...(replanningCycleLimits.length ? { replanningCycleLimit: Math.max(...replanningCycleLimits) } : {}),
    ...(replanningCycles ? { replanningCycles } : {}),
    ...(retryAttempts ? { retryAttempts } : {}),
    ...(dynamicWaitAttempts ? { dynamicWaitAttempts } : {}),
    ...(selectorFallbackAttempts ? { selectorFallbackAttempts } : {}),
    byIntent: mergeUsageBuckets(metrics, 'byIntent'),
    byModel: mergeUsageBuckets(metrics, 'byModel'),
  };
}

function mergeModelAssignments(stepRuns: AgentRunResult[]): AgentModelAssignment[] {
  const assignmentsByRole = new Map<AgentModelAssignment['role'], AgentModelAssignment>();
  stepRuns.forEach((run) => {
    run.modelAssignments?.forEach((assignment) => {
      if (!assignmentsByRole.has(assignment.role)) {
        assignmentsByRole.set(assignment.role, assignment);
      }
    });
  });
  return Array.from(assignmentsByRole.values());
}

function remapReporterRecoveryPlan(
  reporter: AgentReporterSummary | undefined,
  sourceStepId: string | undefined,
): AgentReporterSummary | undefined {
  if (!reporter || !sourceStepId) {
    return reporter;
  }

  return {
    ...reporter,
    ...(reporter.recoveryPlan
      ? { recoveryPlan: { ...reporter.recoveryPlan, failedStepId: sourceStepId } }
      : {}),
  };
}

function workflowStepAction(step: WorkflowAgentStepInput, stepRun: AgentRunResult | undefined): AgentStepAction {
  const executedStep = stepRun?.plan.steps.find((candidate) => candidate.sourceStepType === step.type);
  if (executedStep) {
    return executedStep.action;
  }
  return step.type === 'aiAssert' ? 'assert' : step.type === 'aiQuery' ? 'extract' : 'observe';
}

export function createWorkflowAgentRun(request: WorkflowAgentRunRequest): AgentRunResult {
  const now = new Date().toISOString();
  const runId = request.runId ?? `agent-run-workflow-${Date.now()}`;
  const intent = createAgentIntent({
    source: 'workflow',
    prompt: `执行流程「${request.workflow.name}」`,
    page: 'workflow',
    targetUrl: request.workflow.url,
    testCaseId: request.workflow.id,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.environmentId ? { environmentId: request.environmentId } : {}),
    ...(request.documentId ? { documentId: request.documentId } : {}),
  });
  const planSteps: AgentStep[] = request.workflow.steps.map((step, index) => {
    const stepRun = request.stepRuns[index];
    const executedStep = stepRun?.plan.steps.find((candidate) => candidate.sourceStepType === step.type);
    return {
      id: step.id,
      action: workflowStepAction(step, stepRun),
      title: step.title,
      instruction: step.body,
      sourceStepType: step.type,
      ...(executedStep?.expected ? { expected: executedStep.expected } : {}),
      ...(executedStep?.selector ? { selector: executedStep.selector } : {}),
      ...(executedStep?.value !== undefined ? { value: executedStep.value } : {}),
      ...(executedStep?.url ? { url: executedStep.url } : {}),
    };
  });
  const plan: AgentPlan = {
    id: `agent-plan-workflow-${Date.now()}`,
    intentId: intent.id,
    title: request.workflow.name,
    summary: `Workflow 已转换为统一 Agent 计划，共 ${planSteps.length} 个步骤。`,
    steps: planSteps,
    risks:
      request.stepRuns.length < request.workflow.steps.length
        ? ['部分 Workflow 步骤尚未执行，运行结果保持等待态或已因前序失败停止。']
        : [],
    createdAt: now,
  };
  const hasFailure = request.stepRuns.some((run) => run.status === 'failed');
  const hasPending =
    request.stepRuns.length < request.workflow.steps.length || request.stepRuns.some((run) => run.status === 'neutral');
  const status: AgentRunStatus = hasFailure ? 'failed' : hasPending ? 'neutral' : 'passed';
  const failedRun = request.stepRuns.find((run) => run.status === 'failed');
  const failureReason = failedRun?.failureReason;
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

  request.workflow.steps.forEach((step, index) => {
    const stepRun = request.stepRuns[index];
    events.push({
      id: `${runId}-event-step-${index}-started`,
      runId,
      type: 'agent:step-started',
      stepId: step.id,
      message: stepRun ? `执行 Workflow 步骤：${step.title}` : `Workflow 步骤尚未执行：${step.title}`,
      status: stepRun ? 'running' : 'neutral',
      createdAt: stepRun?.startedAt ?? now,
    });

    if (!stepRun) {
      return;
    }

    stepRun.events
      .filter((event) =>
        [
          'agent:browser-action',
          'agent:observation-created',
          'agent:assertion-result',
          'agent:artifact-created',
          'agent:dynamic-wait',
          'agent:step-retried',
        ].includes(event.type),
      )
      .forEach((event, eventIndex) => {
        events.push({
          ...event,
          id: `${runId}-event-step-${index}-${eventIndex}`,
          runId,
          stepId: step.id,
          ...(event.observation ? { observation: { ...event.observation, stepId: step.id } } : {}),
          ...(event.verification ? { verification: { ...event.verification, stepId: step.id } } : {}),
        });
      });

    if (stepRun.status === 'failed') {
      events.push({
        id: `${runId}-event-step-${index}-failed`,
        runId,
        type: 'agent:step-failed',
        stepId: step.id,
        message: stepRun.failureReason ?? stepRun.summary,
        status: 'failed',
        createdAt: stepRun.endedAt ?? now,
      });
    }
  });

  events.push({
    id: `${runId}-event-finished`,
    runId,
    type: 'agent:run-finished',
    message:
      status === 'passed'
        ? `Workflow Agent 已完成 ${request.stepRuns.length} 个步骤。`
        : status === 'failed'
          ? `Workflow Agent 在步骤执行中失败：${failureReason ?? failedRun?.summary ?? '未知错误'}`
          : `Workflow Agent 已生成计划，${request.stepRuns.length}/${request.workflow.steps.length} 个步骤产生执行结果。`,
    status,
    createdAt: request.stepRuns.at(-1)?.endedAt ?? now,
  });

  const artifactPaths = new Set<string>();
  const artifacts = request.stepRuns.flatMap((stepRun, runIndex) =>
    stepRun.artifacts
      .filter((artifact) => !artifact.path.startsWith('memory://') && !artifactPaths.has(artifact.path))
      .map((artifact, artifactIndex) => {
        artifactPaths.add(artifact.path);
        return { ...artifact, id: `${runId}-artifact-${runIndex}-${artifactIndex}` };
      }),
  );
  const metrics = mergeExecutionMetrics(request.stepRuns);
  const modelAssignments = mergeModelAssignments(request.stepRuns);
  const reporterRunIndex = request.stepRuns.findIndex((run) => run.status !== 'passed' && run.reporter);
  const reporter = remapReporterRecoveryPlan(
    reporterRunIndex >= 0 ? request.stepRuns[reporterRunIndex]?.reporter : undefined,
    reporterRunIndex >= 0 ? request.workflow.steps[reporterRunIndex]?.id : undefined,
  );

  return {
    runId,
    intent,
    plan,
    status,
    summary:
      status === 'passed'
        ? `Workflow Agent 已完成全部 ${planSteps.length} 个步骤。`
        : status === 'failed'
          ? `Workflow Agent 执行失败：${failureReason ?? failedRun?.summary ?? '未知错误'}`
          : `Workflow Agent 已生成 ${planSteps.length} 个步骤的计划，等待完成执行。`,
    events,
    artifacts: [
      {
        id: `${runId}-artifact-plan`,
        type: 'report',
        label: 'Workflow Agent 计划摘要',
        path: `memory://agent/${runId}/plan.md`,
      },
      ...artifacts,
    ],
    ...(metrics ? { metrics } : {}),
    ...(modelAssignments.length ? { modelAssignments } : {}),
    ...(reporter ? { reporter } : {}),
    startedAt: request.stepRuns[0]?.startedAt ?? now,
    endedAt: request.stepRuns.at(-1)?.endedAt ?? now,
    ...(failureReason ? { failureReason } : {}),
  };
}

function testCaseStepAction(
  step: TestCaseDraft['steps'][number],
  stepRun: AgentRunResult | undefined,
): AgentStepAction {
  if (step.type === 'recordingReplay' || step.type === 'manual') {
    return 'observe';
  }

  const executedStep = stepRun?.plan.steps.find((candidate) => candidate.sourceStepType === step.type);
  if (executedStep) {
    return executedStep.action;
  }
  return step.type === 'aiAssert' ? 'assert' : step.type === 'aiQuery' ? 'extract' : 'observe';
}

export function createTestCaseAgentRun(request: TestCaseAgentRunRequest): AgentRunResult {
  const now = new Date().toISOString();
  const runId = request.runId ?? `agent-run-test-case-${Date.now()}`;
  const intent = createAgentIntent({
    source: 'workflow',
    prompt: `执行测试用例「${request.testCase.name}」`,
    page: 'testCase',
    targetUrl: request.testCase.url,
    testCaseId: request.testCase.id,
    groupId: request.testCase.groupId,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.environmentId ? { environmentId: request.environmentId } : {}),
    ...(request.testCase.prdPath?.documentId ? { documentId: request.testCase.prdPath.documentId } : {}),
  });
  const planSteps: AgentStep[] = request.testCase.steps.map((step, index) => {
    const stepRun = request.stepRuns[index];
    const executedStep = stepRun?.plan.steps.find((candidate) => candidate.sourceStepType === step.type);
    return {
      id: step.id,
      action: testCaseStepAction(step, stepRun),
      title: step.title,
      instruction: step.body,
      sourceStepType: step.type,
      ...(executedStep?.expected ? { expected: executedStep.expected } : {}),
      ...(executedStep?.selector ? { selector: executedStep.selector } : {}),
      ...(executedStep?.value !== undefined ? { value: executedStep.value } : {}),
      ...(executedStep?.url ? { url: executedStep.url } : {}),
    };
  });
  const executedRuns = request.stepRuns.filter((run): run is AgentRunResult => Boolean(run));
  const hasFailure = executedRuns.some((run) => run.status === 'failed');
  const hasPending =
    executedRuns.length < request.testCase.steps.length || executedRuns.some((run) => run.status === 'neutral');
  const status: AgentRunStatus = hasFailure ? 'failed' : hasPending ? 'neutral' : 'passed';
  const failedRun = executedRuns.find((run) => run.status === 'failed');
  const failureReason = failedRun?.failureReason;
  const plan: AgentPlan = {
    id: `agent-plan-test-case-${Date.now()}`,
    intentId: intent.id,
    title: request.testCase.name,
    summary: `测试用例已转换为统一 Agent 计划，共 ${planSteps.length} 个步骤。`,
    steps: planSteps,
    risks: hasPending ? ['部分测试步骤尚未获得真实执行结论，运行保持等待态。'] : [],
    createdAt: now,
  };
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

  request.testCase.steps.forEach((step, index) => {
    const stepRun = request.stepRuns[index];
    events.push({
      id: `${runId}-event-step-${index}-started`,
      runId,
      type: 'agent:step-started',
      stepId: step.id,
      message: stepRun ? `执行测试步骤：${step.title}` : `测试步骤尚未执行：${step.title}`,
      status: stepRun ? 'running' : 'neutral',
      createdAt: stepRun?.startedAt ?? now,
    });
    if (!stepRun) {
      return;
    }

    stepRun.events
      .filter((event) =>
        [
          'agent:browser-action',
          'agent:observation-created',
          'agent:assertion-result',
          'agent:artifact-created',
          'agent:dynamic-wait',
          'agent:step-retried',
        ].includes(event.type),
      )
      .forEach((event, eventIndex) => {
        events.push({
          ...event,
          id: `${runId}-event-step-${index}-${eventIndex}`,
          runId,
          stepId: step.id,
          ...(event.observation ? { observation: { ...event.observation, stepId: step.id } } : {}),
          ...(event.verification ? { verification: { ...event.verification, stepId: step.id } } : {}),
        });
      });
    if (stepRun.status === 'failed') {
      events.push({
        id: `${runId}-event-step-${index}-failed`,
        runId,
        type: 'agent:step-failed',
        stepId: step.id,
        message: stepRun.failureReason ?? stepRun.summary,
        status: 'failed',
        createdAt: stepRun.endedAt ?? now,
      });
    }
  });

  events.push({
    id: `${runId}-event-finished`,
    runId,
    type: 'agent:run-finished',
    message:
      status === 'passed'
        ? `测试用例 Agent 已完成 ${request.testCase.steps.length} 个步骤。`
        : status === 'failed'
          ? `测试用例 Agent 执行失败：${failureReason ?? failedRun?.summary ?? '未知错误'}`
          : `测试用例 Agent 已生成 ${request.testCase.steps.length} 个步骤的计划，等待完成执行。`,
    status,
    createdAt: executedRuns.at(-1)?.endedAt ?? now,
  });

  const artifactPaths = new Set<string>();
  const artifacts = executedRuns.flatMap((stepRun, runIndex) =>
    stepRun.artifacts
      .filter((artifact) => !artifact.path.startsWith('memory://') && !artifactPaths.has(artifact.path))
      .map((artifact, artifactIndex) => {
        artifactPaths.add(artifact.path);
        return { ...artifact, id: `${runId}-artifact-${runIndex}-${artifactIndex}` };
      }),
  );
  const metrics = mergeExecutionMetrics(executedRuns);
  const modelAssignments = mergeModelAssignments(executedRuns);
  const reporterRunIndex = request.stepRuns.findIndex((run) => run?.status !== 'passed' && run?.reporter);
  const reporter = remapReporterRecoveryPlan(
    reporterRunIndex >= 0 ? request.stepRuns[reporterRunIndex]?.reporter : undefined,
    reporterRunIndex >= 0 ? request.testCase.steps[reporterRunIndex]?.id : undefined,
  );

  return {
    runId,
    intent,
    plan,
    status,
    summary:
      status === 'passed'
        ? `测试用例 Agent 已完成全部 ${planSteps.length} 个步骤。`
        : status === 'failed'
          ? `测试用例 Agent 执行失败：${failureReason ?? failedRun?.summary ?? '未知错误'}`
          : `测试用例 Agent 已生成 ${planSteps.length} 个步骤的计划，等待完成执行。`,
    events,
    artifacts: [
      {
        id: `${runId}-artifact-plan`,
        type: 'report',
        label: '测试用例 Agent 计划摘要',
        path: `memory://agent/${runId}/plan.md`,
      },
      ...artifacts,
    ],
    ...(metrics ? { metrics } : {}),
    ...(modelAssignments.length ? { modelAssignments } : {}),
    ...(reporter ? { reporter } : {}),
    startedAt: executedRuns[0]?.startedAt ?? now,
    endedAt: executedRuns.at(-1)?.endedAt ?? now,
    ...(failureReason ? { failureReason } : {}),
  };
}
