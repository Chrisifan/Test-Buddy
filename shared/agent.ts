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
  strategy?: 'selector' | 'dataReady' | 'networkIdle' | 'timeout';
  selector?: string;
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
}

export interface AgentArtifact {
  id: string;
  type: 'screenshot' | 'trace' | 'report' | 'snapshot';
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
  startedAt: string;
  endedAt?: string;
  failureReason?: string;
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
