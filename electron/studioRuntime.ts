import {
  type ChatEntry,
  type BrowserSessionState,
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ProjectDraft,
  type ProjectEnvironment,
  type RunEventPayload,
  type RunDetail,
  type RunArtifact,
  type RunReason,
  type RunStatus,
  type RunWorkflowRequest,
  type RunWorkflowResponse,
  type RuntimeProfile,
  type ExplicitTestAssertion,
  type SessionStartRequest,
  type TestInputValueBinding,
  type TestStepDraft,
  defaultMidsceneConfig,
  resolveAgentModelAssignments,
} from '../shared/studio.js';
import {
  deriveAgentRecoveryPlan,
  AgentExecutionMetrics,
  AgentFailureCategory,
  AgentObservation,
  AgentRecoveryStrategy,
  AgentArtifact,
  AgentDynamicWaitAttempt,
  AgentPlanDraft,
  AgentPlanProvenance,
  AgentPlanStepDraft,
  AgentRunEvent,
  AgentRunResult,
  AgentRunStatus,
  AgentSelectorFallbackAttempt,
  AgentUsageBucket,
} from '../shared/agent.js';
import {
  createPlannedAgentRun,
  createStubAgentRun,
  createWorkflowAgentRun,
  type PlannedAgentReplanningRecord,
  type PlannedAgentStepExecution,
} from '../shared/agentStub.js';
import type {
  AgentPlanner,
  AgentPlannerModelConfig,
  AgentPlannerRequest,
  AgentPlannerResult,
} from './runtime/agent-planner.js';
import type {
  AgentReporter,
  AgentReporterModelConfig,
  AgentReporterResult,
} from './runtime/agent-reporter.js';
import type {
  AgentVerifier,
  AgentVerifierModelConfig,
} from './runtime/agent-verifier.js';
import type { SemanticActionRuntime } from './runtime/semantic-action-runtime.js';
import type {
  ResolvedChatCommandRequest,
  ResolvedRunWorkflowRequest,
} from './runtime/model-config-resolver.js';
import {
  awaitWithRunCancellation,
  createUserRunCancellation,
  isRunCancelled,
  markAgentRunCancelled,
  throwIfRunCancelled,
} from './runtime/run-cancellation.js';
import { createSecretRedactor } from './runtime/secret-redactor.js';
import {
  extractResponseUrlPattern,
  isObservationIntent,
} from './studio-runtime/routes.js';
import {
  createBrowserSessionCoordinator,
  createPendingSemanticEvaluation,
} from './studio-runtime/browser-session.js';
import type {
  BrowserObserver,
  BrowserPreparationResult,
  BrowserSessionCoordinator,
} from './studio-runtime/browser-session.js';
import { createAgentRunOrchestrator } from './studio-runtime/run-orchestration.js';
import type { AgentRunOrchestrator } from './studio-runtime/run-orchestration.js';

interface PlanningAttempt {
  result?: AgentPlannerResult;
  provenance: AgentPlanProvenance;
}

interface ReporterReportWriter {
  writeReporterReport: (request: { runId: string; markdown: string }) => Promise<{
    markdownPath: string;
    htmlPath?: string;
  }>;
}

export interface DeterministicInputBindingResolver {
  resolve(request: { projectId: string; binding: TestInputValueBinding }): Promise<string>;
}

export interface RunDeterministicStepRequest {
  /** Used only by the desktop runner to compose child-run evidence. */
  runId?: string;
  /** Parent case run. Child runs do not emit independent renderer events. */
  parentRunId?: string;
  /** Internal-only cancellation signal. It is never sent through renderer IPC. */
  cancellationSignal?: AbortSignal;
  sourceStep: TestStepDraft;
  plannedStep: AgentPlanStepDraft;
  /** A reference only. The resolved value must never enter the Agent plan or run evidence. */
  inputBinding?: TestInputValueBinding;
  /** Per-run main-process resolver for a transient Fixture output. Never crosses IPC. */
  inputBindingResolver?: DeterministicInputBindingResolver;
  assertion?: ExplicitTestAssertion;
  testCaseId: string;
  targetEnvironment: string;
  runtimeProfile: RuntimeProfile;
  project?: ProjectDraft;
  environment?: ProjectEnvironment;
  documentId?: string;
  browserSession?: BrowserSessionState;
}

export interface RunDeterministicStepResponse {
  runId: string;
  title: string;
  detail: RunDetail;
  agentRun: AgentRunResult;
}

const nowLabel = (): string => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
};

const describeRuntimeProfile = (profile: RuntimeProfile): string => {
  return `${profile.browser} / ${profile.viewport} / ${profile.headless ? 'headless' : 'headed'} / ${profile.baseUrl}`;
};

const formatDuration = (durationMs: number): string => {
  const totalSeconds = durationMs > 0 ? Math.ceil(durationMs / 1_000) : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

const createWorkflowRunDetail = (
  request: RunWorkflowRequest,
  agentRun: AgentRunResult,
): RunDetail => {
  const elapsedMs = Math.max(0, Date.parse(agentRun.endedAt ?? agentRun.startedAt) - Date.parse(agentRun.startedAt));
  const outcome = terminalAgentRunOutcome(agentRun, runReason('unsupportedAction', agentRun.summary));
  return {
    id: agentRun.runId,
    projectId: request.project?.id ?? '',
    testCaseId: request.workflow.id,
    ...(request.documentId ? { documentId: request.documentId } : {}),
    environmentId: request.environment?.id ?? request.targetEnvironment,
    title: request.workflow.name,
    status: outcome.status,
    startedAt: agentRun.startedAt,
    ...(agentRun.endedAt ? { endedAt: agentRun.endedAt } : {}),
    duration: formatDuration(agentRun.metrics?.durationMs ?? elapsedMs),
    summary: agentRun.summary,
    logs: agentRun.events.map((event) => `[${nowLabel()}] ${event.type}: ${event.message}`),
    steps: request.workflow.steps.map((step, index) => {
      const failedEvent = agentRun.events.find(
        (event) => event.type === 'agent:step-failed' && event.stepId === step.id,
      );
      const assertionEvent = agentRun.events.find(
        (event) => event.type === 'agent:assertion-result' && event.stepId === step.id,
      );
      const observationEvent = agentRun.events.find(
        (event) => event.type === 'agent:observation-created' && event.stepId === step.id,
      );
      const wasExecuted = agentRun.events.some(
        (event) => event.stepId === step.id && event.type !== 'agent:step-started',
      );
      const status = outcome.status === 'cancelled'
        ? 'cancelled'
        : failedEvent
          ? 'failed'
          : wasExecuted
            ? terminalAgentStatus(assertionEvent?.status ?? agentRun.status)
            : 'skipped';
      return {
        id: `${agentRun.runId}-step-${index}`,
        stepId: step.id,
        title: step.title,
        status,
        message:
          failedEvent?.message ??
          assertionEvent?.message ??
          observationEvent?.message ??
          '该步骤尚未执行。',
        ...(observationEvent?.observation?.screenshotPath
          ? { screenshotPath: observationEvent.observation.screenshotPath }
          : {}),
      };
    }),
    artifacts: agentRun.artifacts,
    agentRun,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(agentRun.failureReason ? { failureReason: agentRun.failureReason } : {}),
  };
};

const isSupportedDeterministicPlanStep = (
  step: AgentPlanStepDraft,
  assertion?: ExplicitTestAssertion,
  inputBinding?: TestInputValueBinding,
): boolean => {
  if (step.action === 'assert') {
    return Boolean(assertion);
  }
  if (step.action === 'navigate') {
    return Boolean(step.url?.trim());
  }
  if (step.action === 'click' || step.action === 'scroll') {
    return Boolean(step.selector?.trim());
  }
  if (step.action === 'input' || step.action === 'select') {
    return Boolean(step.selector?.trim() && inputBinding);
  }
  return step.action === 'wait' && (Boolean(step.selector?.trim()) || Boolean(step.timeoutMs && step.timeoutMs > 0));
};

/**
 * Deterministic input values are resolved only in the main process immediately
 * before browser dispatch. Never let a caller-provided plan value reach run
 * evidence, even when this API is used outside TestRunner.
 */
const sanitizeDeterministicPlanStep = (step: AgentPlanStepDraft): AgentPlanStepDraft => {
  if (step.action !== 'input' && step.action !== 'select') {
    return step;
  }
  const { value: _value, ...safeStep } = step;
  return safeStep;
};

const createDeterministicRunDetail = (
  request: RunDeterministicStepRequest,
  agentRun: AgentRunResult,
): RunDetail => {
  const elapsedMs = Math.max(0, Date.parse(agentRun.endedAt ?? agentRun.startedAt) - Date.parse(agentRun.startedAt));
  const plannedStep = agentRun.plan.steps.find((step) => step.sourceStepType === request.sourceStep.type);
  const sourceStepId = plannedStep?.id;
  const failedEvent = agentRun.events.find(
    (event) => event.type === 'agent:step-failed' && event.stepId === sourceStepId,
  );
  const assertionEvent = agentRun.events.find(
    (event) => event.type === 'agent:assertion-result' && event.stepId === sourceStepId,
  );
  const observationEvent = agentRun.events.find(
    (event) => event.type === 'agent:observation-created' && event.stepId === sourceStepId,
  );
  const outcome = terminalAgentRunOutcome(agentRun, deterministicFallbackReason(request, agentRun.summary));
  const stepStatus = outcome.status === 'cancelled'
    ? 'cancelled'
    : failedEvent
      ? 'failed'
      : assertionEvent
        ? terminalAgentStatus(assertionEvent.status)
        : outcome.status;
  return {
    id: agentRun.runId,
    projectId: request.project?.id ?? '',
    testCaseId: request.testCaseId,
    ...(request.documentId ? { documentId: request.documentId } : {}),
    environmentId: request.environment?.id ?? request.targetEnvironment,
    title: request.sourceStep.title,
    status: outcome.status,
    startedAt: agentRun.startedAt,
    ...(agentRun.endedAt ? { endedAt: agentRun.endedAt } : {}),
    duration: formatDuration(agentRun.metrics?.durationMs ?? elapsedMs),
    summary: agentRun.summary,
    logs: agentRun.events.map((event) => `[${nowLabel()}] ${event.type}: ${event.message}`),
    steps: [
      {
        id: `${agentRun.runId}-step-0`,
        stepId: request.sourceStep.id,
        title: request.sourceStep.title,
        status: stepStatus,
        message: failedEvent?.message ?? assertionEvent?.message ?? agentRun.summary,
        ...(observationEvent?.observation?.screenshotPath
          ? { screenshotPath: observationEvent.observation.screenshotPath }
          : {}),
      },
    ],
    artifacts: agentRun.artifacts,
    agentRun,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(agentRun.failureReason ? { failureReason: agentRun.failureReason } : {}),
  };
};

interface TerminalAgentOutcome {
  status: Exclude<RunStatus, 'running'>;
  reason?: RunReason;
}

const terminalAgentRunOutcome = (agentRun: AgentRunResult, fallback: RunReason): TerminalAgentOutcome => {
  if (agentRun.cancellation) {
    return { status: 'cancelled', reason: runReason('userCancelled', agentRun.cancellation.message) };
  }
  if (agentRun.status === 'passed') {
    return { status: 'passed' };
  }
  if (agentRun.status === 'failed') {
    const isAssertionFailure = agentRun.events.some((event) => (
      event.type === 'agent:assertion-result' && event.verification?.status === 'failed'
    ));
    return {
      status: 'failed',
      reason: runReason(isAssertionFailure ? 'assertionFailed' : 'actionFailed', agentRun.failureReason ?? agentRun.summary),
    };
  }
  if (agentRun.status === 'neutral') {
    return { status: 'blocked', reason: fallback };
  }
  return { status: 'error', reason: runReason('executorError', 'Agent runtime did not produce a terminal result.') };
};

const terminalAgentStatus = (status: AgentRunStatus): Exclude<RunStatus, 'running'> => {
  if (status === 'passed') {
    return 'passed';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'neutral') {
    return 'blocked';
  }
  return 'error';
};

const deterministicFallbackReason = (request: RunDeterministicStepRequest, message: string): RunReason => {
  const code = request.inputBinding?.kind === 'credential'
    ? 'credentialUnavailable'
    : request.inputBinding?.kind === 'fixtureOutput'
      ? 'fixturePreflight'
      : 'unsupportedAction';
  return runReason(code, message);
};

const runReason = (code: RunReason['code'], message: string): RunReason => {
  return { code, message };
};

const appendTraceArtifact = (agentRun: AgentRunResult, trace: RunArtifact): AgentRunResult => {
  const artifact: AgentArtifact = {
    id: `${agentRun.runId}-artifact-trace`,
    type: 'trace',
    label: trace.label,
    path: trace.path,
  };
  const createdAt = new Date().toISOString();
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
        createdAt,
      },
    ],
    artifacts: [...agentRun.artifacts, artifact],
  };
};

