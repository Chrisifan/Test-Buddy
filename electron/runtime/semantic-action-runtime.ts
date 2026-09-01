import path from 'node:path';

import { PlaywrightAgent } from '@midscene/web/playwright';
import type { Page } from 'playwright';

import type { AgentExecutionMetrics, AgentRunStatus, AgentUsageBucket } from '../../shared/agent.js';
import type { ResolvedMidsceneConfig } from './model-config-resolver.js';
import { createSecretRedactor, type SecretRedactor } from './secret-redactor.js';

interface SemanticActionRequest {
  config: ResolvedMidsceneConfig;
  prompt: string;
}

export interface SemanticClickRequest extends SemanticActionRequest {
  target: string;
}

export interface SemanticInputRequest extends SemanticActionRequest {
  target: string;
  value: string;
}

export interface SemanticSelectRequest extends SemanticActionRequest {
  target: string;
  value: string;
}

export interface SemanticExtractRequest extends SemanticActionRequest {
  target: string;
}

export interface SemanticAssertRequest extends SemanticActionRequest {
  assertion: string;
}

export interface SemanticActionResult {
  status: Extract<AgentRunStatus, 'passed' | 'failed'>;
  message: string;
  evidence?: string;
  failureReason?: string;
  reportPath?: string;
  metrics?: AgentExecutionMetrics;
}

export interface SemanticActionRuntime {
  click: (request: SemanticClickRequest) => Promise<SemanticActionResult>;
  input: (request: SemanticInputRequest) => Promise<SemanticActionResult>;
  select: (request: SemanticSelectRequest) => Promise<SemanticActionResult>;
  extract: (request: SemanticExtractRequest) => Promise<SemanticActionResult>;
  assert: (request: SemanticAssertRequest) => Promise<SemanticActionResult>;
}

interface MidscenePageProvider {
  getPage: () => unknown | null;
}

interface MidsceneAgent {
  aiTap: (target: string) => Promise<void>;
  aiInput: (target: string, options: { value: string }) => Promise<void>;
  aiAct: (task: string) => Promise<string | undefined>;
  aiQuery: (demand: string) => Promise<unknown>;
  aiAssert: (assertion: string) => Promise<
    | {
        pass: boolean;
        thought?: string;
        message?: string;
      }
    | undefined
  >;
  destroy: () => Promise<void>;
  readonly metrics?: MidsceneUsageMetrics;
}

interface MidsceneUsageMetrics {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCachedInput: number;
  totalTimeCostMs: number;
  calls: number;
  byIntent: Record<string, AgentUsageBucket>;
  byModel: Record<string, AgentUsageBucket>;
}

type MidsceneAgentOptions = NonNullable<ConstructorParameters<typeof PlaywrightAgent>[1]>;
type MidsceneAgentFactory = (page: unknown, options: MidsceneAgentOptions) => MidsceneAgent;

interface MidsceneSemanticRuntimeOptions {
  reportDirectory?: string;
  now?: () => number;
}

type MidsceneActionExecution<T> =
  | { ok: true; value: T; reportPath?: string; metrics?: AgentExecutionMetrics }
  | { ok: false; error: unknown; reportPath?: string; metrics?: AgentExecutionMetrics };

const getErrorMessage = (error: unknown, redactor: SecretRedactor): string => {
  return redactor.redactError(error);
};

const formatExtractedValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const createFailedActionResult = (
  actionLabel: string,
  target: string,
  execution: Extract<MidsceneActionExecution<unknown>, { ok: false }>,
  redactor: SecretRedactor,
): SemanticActionResult => {
  const failureReason = getErrorMessage(execution.error, redactor);
  return {
    status: 'failed',
    message: `Midscene ${actionLabel}「${target}」失败：${failureReason}`,
    evidence: failureReason,
    failureReason,
    ...(execution.reportPath ? { reportPath: execution.reportPath } : {}),
    ...(execution.metrics ? { metrics: execution.metrics } : {}),
  };
};

const createModelConfig = (config: ResolvedMidsceneConfig): Record<string, string> => {
  return {
    MIDSCENE_MODEL_BASE_URL: config.modelBaseUrl,
    MIDSCENE_MODEL_API_KEY: config.modelApiKey,
    MIDSCENE_MODEL_NAME: config.modelName,
    MIDSCENE_MODEL_FAMILY: config.modelFamily,
    ...(config.openaiHttpProxy ? { MIDSCENE_MODEL_HTTP_PROXY: config.openaiHttpProxy } : {}),
  };
};

