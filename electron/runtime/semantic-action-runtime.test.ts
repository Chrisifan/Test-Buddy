import { describe, expect, it, vi } from 'vitest';

import type { MidsceneConfig } from '../../shared/studio.js';
import { MidsceneSemanticActionRuntime } from './semantic-action-runtime.js';

const config: MidsceneConfig = {
  modelBaseUrl: 'https://models.example.test/v1',
  modelApiKey: 'secret-key',
  modelName: 'ui-agent-model',
  modelFamily: 'vlm-ui-tars',
  preferredLanguage: 'Chinese',
  replanningCycleLimit: '12',
  openaiHttpProxy: 'http://127.0.0.1:7890',
  defaultContext: '这是一个企业报表系统。',
};

describe('MidsceneSemanticActionRuntime', () => {
  it('exports a concrete Midscene semantic runtime adapter', async () => {
    const runtimeModule = await import('./semantic-action-runtime.js');

    expect(runtimeModule.MidsceneSemanticActionRuntime).toBeTypeOf('function');
  });

  it('creates a configured page agent and performs semantic click with aiTap', async () => {
    const page = { id: 'page-1' };
    const aiTap = vi.fn().mockResolvedValue(undefined);
    const agentFactory = vi.fn().mockReturnValue({
      aiTap,
      aiInput: vi.fn(),
      aiAssert: vi.fn(),
      destroy: vi.fn(),
    });
    const runtime = new MidsceneSemanticActionRuntime({ getPage: () => page }, agentFactory);

    const result = await runtime.click({
      target: '登录按钮',
      prompt: '点击登录按钮',
      config,
    });

    expect(agentFactory).toHaveBeenCalledWith(page, {
      modelConfig: {
        MIDSCENE_MODEL_BASE_URL: config.modelBaseUrl,
        MIDSCENE_MODEL_API_KEY: config.modelApiKey,
        MIDSCENE_MODEL_NAME: config.modelName,
        MIDSCENE_MODEL_FAMILY: config.modelFamily,
        MIDSCENE_MODEL_HTTP_PROXY: config.openaiHttpProxy,
      },
      replanningCycleLimit: 12,
      aiActContext: config.defaultContext,
      aiActionContext: config.defaultContext,
      generateReport: true,
      autoPrintReportMsg: false,
    });
    expect(aiTap).toHaveBeenCalledWith('登录按钮');
    expect(result).toEqual({
      status: 'passed',
      message: 'Midscene 已点击「登录按钮」。',
      evidence: 'aiTap 已完成语义定位和点击。',
    });
  });

  it('performs semantic input with the current aiInput signature', async () => {
    const page = { id: 'page-1' };
    const aiInput = vi.fn().mockResolvedValue(undefined);
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => page },
      vi.fn().mockReturnValue({
        aiTap: vi.fn(),
        aiInput,
        aiAssert: vi.fn(),
        destroy: vi.fn(),
      }),
    );

    const result = await runtime.input({
      target: '用户名',
      value: 'chris',
      prompt: '在用户名输入 chris',
      config,
    });

    expect(aiInput).toHaveBeenCalledWith('用户名', { value: 'chris' });
    expect(result.status).toBe('passed');
    expect(result.message).toContain('用户名');
  });

  it('performs semantic selection through aiAct', async () => {
    const page = { id: 'page-1' };
    const aiAct = vi.fn().mockResolvedValue(undefined);
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => page },
      vi.fn().mockReturnValue({
        aiTap: vi.fn(),
        aiInput: vi.fn(),
        aiAct,
        aiAssert: vi.fn(),
        destroy: vi.fn(),
      }),
    );

    const result = await runtime.select({
      target: '报表周期',
      value: '近 30 天',
      prompt: '在报表周期中选择近 30 天',
      config,
    });

    expect(aiAct).toHaveBeenCalledWith('在下拉框「报表周期」中选择「近 30 天」');
    expect(result).toEqual({
      status: 'passed',
      message: 'Midscene 已在「报表周期」选择「近 30 天」。',
      evidence: 'aiAct 已完成语义定位、展开和选项选择。',
    });
  });

  it('extracts a targeted value through aiQuery and records the structured result as evidence', async () => {
    const page = { id: 'page-1' };
    const aiQuery = vi.fn().mockResolvedValue({ orderTotal: 128, currency: 'CNY' });
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => page },
      vi.fn().mockReturnValue({
        aiTap: vi.fn(),
        aiInput: vi.fn(),
        aiAct: vi.fn(),
        aiQuery,
        aiAssert: vi.fn(),
        destroy: vi.fn(),
      }),
    );

    const result = await runtime.extract({
      target: '当前订单总额',
      prompt: '提取当前订单总额',
      config,
    });

    expect(aiQuery).toHaveBeenCalledWith('当前订单总额');
    expect(result).toEqual({
      status: 'passed',
      message: 'Midscene 已提取「当前订单总额」。',
      evidence: 'aiQuery 提取结果：{"orderTotal":128,"currency":"CNY"}',
    });
  });

  it('returns a structured failure when aiAssert reports false', async () => {
    const aiAssert = vi.fn().mockResolvedValue({
      pass: false,
      thought: '页面没有成功提示。',
      message: '断言未通过',
    });
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => ({ id: 'page-1' }) },
      vi.fn().mockReturnValue({
        aiTap: vi.fn(),
        aiInput: vi.fn(),
        aiAssert,
        destroy: vi.fn(),
      }),
    );

    const result = await runtime.assert({
      assertion: '页面显示登录成功提示',
      prompt: '验证页面显示登录成功提示',
      config,
    });

    expect(aiAssert).toHaveBeenCalledWith('页面显示登录成功提示');
    expect(result).toEqual({
      status: 'failed',
      message: '断言未通过',
      evidence: '页面没有成功提示。',
      failureReason: '断言未通过',
    });
  });

  it('reuses the same Midscene agent for actions on the same page and config', async () => {
    const page = { id: 'page-1' };
    const agentFactory = vi.fn().mockReturnValue({
      aiTap: vi.fn().mockResolvedValue(undefined),
      aiInput: vi.fn().mockResolvedValue(undefined),
      aiAssert: vi.fn(),
      destroy: vi.fn(),
    });
    const runtime = new MidsceneSemanticActionRuntime({ getPage: () => page }, agentFactory);

    await runtime.click({ target: '登录按钮', prompt: '点击登录按钮', config });
    await runtime.input({ target: '用户名', value: 'chris', prompt: '在用户名输入 chris', config });

    expect(agentFactory).toHaveBeenCalledTimes(1);
  });

  it('destroys the cached agent when the model configuration changes', async () => {
    const page = { id: 'page-1' };
    const destroy = vi.fn().mockResolvedValue(undefined);
    const agentFactory = vi.fn().mockReturnValue({
      aiTap: vi.fn().mockResolvedValue(undefined),
      aiInput: vi.fn(),
      aiAssert: vi.fn(),
      destroy,
    });
    const runtime = new MidsceneSemanticActionRuntime({ getPage: () => page }, agentFactory);

    await runtime.click({ target: '登录按钮', prompt: '点击登录按钮', config });
    await runtime.click({
      target: '登录按钮',
      prompt: '点击登录按钮',
      config: { ...config, modelName: 'another-model' },
    });

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(agentFactory).toHaveBeenCalledTimes(2);
  });

  it('writes Midscene reports to the configured application artifact directory', async () => {
    const agentFactory = vi.fn().mockReturnValue({
      aiTap: vi.fn().mockResolvedValue(undefined),
      aiInput: vi.fn(),
      aiAssert: vi.fn(),
      destroy: vi.fn(),
    });
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => ({ id: 'page-1' }) },
      agentFactory,
      { reportDirectory: '/tmp/playtest-artifacts' },
    );

    const result = await runtime.click({ target: '登录按钮', prompt: '点击登录按钮', config });

    expect(agentFactory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reportFileName: expect.stringMatching(/^\/tmp\/playtest-artifacts\/midscene-\d+\.html$/),
      }),
    );
    expect(result.reportPath).toMatch(/^\/tmp\/playtest-artifacts\/midscene-\d+\.html$/);
  });

  it('records duration and per-action Midscene usage deltas', async () => {
    let metrics = {
      totalPromptTokens: 100,
      totalCompletionTokens: 20,
      totalTokens: 120,
      totalCachedInput: 8,
      totalTimeCostMs: 180,
      calls: 1,
      byIntent: { insight: { promptTokens: 100, completionTokens: 20, totalTokens: 120, calls: 1 } },
      byModel: { 'ui-agent-model': { promptTokens: 100, completionTokens: 20, totalTokens: 120, calls: 1 } },
    };
    const agent = {
      aiTap: vi.fn().mockImplementation(async () => {
        metrics = {
          totalPromptTokens: 220,
          totalCompletionTokens: 50,
          totalTokens: 270,
          totalCachedInput: 18,
          totalTimeCostMs: 420,
          calls: 3,
          byIntent: { insight: { promptTokens: 220, completionTokens: 50, totalTokens: 270, calls: 3 } },
          byModel: { 'ui-agent-model': { promptTokens: 220, completionTokens: 50, totalTokens: 270, calls: 3 } },
        };
      }),
      aiInput: vi.fn(),
      aiAssert: vi.fn(),
      destroy: vi.fn(),
      get metrics() {
        return metrics;
      },
    };
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_360);
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => ({ id: 'page-1' }) },
      vi.fn().mockReturnValue(agent),
      { now },
    );

    const result = await runtime.click({ target: '登录按钮', prompt: '点击登录按钮', config });

    expect(result.metrics).toEqual({
      durationMs: 360,
      modelTimeCostMs: 240,
      calls: 2,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 10,
      replanningCycleLimit: 12,
      byIntent: {
        insight: { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 },
      },
      byModel: {
        'ui-agent-model': { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 },
      },
    });
  });

  it('preserves elapsed time and usage when a semantic action fails', async () => {
    let metrics = {
      totalPromptTokens: 20,
      totalCompletionTokens: 5,
      totalTokens: 25,
      totalCachedInput: 0,
      totalTimeCostMs: 40,
      calls: 1,
      byIntent: { locate: { promptTokens: 20, completionTokens: 5, totalTokens: 25, calls: 1 } },
      byModel: { 'ui-agent-model': { promptTokens: 20, completionTokens: 5, totalTokens: 25, calls: 1 } },
    };
    const agent = {
      aiTap: vi.fn().mockImplementation(async () => {
        metrics = {
          totalPromptTokens: 100,
          totalCompletionTokens: 25,
          totalTokens: 125,
          totalCachedInput: 12,
          totalTimeCostMs: 220,
          calls: 3,
          byIntent: { locate: { promptTokens: 100, completionTokens: 25, totalTokens: 125, calls: 3 } },
          byModel: { 'ui-agent-model': { promptTokens: 100, completionTokens: 25, totalTokens: 125, calls: 3 } },
        };
        throw new Error('locator unavailable');
      }),
      aiInput: vi.fn(),
      aiAssert: vi.fn(),
      destroy: vi.fn(),
      get metrics() {
        return metrics;
      },
    };
    const now = vi.fn().mockReturnValueOnce(2_000).mockReturnValueOnce(2_450);
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => ({ id: 'page-1' }) },
      vi.fn().mockReturnValue(agent),
      { now },
    );

    const result = await runtime.click({ target: '登录按钮', prompt: '点击登录按钮', config });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureReason: 'locator unavailable',
        metrics: expect.objectContaining({
          durationMs: 450,
          modelTimeCostMs: 180,
          calls: 2,
          totalTokens: 100,
          cachedInputTokens: 12,
        }),
      }),
    );
  });

  it('redacts the resolved model key from semantic action failures', async () => {
    const secret = 'sk-semantic-action-redaction';
    const runtime = new MidsceneSemanticActionRuntime(
      { getPage: () => ({ id: 'page-1' }) },
      vi.fn().mockReturnValue({
        aiTap: vi.fn().mockRejectedValue(new Error(`provider rejected Authorization: Bearer ${secret}`)),
        aiInput: vi.fn(),
        aiAssert: vi.fn(),
        destroy: vi.fn(),
      }),
    );

    const result = await runtime.click({
      target: '登录按钮',
      prompt: '点击登录按钮',
      config: { ...config, modelApiKey: secret },
    });

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.failureReason).toContain('[REDACTED_MODEL_SECRET]');
    expect(result.failureReason).toContain('provider rejected Authorization');
  });
});
