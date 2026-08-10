export type AgentIntentSource = 'naturalLanguage' | 'workflow' | 'recording' | 'prd';
export type AgentRunStatus = 'running' | 'passed' | 'failed' | 'neutral';
export type AgentSourceStepType = 'ai' | 'aiAssert' | 'aiQuery' | 'recordingReplay' | 'manual';
export type AgentFailureCategory =
  | 'selector'
  | 'timeout'
  | 'navigation'
  | 'network'
  | 'assertion'
  | 'runtime'
  | 'unknown';
export type AgentRecoveryStrategy =
  | 'retryAfterWait'
  | 'replaceSelector'
  | 'waitForReadiness'
  | 'replanNavigation'
  | 'stopAndReport'
  | 'replanFromCurrentState';

export type AgentStepAction =
  | 'navigate'
  | 'click'
  | 'input'
  | 'wait'
  | 'scroll'
  | 'select'
  | 'assert'
  | 'observe'
  | 'extract';

export interface AgentIntent {
  id: string;
  source: AgentIntentSource;
  prompt: string;
  projectId?: string;
  groupId?: string;
  environmentId?: string;
  testCaseId?: string;
  recordingId?: string;
  documentId?: string;
  targetUrl?: string;
  page?: string;
  createdAt: string;
}

export interface AgentStep {
  id: string;
  action: AgentStepAction;
  title: string;
  instruction: string;
  expected?: string;
  selector?: string;
  target?: string;
  value?: string;
  url?: string;
  timeoutMs?: number;
  sourceStepType?: AgentSourceStepType;
}

export type AgentPlanStepDraft = Omit<AgentStep, 'id' | 'sourceStepType'>;

export interface AgentPlanDraft {
  title: string;
  summary: string;
  steps: AgentPlanStepDraft[];
  risks: string[];
}

export interface AgentPlanProvenance {
  source: 'rule' | 'model';
  modelName?: string;
  fallbackReason?: string;
}

export interface AgentPlan {
  id: string;
  intentId: string;
  title: string;
  summary: string;
  steps: AgentStep[];
  risks: string[];
  planner?: AgentPlanProvenance;
  createdAt: string;
}

export interface AgentTableObservation {
  index: number;
  /** Whether the observed rows represent a complete, partial, or indeterminate data set. */
  evidenceCompleteness?: 'complete' | 'partial' | 'unknown';
  caption?: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  filters?: Array<{
    label: string;
    value: string;
  }>;
  pagination?: {
    currentPage?: number;
    totalPages?: number;
    totalItems?: number;
    pageSize?: number;
  };
  aggregates?: Array<{
    label: string;
    value: string;
  }>;
  sortStates?: Array<{
    column: string;
    direction: 'ascending' | 'descending' | 'none' | 'other';
  }>;
  sampleRows: string[][];
}

export interface AgentChartObservation {
  index: number;
  /** Whether chart values/trends are supported by complete structured evidence. */
  evidenceCompleteness?: 'complete' | 'partial' | 'unknown';
  title?: string;
  kind: 'canvas' | 'svg' | 'image' | 'container';
  width?: number;
  height?: number;
  rendered?: boolean;
  legends: string[];
  tooltip?: string;
  dataPoints?: Array<{
    series?: string;
    label?: string;
    value: number;
  }>;
  seriesTrends?: Array<{
    series: string;
    trend: 'rising' | 'falling' | 'flat' | 'mixed';
  }>;
  trend?: 'rising' | 'falling' | 'flat' | 'mixed';
  selectorHint?: string;
}

export interface AgentDomInspection {
  selector: string;
  found: boolean;
  visible: boolean;
  text?: string;
  attribute?: {
    name: string;
    value?: string;
  };
}

export interface AgentObservation {
  id: string;
  stepId: string;
  url: string;
  title: string;
  screenshotPath?: string;
  textSummary?: string;
  domSummary?: string;
  interactiveElements?: string[];
  consoleMessages?: string[];
  networkHints?: string[];
  tables?: AgentTableObservation[];
  charts?: AgentChartObservation[];
  createdAt: string;
}

export interface AgentVerification {
  id: string;
  stepId: string;
  status: AgentRunStatus;
  summary: string;
  evidence?: string;
  failureReason?: string;
  failureCategory?: AgentFailureCategory;
  recoveryStrategy?: AgentRecoveryStrategy;
  createdAt: string;
}

