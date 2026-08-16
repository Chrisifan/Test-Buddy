import {
  type ChatEntry,
  type BrowserClickRequest,
  type BrowserInputRequest,
  type BrowserSessionState,
  type BrowserSessionRequest,
  type BrowserNavigateRequest,
  type BrowserScrollRequest,
  type BrowserSelectRequest,
  type BrowserWaitRequest,
  type BrowserWaitForChartStableRequest,
  type BrowserWaitForDataReadyRequest,
  type BrowserWaitForNetworkIdleRequest,
  type BrowserWaitForResponseRequest,
  type BrowserWaitForSelectorRequest,
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
  isMidsceneConfigured,
  resolveAgentModelAssignments,
} from '../shared/studio.js';
import {
  deriveAgentRecoveryPlan,
  type AgentDomInspection,
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
  AgentVerifierResult,
} from './runtime/agent-verifier.js';
import type { SemanticActionResult, SemanticActionRuntime } from './runtime/semantic-action-runtime.js';
import {
  awaitWithRunCancellation,
  createUserRunCancellation,
  isRunCancelled,
  markAgentRunCancelled,
  throwIfRunCancelled,
} from './runtime/run-cancellation.js';

interface BrowserObserver {
  hasRealPage?: () => boolean;
  start: (request: BrowserSessionRequest) => Promise<BrowserSessionState>;
  navigate: (request: BrowserNavigateRequest) => Promise<BrowserSessionState>;
  click: (request: BrowserClickRequest) => Promise<BrowserSessionState>;
  input: (request: BrowserInputRequest) => Promise<BrowserSessionState>;
  wait?: (request: BrowserWaitRequest) => Promise<BrowserSessionState>;
  waitForChartStable?: (request: BrowserWaitForChartStableRequest) => Promise<BrowserSessionState>;
  waitForDataReady?: (request: BrowserWaitForDataReadyRequest) => Promise<BrowserSessionState>;
  waitForNetworkIdle?: (request: BrowserWaitForNetworkIdleRequest) => Promise<BrowserSessionState>;
  waitForResponse?: (request: BrowserWaitForResponseRequest) => Promise<BrowserSessionState>;
  waitForSelector?: (request: BrowserWaitForSelectorRequest) => Promise<BrowserSessionState>;
  scroll?: (request: BrowserScrollRequest) => Promise<BrowserSessionState>;
  select?: (request: BrowserSelectRequest) => Promise<BrowserSessionState>;
  capture: () => Promise<BrowserSessionState>;
  beginTrace?: (runId: string) => Promise<boolean>;
  finishTrace?: () => Promise<RunArtifact | undefined>;
  getPageText?: () => Promise<string>;
  inspectDom?: (selector: string, attributeName?: string) => Promise<AgentDomInspection>;
  captureObservation?: () => Promise<
    Partial<
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
    >
  >;
  getState: () => BrowserSessionState;
}

type ExplicitAssertionKind =
  | 'urlContains'
  | 'titleContains'
  | 'pageContains'
  | 'tableContains'
  | 'tableRowCount'
  | 'tableColumnCount'
  | 'tableCellEquals'
  | 'tableColumnContains'
  | 'tableColumnSum'
  | 'tableSort'
  | 'tableFilter'
  | 'tableCurrentPage'
  | 'tableTotalPages'
  | 'tableTotalItems'
  | 'tablePageSize'
  | 'tableAggregateEquals'
  | 'domSelectorExists'
  | 'domSelectorVisible'
  | 'domSelectorTextContains'
  | 'domSelectorAttributeEquals'
  | 'chartContains'
  | 'chartCount'
  | 'chartRendered'
  | 'chartTitleEquals'
  | 'chartLegendContains'
  | 'chartTooltipContains'
  | 'chartDataContains'
  | 'chartSeriesContains'
  | 'chartDataPointEquals'
  | 'chartSeriesDataPointEquals'
  | 'chartSeriesTrend'
  | 'chartTrend';

interface ExplicitAssertionIntent {
  kind: ExplicitAssertionKind;
  expected: string;
  label: string;
  rowIndex?: number;
  columnIndex?: number;
  columnName?: string;
  sortColumn?: string;
  sortDirection?: 'ascending' | 'descending';
  filterName?: string;
  aggregateName?: string;
  tableName?: string;
  chartName?: string;
  domSelector?: string;
  domAttributeName?: string;
  chartDataPointLabel?: string;
  chartSeriesName?: string;
  chartTrend?: 'rising' | 'falling' | 'flat' | 'mixed';
}

interface AssertionEvaluation {
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
}

interface BrowserPreparationResult {
  session?: BrowserSessionState;
  message: string;
  navigatedUrl?: string;
  clickedSelector?: string;
  clickTarget?: string;
  inputSelector?: string;
  inputTarget?: string;
  inputValue?: string;
  waitedMs?: number;
  scrolledSelector?: string;
  scrolledPage?: boolean;
  selectedSelector?: string;
  selectedValue?: string;
  extracted?: boolean;
  assertion?: ExplicitAssertionIntent;
  semanticAssertion?: string;
  assertionEvaluation?: AssertionEvaluation;
  reportArtifactPath?: string;
  executionMetrics?: AgentExecutionMetrics;
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
}

interface PlanningAttempt {
  result?: AgentPlannerResult;
  provenance: AgentPlanProvenance;
}