const parseReplanningCycleLimit = (value: string): number | undefined => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const subtractBucket = (current: AgentUsageBucket | undefined, previous: AgentUsageBucket | undefined): AgentUsageBucket => {
  return {
    promptTokens: Math.max(0, (current?.promptTokens ?? 0) - (previous?.promptTokens ?? 0)),
    completionTokens: Math.max(0, (current?.completionTokens ?? 0) - (previous?.completionTokens ?? 0)),
    totalTokens: Math.max(0, (current?.totalTokens ?? 0) - (previous?.totalTokens ?? 0)),
    calls: Math.max(0, (current?.calls ?? 0) - (previous?.calls ?? 0)),
  };
};

const subtractBuckets = (
  current: Record<string, AgentUsageBucket>,
  previous: Record<string, AgentUsageBucket>,
): Record<string, AgentUsageBucket> => {
  return Object.fromEntries(
    [...new Set([...Object.keys(current), ...Object.keys(previous)])]
      .map((key) => [key, subtractBucket(current[key], previous[key])] as const)
      .filter(([, bucket]) => bucket.calls || bucket.totalTokens),
  );
};

const createExecutionMetrics = (
  current: MidsceneUsageMetrics,
  previous: MidsceneUsageMetrics,
  durationMs: number,
  replanningCycleLimit: number | undefined,
): AgentExecutionMetrics => {
  return {
    durationMs,
    modelTimeCostMs: Math.max(0, current.totalTimeCostMs - previous.totalTimeCostMs),
    calls: Math.max(0, current.calls - previous.calls),
    promptTokens: Math.max(0, current.totalPromptTokens - previous.totalPromptTokens),
    completionTokens: Math.max(0, current.totalCompletionTokens - previous.totalCompletionTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
    cachedInputTokens: Math.max(0, current.totalCachedInput - previous.totalCachedInput),
    ...(replanningCycleLimit ? { replanningCycleLimit } : {}),
    byIntent: subtractBuckets(current.byIntent, previous.byIntent),
    byModel: subtractBuckets(current.byModel, previous.byModel),
  };
};

const defaultAgentFactory: MidsceneAgentFactory = (page, options) =>
  new PlaywrightAgent(page as Page, options) as MidsceneAgent;

export class MidsceneSemanticActionRuntime {
  private cachedAgent?: {
    page: unknown;
    configKey: string;
    agent: MidsceneAgent;
    reportPath?: string;
  };

  constructor(
    private readonly pageProvider: MidscenePageProvider,
    private readonly agentFactory: MidsceneAgentFactory = defaultAgentFactory,
    private readonly options: MidsceneSemanticRuntimeOptions = {},
  ) {}

  async click(request: SemanticClickRequest): Promise<SemanticActionResult> {
    const execution = await this.runWithMetrics(request.config, (agent) => agent.aiTap(request.target));
    if (!execution.ok) {
      return createFailedActionResult('点击', request.target, execution, createSecretRedactor(request.config));
    }
    const { metrics, reportPath } = execution;
    return {
      status: 'passed',
      message: `Midscene 已点击「${request.target}」。`,
      evidence: 'aiTap 已完成语义定位和点击。',
      ...(reportPath ? { reportPath } : {}),
      ...(metrics ? { metrics } : {}),
    };
  }

  async input(request: SemanticInputRequest): Promise<SemanticActionResult> {
    const execution = await this.runWithMetrics(request.config, (agent) =>
      agent.aiInput(request.target, { value: request.value }),
    );
    if (!execution.ok) {
      return createFailedActionResult('输入', request.target, execution, createSecretRedactor(request.config));
    }
    const { metrics, reportPath } = execution;
    return {
      status: 'passed',
      message: `Midscene 已在「${request.target}」输入内容。`,
      evidence: 'aiInput 已完成语义定位和输入。',
      ...(reportPath ? { reportPath } : {}),
      ...(metrics ? { metrics } : {}),
    };
  }

  async select(request: SemanticSelectRequest): Promise<SemanticActionResult> {
    const task = `在下拉框「${request.target}」中选择「${request.value}」`;
    const execution = await this.runWithMetrics(request.config, (agent) => agent.aiAct(task));
    if (!execution.ok) {
      return createFailedActionResult('选择', `${request.target}：${request.value}`, execution, createSecretRedactor(request.config));
    }
    const { metrics, reportPath } = execution;
    return {
      status: 'passed',
      message: `Midscene 已在「${request.target}」选择「${request.value}」。`,
      evidence: 'aiAct 已完成语义定位、展开和选项选择。',
      ...(reportPath ? { reportPath } : {}),
      ...(metrics ? { metrics } : {}),
    };
  }

  async extract(request: SemanticExtractRequest): Promise<SemanticActionResult> {
    const execution = await this.runWithMetrics(request.config, (agent) => agent.aiQuery(request.target));
    if (!execution.ok) {
      return createFailedActionResult('提取', request.target, execution, createSecretRedactor(request.config));
    }
    const { metrics, reportPath, value } = execution;
    if (value === undefined) {
      const failureReason = `Midscene 未返回「${request.target}」的提取结果。`;
      return {
        status: 'failed',
        message: failureReason,
        evidence: failureReason,
        failureReason,
        ...(reportPath ? { reportPath } : {}),
        ...(metrics ? { metrics } : {}),
      };
    }
    return {
      status: 'passed',
      message: `Midscene 已提取「${request.target}」。`,
      evidence: `aiQuery 提取结果：${formatExtractedValue(value)}`,
      ...(reportPath ? { reportPath } : {}),
      ...(metrics ? { metrics } : {}),
    };
  }

  async assert(request: SemanticAssertRequest): Promise<SemanticActionResult> {
    const execution = await this.runWithMetrics(request.config, (agent) =>
      agent.aiAssert(request.assertion),
    );
    if (!execution.ok) {
      return createFailedActionResult('断言', request.assertion, execution, createSecretRedactor(request.config));
    }
    const { metrics, reportPath, value: result } = execution;
    if (result?.pass === false) {
      const failureReason = result.message || `Midscene 断言未通过：「${request.assertion}」。`;
      return {
        status: 'failed',
        message: failureReason,
        evidence: result.thought || failureReason,
        failureReason,
        ...(reportPath ? { reportPath } : {}),
        ...(metrics ? { metrics } : {}),
      };
    }

    return {
      status: 'passed',
      message: `Midscene 断言已通过：「${request.assertion}」。`,
      evidence: result?.thought || result?.message || 'aiAssert 已完成页面状态判断。',
      ...(reportPath ? { reportPath } : {}),
      ...(metrics ? { metrics } : {}),
    };
  }

  private async runWithMetrics<T>(
    config: ResolvedMidsceneConfig,
    action: (agent: MidsceneAgent) => Promise<T>,
  ): Promise<MidsceneActionExecution<T>> {
    const { agent, reportPath } = await this.getAgent(config);
    const previousMetrics = agent.metrics;
    const startedAt = this.options.now?.() ?? Date.now();
    let value: T | undefined;
    let actionError: unknown;
    let failed = false;
    try {
      value = await action(agent);
    } catch (error) {
      actionError = error;
      failed = true;
    }
    const durationMs = Math.max(0, (this.options.now?.() ?? Date.now()) - startedAt);
    const currentMetrics = agent.metrics;
    const replanningCycleLimit = parseReplanningCycleLimit(config.replanningCycleLimit);
    const metrics =
      previousMetrics && currentMetrics
        ? createExecutionMetrics(currentMetrics, previousMetrics, durationMs, replanningCycleLimit)
        : undefined;
    const evidence = {
      ...(reportPath ? { reportPath } : {}),
      ...(metrics ? { metrics } : {}),
    };
    return failed
      ? { ok: false, error: actionError, ...evidence }
      : { ok: true, value: value as T, ...evidence };
  }

  private async getAgent(config: ResolvedMidsceneConfig): Promise<NonNullable<MidsceneSemanticActionRuntime['cachedAgent']>> {
    const page = this.pageProvider.getPage();
    if (!page) {
      throw new Error('尚未启动真实 Playwright 页面，无法执行 Midscene 语义动作。');
    }

    const defaultContext = config.defaultContext.trim();
    const configKey = JSON.stringify(config);
    if (this.cachedAgent?.page === page && this.cachedAgent.configKey === configKey) {
      return this.cachedAgent;
    }

    if (this.cachedAgent) {
      await this.cachedAgent.agent.destroy();
    }

    const replanningCycleLimit = parseReplanningCycleLimit(config.replanningCycleLimit);
    const reportPath = this.options.reportDirectory
      ? path.join(this.options.reportDirectory, `midscene-${Date.now()}.html`)
      : undefined;
    const agent = this.agentFactory(page, {
      modelConfig: createModelConfig(config),
      ...(replanningCycleLimit ? { replanningCycleLimit } : {}),
      ...(defaultContext ? { aiActContext: defaultContext, aiActionContext: defaultContext } : {}),
      generateReport: true,
      autoPrintReportMsg: false,
      ...(reportPath ? { reportFileName: reportPath } : {}),
    });
    this.cachedAgent = { page, configKey, agent, ...(reportPath ? { reportPath } : {}) };
    return this.cachedAgent;
  }
}