const makeAssistantReply = (
  mode: ChatCommandRequest['mode'],
  prompt: string,
  runtimeProfile: RuntimeProfile,
): string => {
  if (mode === 'aiAssert') {
    return `主进程已接收断言指令：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，等接入 MidScene 后，这里会替换成真实断言执行结果。`;
  }

  if (mode === 'aiQuery') {
    return `主进程已接收提取指令：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，提取结果将写入本次运行证据。`;
  }

  return `主进程已接收动作指令：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，前端和桌面端的命令流已经打通。`;
};


const addUsageBucket = (left: AgentUsageBucket | undefined, right: AgentUsageBucket): AgentUsageBucket => {
  return {
    calls: (left?.calls ?? 0) + right.calls,
    promptTokens: (left?.promptTokens ?? 0) + right.promptTokens,
    completionTokens: (left?.completionTokens ?? 0) + right.completionTokens,
    totalTokens: (left?.totalTokens ?? 0) + right.totalTokens,
  };
};

const mergeExecutionMetrics = (
  left: AgentExecutionMetrics | undefined,
  right: AgentExecutionMetrics | undefined,
): AgentExecutionMetrics | undefined => {
  if (!left) return right;
  if (!right) return left;

  const byIntent = { ...left.byIntent };
  for (const [key, bucket] of Object.entries(right.byIntent)) {
    byIntent[key] = addUsageBucket(byIntent[key], bucket);
  }
  const byModel = { ...left.byModel };
  for (const [key, bucket] of Object.entries(right.byModel)) {
    byModel[key] = addUsageBucket(byModel[key], bucket);
  }

  return {
    durationMs: left.durationMs + right.durationMs,
    modelTimeCostMs: left.modelTimeCostMs + right.modelTimeCostMs,
    calls: left.calls + right.calls,
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    ...(left.replanningCycleLimit || right.replanningCycleLimit
      ? { replanningCycleLimit: Math.max(left.replanningCycleLimit ?? 0, right.replanningCycleLimit ?? 0) }
      : {}),
    ...(left.replanningCycles || right.replanningCycles
      ? { replanningCycles: (left.replanningCycles ?? 0) + (right.replanningCycles ?? 0) }
      : {}),
    ...(left.retryAttempts || right.retryAttempts
      ? { retryAttempts: (left.retryAttempts ?? 0) + (right.retryAttempts ?? 0) }
      : {}),
    ...(left.dynamicWaitAttempts || right.dynamicWaitAttempts
      ? { dynamicWaitAttempts: (left.dynamicWaitAttempts ?? 0) + (right.dynamicWaitAttempts ?? 0) }
      : {}),
    ...(left.selectorFallbackAttempts || right.selectorFallbackAttempts
      ? { selectorFallbackAttempts: (left.selectorFallbackAttempts ?? 0) + (right.selectorFallbackAttempts ?? 0) }
      : {}),
    byIntent,
    byModel,
  };
};

const withReplanningCycle = (metrics: AgentExecutionMetrics): AgentExecutionMetrics => {
  return {
    ...metrics,
    replanningCycles: Math.max(1, metrics.replanningCycles ?? 0),
  };
};

const withReplanningCycleLimit = (
  metrics: AgentExecutionMetrics,
  replanningCycleLimit: number,
): AgentExecutionMetrics => {
  return {
    ...metrics,
    replanningCycleLimit: Math.max(metrics.replanningCycleLimit ?? 0, replanningCycleLimit),
  };
};

const resolvePlannerReplanningCycleLimit = (request: ChatCommandRequest): number => {
  const parsed = Number.parseInt(request.midsceneConfig?.replanningCycleLimit ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10) : 1;
};

const withRetryAttempt = (metrics: AgentExecutionMetrics): AgentExecutionMetrics => {
  return {
    ...metrics,
    retryAttempts: (metrics.retryAttempts ?? 0) + 1,
  };
};

const withDynamicWaitAttempt = (metrics: AgentExecutionMetrics): AgentExecutionMetrics => {
  return {
    ...metrics,
    dynamicWaitAttempts: (metrics.dynamicWaitAttempts ?? 0) + 1,
  };
};

const withSelectorFallbackAttempt = (metrics: AgentExecutionMetrics): AgentExecutionMetrics => {
  return {
    ...metrics,
    selectorFallbackAttempts: (metrics.selectorFallbackAttempts ?? 0) + 1,
  };
};

const canRetryFailedStep = (step: AgentPlanStepDraft): boolean => {
  if (step.action === 'navigate') return Boolean(step.url);
  if (step.action === 'click' || step.action === 'input' || step.action === 'select') return Boolean(step.selector);
  return step.action === 'wait' || step.action === 'scroll' || step.action === 'observe';
};

const shouldRetryFailedExecution = (step: AgentPlanStepDraft, execution: PlannedAgentStepExecution): boolean => {
  if (
    execution.recoveryStrategy === 'replaceSelector' ||
    execution.recoveryStrategy === 'replanNavigation' ||
    execution.recoveryStrategy === 'replanFromCurrentState' ||
    execution.recoveryStrategy === 'stopAndReport'
  ) {
    return false;
  }
  return canRetryFailedStep(step);
};

const canWaitBeforeRetry = (
  step: AgentPlanStepDraft,
  recoveryStrategy?: AgentRecoveryStrategy,
): boolean => {
  if (recoveryStrategy === 'waitForReadiness') {
    return true;
  }
  if (recoveryStrategy === 'retryAfterWait') {
    return canRetryFailedStep(step);
  }
  return (step.action === 'click' || step.action === 'input' || step.action === 'select') && Boolean(step.selector);
};