interface ExecutionIntent {
  explicitUrl?: string;
  clickIntent?: { selector?: string; target?: string };
  inputIntent?: { selector?: string; target?: string; value: string };
  waitIntent?: {
    timeoutMs: number;
    selector?: string;
    urlPattern?: string;
    strategy?: 'selector' | 'chartStable' | 'dataReady' | 'response' | 'networkIdle' | 'timeout';
  };
  scrollIntent?: { selector?: string; x?: number; y?: number };
  selectIntent?: { selector?: string; target?: string; value: string };
  extractIntent?: { target?: string };
  assertionIntent?: ExplicitAssertionIntent;
  semanticAssertion?: string;
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

function nowLabel(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function describeRuntimeProfile(profile: RuntimeProfile): string {
  return `${profile.browser} / ${profile.viewport} / ${profile.headless ? 'headless' : 'headed'} / ${profile.baseUrl}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = durationMs > 0 ? Math.ceil(durationMs / 1_000) : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function createWorkflowRunDetail(
  request: RunWorkflowRequest,
  agentRun: AgentRunResult,
): RunDetail {
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
}

function isSupportedDeterministicPlanStep(
  step: AgentPlanStepDraft,
  assertion?: ExplicitTestAssertion,
  inputBinding?: TestInputValueBinding,
): boolean {
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
}

/**
 * Deterministic input values are resolved only in the main process immediately
 * before browser dispatch. Never let a caller-provided plan value reach run
 * evidence, even when this API is used outside TestRunner.
 */
function sanitizeDeterministicPlanStep(step: AgentPlanStepDraft): AgentPlanStepDraft {
  if (step.action !== 'input' && step.action !== 'select') {
    return step;
  }
  const { value: _value, ...safeStep } = step;
  return safeStep;
}

function createDeterministicRunDetail(
  request: RunDeterministicStepRequest,
  agentRun: AgentRunResult,
): RunDetail {
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
}

interface TerminalAgentOutcome {
  status: Exclude<RunStatus, 'running'>;
  reason?: RunReason;
}

function terminalAgentRunOutcome(agentRun: AgentRunResult, fallback: RunReason): TerminalAgentOutcome {
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
}

function terminalAgentStatus(status: AgentRunStatus): Exclude<RunStatus, 'running'> {
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
}

function deterministicFallbackReason(request: RunDeterministicStepRequest, message: string): RunReason {
  const code = request.inputBinding?.kind === 'credential'
    ? 'credentialUnavailable'
    : request.inputBinding?.kind === 'fixtureOutput'
      ? 'fixturePreflight'
      : 'unsupportedAction';
  return runReason(code, message);
}

function runReason(code: RunReason['code'], message: string): RunReason {
  return { code, message };
}

function appendTraceArtifact(agentRun: AgentRunResult, trace: RunArtifact): AgentRunResult {
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
}

function makeAssistantReply(
  mode: ChatCommandRequest['mode'],
  prompt: string,
  runtimeProfile: RuntimeProfile,
): string {
  if (mode === 'aiAssert') {
    return `主进程已接收断言指令：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，等接入 MidScene 后，这里会替换成真实断言执行结果。`;
  }

  if (mode === 'aiQuery') {
    return `主进程已接收提取指令：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，提取结果将写入本次运行证据。`;
  }

  return `主进程已接收动作指令：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，前端和桌面端的命令流已经打通。`;
}

function extractExplicitUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s"'<>，。；、)）\]]+/i);
  return match?.[0];
}

function extractClickIntent(text: string): { selector?: string; target?: string } | undefined {
  const selectorMatch = text.match(/(?:点击|click)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])/i);
  if (selectorMatch?.[1]) {
    return { selector: selectorMatch[1].replace(/^`|`$/g, '') };
  }

  const targetMatch = text.match(/(?:点击|click)\s*([^，。；,.、\n]+)/i);
  const target = targetMatch?.[1]?.trim();
  return target ? { target } : undefined;
}

function extractInputIntent(text: string): { selector?: string; target?: string; value: string } | undefined {
  const selectorInput = text.match(
    /(?:在|向|给|输入到|填入)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:中|里)?\s*(?:输入|填入|填写)\s*([^，。；,\n]+)/i,
  );
  if (selectorInput?.[1] && selectorInput[2]) {
    return {
      selector: selectorInput[1].replace(/^`|`$/g, ''),
      value: selectorInput[2].trim(),
    };
  }

  const fillSelector = text.match(/(?:fill|type)\s+(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s+(?:with\s+)?([^，。；,\n]+)/i);
  if (fillSelector?.[1] && fillSelector[2]) {
    return {
      selector: fillSelector[1].replace(/^`|`$/g, ''),
      value: fillSelector[2].trim(),
    };
  }

  const semanticInput = text.match(/(?:在|向|给)\s*([^，。；,\n]+?)\s*(?:中|里)?\s*(?:输入|填入|填写)\s*([^，。；,\n]+)/i);
  if (semanticInput?.[1] && semanticInput[2]) {
    return {
      target: semanticInput[1].trim(),
      value: semanticInput[2].trim(),
    };
  }

  return undefined;
}

function extractSelectIntent(text: string): { selector?: string; target?: string; value: string } | undefined {
  const selectorSelect = text.match(
    /(?:在|向|给)?\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:中|里)?\s*(?:选择|选中|select)\s*([^，。；,\n]+)/i,
  );
  if (selectorSelect?.[1] && selectorSelect[2]) {
    return { selector: selectorSelect[1].replace(/^`|`$/g, ''), value: selectorSelect[2].trim() };
  }

  const semanticSelect = text.match(/(?:在|向|给)?\s*([^，。；,\n]+?)\s*(?:中|里)?\s*(?:选择|选中|select)\s*([^，。；,\n]+)/i);
  if (semanticSelect?.[1] && semanticSelect[2]) {
    return { target: semanticSelect[1].trim(), value: semanticSelect[2].trim() };
  }

  return undefined;
}

function extractQueryIntent(text: string): { target?: string } {
  const match = text.match(
    /(?:提取|读取|查询|获取|extract|query)\s*(?:(?:当前)?页面(?:中|里|的)?\s*)?(.+?)(?:[。；，,\n]|$)/i,
  );
  const target = normalizeCapturedValue(match?.[1] ?? '');
  return target ? { target } : {};
}

function extractWaitMs(text: string): number | undefined {
  const milliseconds = text.match(/(?:等待|wait)[\s\S]{0,100}?(\d+)\s*(?:毫秒|ms)/i);
  if (milliseconds?.[1]) {
    return Math.min(Math.max(Number.parseInt(milliseconds[1], 10), 0), 30_000);
  }

  const seconds = text.match(/(?:等待|wait)[\s\S]{0,100}?(\d+(?:\.\d+)?)\s*(?:秒|s|sec|second|seconds)/i);
  if (seconds?.[1]) {
    return Math.min(Math.max(Math.round(Number.parseFloat(seconds[1]) * 1_000), 0), 30_000);
  }

  const bareSeconds = text.match(/(?:等待|wait)\s*(\d+(?:\.\d+)?)/i);
  if (bareSeconds?.[1]) {
    return Math.min(Math.max(Math.round(Number.parseFloat(bareSeconds[1]) * 1_000), 0), 30_000);
  }

  return undefined;
}

function extractDirectWaitIntent(text: string): ExecutionIntent['waitIntent'] | undefined {
  if (!/(?:等待|wait)/i.test(text)) {
    return undefined;
  }
  const selectorMatch = text.match(/(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])/i);
  const selector = selectorMatch?.[1]?.replace(/^`|`$/g, '');
  const timeoutMs = extractWaitMs(text) ?? 1_000;
  const responseUrlPattern = selector ? undefined : extractApiPath(text);
  const strategy = isChartStableWaitInstruction(text)
    ? 'chartStable' as const
    : responseUrlPattern
      ? 'response' as const
      : isDataReadyWaitInstruction(text)
        ? 'dataReady' as const
        : selector
          ? 'selector' as const
          : isNetworkIdleWaitInstruction(text)
            ? 'networkIdle' as const
            : 'timeout' as const;
  return {
    timeoutMs,
    ...(selector ? { selector } : {}),
    ...(responseUrlPattern ? { urlPattern: responseUrlPattern } : {}),
    strategy,
  };
}

function extractScrollIntent(text: string): { selector?: string; x?: number; y?: number } | undefined {
  if (!/(?:滚动|scroll)/i.test(text)) {
    return undefined;
  }
  const selectorMatch = text.match(/(?:滚动到|scroll\s+to)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])/i);
  if (selectorMatch?.[1]) {
    return { selector: selectorMatch[1].replace(/^`|`$/g, '') };
  }
  return { y: /(?:向上|上滚|scroll\s+up)/i.test(text) ? -800 : 800 };
}

function isNetworkIdleWaitInstruction(text: string): boolean {
  return /(?:network\s*idle|networkidle|网络空闲|接口稳定|请求稳定|数据稳定|等待接口|等待请求)/i.test(text);
}

function isChartStableWaitInstruction(text: string): boolean {
  return /(?:(?:图表|趋势图|折线图|柱状图|饼图|chart|graph).*(?:稳定|渲染完成|加载完成|绘制完成|stable|rendered|loaded)|(?:稳定|渲染完成|加载完成|绘制完成|stable|rendered|loaded).*(?:图表|趋势图|折线图|柱状图|饼图|chart|graph))/i.test(
    text,
  );
}

function isDataReadyWaitInstruction(text: string): boolean {
  return /(?:(?:数据|表格|列表|结果|订单|记录|table|grid|list|rows?).*(?:就绪|加载完成|加载完毕|返回完成|渲染完成|ready|loaded|available)|(?:等待|wait).*(?:数据|表格|列表|结果|table|grid|list|rows?).*(?:完成|就绪|ready|loaded))/i.test(
    text,
  );
}

function extractApiPath(text: string): string | undefined {
  const match = text.match(/\/api\/[^\s"'<>，。；、)）\]]+/i);
  return match?.[0];
}

function extractResponseUrlPattern(step: AgentPlanStepDraft): string | undefined {
  const candidates = [step.target, step.url, step.instruction].filter((value): value is string => Boolean(value?.trim()));
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const explicitUrl = extractExplicitUrl(trimmed);
    if (explicitUrl) {
      return explicitUrl;
    }
    const apiPath = extractApiPath(trimmed);
    if (apiPath) {
      return apiPath;
    }
  }
  return undefined;
}

function resolveScrollIntent(step: AgentPlanStepDraft): { selector?: string; x?: number; y?: number } {
  const value = `${step.value ?? ''} ${step.instruction}`;
  const y = /(?:up|向上|上滚)/i.test(value) ? -800 : /(?:down|向下|下滚|scroll|滚动)/i.test(value) ? 800 : undefined;
  return {
    ...(step.selector ? { selector: step.selector } : {}),
    ...(y !== undefined ? { y } : {}),
  };
}

function normalizeCapturedValue(value: string): string {
  return value
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim();
}

function extractAssertionIntent(text: string): ExplicitAssertionIntent | undefined {
  const tableTargetMatch = text.match(/(?:表格|table)\s*(?:「([^」]+)」|“([^”]+)”|["'`]([^"'`]+)["'`])/i);
  const tableName = normalizeCapturedValue(tableTargetMatch?.[1] ?? tableTargetMatch?.[2] ?? tableTargetMatch?.[3] ?? '');
  if (tableTargetMatch && tableName) {
    const normalizedText = text.replace(tableTargetMatch[0], /table/i.test(tableTargetMatch[0]) ? 'table ' : '表格 ');
    const parsed = extractAssertionIntent(normalizedText);
    return parsed?.kind.startsWith('table') ? { ...parsed, tableName } : parsed;
  }
  const chartTargetMatch = text.match(/(?:图表|chart)\s*(?:「([^」]+)」|“([^”]+)”|["'`]([^"'`]+)["'`])/i);
  const chartName = normalizeCapturedValue(chartTargetMatch?.[1] ?? chartTargetMatch?.[2] ?? chartTargetMatch?.[3] ?? '');
  if (chartTargetMatch && chartName) {
    const normalizedText = text.replace(chartTargetMatch[0], /chart/i.test(chartTargetMatch[0]) ? 'chart ' : '图表 ');
    const parsed = extractAssertionIntent(normalizedText);
    return parsed?.kind.startsWith('chart') ? { ...parsed, chartName } : parsed;
  }
  const patterns: Array<[ExplicitAssertionKind, string, RegExp]> = [
    ['urlContains', 'URL 包含', /(?:断言|验证|检查|assert)\s*(?:url|URL|地址|链接)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['titleContains', '标题包含', /(?:断言|验证|检查|assert)\s*(?:标题|title)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    [
      'pageContains',
      '页面包含',
      /(?:断言|验证|检查|assert)\s*(?:页面|文本|正文|内容|page|text)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'tableContains',
      '表格包含',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'tableRowCount',
      '表格行数',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:行数|rows?)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i,
    ],
    [
      'tableColumnCount',
      '表格列数',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:列数|columns?|cols?)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i,
    ],
    [
      'tableCellEquals',
      '表格单元格',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:第\s*)?(\d+)\s*(?:行|row)\s*(?:第\s*)?(\d+)\s*(?:列|column|col)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i,
    ],
    [
      'tableColumnContains',
      '表格列包含',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:列|column|col)\s*([^，。；,\n]+?)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'tableColumnSum',
      '表格列合计',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:列|column|col)\s*([^，。；,\n]+?)\s*(?:合计|总和|sum|total)\s*(?:为|等于|是|=|equals?)\s*(-?\d+(?:\.\d+)?)/i,
    ],
    [
      'tableSort',
      '表格排序',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:按|by)\s*([^，。；,\n]+?)\s*(升序|降序|ascending|descending|asc|desc)/i,
    ],
    [
      'tableFilter',
      '表格筛选',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:筛选|filter)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i,
    ],
    [
      'tableCurrentPage',
      '表格当前页',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:当前页|current\s*page)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i,
    ],
    [
      'tableTotalPages',
      '表格总页数',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:总页数|total\s*pages?)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i,
    ],
    [
      'tableTotalItems',
      '表格总条数',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:总条数|总记录数|总数|total\s*(?:items?|records?))\s*(?:为|等于|是|=|equals?)\s*(\d+)/i,
    ],
    [
      'tablePageSize',
      '表格每页条数',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:每页|page\s*size)\s*(?:为|等于|是|=|equals?)?\s*(\d+)\s*(?:条|rows?|items?)?/i,
    ],
    [
      'tableAggregateEquals',
      '表格聚合值',
      /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:聚合|汇总|aggregate)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i,
    ],
    [
      'domSelectorTextContains',
      'DOM 文本',
      /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:文本|text)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'domSelectorAttributeEquals',
      'DOM 属性',
      /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:属性|attribute)\s*([\w-]+)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i,
    ],
    [
      'domSelectorVisible',
      'DOM 可见',
      /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:可见|visible)/i,
    ],
    [
      'domSelectorExists',
      'DOM 存在',
      /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:存在|exists?|present)/i,
    ],
    [
      'chartContains',
      '图表包含',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'chartCount',
      '图表数量',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数量|个数|count)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i,
    ],
    [
      'chartRendered',
      '图表渲染',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:已渲染|渲染正常|rendered)/i,
    ],
    [
      'chartTitleEquals',
      '图表标题',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:标题|title)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i,
    ],
    [
      'chartLegendContains',
      '图表图例',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:图例|legend)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'chartTooltipContains',
      '图表提示',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:tooltip|提示)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'chartDataContains',
      '图表数据区域',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据区域|数据|data(?:\s*region)?)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'chartSeriesContains',
      '图表系列',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据系列|系列|series)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i,
    ],
    [
      'chartSeriesTrend',
      '图表系列趋势',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据系列|系列|series)\s*([^，。；,\n]+?)\s*(?:趋势|trend)\s*(上升|下降|平稳|rising|falling|flat|mixed)/i,
    ],
    [
      'chartSeriesDataPointEquals',
      '图表系列数据点',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据系列|系列|series)\s*([^，。；,\n]+?)\s*(?:数据点|data\s*point)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*(-?\d+(?:\.\d+)?)/i,
    ],
    [
      'chartDataPointEquals',
      '图表数据点',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据点|data\s*point)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*(-?\d+(?:\.\d+)?)/i,
    ],
    [
      'chartTrend',
      '图表趋势',
      /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:趋势|trend)\s*(上升|下降|平稳|rising|falling|flat|mixed)/i,
    ],
  ];

  for (const [kind, label, pattern] of patterns) {
    const match = text.match(pattern);
    if (kind === 'tableCellEquals') {
      const rowIndex = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
      const columnIndex = match?.[2] ? Number.parseInt(match[2], 10) : Number.NaN;
      const expected = match?.[3] ? normalizeCapturedValue(match[3]) : '';
      if (Number.isFinite(rowIndex) && Number.isFinite(columnIndex) && expected) {
        return { kind, expected, label, rowIndex, columnIndex };
      }
      continue;
    }
    if (kind === 'tableColumnContains') {
      const columnName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (columnName && expected) {
        return { kind, expected: `${columnName} 包含 ${expected}`, label, columnName };
      }
      continue;
    }
    if (kind === 'tableColumnSum') {
      const columnName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (columnName && expected) {
        return { kind, expected: `${columnName} 合计 ${expected}`, label, columnName };
      }
      continue;
    }
    if (kind === 'tableSort') {
      const sortColumn = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const sortDirection = normalizeSortDirection(match?.[2] ?? '');
      if (sortColumn && sortDirection) {
        return {
          kind,
          expected: `${sortColumn} ${sortDirection === 'ascending' ? '升序' : '降序'}`,
          label,
          sortColumn,
          sortDirection,
        };
      }
      continue;
    }
    if (kind === 'tableFilter') {
      const filterName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (filterName && expected) {
        return { kind, expected: `${filterName} = ${expected}`, label, filterName };
      }
      continue;
    }
    if (kind === 'tableAggregateEquals') {
      const aggregateName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (aggregateName && expected) {
        return { kind, expected: `${aggregateName} = ${expected}`, label, aggregateName };
      }
      continue;
    }
    if (kind === 'domSelectorTextContains') {
      const domSelector = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (domSelector && expected) {
        return { kind, expected, label, domSelector };
      }
      continue;
    }
    if (kind === 'domSelectorAttributeEquals') {
      const domSelector = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const domAttributeName = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      const expected = match?.[3] ? normalizeCapturedValue(match[3]) : '';
      if (domSelector && domAttributeName && expected) {
        return { kind, expected, label, domSelector, domAttributeName };
      }
      continue;
    }
    if (kind === 'domSelectorExists' || kind === 'domSelectorVisible') {
      const domSelector = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      if (domSelector) {
        return { kind, expected: domSelector, label, domSelector };
      }
      continue;
    }
    if (kind === 'chartRendered') {
      if (match) {
        return { kind, expected: '已渲染', label };
      }
      continue;
    }
    if (kind === 'chartTrend') {
      const chartTrend = normalizeChartTrend(match?.[1] ?? '');
      if (chartTrend) {
        return { kind, expected: formatChartTrend(chartTrend), label, chartTrend };
      }
      continue;
    }
    if (kind === 'chartSeriesTrend') {
      const chartSeriesName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const chartTrend = normalizeChartTrend(match?.[2] ?? '');
      if (chartSeriesName && chartTrend) {
        return { kind, expected: `${chartSeriesName} ${formatChartTrend(chartTrend)}`, label, chartSeriesName, chartTrend };
      }
      continue;
    }
    if (kind === 'chartDataPointEquals') {
      const chartDataPointLabel = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const pointValue = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (chartDataPointLabel && pointValue) {
        return { kind, expected: `${chartDataPointLabel} = ${pointValue}`, label, chartDataPointLabel };
      }
      continue;
    }
    if (kind === 'chartSeriesDataPointEquals') {
      const chartSeriesName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const chartDataPointLabel = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      const pointValue = match?.[3] ? normalizeCapturedValue(match[3]) : '';
      if (chartSeriesName && chartDataPointLabel && pointValue) {
        return {
          kind,
          expected: `${chartSeriesName} / ${chartDataPointLabel} = ${pointValue}`,
          label,
          chartSeriesName,
          chartDataPointLabel,
        };
      }
      continue;
    }

    const expected = match?.[1] ? normalizeCapturedValue(match[1]) : '';
    if (expected) {
      return { kind, expected, label };
    }
  }

  return undefined;
}

function evaluateExplicitAssertion(
  assertion: ExplicitAssertionIntent,
  session: BrowserSessionState | undefined,
  pageText?: string,
  observation?: Partial<Pick<AgentObservation, 'tables' | 'charts'>>,
  domInspection?: AgentDomInspection,
): AssertionEvaluation {
  if (
    assertion.kind === 'domSelectorExists' ||
    assertion.kind === 'domSelectorVisible' ||
    assertion.kind === 'domSelectorTextContains' ||
    assertion.kind === 'domSelectorAttributeEquals'
  ) {
    return evaluateDomAssertion(assertion, domInspection);
  }
  const tables = selectAssertionTables(observation?.tables ?? [], assertion.tableName);
  const charts = selectAssertionCharts(observation?.charts ?? [], assertion.chartName);
  if (assertion.kind === 'tableRowCount' || assertion.kind === 'tableColumnCount') {
    return evaluateTableCountAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableCellEquals') {
    return evaluateTableCellAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableColumnContains') {
    return evaluateTableColumnContainsAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableColumnSum') {
    return evaluateTableColumnSumAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableSort') {
    return evaluateTableSortAssertion(assertion, tables);
  }
  if (
    assertion.kind === 'tableFilter' ||
    assertion.kind === 'tableCurrentPage' ||
    assertion.kind === 'tableTotalPages' ||
    assertion.kind === 'tableTotalItems' ||
    assertion.kind === 'tablePageSize' ||
    assertion.kind === 'tableAggregateEquals'
  ) {
    return evaluateTableStateAssertion(assertion, tables);
  }
  if (assertion.kind === 'chartCount') {
    return evaluateChartCountAssertion(assertion, charts);
  }
  if (assertion.kind === 'chartRendered') {
    return evaluateChartRenderedAssertion(assertion, charts);
  }
  if (assertion.kind === 'chartTitleEquals' || assertion.kind === 'chartLegendContains') {
    return evaluateChartFieldAssertion(assertion, charts);
  }
  if (
    assertion.kind === 'chartTooltipContains' ||
    assertion.kind === 'chartDataContains' ||
    assertion.kind === 'chartSeriesContains' ||
    assertion.kind === 'chartDataPointEquals' ||
    assertion.kind === 'chartSeriesDataPointEquals' ||
    assertion.kind === 'chartSeriesTrend' ||
    assertion.kind === 'chartTrend'
  ) {
    return evaluateChartEvidenceAssertion(assertion, charts);
  }

  const actual =
    assertion.kind === 'urlContains'
      ? session?.currentUrl ?? ''
      : assertion.kind === 'titleContains'
        ? session?.pageTitle ?? ''
        : assertion.kind === 'tableContains'
          ? summarizeTables(tables)
          : assertion.kind === 'chartContains'
            ? summarizeCharts(charts)
          : pageText ?? '';
  const passed = actual.includes(assertion.expected);
  const targetLabel =
    assertion.kind === 'urlContains'
      ? '当前 URL'
      : assertion.kind === 'titleContains'
        ? '页面标题'
        : assertion.kind === 'tableContains'
          ? '表格内容'
          : assertion.kind === 'chartContains'
            ? '图表内容'
          : '页面文本';
  const evidence =
    assertion.kind === 'pageContains'
      ? `${targetLabel}长度 ${actual.length}，期望片段：${assertion.expected}`
      : assertion.kind === 'tableContains'
        ? `${targetLabel}：${actual || '未观察到表格'}；期望包含：${assertion.expected}`
        : assertion.kind === 'chartContains'
          ? `${targetLabel}：${actual || '未观察到图表'}；期望包含：${assertion.expected}`
      : `${targetLabel}：${actual || '空'}；期望包含：${assertion.expected}`;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${targetLabel}不包含「${assertion.expected}」。`,
  };
}

function toExplicitAssertionIntent(assertion: ExplicitTestAssertion): ExplicitAssertionIntent {
  switch (assertion.kind) {
    case 'urlContains':
      return { kind: 'urlContains', expected: assertion.expected, label: '当前 URL 包含' };
    case 'titleContains':
      return { kind: 'titleContains', expected: assertion.expected, label: '页面标题包含' };
    case 'pageContains':
      return { kind: 'pageContains', expected: assertion.expected, label: '页面文本包含' };
    case 'locatorVisible':
      return {
        kind: 'domSelectorVisible',
        expected: assertion.locator.selector,
        label: '元素可见',
        domSelector: assertion.locator.selector,
      };
    case 'locatorTextContains':
      return {
        kind: 'domSelectorTextContains',
        expected: assertion.expected,
        label: '元素文本包含',
        domSelector: assertion.locator.selector,
      };
  }
}

function normalizeSortDirection(value: string): 'ascending' | 'descending' | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === '升序' || normalized === 'ascending' || normalized === 'asc') {
    return 'ascending';
  }
  if (normalized === '降序' || normalized === 'descending' || normalized === 'desc') {
    return 'descending';
  }
  return undefined;
}

function normalizeChartTrend(value: string): 'rising' | 'falling' | 'flat' | 'mixed' | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === '上升' || normalized === 'rising') return 'rising';
  if (normalized === '下降' || normalized === 'falling') return 'falling';
  if (normalized === '平稳' || normalized === 'flat') return 'flat';
  if (normalized === 'mixed') return 'mixed';
  return undefined;
}

function formatChartTrend(trend: NonNullable<ExplicitAssertionIntent['chartTrend']>): string {
  return trend === 'rising' ? '上升' : trend === 'falling' ? '下降' : trend === 'flat' ? '平稳' : 'mixed';
}

function evidenceCompletenessLabel(value: 'complete' | 'partial' | 'unknown' | undefined): string {
  return value === 'complete' ? '完整' : value === 'partial' ? '局部/虚拟化' : '未知';
}

function requireCompleteTableEvidence(
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): { tables: NonNullable<AgentObservation['tables']> } | { pending: AssertionEvaluation } {
  const completeTables = tables.filter((table) => table.evidenceCompleteness === 'complete');
  if (completeTables.length) {
    return { tables: completeTables };
  }
  const evidence = tables.length
    ? tables.map((table) => `${table.caption || `表格 #${table.index}`}：证据${evidenceCompletenessLabel(table.evidenceCompleteness)}`).join('；')
    : '未观察到表格';
  return {
    pending: {
      status: 'neutral',
      summary: `${assertion.label}缺少完整表格证据，暂不判定。`,
      evidence,
    },
  };
}

function requireCompleteChartEvidence(
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): { charts: NonNullable<AgentObservation['charts']> } | { pending: AssertionEvaluation } {
  const completeCharts = charts.filter((chart) => chart.evidenceCompleteness === 'complete');
  if (completeCharts.length) {
    return { charts: completeCharts };
  }
  const evidence = charts.length
    ? charts.map((chart) => `${chart.title || `图表 #${chart.index}`}：证据${evidenceCompletenessLabel(chart.evidenceCompleteness)}`).join('；')
    : '未观察到图表';
  return {
    pending: {
      status: 'neutral',
      summary: `${assertion.label}缺少完整图表证据，暂不判定。`,
      evidence,
    },
  };
}

function evaluateChartCountAssertion(
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation {
  const expectedCount = Number.parseInt(assertion.expected, 10);
  const chartTitles = charts.map((chart) => chart.title || `图表 #${chart.index}`).join('、');
  const evidence = `实际观察到 ${charts.length} 个图表${chartTitles ? `：${chartTitles}` : ''}`;
  const passed = Number.isFinite(expectedCount) ? charts.length === expectedCount : false;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
  };
}

function evaluateDomAssertion(
  assertion: ExplicitAssertionIntent,
  inspection: AgentDomInspection | undefined,
): AssertionEvaluation {
  const selector = assertion.domSelector ?? assertion.expected;
  const evidence = inspection
    ? `${inspection.selector}：${inspection.found ? (inspection.visible ? '已找到且可见' : '已找到但不可见') : '未找到'}${inspection.text ? `；文本：${inspection.text}` : ''}${inspection.attribute ? `；属性 ${inspection.attribute.name}：${inspection.attribute.value ?? '未设置'}` : ''}`
    : `未连接 DOM 检查器，无法检查 ${selector}`;
  const passed =
    assertion.kind === 'domSelectorExists'
      ? inspection?.found === true
      : assertion.kind === 'domSelectorVisible'
        ? inspection?.visible === true
        : assertion.kind === 'domSelectorAttributeEquals'
          ? inspection?.found === true && inspection.attribute?.name === assertion.domAttributeName && inspection.attribute?.value === assertion.expected
          : inspection?.found === true && Boolean(inspection.text?.includes(assertion.expected));
  if (passed) {
    return { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence };
  }

  const failureReason =
    assertion.kind === 'domSelectorExists'
      ? `未找到 DOM selector「${selector}」。`
      : assertion.kind === 'domSelectorVisible'
        ? `DOM selector 不可见「${selector}」。`
        : assertion.kind === 'domSelectorAttributeEquals'
          ? `DOM 属性「${assertion.domAttributeName ?? ''}」不等于「${assertion.expected}」。`
        : `DOM 文本不包含「${assertion.expected}」。`;
  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason,
  };
}

function evaluateChartFieldAssertion(
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation {
  const isTitleAssertion = assertion.kind === 'chartTitleEquals';
  const values = charts.flatMap((chart) => (isTitleAssertion ? [chart.title].filter(Boolean) : chart.legends ?? []));
  const evidence = isTitleAssertion
    ? `图表标题：${values.join(' / ') || '未观察到标题'}`
    : `图表图例：${values.join(' / ') || '未观察到图例'}`;
  const passed = isTitleAssertion ? values.some((value) => value === assertion.expected) : values.includes(assertion.expected);

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}${isTitleAssertion ? '不等于' : '不包含'}「${assertion.expected}」。`,
  };
}

function evaluateChartRenderedAssertion(
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation {
  const evidence = charts.length
    ? charts
        .map((chart) => {
          const size = chart.width !== undefined && chart.height !== undefined ? `${chart.width}x${chart.height}` : '尺寸未记录';
          return `${chart.title || `图表 #${chart.index}`}：${chart.rendered ? '已渲染' : '未渲染'} ${size}`;
        })
        .join('；')
    : '未观察到图表';
  const passed = charts.some((chart) => chart.rendered === true);

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: '未观察到已渲染图表。',
  };
}

function evaluateChartEvidenceAssertion(
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation {
  if (assertion.kind === 'chartSeriesTrend' || assertion.kind === 'chartTrend') {
    const completeness = requireCompleteChartEvidence(assertion, charts);
    if ('pending' in completeness) {
      return completeness.pending;
    }
    charts = completeness.charts;
  }
  const chartLabel = (chart: NonNullable<AgentObservation['charts']>[number]) => chart.title || `图表 #${chart.index}`;
  const formatDataPoint = (point: { series?: string; label?: string; value: number }) =>
    `${point.series ? `${point.series} / ` : ''}${point.label ? `${point.label} = ` : ''}${formatNumber(point.value)}`;
  const formatDataEvidence = () =>
    charts.length
      ? charts
          .map((chart) => `${chartLabel(chart)}：${(chart.dataPoints ?? []).map(formatDataPoint).join(' / ') || '未观察到结构化数据点'}`)
          .join('；')
      : '未观察到图表';
  const formatSeriesTrendEvidence = () =>
    charts.length
      ? charts
          .map(
            (chart) =>
              `${chartLabel(chart)}：${(chart.seriesTrends ?? [])
                .map((seriesTrend) => `${seriesTrend.series} ${formatChartTrend(seriesTrend.trend)}`)
                .join(' / ') || '未观察到系列趋势'}`,
          )
          .join('；')
      : '未观察到图表';
  const formatSeriesEvidence = () =>
    charts.length
      ? charts
          .map((chart) => {
            const seriesNames = Array.from(
              new Set([
                ...(chart.dataPoints ?? []).map((point) => point.series).filter((series): series is string => Boolean(series)),
                ...(chart.seriesTrends ?? []).map((seriesTrend) => seriesTrend.series),
              ]),
            );
            return `${chartLabel(chart)}：${seriesNames.join(' / ') || '未观察到结构化系列'}`;
          })
          .join('；')
      : '未观察到图表';
  if (assertion.kind === 'chartTooltipContains') {
    const evidence = charts.length
      ? charts.map((chart) => `${chartLabel(chart)}：${chart.tooltip || '未观察到可见提示'}`).join('；')
      : '未观察到图表';
    const passed = charts.some((chart) => chart.tooltip?.includes(assertion.expected));
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不包含「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'chartDataContains') {
    const evidence = formatDataEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some(
        (point) => point.series === assertion.expected || point.label === assertion.expected || formatNumber(point.value) === assertion.expected,
      ),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不包含「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'chartDataPointEquals') {
    const pointLabel = assertion.chartDataPointLabel ?? '';
    const expectedValue = assertion.expected.replace(`${pointLabel} = `, '');
    const evidence = formatDataEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some((point) => point.label === pointLabel && formatNumber(point.value) === expectedValue),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
        failureReason: `图表数据点「${pointLabel}」不等于「${expectedValue}」。`,
      };
  }

  if (assertion.kind === 'chartSeriesContains') {
    const evidence = formatSeriesEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some((point) => point.series === assertion.expected) ||
      (chart.seriesTrends ?? []).some((seriesTrend) => seriesTrend.series === assertion.expected),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不包含「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'chartSeriesDataPointEquals') {
    const seriesName = assertion.chartSeriesName ?? '';
    const pointLabel = assertion.chartDataPointLabel ?? '';
    const expectedValue = assertion.expected.replace(`${seriesName} / ${pointLabel} = `, '');
    const evidence = formatDataEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some(
        (point) => point.series === seriesName && point.label === pointLabel && formatNumber(point.value) === expectedValue,
      ),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `图表系列「${seriesName}」数据点「${pointLabel}」不等于「${expectedValue}」。`,
      };
  }

