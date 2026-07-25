import type {
  AgentExecutionMetrics,
  AgentRunResult,
  AgentUsageBucket,
} from '../../shared/agent.js';
import type { AgentPlannerModelConfig } from './agent-planner.js';

export type AgentReporterModelConfig = AgentPlannerModelConfig;

export interface AgentReporterRequest {
  config: AgentReporterModelConfig;
  run: Pick<AgentRunResult, 'status' | 'summary' | 'failureReason' | 'intent' | 'plan' | 'events' | 'artifacts'>;
}

export interface AgentReporterResult {
  summary: string;
  evidenceSummary: string;
  failureAnalysis: string;
  suggestedFixes: string[];
  modelName: string;
  metrics: AgentExecutionMetrics;
}

export interface AgentReporter {
  report(request: AgentReporterRequest): Promise<AgentReporterResult>;
}

function completionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('Reporter 模型 Base URL 不能为空');
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

function reporterSystemPrompt(): string {
  return [
    '你是 Web 自动化测试 Reporter。只返回 JSON，不要 Markdown。',
    '根据 Agent 运行计划、事件、断言结果和产物总结失败原因、关键证据和修复建议。',
    '输出结构：{"summary":string,"evidenceSummary":string,"failureAnalysis":string,"suggestedFixes":string[]}。',
    '不要编造不存在的证据；证据不足时明确说明不足。',
  ].join('\n');
}

function parseReporterPayload(content: string): Omit<AgentReporterResult, 'modelName' | 'metrics'> {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(normalized);
  } catch {
    throw new Error('Reporter 未返回合法 JSON');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Reporter 返回的报告结构无效');
  }
  const record = raw as Record<string, unknown>;
  const summary = typeof record.summary === 'string' && record.summary.trim() ? record.summary.trim() : '';
  const evidenceSummary =
    typeof record.evidenceSummary === 'string' && record.evidenceSummary.trim()
      ? record.evidenceSummary.trim()
      : '';
  const failureAnalysis =
    typeof record.failureAnalysis === 'string' && record.failureAnalysis.trim()
      ? record.failureAnalysis.trim()
      : '';
  const suggestedFixes = Array.isArray(record.suggestedFixes)
    ? record.suggestedFixes.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
    : [];
  if (!summary || !evidenceSummary || !failureAnalysis) {
    throw new Error('Reporter 返回的 summary/evidenceSummary/failureAnalysis 不能为空');
  }
  return {
    summary,
    evidenceSummary,
    failureAnalysis,
    suggestedFixes,
  };
}

export class OpenAICompatibleAgentReporter implements AgentReporter {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async report(request: AgentReporterRequest): Promise<AgentReporterResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
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
            { role: 'system', content: reporterSystemPrompt() },
            {
              role: 'user',
              content: JSON.stringify({
                status: request.run.status,
                summary: request.run.summary,
                failureReason: request.run.failureReason ?? '',
                intent: request.run.intent,
                plan: request.run.plan,
                events: request.run.events.map((event) => ({
                  type: event.type,
                  status: event.status,
                  message: event.message,
                  stepId: event.stepId,
                  verification: event.verification,
                  observation: event.observation,
                  artifact: event.artifact,
                })),
                artifacts: request.run.artifacts,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Reporter 请求失败（HTTP ${response.status}）：${detail || response.statusText}`);
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
      throw new Error('Reporter 响应缺少 choices[0].message.content');
    }

    const parsed = parseReporterPayload(content);
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
        byIntent: { reporter: bucket },
        byModel: { [request.config.modelName]: bucket },
      },
    };
  }
}