const shouldWaitForDataReady = (
  step: AgentPlanStepDraft,
  failedExecution?: PlannedAgentStepExecution,
): boolean => {
  if (failedExecution?.recoveryStrategy !== 'waitForReadiness') {
    return false;
  }
  const context = [
    step.title,
    step.instruction,
    step.selector,
    failedExecution.failureReason,
    failedExecution.summary,
  ]
    .filter(Boolean)
    .join(' ');
  return /\b(?:table|tables|list|grid|data|dataset|rows?|chart)\b|表格|列表|数据|行数据|图表/i.test(context);
};

const responseUrlPatternForNetworkRecovery = (
  step: AgentPlanStepDraft,
  failedExecution?: PlannedAgentStepExecution,
): string | undefined => {
  if (
    failedExecution?.recoveryStrategy !== 'waitForReadiness' ||
    failedExecution.failureCategory !== 'network'
  ) {
    return undefined;
  }
  return extractResponseUrlPattern(step);
};

const canUseSelectorFallback = (step: AgentPlanStepDraft): boolean => {
  return (step.action === 'click' || step.action === 'input' || step.action === 'select') && Boolean(step.selector);
};

const shouldTrySelectorFallback = (
  step: AgentPlanStepDraft,
  execution: PlannedAgentStepExecution,
): boolean => {
  return execution.recoveryStrategy === 'replaceSelector' && canUseSelectorFallback(step);
};

const canReplanFailedStep = (step: AgentPlanStepDraft): boolean => {
  return ['navigate', 'click', 'input', 'wait', 'scroll', 'select', 'observe'].includes(step.action);
};

const shouldReplanFailedExecution = (
  step: AgentPlanStepDraft,
  execution: PlannedAgentStepExecution,
): boolean => {
  return canReplanFailedStep(step) && execution.recoveryStrategy !== 'stopAndReport';
};

const completedActionIdentity = (step: AgentPlanStepDraft): string | undefined => {
  if (step.action === 'navigate' && step.url) {
    return `navigate:url:${step.url}`;
  }
  if (step.action === 'click') {
    return step.selector ? `click:selector:${step.selector}` : step.target ? `click:target:${step.target}` : undefined;
  }
  if (step.action === 'input' || step.action === 'select') {
    const target = step.selector ? `selector:${step.selector}` : step.target ? `target:${step.target}` : undefined;
    return target && step.value !== undefined ? `${step.action}:${target}:value:${step.value}` : undefined;
  }
  return undefined;
};

const removeCompletedActionReplays = (
  plan: AgentPlanDraft,
  completedSteps: AgentPlanStepDraft[],
): { plan: AgentPlanDraft; skippedStepCount: number } => {
  const completedActions = new Set(completedSteps.map(completedActionIdentity).filter(Boolean));
  if (!completedActions.size) {
    return { plan, skippedStepCount: 0 };
  }
  const steps = plan.steps.filter((step) => {
    const identity = completedActionIdentity(step);
    return !identity || !completedActions.has(identity);
  });
  const skippedStepCount = plan.steps.length - steps.length;
  return {
    plan: skippedStepCount
      ? {
          ...plan,
          steps,
          risks: [...plan.risks, `已跳过 ${skippedStepCount} 个与已完成步骤完全相同的动作。`],
        }
      : plan,
    skippedStepCount,
  };
};

type CompletedPlannerStep = NonNullable<AgentPlannerRequest['completedSteps']>[number];

const appendCompletedPlannerSteps = (
  previousSteps: CompletedPlannerStep[],
  currentPlan: AgentPlanDraft,
  executions: PlannedAgentStepExecution[],
): CompletedPlannerStep[] => {
  const currentSteps = executions.flatMap((execution) => {
    if (execution.status !== 'passed') {
      return [];
    }
    const completedStep = currentPlan.steps[execution.stepIndex];
    if (!completedStep) {
      return [];
    }
    return [
      {
        stepIndex: 0,
        action: completedStep.action,
        title: completedStep.title,
        instruction: completedStep.instruction,
        evidence: execution.evidence,
        ...(completedStep.selector ? { selector: completedStep.selector } : {}),
        ...(completedStep.target ? { target: completedStep.target } : {}),
        ...(completedStep.value !== undefined ? { value: completedStep.value } : {}),
        ...(completedStep.url ? { url: completedStep.url } : {}),
        ...(execution.browserSession?.currentUrl ? { currentUrl: execution.browserSession.currentUrl } : {}),
      },
    ];
  });
  return [...previousSteps, ...currentSteps].map((step, index) => ({ ...step, stepIndex: index + 1 }));
};

interface SelectorFallbackCandidate {
  selector: string;
  source: string;
}

const selectorFallbackLimit = 3;
const dynamicRetryWaitMs = 500;
const dynamicRetrySelectorWaitMs = 1_000;
const dynamicRetryNetworkIdleWaitMs = 1_500;
const dynamicRetryDataReadyWaitMs = 1_500;
const dynamicRetryResponseWaitMs = 1_500;
const selectorFallbackStopWords = new Set([
  'a',
  'button',
  'click',
  'input',
  'link',
  'missing',
  'select',
  'selector',
  'textarea',
  'type',
  '按钮',
  '点击',
  '输入',
  '选择',
]);

const normalizeSelectorToken = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[`"'“”‘’#[\].=_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const tokenizeSelectorContext = (value: string): Set<string> => {
  return new Set(
    normalizeSelectorToken(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !selectorFallbackStopWords.has(token)),
  );
};

const extractSelectorFromInteractiveElement = (element: string): string | undefined => {
  const selectorMatch = element.match(/((?:#[\w-]+)|(?:\.[\w-]+)|(?:\[[^\]]+\])|(?:[a-z][\w-]*\[[^\]]+\]))\s*$/i);
  return selectorMatch?.[1];
};

const isSelectorFallbackActionCompatible = (action: AgentPlanStepDraft['action'], source: string): boolean => {
  const normalized = source.toLowerCase();
  if (action === 'click') {
    return /^(button|a)\b/.test(normalized) || /\brole="?button"?|\brole="?link"?/.test(normalized);
  }
  if (action === 'input') {
    return /^(input|textarea)\b/.test(normalized);
  }
  if (action === 'select') {
    return /^select\b/.test(normalized);
  }
  return false;
};

const hasSelectorFallbackTokenOverlap = (contextTokens: Set<string>, sourceTokens: Set<string>): boolean => {
  return [...sourceTokens].some((sourceToken) =>
    [...contextTokens].some(
      (contextToken) =>
        contextToken === sourceToken ||
        (sourceToken.length >= 2 && contextToken.length >= 2 && contextToken.includes(sourceToken)) ||
        (sourceToken.length >= 3 && contextToken.length >= 3 && sourceToken.includes(contextToken)),
    ),
  );
};

const resolveSelectorFallbackCandidates = (
  step: AgentPlanStepDraft,
  interactiveElements: string[] | undefined,
): SelectorFallbackCandidate[] => {
  if (!canUseSelectorFallback(step) || !interactiveElements?.length || !step.selector) {
    return [];
  }

  const contextTokens = tokenizeSelectorContext(
    [step.selector, step.title, step.instruction, step.target ?? ''].filter(Boolean).join(' '),
  );
  const seen = new Set([step.selector]);
  const candidates: SelectorFallbackCandidate[] = [];

  for (const source of interactiveElements) {
    const selector = extractSelectorFromInteractiveElement(source);
    if (!selector || seen.has(selector) || !isSelectorFallbackActionCompatible(step.action, source)) {
      continue;
    }

    const sourceTokens = tokenizeSelectorContext(source);
    const hasExplainableOverlap = hasSelectorFallbackTokenOverlap(contextTokens, sourceTokens);
    if (!hasExplainableOverlap) {
      continue;
    }

    seen.add(selector);
    candidates.push({ selector, source });
    if (candidates.length >= selectorFallbackLimit) {
      break;
    }
  }

  return candidates;
};

const createReporterMarkdown = (result: AgentReporterResult): string => {
  return [
    `# ${result.summary}`,
    '',
    '## 证据摘要',
    result.evidenceSummary,
    '',
    '## 失败归因',
    result.failureAnalysis,
    '',
    '## 修复建议',
    ...(result.suggestedFixes.length ? result.suggestedFixes.map((item) => `- ${item}`) : ['- 暂无明确建议。']),
  ].join('\n');
};

const plannerConfigForRequest = (request: ResolvedChatCommandRequest): {
  config?: AgentPlannerModelConfig;
  fallbackReason?: string;
} => {
  const role = request.agentModelConfig?.planner;
  if (!role) {
    return {};
  }
  if (!role.enabled) {
    return { fallbackReason: 'Planner 角色已停用' };
  }

  const config: AgentPlannerModelConfig =
    role.provider === 'openaiCompatible'
      ? {
          modelBaseUrl: role.modelBaseUrl,
          modelApiKey: role.modelApiKey,
          modelName: role.modelName,
          modelFamily: role.modelFamily,
          temperature: role.temperature,
        }
      : {
          modelBaseUrl: request.midsceneConfig?.modelBaseUrl ?? '',
          modelApiKey: request.midsceneConfig?.modelApiKey ?? '',
          modelName: request.midsceneConfig?.modelName ?? '',
          modelFamily: request.midsceneConfig?.modelFamily ?? '',
          temperature: role.temperature,
        };

  if (!config.modelBaseUrl.trim() || !config.modelApiKey.trim() || !config.modelName.trim()) {
    return { fallbackReason: 'Planner 模型配置不完整' };
  }
  return { config };
};

