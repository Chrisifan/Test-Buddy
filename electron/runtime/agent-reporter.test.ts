import { describe, expect, it, vi } from 'vitest';

import { createStubAgentRun } from '../../shared/agentStub.js';
import { OpenAICompatibleAgentReporter } from './agent-reporter.js';

describe('OpenAICompatibleAgentReporter', () => {
  it('requests a structured failure report and records model usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '失败集中在图表刷新未完成。',
                  evidenceSummary: '断言证据显示页面仍处于加载中。',
                  failureAnalysis: '图表接口响应慢或前端渲染等待不足。',
                  suggestedFixes: ['增加图表稳定等待', '检查图表接口响应耗时'],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 90,
            completion_tokens: 35,
            total_tokens: 125,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const reporter = new OpenAICompatibleAgentReporter(fetchImpl);
    const run = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '验证图表刷新成功',
      runtimeDescription: 'chromium / desktop / headless / https://example.test',
      targetEnvironment: 'staging',
      verificationStatus: 'failed',
      verificationSummary: '未找到刷新成功状态。',
      verificationEvidence: '页面仍显示加载中。',
      verificationFailureReason: '图表未刷新完成。',
    });

    const result = await reporter.report({
      config: {
        modelBaseUrl: 'https://reporter.example.test/v1/',
        modelApiKey: 'reporter-secret',
        modelName: 'reporter-large',
        modelFamily: 'openai',
        temperature: '0.1',
      },
      run,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://reporter.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer reporter-secret',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual(
      expect.objectContaining({
        model: 'reporter-large',
        temperature: 0.1,
      }),
    );
    expect(JSON.parse(requestBody.messages[1].content)).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureReason: '图表未刷新完成。',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        summary: '失败集中在图表刷新未完成。',
        evidenceSummary: '断言证据显示页面仍处于加载中。',
        failureAnalysis: '图表接口响应慢或前端渲染等待不足。',
        suggestedFixes: ['增加图表稳定等待', '检查图表接口响应耗时'],
        modelName: 'reporter-large',
        metrics: expect.objectContaining({
          calls: 1,
          promptTokens: 90,
          completionTokens: 35,
          totalTokens: 125,
          byIntent: {
            reporter: {
              calls: 1,
              promptTokens: 90,
              completionTokens: 35,
              totalTokens: 125,
            },
          },
        }),
      }),
    );
  });

  it('rejects malformed model output instead of inventing a report', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"","evidenceSummary":"","failureAnalysis":"","suggestedFixes":[]}' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const reporter = new OpenAICompatibleAgentReporter(fetchImpl);
    const run = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '验证图表刷新成功',
      runtimeDescription: 'chromium / desktop / headless / https://example.test',
      targetEnvironment: 'staging',
      verificationStatus: 'failed',
      verificationSummary: '未找到刷新成功状态。',
      verificationEvidence: '页面仍显示加载中。',
      verificationFailureReason: '图表未刷新完成。',
    });

    await expect(
      reporter.report({
        config: {
          modelBaseUrl: 'https://reporter.example.test/v1',
          modelApiKey: 'reporter-secret',
          modelName: 'reporter-large',
          modelFamily: 'openai',
          temperature: '0.1',
        },
        run,
      }),
    ).rejects.toThrow('Reporter 返回的 summary/evidenceSummary/failureAnalysis 不能为空');
  });
});
