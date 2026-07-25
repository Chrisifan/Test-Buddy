import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  defaultAgentModelConfig,
  type AgentModelConfig,
  type BrowserSessionState,
  type MidsceneConfig,
} from '../shared/studio.js';
import { StudioRuntime } from './studioRuntime.js';

const midsceneConfig: MidsceneConfig = {
  modelBaseUrl: 'https://models.example.test/v1',
  modelApiKey: 'test-key',
  modelName: 'ui-agent-model',
  modelFamily: 'vlm-ui-tars',
  preferredLanguage: 'Chinese',
  replanningCycleLimit: '10',
  openaiHttpProxy: '',
  defaultContext: '',
};

describe('StudioRuntime agent observation', () => {
  it('captures browser state before creating a chat agent run', async () => {
    const capturedState: BrowserSessionState = {
      id: 'session-1',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/dashboard.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const capture = vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(capturedState);
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture,
      getState: () => capturedState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '验证图表刷新成功',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(response.agentRun?.events.some((event) => event.type === 'agent:observation-created')).toBe(true);
    expect(response.agentRun?.events.find((event) => event.browserSession)?.browserSession?.screenshotPath).toBe(
      '/tmp/dashboard.png',
    );
    expect(response.agentRun?.artifacts.some((artifact) => artifact.type === 'screenshot')).toBe(true);
  });

  it('starts a controlled browser when the current session is idle', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const idleState: BrowserSessionState = {
      id: 'session-idle',
      status: 'idle',
      currentUrl: '',
      pageTitle: '尚未启动浏览器',
      message: 'idle',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const startedState: BrowserSessionState = {
      id: 'session-started',
      status: 'ready',
      projectId: project.id,
      environmentId: environment.id,
      currentUrl: environment.url,
      pageTitle: project.name,
      screenshotPath: '/tmp/started.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const start = vi.fn().mockResolvedValue(startedState);
    const capture = vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(startedState);
    const runtime = new StudioRuntime(vi.fn(), {
      start,
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture,
      getState: () => idleState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '打开首页并点击登录',
      targetEnvironment: environment.name,
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: environment.browser,
        baseUrl: environment.url,
        viewport: environment.viewport,
        locale: environment.locale,
        headless: environment.headless,
      },
      project,
      environment,
      projectId: project.id,
    });

    expect(start).toHaveBeenCalledWith({ project, environment, record: false });
    expect(capture).not.toHaveBeenCalled();
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      'Agent 已启动受控浏览器',
    );
    expect(response.agentRun?.events.find((event) => event.browserSession)?.browserSession?.screenshotPath).toBe(
      '/tmp/started.png',
    );
  });

  it('resolves role model assignments for natural language agent runs', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/dashboard.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
        modelFamily: 'openai',
        temperature: '0.1',
      },
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '验证页面包含 Dashboard',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(response.agentRun.modelAssignments?.find((assignment) => assignment.role === 'planner')).toEqual(
      expect.objectContaining({
        source: 'agentRole',
        modelName: 'planner-large',
        hasApiKey: true,
      }),
    );
    expect(response.agentRun.modelAssignments?.find((assignment) => assignment.role === 'executor')).toEqual(
      expect.objectContaining({
        source: 'midscene',
        modelName: 'ui-agent-model',
      }),
    );
    expect(JSON.stringify(response.agentRun.modelAssignments)).not.toContain('planner-secret');
  });

  it('uses the configured Planner model step to drive the current browser execution', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const clickedState: BrowserSessionState = {
      ...currentState,
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
    };
    const click = vi.fn().mockResolvedValue(clickedState);
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '登录工作台',
        summary: '提交登录并进入工作台。',
        risks: ['登录态可能过期'],
        steps: [
          {
            action: 'click',
            title: '提交登录',
            instruction: '点击登录按钮',
            selector: '#login-button',
            expected: '进入工作台',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 100,
        modelTimeCostMs: 100,
        calls: 1,
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        cachedInputTokens: 0,
        byIntent: {
          planner: { calls: 1, promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
        byModel: {
          'planner-large': { calls: 1, promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
        modelFamily: 'openai',
        temperature: '0.1',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '完成当前登录流程',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '完成当前登录流程',
        config: expect.objectContaining({
          modelApiKey: 'planner-secret',
          modelName: 'planner-large',
        }),
      }),
    );
    expect(click).toHaveBeenCalledWith({ selector: '#login-button' });
    expect(response.agentRun.plan.steps[1]).toEqual(
      expect.objectContaining({
        action: 'click',
        title: '提交登录',
        selector: '#login-button',
      }),
    );
    expect(response.agentRun.plan.planner).toEqual({
      source: 'model',
      modelName: 'planner-large',
    });
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ calls: 1, totalTokens: 30 }));
  });

  it('falls back to rule planning when the configured Planner request fails', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test',
      pageTitle: 'Home',
      screenshotPath: '/tmp/home.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const navigatedState: BrowserSessionState = {
      ...currentState,
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
    };
    const navigate = vi.fn().mockResolvedValue(navigatedState);
    const createPlan = vi.fn().mockRejectedValue(new Error('model unavailable'));
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate,
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '打开 https://example.test/reports',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(navigate).toHaveBeenCalledWith({ url: 'https://example.test/reports' });
    expect(response.agentRun.plan.planner).toEqual({
      source: 'rule',
      fallbackReason: 'model unavailable',
    });
    expect(response.agentRun.events[0]?.message).toContain('Planner 已降级为规则规划');
  });

  it('executes every supported Planner step in order', async () => {
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test',
      pageTitle: 'Home',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const navigate = vi.fn(async ({ url }: { url: string }) => {
      actionOrder.push(`navigate:${new URL(url).pathname}`);
      currentState = { ...currentState, currentUrl: url, pageTitle: 'Login' };
      return currentState;
    });
    const input = vi.fn(async ({ selector, value }: { selector: string; value: string }) => {
      actionOrder.push(`input:${selector}:${value}`);
      return currentState;
    });
    const click = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      currentState = { ...currentState, currentUrl: 'https://example.test/dashboard', pageTitle: 'Dashboard' };
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '完整登录流程',
        summary: '进入登录页，填写账号，提交并检查结果。',
        risks: [],
        steps: [
          {
            action: 'navigate',
            title: '打开登录页',
            instruction: '打开登录页',
            url: 'https://example.test/login',
          },
          {
            action: 'input',
            title: '填写账号',
            instruction: '在用户名输入框填写 qa',
            selector: '#username',
            value: 'qa',
          },
          {
            action: 'click',
            title: '提交登录',
            instruction: '点击登录按钮',
            selector: '#login-button',
          },
          {
            action: 'assert',
            title: '检查工作台',
            instruction: '断言标题包含 Dashboard',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate,
        click,
        input,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '完成登录流程',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(actionOrder).toEqual(['navigate:/login', 'input:#username:qa', 'click:#login-button']);
    expect(response.agentRun.plan.steps).toHaveLength(6);
    expect(response.agentRun.events.filter((event) => event.type === 'agent:step-started')).toHaveLength(4);
    expect(response.agentRun.status).toBe('passed');
  });

  it('executes a Planner semantic select step through the configured action runtime', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticSelect = vi.fn().mockResolvedValue({
      status: 'passed',
      message: '已选择近 30 天。',
      evidence: '报表周期已更新。',
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '筛选报表周期',
        summary: '按指定周期查看报表。',
        risks: [],
        steps: [
          {
            action: 'select',
            title: '选择报表周期',
            instruction: '在报表周期中选择近 30 天',
            target: '报表周期',
            value: '近 30 天',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      { click: vi.fn(), input: vi.fn(), select: semanticSelect, assert: vi.fn() },
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '将报表周期切换到近 30 天',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(semanticSelect).toHaveBeenCalledWith({
      target: '报表周期',
      value: '近 30 天',
      prompt: '在报表周期中选择近 30 天',
      config: midsceneConfig,
    });
    expect(response.agentRun.status).toBe('passed');
  });

  it('preserves a Planner targeted extraction result as step evidence', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticExtract = vi.fn().mockResolvedValue({
      status: 'passed',
      message: 'Midscene 已提取「当前订单总额」。',
      evidence: 'aiQuery 提取结果：{"orderTotal":128,"currency":"CNY"}',
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '提取订单总额',
        summary: '读取当前订单的总额。',
        risks: [],
        steps: [
          {
            action: 'extract',
            title: '读取订单总额',
            instruction: '提取当前订单总额',
            target: '当前订单总额',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      { click: vi.fn(), input: vi.fn(), select: vi.fn(), extract: semanticExtract, assert: vi.fn() },
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'aiQuery',
      prompt: '提取当前订单总额',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(semanticExtract).toHaveBeenCalledWith({
      target: '当前订单总额',
      prompt: '提取当前订单总额',
      config: midsceneConfig,
    });
    expect(
      response.agentRun.events.find(
        (event) => event.type === 'agent:assertion-result' && event.stepId?.includes('step-planned-1'),
      )?.verification?.evidence,
    ).toBe('aiQuery 提取结果：{"orderTotal":128,"currency":"CNY"}');
    expect(response.agentRun.status).toBe('passed');
  });

  it('stops a Planner plan after a failed semantic assertion', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const laterClick = vi.fn().mockResolvedValue(currentState);
    const semanticAssert = vi.fn().mockResolvedValue({
      status: 'failed',
      message: '未找到刷新成功状态。',
      evidence: '页面仍显示加载中。',
      failureReason: '图表未刷新完成。',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        byIntent: { executor: { calls: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
        byModel: { 'ui-agent-model': { calls: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      },
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '图表刷新检查',
        summary: '先验证刷新状态，再继续操作。',
        risks: [],
        steps: [
          { action: 'assert', title: '验证刷新', instruction: '验证图表刷新成功' },
          { action: 'click', title: '打开详情', instruction: '点击详情按钮', selector: '#detail' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: laterClick,
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      { click: vi.fn(), input: vi.fn(), assert: semanticAssert },
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '验证图表刷新后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(semanticAssert).toHaveBeenCalledTimes(1);
    expect(laterClick).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('failed');
    expect(response.agentRun.failureReason).toBe('图表未刷新完成。');
  });

  it('routes unsupported semantic assertions to the configured Verifier model', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/dashboard.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const verify = vi.fn().mockResolvedValue({
      status: 'passed',
      summary: 'Verifier 判断图表趋势已明显上升。',
      evidence: '图表观察摘要显示本周数据高于上周，且折线末端上扬。',
      modelName: 'verifier-large',
      metrics: {
        durationMs: 40,
        modelTimeCostMs: 40,
        calls: 1,
        promptTokens: 30,
        completionTokens: 12,
        totalTokens: 42,
        cachedInputTokens: 0,
        byIntent: { verifier: { calls: 1, promptTokens: 30, completionTokens: 12, totalTokens: 42 } },
        byModel: { 'verifier-large': { calls: 1, promptTokens: 30, completionTokens: 12, totalTokens: 42 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '营收趋势图展示本周收入持续升高。',
          domSummary: '发现 1 个图表。',
          charts: [
            {
              index: 1,
              title: '营收趋势',
              kind: 'canvas',
              rendered: true,
              legends: ['收入'],
            },
          ],
        }),
        getState: () => currentState,
      },
      undefined,
      undefined,
      { verify },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      verifier: {
        ...defaultAgentModelConfig.verifier,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://verifier.example.test/v1',
        modelApiKey: 'verifier-secret',
        modelName: 'verifier-large',
        modelFamily: 'openai',
        temperature: '0',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '验证营收趋势图明显上升',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        assertion: '验证营收趋势图明显上升',
        config: expect.objectContaining({
          modelApiKey: 'verifier-secret',
          modelName: 'verifier-large',
        }),
        observation: expect.objectContaining({
          domSummary: '发现 1 个图表。',
        }),
      }),
    );
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.summary).toContain('Verifier 判断图表趋势已明显上升');
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ calls: 1, totalTokens: 42 }));
    expect(JSON.stringify(response.agentRun)).not.toContain('verifier-secret');
  });

  it('uses the configured Reporter model to summarize failed agent runs', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/dashboard.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticAssert = vi.fn().mockResolvedValue({
      status: 'failed',
      message: '未找到刷新成功状态。',
      evidence: '页面仍显示加载中。',
      failureReason: '图表未刷新完成。',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        byIntent: { executor: { calls: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
        byModel: { 'ui-agent-model': { calls: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      },
    });
    const report = vi.fn().mockResolvedValue({
      summary: 'Reporter 判断失败集中在图表刷新未完成。',
      evidenceSummary: '断言失败证据：页面仍显示加载中。',
      failureAnalysis: '图表接口或前端渲染可能未在等待窗口内完成。',
      suggestedFixes: ['增加图表稳定等待', '检查 /api/chart 响应耗时'],
      modelName: 'reporter-large',
      metrics: {
        durationMs: 50,
        modelTimeCostMs: 50,
        calls: 1,
        promptTokens: 40,
        completionTokens: 16,
        totalTokens: 56,
        cachedInputTokens: 0,
        byIntent: { reporter: { calls: 1, promptTokens: 40, completionTokens: 16, totalTokens: 56 } },
        byModel: { 'reporter-large': { calls: 1, promptTokens: 40, completionTokens: 16, totalTokens: 56 } },
      },
    });
    const writeReporterReport = vi.fn().mockResolvedValue({
      markdownPath: '/tmp/playtest-artifacts/agent-run-1-reporter.md',
      htmlPath: '/tmp/playtest-artifacts/agent-run-1-reporter.html',
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '图表区域仍显示加载中。',
          domSummary: '发现 1 个图表容器。',
          networkHints: ['GET https://example.test/api/chart -> timeout'],
        }),
        getState: () => currentState,
      },
      { click: vi.fn(), input: vi.fn(), assert: semanticAssert },
      undefined,
      undefined,
      { report },
      { writeReporterReport },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      reporter: {
        ...defaultAgentModelConfig.reporter,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://reporter.example.test/v1',
        modelApiKey: 'reporter-secret',
        modelName: 'reporter-large',
        modelFamily: 'openai',
        temperature: '0.1',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '验证图表刷新成功',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          modelApiKey: 'reporter-secret',
          modelName: 'reporter-large',
        }),
        run: expect.objectContaining({
          status: 'failed',
          failureReason: '图表未刷新完成。',
        }),
      }),
    );
    expect(response.agentRun.status).toBe('failed');
    expect(response.agentRun.summary).toContain('Reporter 判断失败集中在图表刷新未完成。');
    expect(response.agentRun.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'report',
          label: 'Reporter 失败分析',
          path: '/tmp/playtest-artifacts/agent-run-1-reporter.md',
        }),
        expect.objectContaining({
          type: 'report',
          label: 'Reporter HTML 报告',
          path: '/tmp/playtest-artifacts/agent-run-1-reporter.html',
        }),
      ]),
    );
    expect(writeReporterReport).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: response.agentRun.runId,
        markdown: expect.stringContaining('## 失败归因'),
      }),
    );
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ calls: 2, totalTokens: 56 }));
    expect(JSON.stringify(response.agentRun)).not.toContain('reporter-secret');
  });

  it('replans once after a failed Planner browser step and continues with the revised step', async () => {
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const clickOrder: string[] = [];
    const click = vi.fn(async ({ selector }: { selector: string }) => {
      clickOrder.push(selector);
      if (selector === '#missing-login-button') {
        throw new Error('locator #missing-login-button not found');
      }
      currentState = { ...currentState, currentUrl: 'https://example.test/dashboard', pageTitle: 'Dashboard' };
      return currentState;
    });
    const createPlan = vi
      .fn()
      .mockResolvedValueOnce({
        plan: {
          title: '登录工作台',
          summary: '点击登录按钮进入工作台。',
          risks: [],
          steps: [
            {
              action: 'click',
              title: '提交登录',
              instruction: '点击登录按钮',
              selector: '#missing-login-button',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 20,
          modelTimeCostMs: 20,
          calls: 1,
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          cachedInputTokens: 0,
          byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        },
      })
      .mockResolvedValueOnce({
        plan: {
          title: '登录工作台修正版',
          summary: '根据失败证据改用可用 selector。',
          risks: ['已基于失败步骤完成一次重规划'],
          steps: [
            {
              action: 'click',
              title: '提交登录',
              instruction: '点击登录按钮',
              selector: '#login-button',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 30,
          modelTimeCostMs: 30,
          calls: 1,
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 0,
          byIntent: { planner: { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
        },
      });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '登录页仍显示表单',
          domSummary: '未发现可安全替代的登录按钮',
          interactiveElements: ['input "用户名" #username'],
        }),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '完成登录',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(2);
    expect(createPlan.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        previousFailure: expect.objectContaining({
          stepTitle: '提交登录',
          status: 'failed',
          failureCategory: 'selector',
          recoveryStrategy: 'replaceSelector',
        }),
      }),
    );
    expect(clickOrder).toEqual(['#missing-login-button', '#login-button']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.title).toBe('登录工作台修正版');
    expect(response.agentRun.metrics).toEqual(
      expect.objectContaining({ calls: 2, totalTokens: 40, replanningCycles: 1 }),
    );
    expect(response.agentRun.metrics?.retryAttempts ?? 0).toBe(0);
  });

  it('skips same-plan retry for replan-navigation failures and asks Planner for a revised route', async () => {
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/start',
      pageTitle: 'Start',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const navigateOrder: string[] = [];
    const navigate = vi.fn(async ({ url }: { url: string }) => {
      navigateOrder.push(url);
      if (url === 'https://broken.example.test/dashboard') {
        throw new Error('Navigation failed: net::ERR_NAME_NOT_RESOLVED');
      }
      currentState = { ...currentState, currentUrl: url, pageTitle: 'Dashboard' };
      return currentState;
    });
    const createPlan = vi
      .fn()
      .mockResolvedValueOnce({
        plan: {
          title: '打开工作台',
          summary: '导航到工作台。',
          risks: [],
          steps: [
            {
              action: 'navigate',
              title: '进入工作台',
              instruction: '打开工作台页面',
              url: 'https://broken.example.test/dashboard',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 20,
          modelTimeCostMs: 20,
          calls: 1,
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          cachedInputTokens: 0,
          byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        },
      })
      .mockResolvedValueOnce({
        plan: {
          title: '打开工作台修正版',
          summary: '改用可访问的工作台地址。',
          risks: ['已基于导航失败完成一次重规划'],
          steps: [
            {
              action: 'navigate',
              title: '进入工作台',
              instruction: '打开可访问的工作台页面',
              url: 'https://example.test/dashboard',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 30,
          modelTimeCostMs: 30,
          calls: 1,
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 0,
          byIntent: { planner: { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
        },
      });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate,
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '仍停留在起始页',
          domSummary: '页面未跳转',
          interactiveElements: [],
        }),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '打开工作台',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(2);
    expect(createPlan.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        previousFailure: expect.objectContaining({
          stepTitle: '进入工作台',
          failureCategory: 'navigation',
          recoveryStrategy: 'replanNavigation',
        }),
      }),
    );
    expect(navigateOrder).toEqual(['https://broken.example.test/dashboard', 'https://example.test/dashboard']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.metrics).toEqual(
      expect.objectContaining({ calls: 2, totalTokens: 40, replanningCycles: 1 }),
    );
    expect(response.agentRun.metrics?.retryAttempts ?? 0).toBe(0);
  });

  it('replans from the current state without retrying an unknown browser failure', async () => {
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const clickOrder: string[] = [];
    const click = vi.fn(async ({ selector }: { selector: string }) => {
      clickOrder.push(selector);
      if (selector === '#submit-order') {
        throw new Error('browser entered an indeterminate state');
      }
      currentState = { ...currentState, currentUrl: 'https://example.test/orders/confirmed', pageTitle: 'Confirmed' };
      return currentState;
    });
    const createPlan = vi
      .fn()
      .mockResolvedValueOnce({
        plan: {
          title: '提交订单',
          summary: '提交当前订单。',
          risks: [],
          steps: [
            {
              action: 'click',
              title: '确认提交',
              instruction: '点击提交订单按钮',
              selector: '#submit-order',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 20,
          modelTimeCostMs: 20,
          calls: 1,
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          cachedInputTokens: 0,
          byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        },
      })
      .mockResolvedValueOnce({
        plan: {
          title: '提交订单修正版',
          summary: '先检查当前订单状态，再安全确认。',
          risks: ['已基于未知浏览器状态完成重规划'],
          steps: [
            {
              action: 'click',
              title: '确认订单状态',
              instruction: '点击确认订单状态按钮',
              selector: '#confirm-order-state',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 30,
          modelTimeCostMs: 30,
          calls: 1,
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 0,
          byIntent: { planner: { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
        },
      });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '订单状态未知，未出现确认提示。',
          domSummary: '提交按钮仍可见，页面没有发生可观察跳转。',
          interactiveElements: [],
        }),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '提交当前订单',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(2);
    expect(createPlan.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        previousFailure: expect.objectContaining({
          stepTitle: '确认提交',
          failureCategory: 'unknown',
          recoveryStrategy: 'replanFromCurrentState',
        }),
      }),
    );
    expect(clickOrder).toEqual(['#submit-order', '#confirm-order-state']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.metrics).toEqual(
      expect.objectContaining({ calls: 2, totalTokens: 40, replanningCycles: 1 }),
    );
    expect(response.agentRun.metrics?.retryAttempts ?? 0).toBe(0);
  });

  it('replans multiple times up to the configured recovery limit', async () => {
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const clickOrder: string[] = [];
    const click = vi.fn(async ({ selector }: { selector: string }) => {
      clickOrder.push(selector);
      if (selector !== '#login-button') {
        throw new Error(`locator ${selector} not found`);
      }
      currentState = { ...currentState, currentUrl: 'https://example.test/dashboard', pageTitle: 'Dashboard' };
      return currentState;
    });
    const createPlan = vi
      .fn()
      .mockResolvedValueOnce({
        plan: {
          title: '登录工作台',
          summary: '点击登录按钮进入工作台。',
          risks: [],
          steps: [
            {
              action: 'click',
              title: '提交登录',
              instruction: '点击登录按钮',
              selector: '#missing-login-button',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 20,
          modelTimeCostMs: 20,
          calls: 1,
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          cachedInputTokens: 0,
          byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        },
      })
      .mockResolvedValueOnce({
        plan: {
          title: '登录工作台修正版 A',
          summary: '第一次重规划仍然选择了不可用 selector。',
          risks: ['第一次重规划'],
          steps: [
            {
              action: 'click',
              title: '提交登录',
              instruction: '点击登录按钮',
              selector: '#still-missing-login-button',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 30,
          modelTimeCostMs: 30,
          calls: 1,
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 0,
          replanningCycles: 1,
          byIntent: { planner: { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
        },
      })
      .mockResolvedValueOnce({
        plan: {
          title: '登录工作台修正版 B',
          summary: '第二次重规划改用可用 selector。',
          risks: ['第二次重规划'],
          steps: [
            {
              action: 'click',
              title: '提交登录',
              instruction: '点击登录按钮',
              selector: '#login-button',
            },
          ],
        },
        modelName: 'planner-large',
        metrics: {
          durationMs: 30,
          modelTimeCostMs: 30,
          calls: 1,
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 0,
          replanningCycles: 1,
          byIntent: { planner: { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
          byModel: { 'planner-large': { calls: 1, promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
        },
      });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '登录页仍显示表单',
          domSummary: '未发现可安全替代的登录按钮',
          interactiveElements: ['input "用户名" #username'],
        }),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '完成登录',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig: { ...midsceneConfig, replanningCycleLimit: '2' },
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(3);
    expect(clickOrder).toEqual([
      '#missing-login-button',
      '#still-missing-login-button',
      '#login-button',
    ]);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.title).toBe('登录工作台修正版 B');
    expect(response.agentRun.metrics).toEqual(
      expect.objectContaining({
        calls: 3,
        totalTokens: 60,
        replanningCycleLimit: 2,
        replanningCycles: 2,
      }),
    );
    expect(response.agentRun.metrics?.retryAttempts ?? 0).toBe(0);
  });

  it('waits briefly before retrying a deterministic Planner browser step', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const click = vi
      .fn(async () => {
        actionOrder.push('click');
        if (actionOrder.filter((action) => action === 'click').length === 1) {
          throw new Error('page is still settling');
        }
        return currentState;
      });
    const wait = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`wait:${timeoutMs}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '登录工作台',
        summary: '点击登录按钮进入工作台。',
        risks: [],
        steps: [
          {
            action: 'click',
            title: '提交登录',
            instruction: '点击登录按钮',
            selector: '#login-button',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        wait,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '完成登录',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith({ timeoutMs: 500 });
    expect(actionOrder).toEqual(['click', 'wait:500', 'click']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:dynamic-wait',
          status: 'running',
          message: expect.stringContaining('500ms'),
        }),
        expect.objectContaining({
          type: 'agent:step-retried',
          status: 'running',
          message: expect.stringContaining('第 1 次重试'),
          retryAttempt: expect.objectContaining({
            failureCategory: 'runtime',
            recoveryStrategy: 'retryAfterWait',
          }),
        }),
      ]),
    );
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ retryAttempts: 1, dynamicWaitAttempts: 1 }));
  });

  it('waits for the explicit selector before retrying when the browser supports readiness waits', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/report',
      pageTitle: 'Report',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const click = vi.fn(async () => {
      actionOrder.push('click');
      if (actionOrder.filter((action) => action === 'click').length === 1) {
        throw new Error('table toolbar is still rendering');
      }
      return currentState;
    });
    const wait = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`wait:${timeoutMs}`);
      return currentState;
    });
    const waitForSelector = vi.fn(async ({ selector, timeoutMs }: { selector: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForSelector:${selector}:${timeoutMs}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '报表工具栏',
        summary: '等待报表工具栏渲染后点击导出。',
        risks: [],
        steps: [
          {
            action: 'click',
            title: '导出报表',
            instruction: '点击导出按钮',
            selector: '#export-report',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        wait,
        waitForSelector,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '导出当前报表',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(waitForSelector).toHaveBeenCalledWith({ selector: '#export-report', timeoutMs: 1000 });
    expect(wait).not.toHaveBeenCalled();
    expect(actionOrder).toEqual(['click', 'waitForSelector:#export-report:1000', 'click']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:dynamic-wait',
          dynamicWait: expect.objectContaining({
            selector: '#export-report',
            timeoutMs: 1000,
          }),
        }),
      ]),
    );
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ retryAttempts: 1, dynamicWaitAttempts: 1 }));
  });

  it('waits for network idle before retrying when selector readiness is unavailable', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/report',
      pageTitle: 'Report',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const click = vi.fn(async () => {
      actionOrder.push('click');
      if (actionOrder.filter((action) => action === 'click').length === 1) {
        throw new Error('report data is still loading');
      }
      return currentState;
    });
    const wait = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`wait:${timeoutMs}`);
      return currentState;
    });
    const waitForNetworkIdle = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForNetworkIdle:${timeoutMs}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '报表导出',
        summary: '等待接口稳定后导出报表。',
        risks: [],
        steps: [
          {
            action: 'click',
            title: '导出报表',
            instruction: '点击导出按钮',
            selector: '#export-report',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        wait,
        waitForNetworkIdle,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '导出当前报表',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(waitForNetworkIdle).toHaveBeenCalledWith({ timeoutMs: 1500 });
    expect(wait).not.toHaveBeenCalled();
    expect(actionOrder).toEqual(['click', 'waitForNetworkIdle:1500', 'click']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:dynamic-wait',
          dynamicWait: expect.objectContaining({
            strategy: 'networkIdle',
            timeoutMs: 1500,
          }),
        }),
      ]),
    );
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ retryAttempts: 1, dynamicWaitAttempts: 1 }));
  });

  it('uses wait-for-readiness recovery before retrying a timed out Planner wait step', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const wait = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`wait:${timeoutMs}`);
      if (actionOrder.filter((action) => action.startsWith('wait:')).length === 1) {
        throw new Error('Timeout 2000ms exceeded while waiting for data');
      }
      return currentState;
    });
    const waitForNetworkIdle = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForNetworkIdle:${timeoutMs}`);
      return currentState;
    });
    const laterClick = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '等待数据后打开详情',
        summary: '等待数据稳定后打开详情。',
        risks: [],
        steps: [
          { action: 'wait', title: '等待数据稳定', instruction: '等待 2 秒', timeoutMs: 2000 },
          { action: 'click', title: '打开详情', instruction: '点击详情按钮', selector: '#detail' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: laterClick,
        input: vi.fn(),
        wait,
        waitForNetworkIdle,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待数据稳定后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(waitForNetworkIdle).toHaveBeenCalledWith({ timeoutMs: 1500 });
    expect(actionOrder).toEqual(['wait:2000', 'waitForNetworkIdle:1500', 'wait:2000', 'click:#detail']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:step-retried',
          retryAttempt: expect.objectContaining({
            failureCategory: 'timeout',
            recoveryStrategy: 'waitForReadiness',
          }),
        }),
      ]),
    );
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ retryAttempts: 1, dynamicWaitAttempts: 1 }));
  });

  it('waits for table data before retrying a step that timed out during data loading', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const click = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      if (actionOrder.filter((action) => action.startsWith('click:')).length === 1) {
        throw new Error('Timeout 10000ms exceeded while waiting for orders table data');
      }
      return currentState;
    });
    const waitForDataReady = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForDataReady:${timeoutMs}`);
      return currentState;
    });
    const waitForNetworkIdle = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForNetworkIdle:${timeoutMs}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '查看订单详情',
        summary: '等待订单表格加载后打开详情。',
        risks: [],
        steps: [
          {
            action: 'click',
            title: '打开订单详情',
            instruction: '等待订单表格数据加载完成后，点击订单详情按钮',
            selector: '#order-detail',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        waitForDataReady,
        waitForNetworkIdle,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待订单表格加载完成后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(waitForDataReady).toHaveBeenCalledWith({ timeoutMs: 1500 });
    expect(waitForNetworkIdle).not.toHaveBeenCalled();
    expect(actionOrder).toEqual(['click:#order-detail', 'waitForDataReady:1500', 'click:#order-detail']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:dynamic-wait',
          dynamicWait: expect.objectContaining({
            strategy: 'dataReady',
            timeoutMs: 1500,
          }),
        }),
      ]),
    );
  });

  it('tries a bounded selector fallback from observed interactive elements before replanning', async () => {
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const clickOrder: string[] = [];
    const click = vi.fn(async ({ selector }: { selector: string }) => {
      clickOrder.push(selector);
      if (selector === '#missing-login-button') {
        throw new Error(`locator ${selector} not found`);
      }
      currentState = { ...currentState, currentUrl: 'https://example.test/dashboard', pageTitle: 'Dashboard' };
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '登录工作台',
        summary: '点击登录按钮进入工作台。',
        risks: [],
        steps: [
          {
            action: 'click',
            title: '提交登录',
            instruction: '点击登录按钮',
            selector: '#missing-login-button',
          },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click,
        input: vi.fn(),
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '登录页显示登录按钮',
          domSummary: '发现 2 个关键可交互元素。',
          interactiveElements: ['button "登录" #login-button', 'a "忘记密码" #forgot-password'],
        }),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '完成登录',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(clickOrder).toEqual(['#missing-login-button', '#login-button']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:selector-fallback',
          status: 'running',
          message: expect.stringContaining('#login-button'),
        }),
      ]),
    );
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ selectorFallbackAttempts: 1 }));
    expect(response.agentRun.metrics?.retryAttempts ?? 0).toBe(0);
  });

  it('executes Planner wait steps before continuing later actions', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const wait = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`wait:${timeoutMs}`);
      return currentState;
    });
    const laterClick = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '等待后继续',
        summary: '等待数据稳定后打开详情。',
        risks: [],
        steps: [
          { action: 'wait', title: '等待数据稳定', instruction: '等待 2 秒', timeoutMs: 2000 },
          { action: 'click', title: '打开详情', instruction: '点击详情按钮', selector: '#detail' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: laterClick,
        input: vi.fn(),
        wait,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待数据稳定后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(actionOrder).toEqual(['wait:2000', 'click:#detail']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.summary).toContain('全部 2 个计划步骤');
  });

  it('executes Planner conditional wait steps for selector readiness and network idle', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const wait = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`wait:${timeoutMs}`);
      return currentState;
    });
    const waitForSelector = vi.fn(async ({ selector, timeoutMs }: { selector: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForSelector:${selector}:${timeoutMs}`);
      return currentState;
    });
    const waitForNetworkIdle = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForNetworkIdle:${timeoutMs}`);
      return currentState;
    });
    const laterClick = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '图表稳定后打开详情',
        summary: '先等待图表容器和接口稳定，再打开详情。',
        risks: [],
        steps: [
          {
            action: 'wait',
            title: '等待图表容器',
            instruction: '等待图表容器出现',
            selector: '#sales-chart',
            timeoutMs: 3000,
          },
          {
            action: 'wait',
            title: '等待接口稳定',
            instruction: '等待网络空闲后继续',
            timeoutMs: 2500,
          },
          { action: 'click', title: '打开详情', instruction: '点击详情按钮', selector: '#detail' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: laterClick,
        input: vi.fn(),
        wait,
        waitForSelector,
        waitForNetworkIdle,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待图表稳定后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(wait).not.toHaveBeenCalled();
    expect(actionOrder).toEqual([
      'waitForSelector:#sales-chart:3000',
      'waitForNetworkIdle:2500',
      'click:#detail',
    ]);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.summary).toContain('全部 3 个计划步骤');
  });

  it('executes Planner conditional wait steps for a specific API response before continuing', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const wait = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`wait:${timeoutMs}`);
      return currentState;
    });
    const waitForNetworkIdle = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForNetworkIdle:${timeoutMs}`);
      return currentState;
    });
    const waitForResponse = vi.fn(async ({ urlPattern, timeoutMs }: { urlPattern: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForResponse:${urlPattern}:${timeoutMs}`);
      return currentState;
    });
    const laterClick = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '图表接口返回后打开详情',
        summary: '先等待图表数据接口响应，再打开详情。',
        risks: [],
        steps: [
          {
            action: 'wait',
            title: '等待图表接口',
            instruction: '等待 /api/chart 响应后继续',
            target: '/api/chart',
            timeoutMs: 4000,
          },
          { action: 'click', title: '打开详情', instruction: '点击详情按钮', selector: '#detail' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const browserObserver = {
      start: vi.fn(),
      navigate: vi.fn(),
      click: laterClick,
      input: vi.fn(),
      wait,
      waitForNetworkIdle,
      waitForResponse,
      capture: vi.fn(async () => currentState),
      getState: () => currentState,
    };
    const runtime = new StudioRuntime(vi.fn(), browserObserver, undefined, { createPlan });
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待图表接口返回后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(waitForResponse).toHaveBeenCalledWith({ urlPattern: '/api/chart', timeoutMs: 4000 });
    expect(waitForNetworkIdle).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(actionOrder).toEqual(['waitForResponse:/api/chart:4000', 'click:#detail']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.summary).toContain('全部 2 个计划步骤');
  });

  it('executes Planner conditional wait steps for chart stability before continuing', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const waitForSelector = vi.fn(async ({ selector, timeoutMs }: { selector: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForSelector:${selector}:${timeoutMs}`);
      return currentState;
    });
    const waitForChartStable = vi.fn(async ({ selector, timeoutMs }: { selector?: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForChartStable:${selector}:${timeoutMs}`);
      return currentState;
    });
    const laterClick = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '图表稳定后打开详情',
        summary: '先等待图表渲染稳定，再打开详情。',
        risks: [],
        steps: [
          {
            action: 'wait',
            title: '等待图表稳定',
            instruction: '等待销售趋势图表稳定后继续',
            selector: '#sales-chart',
            timeoutMs: 3500,
          },
          { action: 'click', title: '打开详情', instruction: '点击详情按钮', selector: '#detail' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const browserObserver = {
      start: vi.fn(),
      navigate: vi.fn(),
      click: laterClick,
      input: vi.fn(),
      waitForSelector,
      waitForChartStable,
      capture: vi.fn(async () => currentState),
      getState: () => currentState,
    };
    const runtime = new StudioRuntime(vi.fn(), browserObserver, undefined, { createPlan });
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待图表稳定后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(waitForChartStable).toHaveBeenCalledWith({ selector: '#sales-chart', timeoutMs: 3500 });
    expect(waitForSelector).not.toHaveBeenCalled();
    expect(actionOrder).toEqual(['waitForChartStable:#sales-chart:3500', 'click:#detail']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.summary).toContain('全部 2 个计划步骤');
  });

  it('executes Planner conditional wait steps for table data readiness before continuing', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const waitForSelector = vi.fn(async ({ selector, timeoutMs }: { selector: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForSelector:${selector}:${timeoutMs}`);
      return currentState;
    });
    const waitForDataReady = vi.fn(async ({ selector, timeoutMs }: { selector?: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForDataReady:${selector}:${timeoutMs}`);
      return currentState;
    });
    const laterClick = vi.fn(async ({ selector }: { selector: string }) => {
      actionOrder.push(`click:${selector}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '订单数据就绪后打开详情',
        summary: '先等待订单表格数据加载完成，再打开详情。',
        risks: [],
        steps: [
          {
            action: 'wait',
            title: '等待订单数据',
            instruction: '等待订单表格数据加载完成后继续',
            selector: '#orders-table',
            timeoutMs: 4500,
          },
          { action: 'click', title: '打开详情', instruction: '点击详情按钮', selector: '#detail' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const browserObserver = {
      start: vi.fn(),
      navigate: vi.fn(),
      click: laterClick,
      input: vi.fn(),
      waitForSelector,
      waitForDataReady,
      capture: vi.fn(async () => currentState),
      getState: () => currentState,
    };
    const runtime = new StudioRuntime(vi.fn(), browserObserver, undefined, { createPlan });
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待订单数据就绪后打开详情',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(waitForDataReady).toHaveBeenCalledWith({ selector: '#orders-table', timeoutMs: 4500 });
    expect(waitForSelector).not.toHaveBeenCalled();
    expect(actionOrder).toEqual(['waitForDataReady:#orders-table:4500', 'click:#detail']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.summary).toContain('全部 2 个计划步骤');
  });

  it('executes Planner scroll, select, and extract steps as real browser work', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/report',
      pageTitle: 'Report',
      screenshotPath: '/tmp/report.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const scroll = vi.fn(async ({ selector }: { selector?: string }) => {
      actionOrder.push(`scroll:${selector}`);
      return currentState;
    });
    const select = vi.fn(async ({ selector, value }: { selector: string; value: string }) => {
      actionOrder.push(`select:${selector}:${value}`);
      return currentState;
    });
    const captureObservation = vi.fn().mockResolvedValue({
      textSummary: '报表已显示，状态为成功。',
      domSummary: '发现 1 个表格、1 个图表。',
      tables: [
        {
          index: 1,
          rowCount: 2,
          columnCount: 2,
          headers: ['名称', '状态'],
          sampleRows: [['订单', '成功']],
        },
      ],
      charts: [
        {
          index: 1,
          title: '成交趋势',
          kind: 'canvas',
          rendered: true,
          legends: ['买入'],
        },
      ],
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '筛选并提取报表',
        summary: '滚动到筛选器，选择状态并提取报表证据。',
        risks: [],
        steps: [
          { action: 'scroll', title: '定位筛选器', instruction: '滚动到筛选器', selector: '#filters' },
          { action: 'select', title: '选择状态', instruction: '选择成功状态', selector: '#status', value: 'success' },
          { action: 'extract', title: '提取报表', instruction: '提取当前报表的表格和图表信息' },
        ],
      },
      modelName: 'planner-large',
      metrics: {
        durationMs: 20,
        modelTimeCostMs: 20,
        calls: 1,
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cachedInputTokens: 0,
        byIntent: { planner: { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
        byModel: { 'planner-large': { calls: 1, promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        scroll,
        select,
        capture: vi.fn(async () => currentState),
        captureObservation,
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'aiQuery',
      prompt: '筛选成功状态并提取报表',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(actionOrder).toEqual(['scroll:#filters', 'select:#status:success']);
    expect(captureObservation).toHaveBeenCalled();
    expect(response.agentRun.status).toBe('passed');
    expect(
      response.agentRun.events.find(
        (event) => event.type === 'agent:assertion-result' && event.stepId?.includes('step-planned-3'),
      )?.message,
    ).toContain('表格和图表');
  });

  it('navigates to an explicit URL from a natural language prompt', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test',
      pageTitle: 'Home',
      screenshotPath: '/tmp/home.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const navigatedState: BrowserSessionState = {
      ...currentState,
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
    };
    const navigate = vi.fn().mockResolvedValue(navigatedState);
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate,
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '打开 https://example.test/reports 并检查报表页面',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(navigate).toHaveBeenCalledWith({ url: 'https://example.test/reports' });
    expect(response.agentRun?.plan.steps[1]?.action).toBe('navigate');
    expect(response.agentRun?.plan.steps[1]?.instruction).toBe('导航到 https://example.test/reports');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '导航到用户指定 URL',
    );
    expect(response.agentRun?.events.find((event) => event.browserSession)?.browserSession?.currentUrl).toBe(
      'https://example.test/reports',
    );
  });

  it('clicks an explicit selector from a natural language prompt', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const clickedState: BrowserSessionState = {
      ...currentState,
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/clicked.png',
      message: '已点击元素：#login-button',
    };
    const click = vi.fn().mockResolvedValue(clickedState);
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click,
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '点击 #login-button',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(click).toHaveBeenCalledWith({ selector: '#login-button' });
    expect(response.agentRun?.plan.steps[1]?.action).toBe('click');
    expect(response.agentRun?.plan.steps[1]?.selector).toBe('#login-button');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '点击用户指定 selector',
    );
  });

  it('keeps semantic click targets as a planned Midscene action without selector execution', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const click = vi.fn();
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click,
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '点击登录按钮',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(click).not.toHaveBeenCalled();
    expect(response.agentRun?.plan.steps[1]?.action).toBe('click');
    expect(response.agentRun?.plan.steps[1]?.instruction).toBe('点击「登录按钮」');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '等待 Midscene 语义定位执行',
    );
    expect(response.agentRun?.status).toBe('neutral');
  });

  it('executes a semantic click through the configured Midscene runtime', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticClick = vi.fn().mockResolvedValue({
      status: 'passed',
      message: 'Midscene 已点击登录按钮。',
      evidence: '定位到 button "登录"。',
      reportPath: '/tmp/midscene-login.html',
      metrics: {
        durationMs: 360,
        modelTimeCostMs: 240,
        calls: 2,
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 10,
        replanningCycleLimit: 12,
        byIntent: {},
        byModel: {},
      },
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      {
        click: semanticClick,
        input: vi.fn(),
        assert: vi.fn(),
      },
    );

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '点击登录按钮',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(semanticClick).toHaveBeenCalledWith({
      target: '登录按钮',
      prompt: '点击登录按钮',
      config: midsceneConfig,
    });
    expect(response.agentRun?.status).toBe('passed');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      'Midscene 已点击登录按钮',
    );
    expect(response.agentRun?.artifacts).toContainEqual(
      expect.objectContaining({
        type: 'report',
        path: '/tmp/midscene-login.html',
      }),
    );
    expect(response.agentRun?.events.some((event) => event.type === 'agent:artifact-created')).toBe(true);
    expect(response.agentRun?.metrics).toEqual(
      expect.objectContaining({ durationMs: 360, calls: 2, totalTokens: 150 }),
    );
  });

  it('inputs into an explicit selector from a natural language prompt', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const inputState: BrowserSessionState = {
      ...currentState,
      screenshotPath: '/tmp/input.png',
      message: '已在 #username 输入内容。',
    };
    const input = vi.fn().mockResolvedValue(inputState);
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input,
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '在 #username 输入 chris',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(input).toHaveBeenCalledWith({ selector: '#username', value: 'chris' });
    expect(response.agentRun?.plan.steps[1]?.action).toBe('input');
    expect(response.agentRun?.plan.steps[1]?.selector).toBe('#username');
    expect(response.agentRun?.plan.steps[1]?.value).toBe('chris');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '用户指定 selector 输入内容',
    );
  });

  it('keeps semantic input targets as a planned Midscene action without selector execution', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const input = vi.fn();
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input,
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '在用户名输入 chris',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(input).not.toHaveBeenCalled();
    expect(response.agentRun?.plan.steps[1]?.action).toBe('input');
    expect(response.agentRun?.plan.steps[1]?.instruction).toBe('在「用户名」输入 chris');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '等待 Midscene 语义定位执行',
    );
    expect(response.agentRun?.status).toBe('neutral');
  });

  it('executes semantic input through the configured Midscene runtime', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticInput = vi.fn().mockResolvedValue({
      status: 'passed',
      message: 'Midscene 已填写用户名。',
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      {
        click: vi.fn(),
        input: semanticInput,
        assert: vi.fn(),
      },
    );

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '在用户名输入 chris',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(semanticInput).toHaveBeenCalledWith({
      target: '用户名',
      value: 'chris',
      prompt: '在用户名输入 chris',
      config: midsceneConfig,
    });
    expect(response.agentRun?.status).toBe('passed');
  });

  it('fails the agent run when a semantic assertion fails', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/dashboard.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticAssert = vi.fn().mockResolvedValue({
      status: 'failed',
      message: '未找到成功提示。',
      evidence: '当前页面没有可见的成功提示。',
      failureReason: '页面未显示登录成功提示。',
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      {
        click: vi.fn(),
        input: vi.fn(),
        assert: semanticAssert,
      },
    );

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '验证页面已经显示登录成功提示',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(semanticAssert).toHaveBeenCalledWith({
      assertion: '验证页面已经显示登录成功提示',
      prompt: '验证页面已经显示登录成功提示',
      config: midsceneConfig,
    });
    expect(response.agentRun?.status).toBe('failed');
    expect(response.agentRun?.failureReason).toBe('页面未显示登录成功提示。');
  });

  it('records a semantic runtime exception as an agent failure', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      {
        click: vi.fn().mockRejectedValue(new Error('模型服务不可用')),
        input: vi.fn(),
        assert: vi.fn(),
      },
    );

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '点击登录按钮',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      midsceneConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(response.agentRun?.status).toBe('failed');
    expect(response.agentRun?.failureReason).toContain('模型服务不可用');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '语义动作执行失败',
    );
  });

  it('passes an explicit URL contains assertion against the current browser state', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard?range=30d',
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/dashboard.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言 url 包含 /dashboard',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(response.agentRun?.status).toBe('passed');
    expect(response.agentRun?.plan.steps[1]?.action).toBe('assert');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.summary).toContain(
      '已通过',
    );
  });

  it('fails an explicit URL contains assertion when the current URL does not match', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言 url 包含 /dashboard',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const verification = response.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
    expect(response.agentRun?.status).toBe('failed');
    expect(verification?.status).toBe('failed');
    expect(verification?.failureReason).toContain('不包含');
  });

  it('passes an explicit title contains assertion', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports Overview',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言标题包含 Reports',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(response.agentRun?.status).toBe('passed');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      'Reports Overview',
    );
  });

  it('passes an explicit page text contains assertion using browser page text', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const getPageText = vi.fn().mockResolvedValue('收入趋势\n近 30 天报表已刷新\n导出');
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getPageText,
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言页面包含 近 30 天报表',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    expect(getPageText).toHaveBeenCalledTimes(1);
    expect(response.agentRun?.status).toBe('passed');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '页面包含',
    );
  });

  it('passes an explicit table contains assertion using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const captureObservation = vi.fn().mockResolvedValue({
      textSummary: '成交统计',
      domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
      interactiveElements: [],
      consoleMessages: [],
      networkHints: [],
      tables: [
        {
          index: 1,
          caption: '订单列表',
          rowCount: 2,
          columnCount: 3,
          headers: ['交易对', '成交量', '状态'],
          sampleRows: [['BTC/USDT', '120', '成功']],
        },
      ],
      charts: [],
    });
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation,
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格包含 成交量',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const verification = response.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
    expect(captureObservation).toHaveBeenCalledTimes(1);
    expect(response.agentRun?.status).toBe('passed');
    expect(verification?.summary).toContain('表格包含「成交量」已通过');
    expect(verification?.evidence).toContain('订单列表');
  });

  it('passes explicit table row and column count assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const captureObservation = vi.fn().mockResolvedValue({
      textSummary: '成交统计',
      domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
      interactiveElements: [],
      consoleMessages: [],
      networkHints: [],
      tables: [
        {
          index: 1,
          caption: '订单列表',
          rowCount: 2,
          columnCount: 3,
          headers: ['交易对', '成交量', '状态'],
          sampleRows: [['BTC/USDT', '120', '成功']],
        },
      ],
      charts: [],
    });
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation,
      getState: () => currentState,
    });

    const rowResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格行数为 2',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const columnResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格列数为 3',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const rowVerification = rowResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const columnVerification = columnResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(rowResponse.agentRun?.status).toBe('passed');
    expect(rowVerification?.summary).toContain('表格行数「2」已通过');
    expect(rowVerification?.evidence).toContain('订单列表：2 行');
    expect(columnResponse.agentRun?.status).toBe('passed');
    expect(columnVerification?.summary).toContain('表格列数「3」已通过');
    expect(columnVerification?.evidence).toContain('订单列表：3 列');
  });

  it('fails an explicit table row count assertion when observed tables do not match', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交统计',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [
          {
            index: 1,
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            sampleRows: [['BTC/USDT', '120', '成功']],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格行数为 4',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const verification = response.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
    expect(response.agentRun?.status).toBe('failed');
    expect(verification?.status).toBe('failed');
    expect(verification?.failureReason).toContain('表格行数不等于「4」');
    expect(verification?.evidence).toContain('订单列表：2 行');
  });

  it('passes and fails explicit table cell assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交统计',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [
          {
            index: 1,
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            sampleRows: [
              ['BTC/USDT', '120', '成功'],
              ['ETH/USDT', '80', '处理中'],
            ],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });

    const passedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格第1行第2列为 120',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const failedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格第2行第3列为 成功',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.summary).toContain('表格单元格「120」已通过');
    expect(passedVerification?.evidence).toContain('订单列表 第 1 行第 2 列：120');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格单元格不等于「成功」');
    expect(failedVerification?.evidence).toContain('订单列表 第 2 行第 3 列：处理中');
  });

  it('passes and fails explicit table column contains assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交统计',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [
          {
            index: 1,
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            sampleRows: [
              ['BTC/USDT', '120', '成功'],
              ['ETH/USDT', '80', '处理中'],
            ],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });

    const passedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格列 状态 包含 成功',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const failedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格列 状态 包含 失败',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.summary).toContain('表格列包含「状态 包含 成功」已通过');
    expect(passedVerification?.evidence).toContain('订单列表：状态 = 成功 / 处理中');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格列不包含「失败」');
    expect(failedVerification?.evidence).toContain('订单列表：状态 = 成功 / 处理中');
  });

  it('passes and fails explicit table column sum assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交统计',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [
          {
            index: 1,
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            sampleRows: [
              ['BTC/USDT', '120', '成功'],
              ['ETH/USDT', '80', '处理中'],
            ],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });

    const passedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格列 成交量 合计为 200',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const failedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格列 成交量 合计为 180',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.summary).toContain('表格列合计「成交量 合计 200」已通过');
    expect(passedVerification?.evidence).toContain('订单列表：成交量 合计 200 (120 / 80)');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格列合计不等于「180」');
    expect(failedVerification?.evidence).toContain('订单列表：成交量 合计 200 (120 / 80)');
  });

  it('passes and fails explicit table sort assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交统计',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [
          {
            index: 1,
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            sortStates: [{ column: '成交量', direction: 'descending' }],
            sampleRows: [
              ['BTC/USDT', '120', '成功'],
              ['ETH/USDT', '80', '处理中'],
            ],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });

    const passedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格按 成交量 降序',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const failedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格按 成交量 升序',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.summary).toContain('表格排序「成交量 降序」已通过');
    expect(passedVerification?.evidence).toContain('订单列表：成交量 descending');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格排序不匹配「成交量 升序」');
    expect(failedVerification?.evidence).toContain('订单列表：成交量 descending');
  });

  it('infers table sort order from sampled column values when no sort state is exposed', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交统计',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [
          {
            index: 1,
            caption: '订单列表',
            rowCount: 3,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            sampleRows: [
              ['BTC/USDT', '120', '成功'],
              ['ETH/USDT', '80', '处理中'],
              ['SOL/USDT', '35', '成功'],
            ],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });

    const passedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格按 成交量 降序',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const failedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言表格按 成交量 升序',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.evidence).toContain('订单列表：成交量 inferred descending (120 / 80 / 35)');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格排序不匹配「成交量 升序」');
    expect(failedVerification?.evidence).toContain('订单列表：成交量 inferred descending (120 / 80 / 35)');
  });

  it('passes an explicit chart contains assertion using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const captureObservation = vi.fn().mockResolvedValue({
      textSummary: '成交趋势',
      domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、0 个表格、1 个图表。',
      interactiveElements: [],
      consoleMessages: [],
      networkHints: [],
      tables: [],
      charts: [
        {
          index: 1,
          title: '成交趋势',
          kind: 'canvas',
          width: 640,
          height: 240,
          legends: ['买入', '卖出'],
        },
      ],
    });
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation,
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言图表包含 买入',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const verification = response.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
    expect(captureObservation).toHaveBeenCalledTimes(1);
    expect(response.agentRun?.status).toBe('passed');
    expect(verification?.summary).toContain('图表包含「买入」已通过');
    expect(verification?.evidence).toContain('成交趋势');
  });

  it('passes and fails explicit chart count assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交趋势 资产分布',
        domSummary: '页面文本约 8 字符；发现 0 个关键可交互元素、0 个表格、2 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [],
        charts: [
          {
            index: 1,
            title: '成交趋势',
            kind: 'canvas',
            width: 640,
            height: 240,
            legends: ['买入', '卖出'],
          },
          {
            index: 2,
            title: '资产分布',
            kind: 'svg',
            width: 320,
            height: 180,
            legends: ['现货', '合约'],
          },
        ],
      }),
      getState: () => currentState,
    });

    const passedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言图表数量为 2',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const failedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言图表数量为 3',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.summary).toContain('图表数量「2」已通过');
    expect(passedVerification?.evidence).toContain('成交趋势');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('图表数量不等于「3」');
    expect(failedVerification?.evidence).toContain('实际观察到 2 个图表');
  });

  it('passes and fails explicit chart rendered assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn()
        .mockResolvedValueOnce({
          textSummary: '成交趋势',
          domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、0 个表格、1 个图表。',
          interactiveElements: [],
          consoleMessages: [],
          networkHints: [],
          tables: [],
          charts: [
            {
              index: 1,
              title: '成交趋势',
              kind: 'canvas',
              width: 640,
              height: 240,
              rendered: true,
              legends: ['买入', '卖出'],
            },
          ],
        })
        .mockResolvedValueOnce({
          textSummary: '成交趋势',
          domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、0 个表格、1 个图表。',
          interactiveElements: [],
          consoleMessages: [],
          networkHints: [],
          tables: [],
          charts: [
            {
              index: 1,
              title: '成交趋势',
              kind: 'canvas',
              width: 0,
              height: 0,
              rendered: false,
              legends: [],
            },
          ],
        }),
      getState: () => currentState,
    });

    const passedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言图表已渲染',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const failedResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言图表已渲染',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.summary).toContain('图表渲染「已渲染」已通过');
    expect(passedVerification?.evidence).toContain('成交趋势：已渲染 640x240');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('未观察到已渲染图表');
    expect(failedVerification?.evidence).toContain('成交趋势：未渲染 0x0');
  });

  it('passes explicit chart title and legend assertions using structured observation', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation: vi.fn().mockResolvedValue({
        textSummary: '成交趋势',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、0 个表格、1 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [],
        charts: [
          {
            index: 1,
            title: '成交趋势',
            kind: 'canvas',
            width: 640,
            height: 240,
            legends: ['买入', '卖出'],
          },
        ],
      }),
      getState: () => currentState,
    });

    const titleResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言图表标题为 成交趋势',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });
    const legendResponse = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '断言图表图例包含 买入',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const titleVerification = titleResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    const legendVerification = legendResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(titleResponse.agentRun?.status).toBe('passed');
    expect(titleVerification?.summary).toContain('图表标题「成交趋势」已通过');
    expect(titleVerification?.evidence).toContain('成交趋势');
    expect(legendResponse.agentRun?.status).toBe('passed');
    expect(legendVerification?.summary).toContain('图表图例「买入」已通过');
    expect(legendVerification?.evidence).toContain('买入 / 卖出');
  });

  it('attaches enriched browser observation data to agent run events', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const captureObservation = vi.fn().mockResolvedValue({
      textSummary: '报表总览 收入趋势 导出',
      domSummary: '页面文本约 12 字符；发现 2 个关键可交互元素；console 1 条；失败请求 1 条。',
      interactiveElements: ['button "导出" #export', 'a "详情" a'],
      consoleMessages: ['error: chart render failed once'],
      networkHints: ['GET https://example.test/api/chart -> net::ERR_FAILED'],
    });
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      captureObservation,
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '观察当前页面',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    const observation = response.agentRun?.events.find((event) => event.type === 'agent:observation-created')?.observation;
    expect(captureObservation).toHaveBeenCalledTimes(1);
    expect(observation?.textSummary).toContain('报表总览');
    expect(observation?.interactiveElements).toContain('button "导出" #export');
    expect(observation?.consoleMessages).toContain('error: chart render failed once');
    expect(observation?.networkHints).toContain('GET https://example.test/api/chart -> net::ERR_FAILED');
  });

  it('executes workflow steps through the agent runtime and returns one run detail', async () => {
    const project = createEmptyProject(1);
    const environment = {
      ...project.environments[0],
      id: 'env-local',
      name: 'Local',
      url: 'https://example.test',
      entryPath: '/login',
    };
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      projectId: project.id,
      environmentId: environment.id,
      currentUrl: 'https://example.test/home',
      pageTitle: 'Home',
      screenshotPath: '/tmp/home.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const navigate = vi.fn().mockImplementation(async ({ url }: { url: string }) => {
      currentState = {
        ...currentState,
        currentUrl: url,
        pageTitle: 'Login',
        screenshotPath: '/tmp/login.png',
      };
      return currentState;
    });
    const semanticClick = vi.fn().mockResolvedValue({
      status: 'passed',
      message: 'Midscene 已点击登录按钮。',
    });
    const semanticAssert = vi.fn().mockResolvedValue({
      status: 'passed',
      message: 'Midscene 已验证登录成功。',
    });
    const emitRunEvent = vi.fn();
    const runtime = new StudioRuntime(
      emitRunEvent,
      {
        start: vi.fn(),
        navigate,
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockImplementation(async () => currentState),
        getState: () => currentState,
      },
      {
        click: semanticClick,
        input: vi.fn(),
        assert: semanticAssert,
      },
    );

    const response = await runtime.runWorkflow({
      workflow: {
        id: 'workflow-login',
        kind: 'scenario',
        name: '登录流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: 'https://example.test/login',
        notes: '',
        steps: [
          { id: 'workflow-step-click', type: 'ai', title: '点击登录', body: '点击登录按钮' },
          { id: 'workflow-step-assert', type: 'aiAssert', title: '验证登录', body: '验证页面显示登录成功' },
        ],
      },
      targetEnvironment: environment.name,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: environment.url,
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
      project,
      environment,
      midsceneConfig,
      browserSession: currentState,
    });

    expect(navigate).toHaveBeenCalledWith({ url: 'https://example.test/login' });
    expect(semanticClick).toHaveBeenCalledTimes(1);
    expect(semanticAssert).toHaveBeenCalledTimes(1);
    expect(response.agentRun.intent.source).toBe('workflow');
    expect(response.agentRun.plan.steps.map((step) => step.action)).toEqual(['click', 'assert']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.detail.agentRun).toBe(response.agentRun);
    expect(response.detail.steps).toHaveLength(2);
    expect(emitRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'complete', status: 'passed', detail: response.detail }),
    );
  });

  it('keeps unsupported workflow actions neutral instead of reporting a fake pass', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticAssert = vi.fn().mockResolvedValue({ status: 'passed', message: '断言已通过。' });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      { click: vi.fn(), input: vi.fn(), assert: semanticAssert },
    );

    const response = await runtime.runWorkflow({
      workflow: {
        id: 'workflow-filter',
        kind: 'scenario',
        name: '报表筛选',
        category: '报表',
        lastEdited: '刚刚',
        url: currentState.currentUrl,
        notes: '',
        steps: [
          { id: 'step-filter', type: 'ai', title: '筛选时间', body: '筛选近 30 天数据' },
          { id: 'step-assert', type: 'aiAssert', title: '验证结果', body: '验证图表已经刷新' },
        ],
      },
      targetEnvironment: 'local',
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
      midsceneConfig,
    });

    expect(semanticAssert).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.status).toBe('neutral');
    expect(response.detail.steps[0]?.status).toBe('neutral');
    expect(response.detail.steps[1]?.status).toBe('neutral');
  });
});