const verifierConfigForRequest = (request: ResolvedChatCommandRequest): {
  config?: AgentVerifierModelConfig;
  fallbackReason?: string;
} => {
  const role = request.agentModelConfig?.verifier;
  if (!role) {
    return {};
  }
  if (!role.enabled) {
    return { fallbackReason: 'Verifier 角色已停用' };
  }

  const config: AgentVerifierModelConfig =
    role.provider === 'openaiCompatible'
      ? {
          modelBaseUrl: role.modelBaseUrl,
          modelApiKey: role.modelApiKey,
          modelName: role.modelName,
          modelFamily: role.modelFamily,
          temperature: role.temperature,
        }
      : {
          modelBaseUrl: request.midsceneConfig?.modelBaseUrl ?? '',
          modelApiKey: request.midsceneConfig?.modelApiKey ?? '',
          modelName: request.midsceneConfig?.modelName ?? '',
          modelFamily: request.midsceneConfig?.modelFamily ?? '',
          temperature: role.temperature,
        };

  if (!config.modelBaseUrl.trim() || !config.modelApiKey.trim() || !config.modelName.trim()) {
    return { fallbackReason: 'Verifier 模型配置不完整' };
  }
  return { config };
};

const reporterConfigForRequest = (request: ResolvedChatCommandRequest): {
  config?: AgentReporterModelConfig;
  fallbackReason?: string;
} => {
  const role = request.agentModelConfig?.reporter;
  if (!role) {
    return {};
  }
  if (!role.enabled) {
    return { fallbackReason: 'Reporter 角色已停用' };
  }

  const config: AgentReporterModelConfig =
    role.provider === 'openaiCompatible'
      ? {
          modelBaseUrl: role.modelBaseUrl,
          modelApiKey: role.modelApiKey,
          modelName: role.modelName,
          modelFamily: role.modelFamily,
          temperature: role.temperature,
        }
      : {
          modelBaseUrl: request.midsceneConfig?.modelBaseUrl ?? '',
          modelApiKey: request.midsceneConfig?.modelApiKey ?? '',
          modelName: request.midsceneConfig?.modelName ?? '',
          modelFamily: request.midsceneConfig?.modelFamily ?? '',
          temperature: role.temperature,
        };

  if (!config.modelBaseUrl.trim() || !config.modelApiKey.trim() || !config.modelName.trim()) {
    return { fallbackReason: 'Reporter 模型配置不完整' };
  }
  return { config };
};

const resolvePlannerConfigForRequest = async (request: ResolvedChatCommandRequest): Promise<{
  config?: AgentPlannerModelConfig;
  fallbackReason?: string;
}> => {
  return request.modelConfigResolver
    ? request.modelConfigResolver.resolveAgentProviderConfig('planner')
    : plannerConfigForRequest(request);
};

const resolveVerifierConfigForRequest = async (request: ResolvedChatCommandRequest): Promise<{
  config?: AgentVerifierModelConfig;
  fallbackReason?: string;
}> => {
  return request.modelConfigResolver
    ? request.modelConfigResolver.resolveAgentProviderConfig('verifier')
    : verifierConfigForRequest(request);
};

const resolveReporterConfigForRequest = async (request: ResolvedChatCommandRequest): Promise<{
  config?: AgentReporterModelConfig;
  fallbackReason?: string;
}> => {
  return request.modelConfigResolver
    ? request.modelConfigResolver.resolveAgentProviderConfig('reporter')
    : reporterConfigForRequest(request);
};

const createPrimaryExecution = (browserPreparation: BrowserPreparationResult) => {
  if (browserPreparation.assertion) {
    return {
      primaryAction: 'assert' as const,
      primaryInstruction: `${browserPreparation.assertion.label} ${browserPreparation.assertion.expected}`,
      primaryExpected: '根据当前浏览器观察结果生成可判定的通过/失败结论。',
    };
  }

  if (browserPreparation.semanticAssertion) {
    return {
      primaryAction: 'assert' as const,
      primaryInstruction: browserPreparation.semanticAssertion,
      primaryExpected: '由 Midscene 根据页面视觉与 DOM 上下文判断断言是否成立。',
    };
  }

  if (browserPreparation.inputSelector && browserPreparation.inputValue !== undefined) {
    return {
      primaryAction: 'input' as const,
      primaryInstruction: `在 ${browserPreparation.inputSelector} 输入 ${browserPreparation.inputValue}`,
      primaryExpected: '目标输入控件可填写，并成功捕获输入后的页面状态。',
      primarySelector: browserPreparation.inputSelector,
      primaryValue: browserPreparation.inputValue,
    };
  }

  if (browserPreparation.inputTarget && browserPreparation.inputValue !== undefined) {
    return {
      primaryAction: 'input' as const,
      primaryInstruction: `在「${browserPreparation.inputTarget}」输入 ${browserPreparation.inputValue}`,
      primaryExpected: '等待 Midscene 语义定位输入控件后填写内容。',
      primaryValue: browserPreparation.inputValue,
    };
  }

  if (browserPreparation.selectedSelector && browserPreparation.selectedValue !== undefined) {
    return {
      primaryAction: 'select' as const,
      primaryInstruction: `在 ${browserPreparation.selectedSelector} 选择 ${browserPreparation.selectedValue}`,
      primaryExpected: '目标下拉控件可选择，并成功捕获选择后的页面状态。',
      primarySelector: browserPreparation.selectedSelector,
      primaryValue: browserPreparation.selectedValue,
    };
  }

  if (browserPreparation.waitedMs !== undefined) {
    return {
      primaryAction: 'wait' as const,
      primaryInstruction: `等待页面稳定 ${browserPreparation.waitedMs}ms`,
      primaryExpected: '等待策略完成，并成功捕获等待后的页面状态。',
    };
  }

  if (browserPreparation.scrolledSelector || browserPreparation.scrolledPage) {
    return {
      primaryAction: 'scroll' as const,
      primaryInstruction: browserPreparation.scrolledSelector ? `滚动到 ${browserPreparation.scrolledSelector}` : '滚动当前页面',
      primaryExpected: '页面或目标区域已完成滚动，并成功捕获当前页面状态。',
      ...(browserPreparation.scrolledSelector ? { primarySelector: browserPreparation.scrolledSelector } : {}),
    };
  }

  if (browserPreparation.clickedSelector) {
    return {
      primaryAction: 'click' as const,
      primaryInstruction: `点击 ${browserPreparation.clickedSelector}`,
      primaryExpected: '目标元素可点击，并成功捕获点击后的页面状态。',
      primarySelector: browserPreparation.clickedSelector,
    };
  }

  if (browserPreparation.clickTarget) {
    return {
      primaryAction: 'click' as const,
      primaryInstruction: `点击「${browserPreparation.clickTarget}」`,
      primaryExpected: '等待 Midscene 语义定位目标元素后执行点击。',
    };
  }

  if (browserPreparation.navigatedUrl) {
    return {
      primaryAction: 'navigate' as const,
      primaryInstruction: `导航到 ${browserPreparation.navigatedUrl}`,
      primaryExpected: '目标页面可访问，并成功捕获页面观察快照。',
    };
  }

  return {};
};

const toBrowserSessionSnapshot = (
  session: BrowserSessionState | undefined,
): PlannedAgentStepExecution['browserSession'] | undefined => {
  if (!session) {
    return undefined;
  }
  return {
    status: session.status,
    currentUrl: session.currentUrl,
    ...(session.pageTitle ? { pageTitle: session.pageTitle } : {}),
    ...(session.screenshotPath ? { screenshotPath: session.screenshotPath } : {}),
  };
};

const classifyFailureReason = (
  failureReason: string | undefined,
  step?: AgentPlanStepDraft,
): AgentFailureCategory | undefined => {
  if (!failureReason) {
    return undefined;
  }

  const text = `${failureReason} ${step?.action ?? ''} ${step?.selector ?? ''}`.toLowerCase();
  if (step?.action === 'assert') {
    return 'assertion';
  }
  if (/(?:selector|locator|element|元素|找不到|未找到|not found|not visible|detached)/i.test(text)) {
    return 'selector';
  }
  if (/(?:timeout|timed out|超时)/i.test(text)) {
    return 'timeout';
  }
  if (/(?:navigation|navigate|goto|net::err|页面跳转|导航)/i.test(text)) {
    return 'navigation';
  }
  if (/(?:network|request|response|接口|请求|连接|connection|fetch|http|5\d\d)/i.test(text)) {
    return 'network';
  }
  if (/(?:assert|expect|断言|不包含|不等于|不匹配|未观察到)/i.test(text)) {
    return 'assertion';
  }
  if (/(?:indeterminate|unknown|unexpected).*(?:state|状态)|(?:未知|不确定).*(?:状态|页面)/i.test(text)) {
    return 'unknown';
  }
  if (/(?:runtime|error|exception|failed|失败)/i.test(text)) {
    return 'runtime';
  }
  return 'runtime';
};

