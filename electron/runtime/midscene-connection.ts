import type { MidsceneConnectionTestResult } from '../../shared/studio.js';
import type { ResolvedMidsceneConfig } from './model-config-resolver.js';

const connectionTimeoutMs = 15_000;

function completionEndpoint(baseUrl: string): string | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return undefined;
    }
    return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
  } catch {
    return undefined;
  }
}

function isConfigComplete(config: ResolvedMidsceneConfig): boolean {
  return Boolean(
    config.modelBaseUrl.trim() &&
      config.modelApiKey.trim() &&
      config.modelName.trim() &&
      config.modelFamily.trim(),
  );
}

export async function testMidsceneConnection(
  config: ResolvedMidsceneConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<MidsceneConnectionTestResult> {
  const startedAt = Date.now();
  const modelName = config.modelName.trim();
  const endpoint = completionEndpoint(config.modelBaseUrl);
  if (!isConfigComplete(config) || !endpoint) {
    return {
      status: 'failed',
      modelName,
      durationMs: 0,
      failure: 'configuration',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), connectionTimeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.modelApiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: 'system', content: 'You are a model connectivity probe.' },
          { role: 'user', content: 'Reply with OK.' },
        ],
      }),
      signal: controller.signal,
    });
    const durationMs = Math.max(0, Date.now() - startedAt);
    if (!response.ok) {
      return {
        status: 'failed',
        modelName,
        durationMs,
        httpStatus: response.status,
        failure: 'http',
      };
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return {
        status: 'failed',
        modelName,
        durationMs,
        failure: 'response',
      };
    }

    return { status: 'passed', modelName, durationMs };
  } catch {
    return {
      status: 'failed',
      modelName,
      durationMs: Math.max(0, Date.now() - startedAt),
      failure: 'network',
    };
  } finally {
    clearTimeout(timeout);
  }
}
