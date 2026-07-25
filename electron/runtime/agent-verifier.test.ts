import { describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleAgentVerifier } from './agent-verifier.js';

describe('OpenAICompatibleAgentVerifier', () => {
  it('requests a structured verification result and records model usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: 'passed',
                  summary: '图表趋势符合预期。',
                  evidence: '观察摘要显示图表已渲染，图例为收入，文本提示持续上升。',
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 25,
            total_tokens: 105,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const verifier = new OpenAICompatibleAgentVerifier(fetchImpl);

    const result = await verifier.verify({
      config: {
        modelBaseUrl: 'https://verifier.example.test/v1/',
        modelApiKey: 'verifier-secret',
        modelName: 'verifier-large',
        modelFamily: 'openai',
        temperature: '0',
      },
      assertion: '验证收入趋势明显上升',
      prompt: '验证收入趋势明显上升',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      observation: {
        domSummary: '发现 1 个图表。',
        textSummary: '收入持续上升。',
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://verifier.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer verifier-secret',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual(
      expect.objectContaining({
        model: 'verifier-large',
        temperature: 0,
      }),
    );
    expect(JSON.parse(requestBody.messages[1].content)).toEqual(
      expect.objectContaining({
        assertion: '验证收入趋势明显上升',
        observation: expect.objectContaining({ domSummary: '发现 1 个图表。' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'passed',
        summary: '图表趋势符合预期。',
        evidence: '观察摘要显示图表已渲染，图例为收入，文本提示持续上升。',
        modelName: 'verifier-large',
        metrics: expect.objectContaining({
          calls: 1,
          promptTokens: 80,
          completionTokens: 25,
          totalTokens: 105,
          byIntent: {
            verifier: {
              calls: 1,
              promptTokens: 80,
              completionTokens: 25,
              totalTokens: 105,
            },
          },
        }),
      }),
    );
  });

  it('rejects malformed model output instead of inventing a verification result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"status":"passed","summary":"","evidence":""}' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const verifier = new OpenAICompatibleAgentVerifier(fetchImpl);

    await expect(
      verifier.verify({
        config: {
          modelBaseUrl: 'https://verifier.example.test/v1',
          modelApiKey: 'verifier-secret',
          modelName: 'verifier-large',
          modelFamily: 'openai',
          temperature: '0',
        },
        assertion: '验证图表趋势',
        prompt: '验证图表趋势',
      }),
    ).rejects.toThrow('Verifier 返回的 summary/evidence 不能为空');
  });
});