const recoveryStrategyForFailure = (
  failureCategory: AgentFailureCategory | undefined,
): AgentRecoveryStrategy | undefined => {
  if (!failureCategory) {
    return undefined;
  }

  if (failureCategory === 'selector') {
    return 'replaceSelector';
  }
  if (failureCategory === 'timeout' || failureCategory === 'network') {
    return 'waitForReadiness';
  }
  if (failureCategory === 'navigation') {
    return 'replanNavigation';
  }
  if (failureCategory === 'assertion') {
    return 'stopAndReport';
  }
  if (failureCategory === 'runtime') {
    return 'retryAfterWait';
  }
  return 'replanFromCurrentState';
};

const toPlannedStepExecution = (
  step: AgentPlanStepDraft,
  stepIndex: number,
  preparation: BrowserPreparationResult,
): PlannedAgentStepExecution => {
  const browserSession = toBrowserSessionSnapshot(preparation.session);
  if (preparation.assertionEvaluation) {
    const failureCategory = classifyFailureReason(preparation.assertionEvaluation.failureReason, step);
    const recoveryStrategy = recoveryStrategyForFailure(failureCategory);
    return {
      stepIndex,
      status: preparation.assertionEvaluation.status,
      summary: preparation.assertionEvaluation.summary,
      evidence: preparation.assertionEvaluation.evidence,
      ...(preparation.assertionEvaluation.failureReason
        ? { failureReason: preparation.assertionEvaluation.failureReason }
        : {}),
      ...(failureCategory ? { failureCategory } : {}),
      ...(recoveryStrategy ? { recoveryStrategy } : {}),
      browserActionMessage: preparation.message,
      ...(browserSession ? { browserSession } : {}),
      ...(preparation.observation ? { observation: preparation.observation } : {}),
      ...(preparation.reportArtifactPath ? { reportArtifactPath: preparation.reportArtifactPath } : {}),
      ...(preparation.executionMetrics ? { metrics: preparation.executionMetrics } : {}),
    };
  }

  const directActionPassed =
    (step.action === 'navigate' && Boolean(preparation.navigatedUrl)) ||
    (step.action === 'click' && Boolean(preparation.clickedSelector)) ||
    (step.action === 'input' && Boolean(preparation.inputSelector)) ||
    (step.action === 'wait' && preparation.waitedMs !== undefined) ||
    (step.action === 'scroll' && (Boolean(preparation.scrolledSelector) || preparation.scrolledPage)) ||
    (step.action === 'select' && Boolean(preparation.selectedSelector)) ||
    (step.action === 'extract' && Boolean(preparation.extracted)) ||
    (step.action === 'observe' && Boolean(preparation.session));
  if (directActionPassed) {
    const extractionEvidence =
      step.action === 'extract' && preparation.observation
        ? [
            preparation.observation.textSummary ? `文本摘要：${preparation.observation.textSummary}` : '',
            preparation.observation.tables?.length ? `表格：${preparation.observation.tables.length} 个` : '',
            preparation.observation.charts?.length ? `图表：${preparation.observation.charts.length} 个` : '',
          ]
            .filter(Boolean)
            .join('；')
        : '';
    return {
      stepIndex,
      status: 'passed',
      summary:
        step.action === 'extract'
          ? `计划步骤「${step.title}」已完成，已提取页面文本、表格和图表证据。`
          : `计划步骤「${step.title}」已完成。`,
      evidence: [
        preparation.message,
        extractionEvidence,
        preparation.session?.currentUrl ? `当前 URL：${preparation.session.currentUrl}` : '',
        preparation.session?.pageTitle ? `页面标题：${preparation.session.pageTitle}` : '',
      ]
        .filter(Boolean)
        .join('；'),
      browserActionMessage: preparation.message,
      ...(browserSession ? { browserSession } : {}),
      ...(preparation.observation ? { observation: preparation.observation } : {}),
      ...(preparation.reportArtifactPath ? { reportArtifactPath: preparation.reportArtifactPath } : {}),
      ...(preparation.executionMetrics ? { metrics: preparation.executionMetrics } : {}),
    };
  }

  return {
    stepIndex,
    status: 'neutral',
    summary: `Planner 动作「${step.action}」尚未接入真实执行器。`,
    evidence: `${preparation.message}；该步骤没有产生可判定的完成证据。`,
    browserActionMessage: preparation.message,
    ...(browserSession ? { browserSession } : {}),
    ...(preparation.observation ? { observation: preparation.observation } : {}),
    ...(preparation.executionMetrics ? { metrics: preparation.executionMetrics } : {}),
  };
};

export class StudioRuntime {
  private sessionActive = false;
  private activeTraceScope: string | null = null;
  private readonly browserSessionCoordinator: BrowserSessionCoordinator;
  private readonly agentRunOrchestrator: AgentRunOrchestrator;

  constructor(
    private readonly emitRunEvent: (event: RunEventPayload) => void,
    private readonly browserObserver?: BrowserObserver,
    private readonly semanticActionRuntime?: SemanticActionRuntime,
    private readonly agentPlanner?: AgentPlanner,
    private readonly agentVerifier?: AgentVerifier,
    private readonly agentReporter?: AgentReporter,
    private readonly reporterReportWriter?: ReporterReportWriter,
    private readonly deterministicInputBindingResolver?: DeterministicInputBindingResolver,
  ) {
    this.browserSessionCoordinator = createBrowserSessionCoordinator({
      browserObserver,
      semanticActionRuntime,
      agentVerifier,
      deterministicInputBindingResolver,
      resolveVerifierConfigForRequest,
    });
    this.agentRunOrchestrator = createAgentRunOrchestrator({
      browserSessionCoordinator: this.browserSessionCoordinator,
      beginTraceScope: (runId) => this.beginTraceScope(runId),
      finishTraceScope: (runId, ownsTraceScope, agentRun) => this.finishTraceScope(runId, ownsTraceScope, agentRun),
      createAgentPlan: (request) => this.createAgentPlan(request),
      resolvePlannerReplanningCycleLimit,
      prepareStepExecution: toPlannedStepExecution,
      mergeExecutionMetrics,
      withReplanningCycleLimit,
      shouldRetryFailedExecution,
      waitBeforeRetry: (step, failedExecution, cancellationSignal) =>
        this.waitBeforeRetry(step, failedExecution, cancellationSignal),
      withDynamicWaitAttempt,
      withRetryAttempt,
      shouldTrySelectorFallback,
      trySelectorFallbackForStep: (request, step, stepIndex, previousExecution, cancellationSignal) =>
        this.trySelectorFallbackForStep(request, step, stepIndex, previousExecution, cancellationSignal),
      withSelectorFallbackAttempt,
      appendCompletedPlannerSteps,
      shouldReplanFailedExecution,
      createReplannedAgentPlan: (request, currentPlan, failedStep, failedExecution, completedSteps) =>
        this.createReplannedAgentPlan(request, currentPlan, failedStep, failedExecution, completedSteps),
      withReplanningCycle,
      createPrimaryExecution,
      enhanceRunWithReporter: (request, agentRun) => this.enhanceRunWithReporter(request, agentRun),
      createChatCommandResponse: (request, agentRun) => this.createChatCommandResponse(request, agentRun),
    });
  }

  private async trySelectorFallbackForStep(
    request: ResolvedChatCommandRequest,
    step: AgentPlanStepDraft,
    stepIndex: number,
    previousExecution: PlannedAgentStepExecution,
    cancellationSignal?: AbortSignal,
  ): Promise<
    | {
        execution: PlannedAgentStepExecution;
        attempts: AgentSelectorFallbackAttempt[];
        executionMetrics?: AgentExecutionMetrics;
      }
    | undefined
  > {
    if (!canUseSelectorFallback(step) || !step.selector) {
      return undefined;
    }

    const observation = previousExecution.observation ?? (await this.captureBrowserObservation(cancellationSignal));
    const candidates = resolveSelectorFallbackCandidates(step, observation?.interactiveElements);
    if (!candidates.length) {
      return undefined;
    }

    const attempts: AgentSelectorFallbackAttempt[] = [];
    let executionMetrics: AgentExecutionMetrics | undefined;
    for (const candidate of candidates) {
      throwIfRunCancelled(cancellationSignal);
      const fallbackStep = { ...step, selector: candidate.selector };
      const preparation = await this.prepareBrowserForAgent(request, fallbackStep);
      const fallbackExecution = toPlannedStepExecution(fallbackStep, stepIndex, preparation);
      executionMetrics = mergeExecutionMetrics(executionMetrics, preparation.executionMetrics);
      const attempt: AgentSelectorFallbackAttempt = {
        originalSelector: step.selector,
        candidateSelector: candidate.selector,
        source: candidate.source,
        status: fallbackExecution.status,
        summary: fallbackExecution.summary,
        evidence: fallbackExecution.evidence,
        ...(fallbackExecution.failureReason ? { failureReason: fallbackExecution.failureReason } : {}),
      };
      attempts.push(attempt);

      if (fallbackExecution.status === 'passed') {
        return {
          execution: {
            ...fallbackExecution,
            ...(previousExecution.dynamicWaitAttempts
              ? { dynamicWaitAttempts: previousExecution.dynamicWaitAttempts }
              : {}),
            ...(previousExecution.retryAttempts ? { retryAttempts: previousExecution.retryAttempts } : {}),
            selectorFallbackAttempts: attempts,
          },
          attempts,
          ...(executionMetrics ? { executionMetrics } : {}),
        };
      }
    }

    return {
      execution: {
        ...previousExecution,
        ...(previousExecution.dynamicWaitAttempts
          ? { dynamicWaitAttempts: previousExecution.dynamicWaitAttempts }
          : {}),
        selectorFallbackAttempts: [...(previousExecution.selectorFallbackAttempts ?? []), ...attempts],
      },
      attempts,
      ...(executionMetrics ? { executionMetrics } : {}),
    };
  }

