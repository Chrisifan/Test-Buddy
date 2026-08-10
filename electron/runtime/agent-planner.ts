import type {
  AgentExecutionMetrics,
  AgentFailureCategory,
  AgentPlanDraft,
  AgentPlanStepDraft,
  AgentRecoveryStrategy,
  AgentStepAction,
  AgentUsageBucket,
} from '../../shared/agent.js';
import type { CommandMode } from '../../shared/studio.js';
import { createLinkedAbortController } from './run-cancellation.js';

export interface AgentPlannerModelConfig {
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  modelFamily: string;
  temperature: string;
}

export interface AgentPlannerRequest {
  config: AgentPlannerModelConfig;
  cancellationSignal?: AbortSignal;
  mode: CommandMode;
  prompt: string;
  targetEnvironment: string;
  targetUrl: string;
  currentUrl?: string;
  pageTitle?: string;
  previousFailure?: {
    stepTitle: string;
    action: AgentStepAction;
    instruction: string;
    status: 'failed' | 'neutral';
    summary: string;
    evidence: string;
    failureReason?: string;
    failureCategory?: AgentFailureCategory;
    recoveryStrategy?: AgentRecoveryStrategy;
  };
  completedSteps?: Array<{
    stepIndex: number;
    action: AgentStepAction;
    title: string;
    instruction: string;
    evidence: string;
    selector?: string;
    target?: string;
    value?: string;
    url?: string;
    currentUrl?: string;
  }>;
  observationSummary?: string;
  interactiveElements?: string[];
}

export interface AgentPlannerResult {
  plan: AgentPlanDraft;
  modelName: string;
  metrics: AgentExecutionMetrics;
}

export interface AgentPlanner {
  createPlan(request: AgentPlannerRequest): Promise<AgentPlannerResult>;
}

const supportedActions = new Set<AgentStepAction>([
  'navigate',
  'click',
  'input',
  'wait',
  'scroll',
  'select',
  'assert',
  'observe',
  'extract',
]);

function completionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('Planner 模型 Base URL 不能为空');
  }
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Planner 返回的 ${label} 无效`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parsePlanStep(value: unknown, index: number): AgentPlanStepDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Planner 返回的第 ${index + 1} 个步骤无效`);
  }

  const raw = value as Record<string, unknown>;
  const action = requiredString(raw.action, `steps[${index}].action`) as AgentStepAction;
  if (!supportedActions.has(action)) {
    throw new Error(`Planner 返回了不支持的动作：${action}`);
  }

  return {
    action,
    title: requiredString(raw.title, `steps[${index}].title`),
    instruction: requiredString(raw.instruction, `steps[${index}].instruction`),
    ...(optionalString(raw.expected) ? { expected: optionalString(raw.expected) } : {}),
    ...(optionalString(raw.selector) ? { selector: optionalString(raw.selector) } : {}),
    ...(optionalString(raw.target) ? { target: optionalString(raw.target) } : {}),
    ...(optionalString(raw.value) ? { value: optionalString(raw.value) } : {}),
    ...(optionalString(raw.url) ? { url: optionalString(raw.url) } : {}),
    ...(typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
      ? { timeoutMs: Math.round(raw.timeoutMs) }
      : {}),
  };
}

function parsePlan(content: string): AgentPlanDraft {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(normalized);
  } catch {
    throw new Error('Planner 未返回合法 JSON');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Planner 返回的计划结构无效');
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    throw new Error('Planner 返回的 steps 不能为空');
  }
  if (record.steps.length > 12) {
    throw new Error('Planner 单次最多返回 12 个步骤');
  }

  return {
    title: requiredString(record.title, 'title'),
    summary: optionalString(record.summary) ?? 'Planner 已生成结构化执行计划。',
    risks: Array.isArray(record.risks)
      ? record.risks.flatMap((risk) => (typeof risk === 'string' && risk.trim() ? [risk.trim()] : []))
      : [],
    steps: record.steps.map(parsePlanStep),
  };
}

function usageBucket(promptTokens: number, completionTokens: number, totalTokens: number): AgentUsageBucket {
  return {
    calls: 1,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function plannerSystemPrompt(): string {
  return [
    '你是 Web 自动化测试 Planner。只返回 JSON，不要 Markdown。',
    '输出结构：{"title":string,"summary":string,"risks":string[],"steps":Step[]}。',
    'Step.action 只能是 navigate、click、input、wait、scroll、select、assert、observe、extract。',
    '每个 Step 必须包含 action、title、instruction，可选 expected、selector、target、value、url、timeoutMs。',
    '有稳定 selector 时填写 selector；语义定位时填写 target；navigate 必须填写 url；input 必须填写 value。',
    '当请求提供 completedSteps 时，其中步骤已经在当前页面成功完成。只输出从当前状态继续所需的后续步骤，不要重新输出或执行已完成步骤；如需确认状态，使用 observe 或 assert。',
    '最多 12 步。不要声称执行已经成功。',
  ].join('\n');
}

export class OpenAICompatibleAgentPlanner implements AgentPlanner {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async createPlan(request: AgentPlannerRequest): Promise<AgentPlannerResult> {
    const startedAt = Date.now();
    const linkedAbort = createLinkedAbortController(request.cancellationSignal);
    const { controller } = linkedAbort;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;

    try {
      const temperature = Number.parseFloat(request.config.temperature);
      response = await this.fetchImpl(completionEndpoint(request.config.modelBaseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.config.modelApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.config.modelName,
          temperature: Number.isFinite(temperature) ? temperature : 0.2,
          messages: [
            { role: 'system', content: plannerSystemPrompt() },
            {
              role: 'user',
              content: JSON.stringify({
                mode: request.mode,
                goal: request.prompt,
                environment: request.targetEnvironment,
                targetUrl: request.targetUrl,
                currentUrl: request.currentUrl ?? '',
                pageTitle: request.pageTitle ?? '',
                previousFailure: request.previousFailure,
                completedSteps: request.completedSteps ?? [],
                observationSummary: request.observationSummary ?? '',
                interactiveElements: request.interactiveElements ?? [],
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      linkedAbort.dispose();
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Planner 请求失败（HTTP ${response.status}）：${detail || response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Planner 响应缺少 choices[0].message.content');
    }

    const plan = parsePlan(content);
    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const totalTokens = payload.usage?.total_tokens ?? promptTokens + completionTokens;
    const bucket = usageBucket(promptTokens, completionTokens, totalTokens);
    const durationMs = Math.max(0, Date.now() - startedAt);

    return {
      plan,
      modelName: request.config.modelName,
      metrics: {
        durationMs,
        modelTimeCostMs: durationMs,
        calls: 1,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        ...(request.previousFailure ? { replanningCycles: 1 } : {}),
        byIntent: { planner: bucket },
        byModel: { [request.config.modelName]: bucket },
      },
    };
  }
}