export interface AgentRetryAttempt {
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
  failureCategory?: AgentFailureCategory;
  recoveryStrategy?: AgentRecoveryStrategy;
}

export interface AgentSelectorFallbackAttempt {
  originalSelector: string;
  candidateSelector: string;
  source: string;
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
}

export interface AgentDynamicWaitAttempt {
  timeoutMs: number;
  strategy?: 'selector' | 'response' | 'dataReady' | 'networkIdle' | 'timeout';
  selector?: string;
  urlPattern?: string;
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
}

export interface AgentArtifact {
  id: string;
  type: 'screenshot' | 'trace' | 'report' | 'snapshot' | 'attachment';
  label: string;
  path: string;
}

export interface AgentUsageBucket {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

export interface AgentExecutionMetrics {
  durationMs: number;
  modelTimeCostMs: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  replanningCycleLimit?: number;
  replanningCycles?: number;
  retryAttempts?: number;
  dynamicWaitAttempts?: number;
  selectorFallbackAttempts?: number;
  byIntent: Record<string, AgentUsageBucket>;
  byModel: Record<string, AgentUsageBucket>;
}

export interface AgentModelAssignment {
  role: 'planner' | 'executor' | 'verifier' | 'reporter';
  provider: 'reuseMidscene' | 'openaiCompatible';
  source: 'midscene' | 'agentRole';
  enabled: boolean;
  modelBaseUrl: string;
  modelName: string;
  modelFamily: string;
  temperature?: string;
  hasApiKey: boolean;
}

export interface AgentReporterSummary {
  summary: string;
  evidenceSummary: string;
  failureAnalysis: string;
  suggestedFixes: string[];
  /**
   * A deterministic, review-only recovery proposal derived from recorded run
   * evidence. Reporter free text is intentionally not converted into actions.
   */
  recoveryPlan?: AgentRecoveryPlan;
  modelName: string;
}

export interface AgentRunCancellation {
  source: 'user';
  reason: 'userCancelled';
  message: string;
  cancelledAt: string;
}

export type AgentRecoveryPlanStrategy =
  | 'waitForResponse'
  | 'waitForSelector'
  | 'waitForDataReady'
  | 'waitForNetworkIdle'
  | 'observe';

export interface AgentRecoveryPlan {
  failedStepId: string;
  strategy: AgentRecoveryPlanStrategy;
  selector?: string;
  urlPattern?: string;
  reason: string;
}

export interface AgentBrowserSessionSnapshot {
  status: string;
  currentUrl: string;
  pageTitle?: string;
  screenshotPath?: string;
}

export interface AgentPlanRevision {
  cycle: number;
  previousPlanTitle: string;
  revisedPlanTitle: string;
  triggerStepId: string;
  triggerStepTitle: string;
  triggerStatus: AgentRunStatus;
  completedStepCount?: number;
  failureReason?: string;
  failureCategory?: AgentFailureCategory;
  recoveryStrategy?: AgentRecoveryStrategy;
}

export type AgentRunEventType =
  | 'agent:plan-created'
  | 'agent:plan-revised'
  | 'agent:step-started'
  | 'agent:dynamic-wait'
  | 'agent:step-retried'
  | 'agent:selector-fallback'
  | 'agent:browser-action'
  | 'agent:observation-created'
  | 'agent:assertion-result'
  | 'agent:artifact-created'
  | 'agent:step-failed'
  | 'agent:run-cancelled'
  | 'agent:run-finished';

export interface AgentRunEvent {
  id: string;
  runId: string;
  type: AgentRunEventType;
  message: string;
  status: AgentRunStatus;
  stepId?: string;
  plan?: AgentPlan;
  planRevision?: AgentPlanRevision;
  observation?: AgentObservation;
  verification?: AgentVerification;
  artifact?: AgentArtifact;
  browserSession?: AgentBrowserSessionSnapshot;
  dynamicWait?: AgentDynamicWaitAttempt;
  retryAttempt?: AgentRetryAttempt;
  selectorFallback?: AgentSelectorFallbackAttempt;
  cancellation?: AgentRunCancellation;
  /** Metrics emitted by the model operation associated with this event. */
  metrics?: AgentExecutionMetrics;
  createdAt: string;
}

export interface AgentRunResult {
  runId: string;
  intent: AgentIntent;
  plan: AgentPlan;
  status: AgentRunStatus;
  summary: string;
  events: AgentRunEvent[];
  artifacts: AgentArtifact[];
  metrics?: AgentExecutionMetrics;
  modelAssignments?: AgentModelAssignment[];
  reporter?: AgentReporterSummary;
  startedAt: string;
  endedAt?: string;
  failureReason?: string;
  cancellation?: AgentRunCancellation;
}

function lastFailureEvent(events: AgentRunEvent[]): AgentRunEvent | undefined {
  return [...events].reverse().find((event) => event.type === 'agent:step-failed' && event.stepId)
    ?? [...events].reverse().find(
      (event) => event.stepId && event.verification && event.verification.status !== 'passed',
    );
}

/**
 * Builds the only recovery instruction a Reporter draft may insert. The model
 * never chooses this action: it is derived from the persisted execution trace.
 */
export function deriveAgentRecoveryPlan(
  run: Pick<AgentRunResult, 'events' | 'plan'>,
): AgentRecoveryPlan | undefined {
  const failedEvent = lastFailureEvent(run.events);
  const failedStepId = failedEvent?.stepId;
  if (!failedStepId) {
    return undefined;
  }

  const verification = failedEvent.verification
    ?? [...run.events]
      .reverse()
      .find((event) => event.stepId === failedStepId && event.verification?.status !== 'passed')
      ?.verification;
  const dynamicWait = [...run.events]
    .reverse()
    .find((event) => event.stepId === failedStepId && event.dynamicWait)
    ?.dynamicWait;
  const planStep = run.plan.steps.find((step) => step.id === failedStepId);
  const reason = verification?.failureReason?.trim()
    || verification?.summary.trim()
    || failedEvent.message.trim()
    || '运行未获得可继续的终态证据。';

  if (dynamicWait?.strategy === 'response' && dynamicWait.urlPattern?.trim()) {
    return {
      failedStepId,
      strategy: 'waitForResponse',
      urlPattern: dynamicWait.urlPattern.trim(),
      reason,
    };
  }
  if (dynamicWait?.strategy === 'selector' && dynamicWait.selector?.trim()) {
    return {
      failedStepId,
      strategy: 'waitForSelector',
      selector: dynamicWait.selector.trim(),
      reason,
    };
  }
  if (dynamicWait?.strategy === 'dataReady') {
    return { failedStepId, strategy: 'waitForDataReady', reason };
  }
  if (dynamicWait?.strategy === 'networkIdle') {
    return { failedStepId, strategy: 'waitForNetworkIdle', reason };
  }
  if (
    planStep?.selector?.trim()
    && (verification?.failureCategory === 'selector'
      || verification?.recoveryStrategy === 'waitForReadiness'
      || verification?.recoveryStrategy === 'retryAfterWait')
  ) {
    return {
      failedStepId,
      strategy: 'waitForSelector',
      selector: planStep.selector.trim(),
      reason,
    };
  }
  if (
    verification?.failureCategory === 'network'
    || verification?.failureCategory === 'timeout'
    || verification?.recoveryStrategy === 'waitForReadiness'
    || verification?.recoveryStrategy === 'retryAfterWait'
  ) {
    return { failedStepId, strategy: 'waitForNetworkIdle', reason };
  }

  // No reliable selector or response target exists. Observation is the only
  // safe draft step because it cannot mutate browser state.
  return { failedStepId, strategy: 'observe', reason };
}

export interface AgentRunRequest {
  intent: AgentIntent;
  projectId?: string;
}

export function createAgentIntent({
  source,
  prompt,
  projectId,
  groupId,
  environmentId,
  testCaseId,
  recordingId,
  documentId,
  targetUrl,
  page,
}: Omit<AgentIntent, 'id' | 'createdAt'>): AgentIntent {
  const intent: AgentIntent = {
    id: `agent-intent-${Date.now()}`,
    source,
    prompt,
    createdAt: new Date().toISOString(),
  };

  if (projectId) intent.projectId = projectId;
  if (groupId) intent.groupId = groupId;
  if (environmentId) intent.environmentId = environmentId;
  if (testCaseId) intent.testCaseId = testCaseId;
  if (recordingId) intent.recordingId = recordingId;
  if (documentId) intent.documentId = documentId;
  if (targetUrl) intent.targetUrl = targetUrl;
  if (page) intent.page = page;

  return intent;
}

export function isTerminalAgentEvent(event: AgentRunEvent): boolean {
  return event.type === 'agent:run-finished' || event.type === 'agent:step-failed';
}