  private async waitBeforeRetry(
    step: AgentPlanStepDraft,
    failedExecution?: PlannedAgentStepExecution,
    cancellationSignal?: AbortSignal,
  ): Promise<AgentDynamicWaitAttempt | undefined> {
    if (!canWaitBeforeRetry(step, failedExecution?.recoveryStrategy)) {
      return undefined;
    }

    let attemptedWait: Pick<AgentDynamicWaitAttempt, 'timeoutMs' | 'strategy' | 'selector' | 'urlPattern'> | undefined;

    try {
      const responseUrlPattern = responseUrlPatternForNetworkRecovery(step, failedExecution);
      if (this.browserObserver?.waitForResponse && responseUrlPattern) {
        attemptedWait = {
          timeoutMs: dynamicRetryResponseWaitMs,
          strategy: 'response',
          urlPattern: responseUrlPattern,
        };
        await awaitWithRunCancellation(this.browserObserver.waitForResponse({
          urlPattern: responseUrlPattern,
          timeoutMs: dynamicRetryResponseWaitMs,
        }), cancellationSignal);
        return {
          ...attemptedWait,
          status: 'passed',
          summary: '按恢复策略等待指定接口响应完成。',
          evidence: `已在重试「${step.title}」前等待接口响应：${responseUrlPattern}。`,
        };
      }
      if (this.browserObserver?.waitForSelector && step.selector && failedExecution?.recoveryStrategy !== 'waitForReadiness') {
        attemptedWait = {
          timeoutMs: dynamicRetrySelectorWaitMs,
          strategy: 'selector',
          selector: step.selector,
        };
        await awaitWithRunCancellation(
          this.browserObserver.waitForSelector({ selector: step.selector, timeoutMs: dynamicRetrySelectorWaitMs }),
          cancellationSignal,
        );
        return {
          ...attemptedWait,
          status: 'passed',
          summary: '目标 selector 已可见。',
          evidence: `已在重试「${step.title}」前等待 selector 可见：${step.selector}。`,
        };
      }
      if (this.browserObserver?.waitForDataReady && shouldWaitForDataReady(step, failedExecution)) {
        attemptedWait = {
          timeoutMs: dynamicRetryDataReadyWaitMs,
          strategy: 'dataReady',
        };
        await awaitWithRunCancellation(
          this.browserObserver.waitForDataReady({ timeoutMs: dynamicRetryDataReadyWaitMs }),
          cancellationSignal,
        );
        return {
          ...attemptedWait,
          status: 'passed',
          summary: '按恢复策略等待页面数据就绪完成。',
          evidence: `已在重试「${step.title}」前等待页面数据就绪 ${dynamicRetryDataReadyWaitMs}ms。`,
        };
      }
      if (this.browserObserver?.waitForNetworkIdle) {
        attemptedWait = {
          timeoutMs: dynamicRetryNetworkIdleWaitMs,
          strategy: 'networkIdle',
        };
        await awaitWithRunCancellation(
          this.browserObserver.waitForNetworkIdle({ timeoutMs: dynamicRetryNetworkIdleWaitMs }),
          cancellationSignal,
        );
        return {
          ...attemptedWait,
          status: 'passed',
          summary:
            failedExecution?.recoveryStrategy === 'waitForReadiness'
              ? '按恢复策略等待页面网络空闲完成。'
              : '页面网络空闲等待完成。',
          evidence: `已在重试「${step.title}」前等待页面网络空闲 ${dynamicRetryNetworkIdleWaitMs}ms。`,
        };
      }
      if (!this.browserObserver?.wait) {
        return undefined;
      }
      attemptedWait = {
        timeoutMs: dynamicRetryWaitMs,
        strategy: 'timeout',
      };
      await awaitWithRunCancellation(this.browserObserver.wait({ timeoutMs: dynamicRetryWaitMs }), cancellationSignal);
      return {
        ...attemptedWait,
        status: 'passed',
        summary: '页面稳定等待完成。',
        evidence: `已在重试「${step.title}」前等待 ${dynamicRetryWaitMs}ms。`,
      };
    } catch (error) {
      if (isRunCancelled(error)) {
        throw error;
      }
      const failureReason = (error as Error).message || '未知错误';
      return {
        ...(attemptedWait ?? { timeoutMs: dynamicRetryWaitMs, strategy: 'timeout' as const }),
        status: 'failed',
        summary: '重试前等待失败。',
        evidence: `Runtime error: ${failureReason}`,
        failureReason,
      };
    }
  }

  async startSession(request: SessionStartRequest): Promise<ChatEntry> {
    this.sessionActive = true;
    return {
      id: `chat-${Date.now()}-system`,
      role: 'system',
      text: `浏览器会话已由桌面 runtime 启动，当前环境为 ${request.targetEnvironment}，运行配置为 ${describeRuntimeProfile(request.runtimeProfile)}。`,
    };
  }

  async endSession(): Promise<ChatEntry> {
    this.sessionActive = false;
    return {
      id: `chat-${Date.now()}-system`,
      role: 'system',
      text: '浏览器会话已由桌面 runtime 结束。',
    };
  }

  async sendChatCommand(request: ResolvedChatCommandRequest): Promise<ChatCommandResponse> {
    return this.agentRunOrchestrator.runChatCommand(request);
  }

  private async beginTraceScope(runId: string): Promise<boolean> {
    if (this.activeTraceScope) {
      return false;
    }

    this.activeTraceScope = runId;
    try {
      await this.browserObserver?.beginTrace?.(runId);
      return true;
    } catch {
      this.activeTraceScope = null;
      return false;
    }
  }

  private async finishTraceScope(
    runId: string,
    ownsTraceScope: boolean,
    agentRun: AgentRunResult,
  ): Promise<AgentRunResult> {
    if (!ownsTraceScope || this.activeTraceScope !== runId) {
      return agentRun;
    }

    try {
      const artifact = await this.browserObserver?.finishTrace?.();
      return artifact ? appendTraceArtifact(agentRun, artifact) : agentRun;
    } finally {
      this.activeTraceScope = null;
    }
  }

  private async enhanceRunWithReporter(
    request: ResolvedChatCommandRequest,
    agentRun: AgentRunResult,
  ): Promise<AgentRunResult> {
    throwIfRunCancelled(request.cancellationSignal);
    if (!this.agentReporter || agentRun.status === 'passed' || agentRun.status === 'running') {
      return agentRun;
    }

    const resolved = await resolveReporterConfigForRequest(request);
    if (!resolved.config) {
      return agentRun;
    }
    const redactor = createSecretRedactor(request.midsceneConfig, request.agentModelConfig);

    try {
      const result = await awaitWithRunCancellation(
        this.agentReporter.report({
          config: resolved.config,
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
          run: redactor.redactValue({
            status: agentRun.status,
            summary: agentRun.summary,
            ...(agentRun.failureReason ? { failureReason: agentRun.failureReason } : {}),
            intent: agentRun.intent,
            plan: agentRun.plan,
            events: agentRun.events,
            artifacts: agentRun.artifacts,
          }),
        }),
        request.cancellationSignal,
      );
      throwIfRunCancelled(request.cancellationSignal);
      const markdown = redactor.redactText(createReporterMarkdown(result));
      const reportPaths = this.reporterReportWriter
        ? await awaitWithRunCancellation(
          this.reporterReportWriter.writeReporterReport({
            runId: agentRun.runId,
            markdown,
          }),
          request.cancellationSignal,
        )
        : undefined;
      throwIfRunCancelled(request.cancellationSignal);
      const artifact: AgentArtifact = {
        id: `${agentRun.runId}-artifact-reporter`,
        type: 'report',
        label: 'Reporter 失败分析',
        path: reportPaths?.markdownPath ?? `memory://agent/${agentRun.runId}/reporter.md`,
      };
      const htmlArtifact: AgentArtifact | undefined = reportPaths?.htmlPath
        ? {
            id: `${agentRun.runId}-artifact-reporter-html`,
            type: 'report',
            label: 'Reporter HTML 报告',
            path: reportPaths.htmlPath,
          }
        : undefined;
      const event: AgentRunEvent = {
        id: `${agentRun.runId}-event-reporter-report`,
        runId: agentRun.runId,
        type: 'agent:artifact-created',
        message: redactor.redactText(`${result.summary}\n\n${markdown}`),
        status: agentRun.status,
        artifact,
        ...(result.metrics ? { metrics: result.metrics } : {}),
        createdAt: new Date().toISOString(),
      };
      const htmlEvent: AgentRunEvent | undefined = htmlArtifact
        ? {
            id: `${agentRun.runId}-event-reporter-html`,
            runId: agentRun.runId,
            type: 'agent:artifact-created',
            message: 'Reporter HTML 报告已生成。',
            status: agentRun.status,
            artifact: htmlArtifact,
            createdAt: event.createdAt,
          }
        : undefined;
      const recoveryPlan = deriveAgentRecoveryPlan(agentRun);
      return redactor.redactValue({
        ...agentRun,
        summary: redactor.redactText(`${result.summary}\n${agentRun.summary}`),
        events: [...agentRun.events, event, ...(htmlEvent ? [htmlEvent] : [])],
        artifacts: [...agentRun.artifacts, artifact, ...(htmlArtifact ? [htmlArtifact] : [])],
        metrics: mergeExecutionMetrics(agentRun.metrics, result.metrics) ?? agentRun.metrics,
        reporter: {
          summary: result.summary,
          evidenceSummary: result.evidenceSummary,
          failureAnalysis: result.failureAnalysis,
          suggestedFixes: result.suggestedFixes,
          ...(recoveryPlan ? { recoveryPlan } : {}),
          modelName: result.modelName,
        },
      });
    } catch (error) {
      if (isRunCancelled(error)) {
        throw error;
      }
      return agentRun;
    }
  }

