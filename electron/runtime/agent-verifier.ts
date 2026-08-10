import type {
  AgentExecutionMetrics,
  AgentObservation,
  AgentRunStatus,
  AgentUsageBucket,
} from '../../shared/agent.js';
import type { AgentPlannerModelConfig } from './agent-planner.js';
import { createLinkedAbortController } from './run-cancellation.js';

export type AgentVerifierModelConfig = AgentPlannerModelConfig;

export interface AgentVerifierRequest {
  config: AgentVerifierModelConfig;
  cancellationSignal?: AbortSignal;
  assertion: string;
  prompt: string;
  currentUrl?: string;
  pageTitle?: string;
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

export interface AgentVerifierResult {
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
  modelName: string;
  metrics: AgentExecutionMetrics;
}

export interface AgentVerifier {
  verify(request: AgentVerifierRequest): Promise<AgentVerifierResult>;
}

function completionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('Verifier 模型 Base URL 不能为空');
  }
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function usageBucket(promptTokens: number, completionTokens: number, totalTokens: number): AgentUsageBucket {
  return {
    calls: 1,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function verifierSystemPrompt(): string {
  return [
    '你是 Web 自动化测试 Verifier。只返回 JSON，不要 Markdown。',
    '根据断言、URL、标题、DOM 摘要、文本摘要、表格和图表观察判断测试是否成立。',
    '输出结构：{"status":"passed"|"failed"|"neutral","summary":string,"evidence":string,"failureReason"?:string}。',
    '证据不足时必须返回 neutral，不要猜测通过。',
  ].join('\n');
}

function parseVerifierPayload(content: string): Pick<AgentVerifierResult, 'status' | 'summary' | 'evidence' | 'failureReason'> {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(normalized);
  } catch {
    throw new Error('Verifier 未返回合法 JSON');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Verifier 返回的判断结构无效');
  }
  const record = raw as Record<string, unknown>;
  const status = record.status;
  if (status !== 'passed' && status !== 'failed' && status !== 'neutral') {
    throw new Error('Verifier 返回的 status 无效');
  }
  const summary = typeof record.summary === 'string' && record.summary.trim() ? record.summary.trim() : '';
  const evidence = typeof record.evidence === 'string' && record.evidence.trim() ? record.evidence.trim() : '';
  if (!summary || !evidence) {
    throw new Error('Verifier 返回的 summary/evidence 不能为空');
  }
  const failureReason =
    typeof record.failureReason === 'string' && record.failureReason.trim() ? record.failureReason.trim() : undefined;
  return {
    status,
    summary,
    evidence,
    ...(failureReason ? { failureReason } : {}),
  };
}

export class OpenAICompatibleAgentVerifier implements AgentVerifier {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async verify(request: AgentVerifierRequest): Promise<AgentVerifierResult> {
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
          temperature: Number.isFinite(temperature) ? temperature : 0,
          messages: [
            { role: 'system', content: verifierSystemPrompt() },
            {
              role: 'user',
              content: JSON.stringify({
                assertion: request.assertion,
                prompt: request.prompt,
                currentUrl: request.currentUrl ?? '',
                pageTitle: request.pageTitle ?? '',
                observation: request.observation ?? {},
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
      throw new Error(`Verifier 请求失败（HTTP ${response.status}）：${detail || response.statusText}`);
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
      throw new Error('Verifier 响应缺少 choices[0].message.content');
    }

    const parsed = parseVerifierPayload(content);
    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const totalTokens = payload.usage?.total_tokens ?? promptTokens + completionTokens;
    const bucket = usageBucket(promptTokens, completionTokens, totalTokens);
    const durationMs = Math.max(0, Date.now() - startedAt);

    return {
      ...parsed,
      modelName: request.config.modelName,
      metrics: {
        durationMs,
        modelTimeCostMs: durationMs,
        calls: 1,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        byIntent: { verifier: bucket },
        byModel: { [request.config.modelName]: bucket },
      },
    };
  }
}