  if (assertion.kind === 'chartSeriesTrend') {
    const seriesName = assertion.chartSeriesName ?? '';
    const trend = assertion.chartTrend;
    const evidence = formatSeriesTrendEvidence();
    const passed = trend !== undefined && charts.some((chart) =>
      (chart.seriesTrends ?? []).some((seriesTrend) => seriesTrend.series === seriesName && seriesTrend.trend === trend),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `图表系列「${seriesName}」趋势不匹配「${assertion.expected.replace(`${seriesName} `, '')}」。`,
        };
  }

  const trend = assertion.chartTrend;
  const evidence = charts.length
    ? charts.map((chart) => `${chartLabel(chart)}：${chart.trend ? formatChartTrend(chart.trend) : '未观察到趋势'}`).join('；')
    : '未观察到图表';
  const passed = trend !== undefined && charts.some((chart) => chart.trend === trend);
  return passed
    ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
    : {
        status: 'failed',
        summary: `${assertion.label}「${assertion.expected}」未通过。`,
        evidence,
        failureReason: `${assertion.label}不匹配「${assertion.expected}」。`,
      };
}

function evaluateTableCellAssertion(
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation {
  const rowIndex = assertion.rowIndex ?? 0;
  const columnIndex = assertion.columnIndex ?? 0;
  const tableWithCell = tables.find((table) => table.sampleRows[rowIndex - 1]?.[columnIndex - 1] !== undefined);
  const actual = tableWithCell?.sampleRows[rowIndex - 1]?.[columnIndex - 1] ?? '';
  const tableName = tableWithCell?.caption || (tableWithCell ? `表格 #${tableWithCell.index}` : '未观察到匹配表格');
  const evidence = actual
    ? `${tableName} 第 ${rowIndex} 行第 ${columnIndex} 列：${actual}`
    : `${tableName} 第 ${rowIndex} 行第 ${columnIndex} 列未在当前样例行中观察到`;
  const passed = actual === assertion.expected;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
  };
}