  private createChatCommandResponse(
    request: ChatCommandRequest,
    agentRun: AgentRunResult,
  ): ChatCommandResponse {
    const redactor = createSecretRedactor(
      'midsceneConfig' in request ? request.midsceneConfig : undefined,
      'agentModelConfig' in request ? request.agentModelConfig : undefined,
    );
    const userEntry: ChatEntry = {
      id: `chat-${Date.now()}-user`,
      role: 'user',
      text: request.prompt,
    };

    const extractionEvidence =
      request.mode === 'aiQuery'
        ? agentRun.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence
        : undefined;
    const assistantEntry: ChatEntry = {
      id: `chat-${Date.now()}-assistant`,
      role: 'assistant',
      text: `${makeAssistantReply(request.mode, request.prompt, request.runtimeProfile)}${extractionEvidence ? `\n\n提取结果：${extractionEvidence}` : ''}\n\nAgent 计划已生成：${agentRun.plan.steps
        .map((step, index) => `${index + 1}. ${step.title}`)
        .join(' / ')}`,
    };

    if (!this.sessionActive) {
      assistantEntry.text = `当前还没有活动会话，已先记录这条 ${request.mode} 指令草稿。${extractionEvidence ? `\n\n提取结果：${extractionEvidence}` : ''}\n\nAgent 计划已生成，但后续真实执行需要先启动浏览器会话。`;
    }

    return redactor.redactValue({
      userEntry,
      assistantEntry,
      agentRun,
    });
  }

  private async createAgentPlan(request: ResolvedChatCommandRequest): Promise<PlanningAttempt> {
    throwIfRunCancelled(request.cancellationSignal);
    if (!this.agentPlanner) {
      return {
        provenance: { source: 'rule' },
      };
    }

    const resolved = await resolvePlannerConfigForRequest(request);
    if (!resolved.config) {
      return {
        provenance: {
          source: 'rule',
          ...(resolved.fallbackReason ? { fallbackReason: resolved.fallbackReason } : {}),
        },
      };
    }

    try {
      const current = this.browserObserver?.getState() ?? request.browserSession;
      const result = await awaitWithRunCancellation(
        this.agentPlanner.createPlan({
          config: resolved.config,
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
          mode: request.mode,
          prompt: request.prompt,
          targetEnvironment: request.targetEnvironment,
          targetUrl: request.runtimeProfile.baseUrl,
          ...(current?.currentUrl ? { currentUrl: current.currentUrl } : {}),
          ...(current?.pageTitle ? { pageTitle: current.pageTitle } : {}),
        }),
        request.cancellationSignal,
      );
      return {
        result,
        provenance: { source: 'model', modelName: result.modelName },
      };
    } catch (error) {
      if (isRunCancelled(error)) {
        throw error;
      }
      return {
        provenance: {
          source: 'rule',
          fallbackReason: createSecretRedactor(resolved.config).redactError(error) || 'Planner 模型调用失败',
        },
      };
    }
  }

  private async createReplannedAgentPlan(
    request: ResolvedChatCommandRequest,
    currentPlan: AgentPlanDraft,
    failedStep: AgentPlanStepDraft,
    failedExecution: PlannedAgentStepExecution,
    completedSteps: CompletedPlannerStep[],
  ): Promise<AgentPlannerResult | undefined> {
    if (!this.agentPlanner) {
      return undefined;
    }

    const resolved = await resolvePlannerConfigForRequest(request);
    if (!resolved.config) {
      return undefined;
    }

    const current = this.browserObserver?.getState() ?? request.browserSession;
    const observation = await this.captureBrowserObservation(request.cancellationSignal);
    try {
      const result = await awaitWithRunCancellation(
        this.agentPlanner.createPlan({
          config: resolved.config,
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
          mode: request.mode,
          prompt: [
            request.prompt,
            `原计划「${currentPlan.title}」在步骤「${failedStep.title}」未完成，请基于最新页面观察重新生成从当前状态继续执行的计划。`,
          ].join('\n'),
          targetEnvironment: request.targetEnvironment,
          targetUrl: request.runtimeProfile.baseUrl,
          ...(current?.currentUrl ? { currentUrl: current.currentUrl } : {}),
          ...(current?.pageTitle ? { pageTitle: current.pageTitle } : {}),
          previousFailure: {
            stepTitle: failedStep.title,
            action: failedStep.action,
            instruction: failedStep.instruction,
            status: failedExecution.status === 'failed' ? 'failed' : 'neutral',
            summary: failedExecution.summary,
            evidence: failedExecution.evidence,
            ...(failedExecution.failureReason ? { failureReason: failedExecution.failureReason } : {}),
            ...(failedExecution.failureCategory ? { failureCategory: failedExecution.failureCategory } : {}),
            ...(failedExecution.recoveryStrategy ? { recoveryStrategy: failedExecution.recoveryStrategy } : {}),
          },
          ...(completedSteps.length ? { completedSteps } : {}),
          ...(observation?.domSummary || observation?.textSummary
            ? { observationSummary: [observation.domSummary, observation.textSummary].filter(Boolean).join('\n') }
            : {}),
          ...(observation?.interactiveElements?.length ? { interactiveElements: observation.interactiveElements } : {}),
        }),
        request.cancellationSignal,
      );
      const continuation = removeCompletedActionReplays(result.plan, completedSteps);
      return continuation.plan.steps.length ? { ...result, plan: continuation.plan } : undefined;
    } catch (error) {
      if (isRunCancelled(error)) {
        throw error;
      }
      return undefined;
    }
  }

  private prepareBrowserForAgent = (
    request: ResolvedChatCommandRequest,
    plannedStep?: AgentPlanStepDraft,
  ): Promise<BrowserPreparationResult> => {
    return this.browserSessionCoordinator.prepareForAgent(request, plannedStep);
  };

  private captureBrowserObservation = (
    cancellationSignal?: AbortSignal,
  ): Promise<BrowserPreparationResult['observation'] | undefined> => {
    return this.browserSessionCoordinator.captureObservation(cancellationSignal);
  };

  private prepareDeterministicAssertion = (
    request: RunDeterministicStepRequest & { assertion: ExplicitTestAssertion },
  ): Promise<BrowserPreparationResult> => {
    return this.browserSessionCoordinator.prepareDeterministicAssertion(request);
  };

  private prepareDeterministicBoundInput = (
    request: RunDeterministicStepRequest & { inputBinding: TestInputValueBinding },
  ): Promise<BrowserPreparationResult> => {
    return this.browserSessionCoordinator.prepareDeterministicBoundInput(request);
  };

  async runDeterministicStep(request: RunDeterministicStepRequest): Promise<RunDeterministicStepResponse> {
    const traceScopeId = request.runId ?? `agent-run-deterministic-${Date.now()}`;
    let ownsTraceScope = false;
    const createRun = (executions: PlannedAgentStepExecution[]): AgentRunResult =>
      createPlannedAgentRun({
        mode: request.assertion ? 'aiAssert' : 'ai',
        prompt: request.sourceStep.body,
        runtimeDescription: describeRuntimeProfile(request.runtimeProfile),
        targetEnvironment: request.targetEnvironment,
        targetUrl:
          request.plannedStep.action === 'navigate' && request.plannedStep.url
            ? request.plannedStep.url
            : request.runtimeProfile.baseUrl,
      plannedPlan: {
        title: request.sourceStep.title,
        summary: request.assertion ? '执行用户已确认的显式测试断言。' : '执行用户已确认的确定性测试步骤。',
        steps: [sanitizeDeterministicPlanStep(request.plannedStep)],
          risks: ['仅执行已确认的结构化动作或断言；不会调用模型、重试、selector fallback 或重规划。'],
        },
        planner: {
          source: 'rule',
          fallbackReason: '用户已确认的结构化测试步骤。',
        },
        executions,
        ...(request.assertion
          ? {
              assertion: {
                id: request.assertion.id,
                version: request.assertion.version,
                kind: request.assertion.kind,
              },
            }
          : {}),
        ...(request.project ? { projectId: request.project.id } : {}),
        ...(request.environment ? { environmentId: request.environment.id } : {}),
        testCaseId: request.testCaseId,
        ...(request.documentId ? { documentId: request.documentId } : {}),
      });
    const complete = async (agentRun: AgentRunResult): Promise<RunDeterministicStepResponse> => {
      const tracedRun = await this.finishTraceScope(traceScopeId, ownsTraceScope, agentRun);
      return {
        runId: tracedRun.runId,
        title: request.sourceStep.title,
        detail: createDeterministicRunDetail(request, tracedRun),
        agentRun: tracedRun,
      };
    };
    const neutralExecution = (summary: string, evidence: string): PlannedAgentStepExecution => ({
      stepIndex: 0,
      status: 'neutral',
      summary,
      evidence,
      browserActionMessage: summary,
    });

    try {
      ownsTraceScope = await this.beginTraceScope(traceScopeId);
      throwIfRunCancelled(request.cancellationSignal);

      if (!isSupportedDeterministicPlanStep(request.plannedStep, request.assertion, request.inputBinding)) {
        return complete(
          createRun([
            neutralExecution(
              '已确认的结构化动作不在当前确定性执行范围内。',
              `${request.plannedStep.action === 'assert' ? '断言' : '动作'}「${request.plannedStep.action}」不支持确定性执行，未调用浏览器或模型。`,
            ),
          ]),
        );
      }

      if (this.browserObserver?.hasRealPage?.() !== true) {
        return complete(
          createRun([
            neutralExecution(
              '未检测到真实 Playwright 页面，确定性步骤保持等待态。',
              'BrowserRuntime 未提供真实页面能力，未派发浏览器动作。',
            ),
          ]),
        );
      }

      const preparation = request.assertion
        ? await this.prepareDeterministicAssertion(request as RunDeterministicStepRequest & { assertion: ExplicitTestAssertion })
        : request.inputBinding
          ? await this.prepareDeterministicBoundInput(
              request as RunDeterministicStepRequest & { inputBinding: TestInputValueBinding },
            )
        : await this.prepareBrowserForAgent(
            {
              mode: 'ai',
              ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
              prompt: request.sourceStep.body,
              targetEnvironment: request.targetEnvironment,
              deepThink: false,
              deepLocate: false,
              runtimeProfile: request.runtimeProfile,
              ...(request.browserSession ? { browserSession: request.browserSession } : {}),
              ...(request.project ? { project: request.project, projectId: request.project.id } : {}),
              ...(request.environment ? { environment: request.environment } : {}),
              ...(request.environment ? { environmentId: request.environment.id } : {}),
              testCaseId: request.testCaseId,
              ...(request.documentId ? { documentId: request.documentId } : {}),
            },
            request.plannedStep,
          );
      throwIfRunCancelled(request.cancellationSignal);
      return complete(createRun([toPlannedStepExecution(request.plannedStep, 0, preparation)]));
    } catch (error) {
      if (isRunCancelled(error)) {
        const cancellation = createUserRunCancellation();
        const cancelledRun = markAgentRunCancelled(await this.finishTraceScope(traceScopeId, ownsTraceScope, createRun([])), cancellation);
        return {
          runId: cancelledRun.runId,
          title: request.sourceStep.title,
          detail: {
            ...createDeterministicRunDetail(request, cancelledRun),
            cancellation,
          },
          agentRun: cancelledRun,
        };
      }
      await this.finishTraceScope(traceScopeId, ownsTraceScope, createRun([]));
      throw error;
    }
  }

  async runWorkflow(request: ResolvedRunWorkflowRequest): Promise<RunWorkflowResponse> {
    const runId = request.runId ?? `agent-run-workflow-${Date.now()}`;
    const title = request.workflow.name;
    const redactor = createSecretRedactor(request.midsceneConfig, request.agentModelConfig);
    let ownsTraceScope = false;
    const emitRunEvent = (event: RunEventPayload) => {
      if (!request.parentRunId) {
        this.emitRunEvent(redactor.redactValue(event));
      }
    };

    const completeCancelledRun = async (): Promise<RunWorkflowResponse> => {
      const cancellation = createUserRunCancellation();
      const baseRun = createWorkflowAgentRun({
        workflow: request.workflow,
        stepRuns: [],
        runId,
        ...(request.project ? { projectId: request.project.id } : {}),
        ...(request.environment ? { environmentId: request.environment.id } : {}),
        ...(request.documentId ? { documentId: request.documentId } : {}),
      });
      const tracedRun = await this.finishTraceScope(runId, ownsTraceScope, baseRun);
      const agentRun = markAgentRunCancelled(tracedRun, cancellation);
      const detail = {
        ...createWorkflowRunDetail(request, agentRun),
        cancellation,
      };
      emitRunEvent({
        runId,
        title,
        type: 'complete',
        status: detail.status,
        duration: detail.duration,
        summary: detail.summary,
        detail,
      });
      return redactor.redactValue({ runId, title, detail, agentRun });
    };

    try {
      ownsTraceScope = await this.beginTraceScope(runId);
      throwIfRunCancelled(request.cancellationSignal);
    emitRunEvent({
      runId,
      title,
      type: 'status',
      status: 'running',
      summary: `已排队执行 ${request.workflow.steps.length} 个步骤。`,
    });

    emitRunEvent({
      runId,
      title,
      type: 'log',
      line: `[${nowLabel()}] Workflow queued: ${request.workflow.name}`,
    });

    emitRunEvent({
      runId,
      title,
      type: 'log',
      line: `[${nowLabel()}] Target URL: ${request.workflow.url}`,
    });

    emitRunEvent({
      runId,
      title,
      type: 'log',
      line: `[${nowLabel()}] Environment: ${request.targetEnvironment}`,
    });

    emitRunEvent({
      runId,
      title,
      type: 'log',
      line: `[${nowLabel()}] Runtime profile: ${describeRuntimeProfile(request.runtimeProfile)}`,
    });

    if (this.browserObserver && request.workflow.url) {
      let current = this.browserObserver.getState();
      if (
        request.project &&
        request.environment &&
        (!current.currentUrl || current.status === 'idle' || current.status === 'closed' || current.status === 'error')
      ) {
        current = await awaitWithRunCancellation(this.browserObserver.start({
          project: request.project,
          environment: request.environment,
          record: false,
        }), request.cancellationSignal);
      }
      if (!request.preserveCurrentPage && current.status !== 'error' && current.currentUrl !== request.workflow.url) {
        current = await awaitWithRunCancellation(
          this.browserObserver.navigate({ url: request.workflow.url }),
          request.cancellationSignal,
        );
      }
      emitRunEvent({
        runId,
        title,
        type: 'log',
        line: `[${nowLabel()}] Workflow context ready: ${current.currentUrl || request.workflow.url}`,
      });
    }

    const stepRuns: AgentRunResult[] = [];
    for (const [index, step] of request.workflow.steps.entries()) {
      throwIfRunCancelled(request.cancellationSignal);
      emitRunEvent({
        runId,
        title,
        type: 'log',
        line: `[${nowLabel()}] Step ${index + 1}/${request.workflow.steps.length} prepared: ${step.type} -> ${step.title}`,
      });
      const response = await this.sendChatCommand({
        mode: step.type,
        ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
        prompt: step.body,
        targetEnvironment: request.targetEnvironment,
        deepThink: true,
        deepLocate: true,
        runtimeProfile: request.runtimeProfile,
        ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
        ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
        ...(request.modelConfigResolver ? { modelConfigResolver: request.modelConfigResolver } : {}),
        ...(request.browserSession ? { browserSession: request.browserSession } : {}),
        ...(request.project ? { project: request.project, projectId: request.project.id } : {}),
        ...(request.environment ? { environment: request.environment } : {}),
        testCaseId: request.workflow.id,
        ...(request.documentId ? { documentId: request.documentId } : {}),
      });
      throwIfRunCancelled(request.cancellationSignal);
      stepRuns.push(response.agentRun);
      emitRunEvent({
        runId,
        title,
        type: 'log',
        line: `[${nowLabel()}] Step ${index + 1}/${request.workflow.steps.length} ${response.agentRun.status}: ${response.agentRun.summary}`,
      });
      if (response.agentRun.status !== 'passed') {
        break;
      }
    }

    const agentRun = await this.finishTraceScope(runId, ownsTraceScope, createWorkflowAgentRun({
      workflow: request.workflow,
      stepRuns,
      runId,
      ...(request.project ? { projectId: request.project.id } : {}),
      ...(request.environment ? { environmentId: request.environment.id } : {}),
      ...(request.documentId ? { documentId: request.documentId } : {}),
    }));
    const detail = createWorkflowRunDetail(request, agentRun);
    emitRunEvent({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: agentRun.summary,
      detail,
    });

    return redactor.redactValue({ runId, title, detail, agentRun });
    } catch (error) {
      if (isRunCancelled(error)) {
        return completeCancelledRun();
      }
      await this.finishTraceScope(runId, ownsTraceScope, createWorkflowAgentRun({
        workflow: request.workflow,
        stepRuns: [],
        runId,
        ...(request.project ? { projectId: request.project.id } : {}),
        ...(request.environment ? { environmentId: request.environment.id } : {}),
        ...(request.documentId ? { documentId: request.documentId } : {}),
      }));
      throw error;
    }
  }
}