function evaluateTableColumnContainsAssertion(
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation {
  const columnName = assertion.columnName ?? '';
  const expectedValue = assertion.expected.replace(`${columnName} 包含 `, '');
  const columnEvidence = tables.flatMap((table) => {
    const columnIndex = table.headers.findIndex((header) => header === columnName);
    if (columnIndex < 0) {
      return [];
    }

    const values = table.sampleRows.map((row) => row[columnIndex]).filter((value): value is string => Boolean(value));
    return [`${table.caption || `表格 #${table.index}`}：${columnName} = ${values.join(' / ')}`];
  });
  const evidence = columnEvidence.length ? columnEvidence.join('；') : `未观察到表格列：${columnName}`;
  const passed = tables.some((table) => {
    const columnIndex = table.headers.findIndex((header) => header === columnName);
    if (columnIndex < 0) {
      return false;
    }
    return table.sampleRows.some((row) => row[columnIndex] === expectedValue);
  });

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `表格列不包含「${expectedValue}」。`,
  };
}

function evaluateTableColumnSumAssertion(
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation {
  const completeness = requireCompleteTableEvidence(assertion, tables);
  if ('pending' in completeness) {
    return completeness.pending;
  }
  tables = completeness.tables;
  const columnName = assertion.columnName ?? '';
  const expectedText = assertion.expected.replace(`${columnName} 合计 `, '');
  const expectedSum = Number.parseFloat(expectedText);
  const sums = tables.flatMap((table) =>
    (table.aggregates ?? []).flatMap((aggregate) => {
      if (aggregate.label !== columnName) {
        return [];
      }
      const sum = parseNumericCell(aggregate.value);
      return sum === undefined
        ? []
        : [{ label: `${table.caption || `表格 #${table.index}`}：${columnName} 合计 ${aggregate.value}`, sum }];
    }),
  );
  const evidence = sums.length
    ? sums.map((item) => item.label).join('；')
    : `未观察到完整表格的显式合计：${columnName}`;
  const passed = Number.isFinite(expectedSum) && sums.some((item) => Math.abs(item.sum - expectedSum) < 0.000001);

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${expectedText}」。`,
  };
}

function parseNumericCell(value: string): number | undefined {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function evaluateTableSortAssertion(
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation {
  const completeness = requireCompleteTableEvidence(assertion, tables);
  if ('pending' in completeness) {
    return completeness.pending;
  }
  tables = completeness.tables;
  const sortColumn = assertion.sortColumn ?? '';
  const sortDirection = assertion.sortDirection;
  const sortEvidence = tables.flatMap((table) =>
    (table.sortStates ?? []).map((state) => `${table.caption || `表格 #${table.index}`}：${state.column} ${state.direction}`),
  );
  const evidence = sortEvidence.length
    ? sortEvidence.join('；')
    : '未观察到表格排序状态';
  if (!sortEvidence.length) {
    return {
      status: 'neutral',
      summary: `${assertion.label}缺少显式排序状态，暂不判定。`,
      evidence,
    };
  }
  const explicitPassed = tables.some((table) =>
    (table.sortStates ?? []).some((state) => state.column === sortColumn && state.direction === sortDirection),
  );
  const passed = explicitPassed;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不匹配「${assertion.expected}」。`,
  };
}

function inferTableSortEvidence(table: NonNullable<AgentObservation['tables']>[number], column: string): string[] {
  const inferred = inferTableSortDirection(table, column);
  if (!inferred) {
    return [];
  }

  const columnIndex = table.headers.findIndex((header) => header === column);
  const values = table.sampleRows.map((row) => row[columnIndex]).filter((value): value is string => Boolean(value));
  return [`${table.caption || `表格 #${table.index}`}：${column} inferred ${inferred} (${values.join(' / ')})`];
}

function inferTableSortDirection(
  table: NonNullable<AgentObservation['tables']>[number],
  column: string,
): 'ascending' | 'descending' | undefined {
  const columnIndex = table.headers.findIndex((header) => header === column);
  if (columnIndex < 0) {
    return undefined;
  }

  const values = table.sampleRows.map((row) => row[columnIndex]).filter((value): value is string => Boolean(value));
  if (values.length < 2) {
    return undefined;
  }

  const comparableValues = values.map((value) => {
    const normalized = value.replace(/,/g, '').trim();
    const numeric = Number.parseFloat(normalized);
    return Number.isFinite(numeric) && normalized.match(/^-?\d+(?:\.\d+)?$/) ? numeric : value;
  });
  const ascending = comparableValues.every((value, index) => index === 0 || compareSortValues(comparableValues[index - 1]!, value) <= 0);
  const descending = comparableValues.every((value, index) => index === 0 || compareSortValues(comparableValues[index - 1]!, value) >= 0);

  if (ascending && !descending) {
    return 'ascending';
  }
  if (descending && !ascending) {
    return 'descending';
  }
  return undefined;
}

function compareSortValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
}

function evaluateTableCountAssertion(
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation {
  const expectedCount = Number.parseInt(assertion.expected, 10);
  const isRowCount = assertion.kind === 'tableRowCount';
  if (isRowCount) {
    const completeness = requireCompleteTableEvidence(assertion, tables);
    if ('pending' in completeness) {
      return completeness.pending;
    }
    tables = completeness.tables;
  }
  const evidence = tables.length
    ? tables
        .map((table) => `${table.caption || `表格 #${table.index}`}：${isRowCount ? table.rowCount : table.columnCount} ${isRowCount ? '行' : '列'}`)
        .join('；')
    : '未观察到表格';
  const passed = Number.isFinite(expectedCount)
    ? tables.some((table) => (isRowCount ? table.rowCount : table.columnCount) === expectedCount)
    : false;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
  };
}

function evaluateTableStateAssertion(
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation {
  const tableLabel = (table: NonNullable<AgentObservation['tables']>[number]) => table.caption || `表格 #${table.index}`;
  const paginationKey =
    assertion.kind === 'tableCurrentPage'
      ? 'currentPage'
      : assertion.kind === 'tableTotalPages'
        ? 'totalPages'
        : assertion.kind === 'tableTotalItems'
          ? 'totalItems'
          : assertion.kind === 'tablePageSize'
            ? 'pageSize'
            : undefined;

  if (paginationKey) {
    const completeness = requireCompleteTableEvidence(assertion, tables);
    if ('pending' in completeness) {
      return completeness.pending;
    }
    tables = completeness.tables;
    const expected = Number.parseInt(assertion.expected, 10);
    const evidence = tables.length
      ? tables
          .map((table) => {
            const actual = table.pagination?.[paginationKey];
            return `${tableLabel(table)}：${actual === undefined ? '未观察到' : actual}`;
          })
          .join('；')
      : '未观察到表格';
    const passed = Number.isFinite(expected) && tables.some((table) => table.pagination?.[paginationKey] === expected);
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'tableFilter') {
    const filterName = assertion.filterName ?? '';
    const expectedValue = assertion.expected.replace(`${filterName} = `, '');
    const evidence = tables.length
      ? tables
          .map((table) =>
            `${tableLabel(table)}：${(table.filters ?? []).map((filter) => `${filter.label} = ${filter.value}`).join(' / ') || '未观察到筛选状态'}`,
          )
          .join('；')
      : '未观察到表格';
    const passed = tables.some((table) => (table.filters ?? []).some((filter) => filter.label === filterName && filter.value === expectedValue));
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不匹配「${assertion.expected}」。`,
        };
  }

  const aggregateName = assertion.aggregateName ?? '';
  const completeness = requireCompleteTableEvidence(assertion, tables);
  if ('pending' in completeness) {
    return completeness.pending;
  }
  tables = completeness.tables;
  const expectedValue = assertion.expected.replace(`${aggregateName} = `, '');
  const evidence = tables.length
    ? tables
        .map((table) =>
          `${tableLabel(table)}：${(table.aggregates ?? []).map((aggregate) => `${aggregate.label} = ${aggregate.value}`).join(' / ') || '未观察到聚合值'}`,
        )
        .join('；')
    : '未观察到表格';
  const passed = tables.some((table) =>
    (table.aggregates ?? []).some((aggregate) => aggregate.label === aggregateName && aggregate.value === expectedValue),
  );
  return passed
    ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
    : {
        status: 'failed',
        summary: `${assertion.label}「${assertion.expected}」未通过。`,
        evidence,
        failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
      };
}

function summarizeTables(tables: NonNullable<AgentObservation['tables']>): string {
  return tables
    .map((table) =>
      [
        table.caption,
        `${table.rowCount} 行`,
        `${table.columnCount} 列`,
        ...(table.filters ?? []).flatMap((filter) => [filter.label, filter.value]),
        ...(table.pagination ? Object.values(table.pagination).map(String) : []),
        ...(table.aggregates ?? []).flatMap((aggregate) => [aggregate.label, aggregate.value]),
        ...table.headers,
        ...table.sampleRows.flat(),
      ]
        .filter(Boolean)
        .join(' / '),
    )
    .join(' | ');
}

function selectAssertionTables(
  tables: NonNullable<AgentObservation['tables']>,
  tableName: string | undefined,
): NonNullable<AgentObservation['tables']> {
  if (!tableName) {
    return tables;
  }
  return tables.filter((table) => table.caption === tableName);
}

function selectAssertionCharts(
  charts: NonNullable<AgentObservation['charts']>,
  chartName: string | undefined,
): NonNullable<AgentObservation['charts']> {
  if (!chartName) {
    return charts;
  }
  return charts.filter((chart) => chart.title === chartName);
}

function summarizeCharts(charts: NonNullable<AgentObservation['charts']>): string {
  return charts
    .map((chart) =>
      [
        chart.title,
        chart.kind,
        chart.width && chart.height ? `${chart.width}x${chart.height}` : undefined,
        ...(chart.legends ?? []),
        chart.tooltip,
        ...(chart.dataPoints ?? []).flatMap((point) => [point.series, point.label, formatNumber(point.value)]),
        ...(chart.seriesTrends ?? []).flatMap((seriesTrend) => [seriesTrend.series, formatChartTrend(seriesTrend.trend)]),
        chart.trend ? formatChartTrend(chart.trend) : undefined,
      ]
        .filter(Boolean)
        .join(' / '),
    )
    .join(' | ');
}

function toAssertionEvaluation(result: SemanticActionResult): AssertionEvaluation {
  return {
    status: result.status,
    summary: result.message,
    evidence: result.evidence ?? result.message,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
  };
}

function toVerifierAssertionEvaluation(result: AgentVerifierResult): AssertionEvaluation {
  return {
    status: result.status,
    summary: result.summary,
    evidence: result.evidence,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
  };
}

function createPendingSemanticEvaluation(message: string): AssertionEvaluation {
  return {
    status: 'neutral',
    summary: message,
    evidence: '语义动作未执行，未生成页面判断证据。',
  };
}

function addUsageBucket(left: AgentUsageBucket | undefined, right: AgentUsageBucket): AgentUsageBucket {
  return {
    calls: (left?.calls ?? 0) + right.calls,
    promptTokens: (left?.promptTokens ?? 0) + right.promptTokens,
    completionTokens: (left?.completionTokens ?? 0) + right.completionTokens,
    totalTokens: (left?.totalTokens ?? 0) + right.totalTokens,
  };
}

function mergeExecutionMetrics(
  left: AgentExecutionMetrics | undefined,
  right: AgentExecutionMetrics | undefined,
): AgentExecutionMetrics | undefined {
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
}

function withReplanningCycle(metrics: AgentExecutionMetrics): AgentExecutionMetrics {
  return {
    ...metrics,
    replanningCycles: Math.max(1, metrics.replanningCycles ?? 0),
  };
}

function withReplanningCycleLimit(
  metrics: AgentExecutionMetrics,
  replanningCycleLimit: number,
): AgentExecutionMetrics {
  return {
    ...metrics,
    replanningCycleLimit: Math.max(metrics.replanningCycleLimit ?? 0, replanningCycleLimit),
  };
}

function resolvePlannerReplanningCycleLimit(request: ChatCommandRequest): number {
  const parsed = Number.parseInt(request.midsceneConfig?.replanningCycleLimit ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10) : 1;
}

function withRetryAttempt(metrics: AgentExecutionMetrics): AgentExecutionMetrics {
  return {
    ...metrics,
    retryAttempts: (metrics.retryAttempts ?? 0) + 1,
  };
}

function withDynamicWaitAttempt(metrics: AgentExecutionMetrics): AgentExecutionMetrics {
  return {
    ...metrics,
    dynamicWaitAttempts: (metrics.dynamicWaitAttempts ?? 0) + 1,
  };
}

function withSelectorFallbackAttempt(metrics: AgentExecutionMetrics): AgentExecutionMetrics {
  return {
    ...metrics,
    selectorFallbackAttempts: (metrics.selectorFallbackAttempts ?? 0) + 1,
  };
}

function canRetryFailedStep(step: AgentPlanStepDraft): boolean {
  if (step.action === 'navigate') return Boolean(step.url);
  if (step.action === 'click' || step.action === 'input' || step.action === 'select') return Boolean(step.selector);
  return step.action === 'wait' || step.action === 'scroll' || step.action === 'observe';
}

function shouldRetryFailedExecution(step: AgentPlanStepDraft, execution: PlannedAgentStepExecution): boolean {
  if (
    execution.recoveryStrategy === 'replaceSelector' ||
    execution.recoveryStrategy === 'replanNavigation' ||
    execution.recoveryStrategy === 'replanFromCurrentState' ||
    execution.recoveryStrategy === 'stopAndReport'
  ) {
    return false;
  }
  return canRetryFailedStep(step);
}

function canWaitBeforeRetry(
  step: AgentPlanStepDraft,
  recoveryStrategy?: AgentRecoveryStrategy,
): boolean {
  if (recoveryStrategy === 'waitForReadiness') {
    return true;
  }
  if (recoveryStrategy === 'retryAfterWait') {
    return canRetryFailedStep(step);
  }
  return (step.action === 'click' || step.action === 'input' || step.action === 'select') && Boolean(step.selector);
}

function shouldWaitForDataReady(
  step: AgentPlanStepDraft,
  failedExecution?: PlannedAgentStepExecution,
): boolean {
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
}

function responseUrlPatternForNetworkRecovery(
  step: AgentPlanStepDraft,
  failedExecution?: PlannedAgentStepExecution,
): string | undefined {
  if (
    failedExecution?.recoveryStrategy !== 'waitForReadiness' ||
    failedExecution.failureCategory !== 'network'
  ) {
    return undefined;
  }
  return extractResponseUrlPattern(step);
}

function canUseSelectorFallback(step: AgentPlanStepDraft): boolean {
  return (step.action === 'click' || step.action === 'input' || step.action === 'select') && Boolean(step.selector);
}

function shouldTrySelectorFallback(
  step: AgentPlanStepDraft,
  execution: PlannedAgentStepExecution,
): boolean {
  return execution.recoveryStrategy === 'replaceSelector' && canUseSelectorFallback(step);
}

function canReplanFailedStep(step: AgentPlanStepDraft): boolean {
  return ['navigate', 'click', 'input', 'wait', 'scroll', 'select', 'observe'].includes(step.action);
}

function shouldReplanFailedExecution(
  step: AgentPlanStepDraft,
  execution: PlannedAgentStepExecution,
): boolean {
  return canReplanFailedStep(step) && execution.recoveryStrategy !== 'stopAndReport';
}

function completedActionIdentity(step: AgentPlanStepDraft): string | undefined {
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
}

function removeCompletedActionReplays(
  plan: AgentPlanDraft,
  completedSteps: AgentPlanStepDraft[],
): { plan: AgentPlanDraft; skippedStepCount: number } {
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
}

type CompletedPlannerStep = NonNullable<AgentPlannerRequest['completedSteps']>[number];

function appendCompletedPlannerSteps(
  previousSteps: CompletedPlannerStep[],
  currentPlan: AgentPlanDraft,
  executions: PlannedAgentStepExecution[],
): CompletedPlannerStep[] {
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
}

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

function normalizeSelectorToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'“”‘’#[\].=_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSelectorContext(value: string): Set<string> {
  return new Set(
    normalizeSelectorToken(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !selectorFallbackStopWords.has(token)),
  );
}

function extractSelectorFromInteractiveElement(element: string): string | undefined {
  const selectorMatch = element.match(/((?:#[\w-]+)|(?:\.[\w-]+)|(?:\[[^\]]+\])|(?:[a-z][\w-]*\[[^\]]+\]))\s*$/i);
  return selectorMatch?.[1];
}

function isSelectorFallbackActionCompatible(action: AgentPlanStepDraft['action'], source: string): boolean {
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
}

function hasSelectorFallbackTokenOverlap(contextTokens: Set<string>, sourceTokens: Set<string>): boolean {
  return [...sourceTokens].some((sourceToken) =>
    [...contextTokens].some(
      (contextToken) =>
        contextToken === sourceToken ||
        (sourceToken.length >= 2 && contextToken.length >= 2 && contextToken.includes(sourceToken)) ||
        (sourceToken.length >= 3 && contextToken.length >= 3 && sourceToken.includes(contextToken)),
    ),
  );
}

function resolveSelectorFallbackCandidates(
  step: AgentPlanStepDraft,
  interactiveElements: string[] | undefined,
): SelectorFallbackCandidate[] {
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
}

function createReporterMarkdown(result: AgentReporterResult): string {
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
}

function plannerConfigForRequest(request: ChatCommandRequest): {
  config?: AgentPlannerModelConfig;
  fallbackReason?: string;
} {
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
}

function verifierConfigForRequest(request: ChatCommandRequest): {
  config?: AgentVerifierModelConfig;
  fallbackReason?: string;
} {
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
}

function reporterConfigForRequest(request: ChatCommandRequest): {
  config?: AgentReporterModelConfig;
  fallbackReason?: string;
} {
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
}

function resolveExecutionIntent(request: ChatCommandRequest, plannedStep?: AgentPlanStepDraft): ExecutionIntent {
  if (!plannedStep) {
    const assertionIntent = extractAssertionIntent(request.prompt);
    const explicitUrl = extractExplicitUrl(request.prompt);
    const clickIntent = extractClickIntent(request.prompt);
    const inputIntent = extractInputIntent(request.prompt);
    const selectIntent = extractSelectIntent(request.prompt);
    const extractIntent = request.mode === 'aiQuery' ? extractQueryIntent(request.prompt) : undefined;
    const waitIntent = extractDirectWaitIntent(request.prompt);
    const scrollIntent = extractScrollIntent(request.prompt);
    return {
      ...(explicitUrl ? { explicitUrl } : {}),
      ...(clickIntent ? { clickIntent } : {}),
      ...(inputIntent ? { inputIntent } : {}),
      ...(selectIntent ? { selectIntent } : {}),
      ...(extractIntent ? { extractIntent } : {}),
      ...(waitIntent ? { waitIntent } : {}),
      ...(scrollIntent ? { scrollIntent } : {}),
      ...(assertionIntent ? { assertionIntent } : {}),
      ...(request.mode === 'aiAssert' && !assertionIntent ? { semanticAssertion: request.prompt.trim() } : {}),
    };
  }

  const instruction = plannedStep.instruction;
  if (plannedStep.action === 'navigate') {
    const explicitUrl = plannedStep.url ?? extractExplicitUrl(instruction);
    return explicitUrl ? { explicitUrl } : {};
  }
  if (plannedStep.action === 'click') {
    const parsed = extractClickIntent(instruction);
    const clickIntent = plannedStep.selector
      ? { selector: plannedStep.selector }
      : plannedStep.target
        ? { target: plannedStep.target }
        : parsed;
    return clickIntent ? { clickIntent } : {};
  }
  if (plannedStep.action === 'input') {
    const parsed = extractInputIntent(instruction);
    const value = plannedStep.value ?? parsed?.value;
    if (value === undefined) {
      return {};
    }
    const inputIntent = plannedStep.selector
      ? { selector: plannedStep.selector, value }
      : plannedStep.target
        ? { target: plannedStep.target, value }
        : parsed;
    return inputIntent ? { inputIntent } : {};
  }
  if (plannedStep.action === 'wait') {
    const timeoutMs = plannedStep.timeoutMs ?? extractWaitMs(instruction) ?? 1_000;
    const waitsForChartStability = isChartStableWaitInstruction(instruction);
    const waitsForDataReadiness = isDataReadyWaitInstruction(instruction);
    const responseUrlPattern = plannedStep.selector ? undefined : extractResponseUrlPattern(plannedStep);
    return {
      waitIntent: {
        timeoutMs,
        ...(plannedStep.selector ? { selector: plannedStep.selector } : {}),
        ...(waitsForChartStability
          ? { strategy: 'chartStable' as const }
          : responseUrlPattern
            ? { urlPattern: responseUrlPattern, strategy: 'response' as const }
            : waitsForDataReadiness
              ? { strategy: 'dataReady' as const }
              : plannedStep.selector
            ? { strategy: 'selector' as const }
            : {}),
        ...(!plannedStep.selector &&
        !responseUrlPattern &&
        !waitsForChartStability &&
        !waitsForDataReadiness &&
        isNetworkIdleWaitInstruction(instruction)
          ? { strategy: 'networkIdle' as const }
          : {}),
      },
    };
  }
  if (plannedStep.action === 'scroll') {
    return { scrollIntent: resolveScrollIntent(plannedStep) };
  }
  if (plannedStep.action === 'select') {
    const parsed = extractSelectIntent(instruction);
    const value = plannedStep.value ?? parsed?.value;
    if (value === undefined) {
      return {};
    }
    const selectIntent = plannedStep.selector
      ? { selector: plannedStep.selector, value }
      : plannedStep.target
        ? { target: plannedStep.target, value }
        : parsed;
    return selectIntent ? { selectIntent } : {};
  }
  if (plannedStep.action === 'assert') {
    const assertionIntent = extractAssertionIntent(instruction);
    return assertionIntent ? { assertionIntent } : { semanticAssertion: instruction };
  }
  if (plannedStep.action === 'extract') {
    return { extractIntent: { ...(plannedStep.target ? { target: plannedStep.target } : {}) } };
  }
  return {};
}

function isObservationIntent(text: string): boolean {
  return /(?:观察|查看|读取|检查|分析)(?:一下)?(?:当前)?页面|(?:observe|inspect)\s+(?:the\s+)?(?:current\s+)?page/i.test(text);
}

function createPrimaryExecution(browserPreparation: BrowserPreparationResult) {
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
}

function toBrowserSessionSnapshot(
  session: BrowserSessionState | undefined,
): PlannedAgentStepExecution['browserSession'] | undefined {
  if (!session) {
    return undefined;
  }
  return {
    status: session.status,
    currentUrl: session.currentUrl,
    ...(session.pageTitle ? { pageTitle: session.pageTitle } : {}),
    ...(session.screenshotPath ? { screenshotPath: session.screenshotPath } : {}),
  };
}

function classifyFailureReason(
  failureReason: string | undefined,
  step?: AgentPlanStepDraft,
): AgentFailureCategory | undefined {
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
}

function recoveryStrategyForFailure(
  failureCategory: AgentFailureCategory | undefined,
): AgentRecoveryStrategy | undefined {
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
}

function toPlannedStepExecution(
  step: AgentPlanStepDraft,
  stepIndex: number,
  preparation: BrowserPreparationResult,
): PlannedAgentStepExecution {
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
}

export class StudioRuntime {
  private sessionActive = false;
  private activeTraceScope: string | null = null;

  constructor(
    private readonly emitRunEvent: (event: RunEventPayload) => void,
    private readonly browserObserver?: BrowserObserver,
    private readonly semanticActionRuntime?: SemanticActionRuntime,
    private readonly agentPlanner?: AgentPlanner,
    private readonly agentVerifier?: AgentVerifier,
    private readonly agentReporter?: AgentReporter,
    private readonly reporterReportWriter?: ReporterReportWriter,
    private readonly deterministicInputBindingResolver?: DeterministicInputBindingResolver,
  ) {}

  private async trySelectorFallbackForStep(
    request: ChatCommandRequest,
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

  async sendChatCommand(request: ChatCommandRequest): Promise<ChatCommandResponse> {
    throwIfRunCancelled(request.cancellationSignal);
    const traceScopeId = `agent-trace-${Date.now()}`;
    const ownsTraceScope = await this.beginTraceScope(traceScopeId);
    const planningAttempt = await this.createAgentPlan(request);
    throwIfRunCancelled(request.cancellationSignal);
    const modelAssignments = resolveAgentModelAssignments({
      midsceneConfig: request.midsceneConfig ?? defaultMidsceneConfig,
      ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
    });

    if (planningAttempt.result) {
      const executions: PlannedAgentStepExecution[] = [];
      const replanningHistory: PlannedAgentReplanningRecord[] = [];
      const replanningCycleLimit = resolvePlannerReplanningCycleLimit(request);
      let executionMetrics = withReplanningCycleLimit(planningAttempt.result.metrics, replanningCycleLimit);
      let plannedPlan = planningAttempt.result.plan;
      let replanningCycles = 0;
      let completedSteps: CompletedPlannerStep[] = [];
      for (let stepIndex = 0; stepIndex < plannedPlan.steps.length; stepIndex += 1) {
        throwIfRunCancelled(request.cancellationSignal);
        const step = plannedPlan.steps[stepIndex]!;
        const preparation = await this.prepareBrowserForAgent(request, step);
        let execution = toPlannedStepExecution(step, stepIndex, preparation);
        executionMetrics = mergeExecutionMetrics(executionMetrics, preparation.executionMetrics) ?? executionMetrics;
        if (execution.status !== 'passed' && shouldRetryFailedExecution(step, execution)) {
          const failedAttempt = execution;
          const dynamicWaitAttempt = await this.waitBeforeRetry(step, failedAttempt, request.cancellationSignal);
          if (dynamicWaitAttempt) {
            executionMetrics = withDynamicWaitAttempt(executionMetrics);
          }
          if (dynamicWaitAttempt?.status === 'failed') {
            execution = {
              ...failedAttempt,
              dynamicWaitAttempts: [...(failedAttempt.dynamicWaitAttempts ?? []), dynamicWaitAttempt],
            };
          } else {
            const retryPreparation = await this.prepareBrowserForAgent(request, step);
            execution = {
              ...toPlannedStepExecution(step, stepIndex, retryPreparation),
              ...(dynamicWaitAttempt ? { dynamicWaitAttempts: [dynamicWaitAttempt] } : {}),
              retryAttempts: [
                {
                  status: failedAttempt.status,
                  summary: failedAttempt.summary,
                  evidence: failedAttempt.evidence,
                  ...(failedAttempt.failureReason ? { failureReason: failedAttempt.failureReason } : {}),
                  ...(failedAttempt.failureCategory ? { failureCategory: failedAttempt.failureCategory } : {}),
                  ...(failedAttempt.recoveryStrategy ? { recoveryStrategy: failedAttempt.recoveryStrategy } : {}),
                },
              ],
            };
            executionMetrics = withRetryAttempt(
              mergeExecutionMetrics(executionMetrics, retryPreparation.executionMetrics) ?? executionMetrics,
            );
          }
        }
        if (execution.status !== 'passed' && shouldTrySelectorFallback(step, execution)) {
          const selectorFallback = await this.trySelectorFallbackForStep(
            request,
            step,
            stepIndex,
            execution,
            request.cancellationSignal,
          );
          if (selectorFallback) {
            execution = selectorFallback.execution;
            executionMetrics =
              mergeExecutionMetrics(executionMetrics, selectorFallback.executionMetrics) ?? executionMetrics;
            selectorFallback.attempts.forEach(() => {
              executionMetrics = withSelectorFallbackAttempt(executionMetrics);
            });
          }
        }
        if (execution.status !== 'passed') {
          const completedStepsForReplan = appendCompletedPlannerSteps(completedSteps, plannedPlan, executions);
          const revisedPlan = replanningCycles >= replanningCycleLimit || !shouldReplanFailedExecution(step, execution)
            ? undefined
            : await this.createReplannedAgentPlan(request, plannedPlan, step, execution, completedStepsForReplan);
          if (revisedPlan) {
            const previousPlan = plannedPlan;
            executions.push(execution);
            completedSteps = completedStepsForReplan;
            const completedStepCount = completedSteps.length;
            replanningCycles += 1;
            const nextPlan = {
              ...revisedPlan.plan,
              risks: [
                ...revisedPlan.plan.risks,
                `已在步骤「${step.title}」${execution.status === 'failed' ? '失败' : '未完成'}后触发第 ${replanningCycles} 次重规划。`,
              ],
            };
            replanningHistory.push({
              cycle: replanningCycles,
              previousPlan,
              revisedPlan: nextPlan,
              executions: [...executions],
              failedStepIndex: stepIndex,
              ...(completedStepCount ? { completedStepCount } : {}),
              ...(revisedPlan.metrics ? { planningMetrics: revisedPlan.metrics } : {}),
            });
            plannedPlan = nextPlan;
            executionMetrics = mergeExecutionMetrics(executionMetrics, withReplanningCycle(revisedPlan.metrics)) ?? executionMetrics;
            executions.length = 0;
            stepIndex = -1;
            continue;
          }
          executions.push(execution);
          break;
        }
        executions.push(execution);
      }
      const tracedAgentRun = await this.finishTraceScope(traceScopeId, ownsTraceScope, createPlannedAgentRun({
        mode: request.mode,
        prompt: request.prompt,
        runtimeDescription: describeRuntimeProfile(request.runtimeProfile),
        targetEnvironment: request.targetEnvironment,
        targetUrl: request.runtimeProfile.baseUrl,
        plannedPlan,
        planner: planningAttempt.provenance,
        executions,
        ...(replanningHistory.length ? { replanningHistory } : {}),
        ...(planningAttempt.result.metrics ? { planningMetrics: planningAttempt.result.metrics } : {}),
        executionMetrics,
        modelAssignments,
        ...(request.projectId ? { projectId: request.projectId } : {}),
        ...(request.groupId ? { groupId: request.groupId } : {}),
        ...(request.environmentId ? { environmentId: request.environmentId } : {}),
        ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
        ...(request.documentId ? { documentId: request.documentId } : {}),
      }));
      const agentRun = await this.enhanceRunWithReporter(request, tracedAgentRun);
      return this.createChatCommandResponse(request, agentRun);
    }

    const browserPreparation = await this.prepareBrowserForAgent(request);
    throwIfRunCancelled(request.cancellationSignal);
    const observedSession = browserPreparation.session;
    const primaryExecution = createPrimaryExecution(browserPreparation);
    const unresolvedEvaluation =
      !browserPreparation.assertionEvaluation &&
      (request.mode === 'aiQuery' ||
        (!('primaryAction' in primaryExecution) && request.mode === 'ai' && !isObservationIntent(request.prompt)))
        ? createPendingSemanticEvaluation(
            request.mode === 'aiQuery'
              ? '结构化提取能力尚未执行，该步骤保持等待态。'
              : '当前指令尚未解析为可执行浏览器动作，该步骤保持等待态。',
          )
        : undefined;
    const verificationEvaluation = browserPreparation.assertionEvaluation ?? unresolvedEvaluation;
    const executionMetrics = browserPreparation.executionMetrics;
    const tracedAgentRun = await this.finishTraceScope(traceScopeId, ownsTraceScope, createStubAgentRun({
      mode: request.mode,
      prompt: request.prompt,
      runtimeDescription: describeRuntimeProfile(request.runtimeProfile),
      targetEnvironment: request.targetEnvironment,
      targetUrl: browserPreparation.navigatedUrl ?? request.runtimeProfile.baseUrl,
      browserActionMessage: browserPreparation.message,
      ...primaryExecution,
      planner: planningAttempt.provenance,
      ...(browserPreparation.observation ? { observation: browserPreparation.observation } : {}),
      ...(verificationEvaluation
        ? {
            verificationStatus: verificationEvaluation.status,
            verificationSummary: verificationEvaluation.summary,
            verificationEvidence: verificationEvaluation.evidence,
            ...(verificationEvaluation.failureReason
              ? { verificationFailureReason: verificationEvaluation.failureReason }
              : {}),
          }
        : {}),
      ...(browserPreparation.reportArtifactPath
        ? { reportArtifactPath: browserPreparation.reportArtifactPath }
        : {}),
      ...(executionMetrics ? { executionMetrics } : {}),
      modelAssignments,
      ...(observedSession
        ? {
            browserSession: {
              status: observedSession.status,
              currentUrl: observedSession.currentUrl,
              pageTitle: observedSession.pageTitle,
              ...(observedSession.screenshotPath ? { screenshotPath: observedSession.screenshotPath } : {}),
            },
          }
        : {}),
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.groupId ? { groupId: request.groupId } : {}),
      ...(request.environmentId ? { environmentId: request.environmentId } : {}),
      ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
      ...(request.documentId ? { documentId: request.documentId } : {}),
    }));
    const agentRun = await this.enhanceRunWithReporter(request, tracedAgentRun);
    return this.createChatCommandResponse(request, agentRun);
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
    request: ChatCommandRequest,
    agentRun: AgentRunResult,
  ): Promise<AgentRunResult> {
    throwIfRunCancelled(request.cancellationSignal);
    if (!this.agentReporter || agentRun.status === 'passed' || agentRun.status === 'running') {
      return agentRun;
    }

    const resolved = reporterConfigForRequest(request);
    if (!resolved.config) {
      return agentRun;
    }

    try {
      const result = await awaitWithRunCancellation(
        this.agentReporter.report({
          config: resolved.config,
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
          run: {
            status: agentRun.status,
            summary: agentRun.summary,
            ...(agentRun.failureReason ? { failureReason: agentRun.failureReason } : {}),
            intent: agentRun.intent,
            plan: agentRun.plan,
            events: agentRun.events,
            artifacts: agentRun.artifacts,
          },
        }),
        request.cancellationSignal,
      );
      throwIfRunCancelled(request.cancellationSignal);
      const reportPaths = this.reporterReportWriter
        ? await awaitWithRunCancellation(
          this.reporterReportWriter.writeReporterReport({
            runId: agentRun.runId,
            markdown: createReporterMarkdown(result),
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
        message: `${result.summary}\n\n${createReporterMarkdown(result)}`,
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
      return {
        ...agentRun,
        summary: `${result.summary}\n${agentRun.summary}`,
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
      };
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

    return {
      userEntry,
      assistantEntry,
      agentRun,
    };
  }

  private async createAgentPlan(request: ChatCommandRequest): Promise<PlanningAttempt> {
    throwIfRunCancelled(request.cancellationSignal);
    const resolved = plannerConfigForRequest(request);
    if (!this.agentPlanner || !resolved.config) {
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
          fallbackReason: (error as Error).message || 'Planner 模型调用失败',
        },
      };
    }
  }

  private async createReplannedAgentPlan(
    request: ChatCommandRequest,
    currentPlan: AgentPlanDraft,
    failedStep: AgentPlanStepDraft,
    failedExecution: PlannedAgentStepExecution,
    completedSteps: CompletedPlannerStep[],
  ): Promise<AgentPlannerResult | undefined> {
    const resolved = plannerConfigForRequest(request);
    if (!this.agentPlanner || !resolved.config) {
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

  private async prepareBrowserForAgent(
    request: ChatCommandRequest,
    plannedStep?: AgentPlanStepDraft,
  ): Promise<BrowserPreparationResult> {
    throwIfRunCancelled(request.cancellationSignal);
    const executionIntent = resolveExecutionIntent(request, plannedStep);
    const {
      assertionIntent,
      clickIntent,
      explicitUrl,
      extractIntent,
      inputIntent,
      scrollIntent,
      semanticAssertion,
      selectIntent,
      waitIntent,
    } = executionIntent;

    if (!this.browserObserver) {
      const assertionEvaluation =
        assertionIntent && request.browserSession
          ? evaluateExplicitAssertion(assertionIntent, request.browserSession)
          : undefined;
      return request.browserSession
        ? {
            session: request.browserSession,
            message: assertionEvaluation
              ? `未连接主进程浏览器 runtime，使用前端会话快照；${assertionEvaluation.summary}`
              : '未连接主进程浏览器 runtime，使用前端会话快照。',
            ...(assertionIntent ? { assertion: assertionIntent } : {}),
            ...(assertionEvaluation ? { assertionEvaluation } : {}),
          }
        : {
            message: '未连接主进程浏览器 runtime，等待真实浏览器观察能力。',
            ...(assertionIntent ? { assertion: assertionIntent } : {}),
          };
    }

    try {
      const current = this.browserObserver.getState();
      const shouldStart =
        request.project &&
        request.environment &&
        (!current.currentUrl || current.status === 'idle' || current.status === 'closed' || current.status === 'error');

      let session: BrowserSessionState;
      let message: string;

      if (shouldStart && request.project && request.environment) {
        session = await awaitWithRunCancellation(this.browserObserver.start({
          project: request.project,
          environment: request.environment,
          record: false,
        }), request.cancellationSignal);
        message = `Agent 已启动受控浏览器：${session.currentUrl || request.environment.url}`;
      } else {
        session = await awaitWithRunCancellation(this.browserObserver.capture(), request.cancellationSignal);
        message = `Agent 已复用浏览器会话并捕获快照：${session.currentUrl || '当前页面'}`;
      }

      if (explicitUrl && session.currentUrl !== explicitUrl) {
        session = await awaitWithRunCancellation(
          this.browserObserver.navigate({ url: explicitUrl }),
          request.cancellationSignal,
        );
        message = `${message}；并导航到用户指定 URL：${explicitUrl}`;
      }

      let semanticEvaluation: AssertionEvaluation | undefined;
      let reportArtifactPath: string | undefined;
      let executionMetrics: AgentExecutionMetrics | undefined;

      if (clickIntent?.selector) {
        session = await awaitWithRunCancellation(
          this.browserObserver.click({ selector: clickIntent.selector }),
          request.cancellationSignal,
        );
        message = `${message}；并点击用户指定 selector：${clickIntent.selector}`;
      } else if (clickIntent?.target) {
        if (this.semanticActionRuntime && request.midsceneConfig && isMidsceneConfigured(request.midsceneConfig)) {
          const result = await awaitWithRunCancellation(this.semanticActionRuntime.click({
            target: clickIntent.target,
            prompt: plannedStep?.instruction ?? request.prompt,
            config: request.midsceneConfig,
          }), request.cancellationSignal);
          semanticEvaluation = toAssertionEvaluation(result);
          reportArtifactPath = result.reportPath;
          executionMetrics = result.metrics;
          session = await awaitWithRunCancellation(this.browserObserver.capture(), request.cancellationSignal);
          message = `${message}；${result.message}`;
        } else {
          const pendingMessage = `已识别点击目标「${clickIntent.target}」，等待 Midscene 语义定位执行。`;
          semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      }

      if (inputIntent?.selector) {
        session = await awaitWithRunCancellation(
          this.browserObserver.input({ selector: inputIntent.selector, value: inputIntent.value }),
          request.cancellationSignal,
        );
        message = `${message}；并在用户指定 selector 输入内容：${inputIntent.selector}`;
      } else if (inputIntent?.target) {
        if (this.semanticActionRuntime && request.midsceneConfig && isMidsceneConfigured(request.midsceneConfig)) {
          const result = await awaitWithRunCancellation(this.semanticActionRuntime.input({
            target: inputIntent.target,
            value: inputIntent.value,
            prompt: plannedStep?.instruction ?? request.prompt,
            config: request.midsceneConfig,
          }), request.cancellationSignal);
          semanticEvaluation = toAssertionEvaluation(result);
          reportArtifactPath = result.reportPath;
          executionMetrics = result.metrics;
          session = await awaitWithRunCancellation(this.browserObserver.capture(), request.cancellationSignal);
          message = `${message}；${result.message}`;
        } else {
          const pendingMessage = `已识别输入目标「${inputIntent.target}」，等待 Midscene 语义定位执行。`;
          semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      }

      let waitedMs: number | undefined;
      if (waitIntent) {
        if (waitIntent.strategy === 'chartStable' && this.browserObserver.waitForChartStable) {
          session = await awaitWithRunCancellation(this.browserObserver.waitForChartStable({
            ...(waitIntent.selector ? { selector: waitIntent.selector } : {}),
            timeoutMs: waitIntent.timeoutMs,
          }), request.cancellationSignal);
          waitedMs = waitIntent.timeoutMs;
          message = waitIntent.selector
            ? `${message}；并等待图表稳定：${waitIntent.selector}`
            : `${message}；并等待页面图表稳定`;
        } else if (waitIntent.strategy === 'dataReady' && this.browserObserver.waitForDataReady) {
          session = await awaitWithRunCancellation(this.browserObserver.waitForDataReady({
            ...(waitIntent.selector ? { selector: waitIntent.selector } : {}),
            timeoutMs: waitIntent.timeoutMs,
          }), request.cancellationSignal);
          waitedMs = waitIntent.timeoutMs;
          message = waitIntent.selector
            ? `${message}；并等待数据就绪：${waitIntent.selector}`
            : `${message}；并等待页面数据就绪`;
        } else if (waitIntent.selector && this.browserObserver.waitForSelector) {
          session = await awaitWithRunCancellation(this.browserObserver.waitForSelector({
            selector: waitIntent.selector,
            timeoutMs: waitIntent.timeoutMs,
          }), request.cancellationSignal);
          waitedMs = waitIntent.timeoutMs;
          message = `${message}；并等待 selector 可见：${waitIntent.selector}`;
        } else if (waitIntent.strategy === 'response' && waitIntent.urlPattern && this.browserObserver.waitForResponse) {
          session = await awaitWithRunCancellation(this.browserObserver.waitForResponse({
            urlPattern: waitIntent.urlPattern,
            timeoutMs: waitIntent.timeoutMs,
          }), request.cancellationSignal);
          waitedMs = waitIntent.timeoutMs;
          message = `${message}；并等待接口响应：${waitIntent.urlPattern}`;
        } else if (waitIntent.strategy === 'networkIdle' && this.browserObserver.waitForNetworkIdle) {
          session = await awaitWithRunCancellation(
            this.browserObserver.waitForNetworkIdle({ timeoutMs: waitIntent.timeoutMs }),
            request.cancellationSignal,
          );
          waitedMs = waitIntent.timeoutMs;
          message = `${message}；并等待页面网络空闲：${waitIntent.timeoutMs}ms`;
        } else if (this.browserObserver.wait) {
          session = await awaitWithRunCancellation(
            this.browserObserver.wait({ timeoutMs: waitIntent.timeoutMs }),
            request.cancellationSignal,
          );
          waitedMs = waitIntent.timeoutMs;
          message = `${message}；并等待页面稳定：${waitIntent.timeoutMs}ms`;
        } else {
          const pendingMessage = '已识别等待动作，但当前浏览器 runtime 尚未接入 wait 执行器。';
          semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      }

      let scrolledSelector: string | undefined;
      let scrolledPage = false;
      if (scrollIntent) {
        if (this.browserObserver.scroll) {
          session = await awaitWithRunCancellation(this.browserObserver.scroll(scrollIntent), request.cancellationSignal);
          scrolledSelector = scrollIntent.selector;
          scrolledPage = !scrollIntent.selector;
          message = scrollIntent.selector
            ? `${message}；并滚动到用户指定 selector：${scrollIntent.selector}`
            : `${message}；并滚动当前页面`;
        } else {
          const pendingMessage = '已识别滚动动作，但当前浏览器 runtime 尚未接入 scroll 执行器。';
          semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      }

      let selectedSelector: string | undefined;
      let selectedValue: string | undefined;
      if (selectIntent?.selector) {
        if (this.browserObserver.select) {
          session = await awaitWithRunCancellation(
            this.browserObserver.select({ selector: selectIntent.selector, value: selectIntent.value }),
            request.cancellationSignal,
          );
          selectedSelector = selectIntent.selector;
          selectedValue = selectIntent.value;
          message = `${message}；并在用户指定 selector 选择选项：${selectIntent.selector}`;
        } else {
          const pendingMessage = '已识别下拉选择动作，但当前浏览器 runtime 尚未接入 select 执行器。';
          semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      } else if (selectIntent?.target) {
        if (this.semanticActionRuntime && request.midsceneConfig && isMidsceneConfigured(request.midsceneConfig)) {
          const result = await awaitWithRunCancellation(this.semanticActionRuntime.select({
            target: selectIntent.target,
            value: selectIntent.value,
            prompt: plannedStep?.instruction ?? request.prompt,
            config: request.midsceneConfig,
          }), request.cancellationSignal);
          semanticEvaluation = toAssertionEvaluation(result);
          reportArtifactPath = result.reportPath;
          executionMetrics = result.metrics;
          session = await this.browserObserver.capture();
          message = `${message}；${result.message}`;
        } else {
          const pendingMessage = `已识别下拉选择目标「${selectIntent.target}」，等待 Midscene 语义选择执行。`;
          semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      }

      if (extractIntent?.target && this.semanticActionRuntime && request.midsceneConfig && isMidsceneConfigured(request.midsceneConfig)) {
        const result = await awaitWithRunCancellation(this.semanticActionRuntime.extract({
          target: extractIntent.target,
          prompt: plannedStep?.instruction ?? request.prompt,
          config: request.midsceneConfig,
        }), request.cancellationSignal);
        semanticEvaluation = toAssertionEvaluation(result);
        reportArtifactPath = result.reportPath;
        executionMetrics = result.metrics;
        message = `${message}；${result.message}`;
      } else if (extractIntent?.target) {
        const pendingMessage = `已识别提取目标「${extractIntent.target}」，等待 Midscene 语义提取执行。`;
        semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
        message = `${message}；${pendingMessage}`;
      }

      const observation = await this.captureBrowserObservation(request.cancellationSignal);
      const extracted = Boolean(
        extractIntent && (extractIntent.target ? semanticEvaluation?.status === 'passed' : observation),
      );
      let assertionEvaluation: AssertionEvaluation | undefined;
      if (assertionIntent) {
        const pageText =
          assertionIntent.kind === 'pageContains' && this.browserObserver.getPageText
            ? await this.browserObserver.getPageText()
            : undefined;
        const domInspection =
          (assertionIntent.kind === 'domSelectorExists' ||
            assertionIntent.kind === 'domSelectorVisible' ||
            assertionIntent.kind === 'domSelectorTextContains' ||
            assertionIntent.kind === 'domSelectorAttributeEquals') &&
          assertionIntent.domSelector &&
          this.browserObserver.inspectDom
            ? assertionIntent.domAttributeName
              ? await this.browserObserver.inspectDom(assertionIntent.domSelector, assertionIntent.domAttributeName)
              : await this.browserObserver.inspectDom(assertionIntent.domSelector)
            : undefined;
        assertionEvaluation = evaluateExplicitAssertion(assertionIntent, session, pageText, observation, domInspection);
        message = `${message}；${assertionEvaluation.summary}`;
      } else if (semanticAssertion) {
        const verifierConfig = verifierConfigForRequest(request);
        if (this.agentVerifier && verifierConfig.config) {
          try {
            const result = await awaitWithRunCancellation(
              this.agentVerifier.verify({
                config: verifierConfig.config,
                ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
                assertion: semanticAssertion,
                prompt: plannedStep?.instruction ?? request.prompt,
                ...(session.currentUrl ? { currentUrl: session.currentUrl } : {}),
                ...(session.pageTitle ? { pageTitle: session.pageTitle } : {}),
                ...(observation ? { observation } : {}),
              }),
              request.cancellationSignal,
            );
            assertionEvaluation = toVerifierAssertionEvaluation(result);
            executionMetrics = result.metrics;
            message = `${message}；${result.summary}`;
          } catch (error) {
            if (isRunCancelled(error)) {
              throw error;
            }
            const pendingMessage = `Verifier 模型判断失败，当前语义断言保持等待态：${(error as Error).message}`;
            assertionEvaluation = createPendingSemanticEvaluation(pendingMessage);
            message = `${message}；${pendingMessage}`;
          }
        } else if (this.semanticActionRuntime && request.midsceneConfig && isMidsceneConfigured(request.midsceneConfig)) {
          const result = await awaitWithRunCancellation(this.semanticActionRuntime.assert({
            assertion: semanticAssertion,
            prompt: plannedStep?.instruction ?? request.prompt,
            config: request.midsceneConfig,
          }), request.cancellationSignal);
          assertionEvaluation = toAssertionEvaluation(result);
          reportArtifactPath = result.reportPath;
          executionMetrics = result.metrics;
          message = `${message}；${result.message}`;
        } else {
          const pendingMessage = verifierConfig.fallbackReason
            ? `已识别语义断言，等待 Verifier 配置完成：${verifierConfig.fallbackReason}。`
            : '已识别语义断言，等待 Verifier 或 Midscene 根据页面上下文执行判断。';
          assertionEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      }

      assertionEvaluation ??= semanticEvaluation;

      return {
        session,
        message,
        ...(explicitUrl ? { navigatedUrl: explicitUrl } : {}),
        ...(clickIntent?.selector ? { clickedSelector: clickIntent.selector } : {}),
        ...(clickIntent?.target ? { clickTarget: clickIntent.target } : {}),
        ...(inputIntent?.selector ? { inputSelector: inputIntent.selector } : {}),
        ...(inputIntent?.target ? { inputTarget: inputIntent.target } : {}),
        ...(inputIntent ? { inputValue: inputIntent.value } : {}),
        ...(waitedMs !== undefined ? { waitedMs } : {}),
        ...(scrolledSelector ? { scrolledSelector } : {}),
        ...(scrolledPage ? { scrolledPage } : {}),
        ...(selectedSelector ? { selectedSelector } : {}),
        ...(selectedValue ? { selectedValue } : {}),
        ...(extracted ? { extracted } : {}),
        ...(assertionIntent ? { assertion: assertionIntent } : {}),
        ...(semanticAssertion ? { semanticAssertion } : {}),
        ...(assertionEvaluation ? { assertionEvaluation } : {}),
        ...(reportArtifactPath ? { reportArtifactPath } : {}),
        ...(executionMetrics ? { executionMetrics } : {}),
        ...(observation ? { observation } : {}),
      };
    } catch (error) {
      if (isRunCancelled(error)) {
        throw error;
      }
      const failureReason = (error as Error).message || '未知错误';
      return {
        session: request.browserSession ?? this.browserObserver.getState(),
        message: `语义动作执行失败，已退回到最近一次会话快照：${failureReason}`,
        ...(clickIntent?.target ? { clickTarget: clickIntent.target } : {}),
        ...(inputIntent?.target ? { inputTarget: inputIntent.target } : {}),
        ...(inputIntent ? { inputValue: inputIntent.value } : {}),
        ...(semanticAssertion ? { semanticAssertion } : {}),
        assertionEvaluation: {
          status: 'failed',
          summary: '语义动作执行失败。',
          evidence: `Runtime error: ${failureReason}`,
          failureReason,
        },
      };
    }
  }

  private async captureBrowserObservation(
    cancellationSignal?: AbortSignal,
  ): Promise<BrowserPreparationResult['observation'] | undefined> {
    if (!this.browserObserver?.captureObservation) {
      return undefined;
    }

    try {
      return await awaitWithRunCancellation(this.browserObserver.captureObservation(), cancellationSignal);
    } catch (error) {
      if (isRunCancelled(error)) {
        throw error;
      }
      return undefined;
    }
  }

  private async prepareDeterministicAssertion(
    request: RunDeterministicStepRequest & { assertion: ExplicitTestAssertion },
  ): Promise<BrowserPreparationResult> {
    const assertion = toExplicitAssertionIntent(request.assertion);
    const session = await awaitWithRunCancellation(this.browserObserver!.capture(), request.cancellationSignal);
    throwIfRunCancelled(request.cancellationSignal);
    const pageText =
      assertion.kind === 'pageContains' && this.browserObserver?.getPageText
        ? await awaitWithRunCancellation(this.browserObserver.getPageText(), request.cancellationSignal)
        : undefined;
    const domInspection =
      (assertion.kind === 'domSelectorVisible' || assertion.kind === 'domSelectorTextContains') &&
      assertion.domSelector &&
      this.browserObserver?.inspectDom
        ? await awaitWithRunCancellation(this.browserObserver.inspectDom(assertion.domSelector), request.cancellationSignal)
        : undefined;
    const observation = await this.captureBrowserObservation(request.cancellationSignal);
    const assertionEvaluation = evaluateExplicitAssertion(assertion, session, pageText, observation, domInspection);

    return {
      session,
      message: `已复用浏览器会话执行已确认的显式断言；${assertionEvaluation.summary}`,
      assertion,
      assertionEvaluation,
      ...(observation ? { observation } : {}),
    };
  }

  private async prepareDeterministicBoundInput(
    request: RunDeterministicStepRequest & { inputBinding: TestInputValueBinding },
  ): Promise<BrowserPreparationResult> {
    const action = request.sourceStep.execution?.action;
    const inputBindingResolver = request.inputBindingResolver ?? this.deterministicInputBindingResolver;
    if (
      !this.browserObserver ||
      (action?.kind !== 'input' && action?.kind !== 'select') ||
      !request.project?.id ||
      !inputBindingResolver
    ) {
      return {
        message: '输入值绑定不可用，未读取值且未派发浏览器动作。',
        assertionEvaluation: {
          status: 'neutral',
          summary: '输入值绑定不可用。',
          evidence: '当前运行缺少项目上下文或受控凭据解析器。',
        },
      };
    }

    const session = await awaitWithRunCancellation(this.browserObserver.capture(), request.cancellationSignal);
    let value: string;
    try {
      value = await awaitWithRunCancellation(
        inputBindingResolver.resolve({
          projectId: request.project.id,
          binding: request.inputBinding,
        }),
        request.cancellationSignal,
      );
    } catch (error) {
      if (isRunCancelled(error)) {
        throw error;
      }
      return {
        session,
        message: '输入值绑定无法解析，未派发浏览器动作。',
        assertionEvaluation: {
          status: 'neutral',
          summary: '输入值绑定无法解析。',
          evidence: (error as Error).message || '凭据引用不可用。',
        },
      };
    }

    throwIfRunCancelled(request.cancellationSignal);
    if (action.kind === 'input') {
      const nextSession = await awaitWithRunCancellation(
        this.browserObserver.input({ selector: action.locator.selector, value }),
        request.cancellationSignal,
      );
      return {
        session: nextSession,
        inputSelector: action.locator.selector,
        message: `已使用已确认的输入值引用填写 selector：${action.locator.selector}`,
      };
    }

    if (!this.browserObserver.select) {
      return {
        session,
        message: '当前浏览器 runtime 未接入 select 执行器，未派发浏览器动作。',
        assertionEvaluation: {
          status: 'neutral',
          summary: '下拉选择执行器不可用。',
          evidence: '输入值未传递给未接入的浏览器执行器。',
        },
      };
    }
    const nextSession = await awaitWithRunCancellation(
      this.browserObserver.select({ selector: action.locator.selector, value }),
      request.cancellationSignal,
    );
    return {
      session: nextSession,
      selectedSelector: action.locator.selector,
      message: `已使用已确认的输入值引用选择 selector：${action.locator.selector}`,
    };
  }

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

  async runWorkflow(request: RunWorkflowRequest): Promise<RunWorkflowResponse> {
    const runId = request.runId ?? `agent-run-workflow-${Date.now()}`;
    const title = request.workflow.name;
    let ownsTraceScope = false;
    const emitRunEvent = (event: RunEventPayload) => {
      if (!request.parentRunId) {
        this.emitRunEvent(event);
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
      return { runId, title, detail, agentRun };
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

    return { runId, title, detail, agentRun };
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
