import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  defaultAgentModelConfig,
  type BrowserSessionState,
} from '../shared/studio.js';
import type { ResolvedAgentModelConfig, ResolvedMidsceneConfig } from './runtime/model-config-resolver.js';
import { StudioRuntime } from './studioRuntime.js';

const midsceneConfig: ResolvedMidsceneConfig = {
  modelBaseUrl: 'https://models.example.test/v1',
  modelSecret: { id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
  modelApiKey: 'test-key',
  modelName: 'ui-agent-model',
  modelFamily: 'vlm-ui-tars',
  preferredLanguage: 'Chinese',
  replanningCycleLimit: '10',
  openaiHttpProxy: '',
  defaultContext: '',
};

const defaultResolvedAgentModelConfig: ResolvedAgentModelConfig = {
  planner: {
    ...defaultAgentModelConfig.planner,
    modelSecret: { id: 'agent:planner', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
    modelApiKey: 'test-planner-key',
  },
  executor: {
    ...defaultAgentModelConfig.executor,
    modelSecret: { id: 'agent:executor', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
    modelApiKey: 'test-executor-key',
  },
  verifier: {
    ...defaultAgentModelConfig.verifier,
    modelSecret: { id: 'agent:verifier', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
    modelApiKey: 'test-verifier-key',
  },
  reporter: {
    ...defaultAgentModelConfig.reporter,
    modelSecret: { id: 'agent:reporter', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
    modelApiKey: 'test-reporter-key',
  },
};

describe('StudioRuntime agent observation', () => {
  it('adds a completed Playwright trace to the natural language agent evidence chain', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-trace',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const beginTrace = vi.fn().mockResolvedValue(true);
    const finishTrace = vi.fn().mockResolvedValue({
      id: 'trace-1',
      type: 'trace' as const,
      label: 'Playwright Trace',
      path: '/tmp/agent-trace.zip',
    });
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
      beginTrace,
      finishTrace,
    });

    const response = await runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt: '验证页面包含 Dashboard',
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

    expect(beginTrace).toHaveBeenCalledWith(expect.stringMatching(/^agent-trace-/));
    expect(finishTrace).toHaveBeenCalledOnce();
    expect(response.agentRun.artifacts).toContainEqual(
      expect.objectContaining({ type: 'trace', path: '/tmp/agent-trace.zip' }),
    );
    expect(response.agentRun.events).toContainEqual(
      expect.objectContaining({ type: 'agent:artifact-created', artifact: expect.objectContaining({ type: 'trace' }) }),
    );
  });

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
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
    });

    expect(start).toHaveBeenCalledWith({ project, environment, record: false });
    expect(capture).not.toHaveBeenCalled();
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      'Agent 已启动受控浏览器',
    );
    expect(response.agentRun?.events.find((event) => event.browserSession)?.browserSession?.screenshotPath).toBe(
      '/tmp/started.png',
    );
    expect(response.agentRun.intent).toMatchObject({
      projectId: project.id,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
    });
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
      projectId: 'project-login',
      groupId: 'group-login',
      environmentId: 'env-staging',
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
    expect(response.agentRun.intent).toMatchObject({
      projectId: 'project-login',
      groupId: 'group-login',
      environmentId: 'env-staging',
    });
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ calls: 1, totalTokens: 30 }));
  });

  it('resolves only the planner provider for a successful selector-based Agent action', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-lazy-planner',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      message: 'ready',
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: 'Save settings',
        summary: 'Click the save button.',
        risks: [],
        steps: [{ action: 'click', title: 'Save', instruction: 'Click save', selector: '#save' }],
      },
      modelName: 'planner-model',
      metrics: { durationMs: 1, modelTimeCostMs: 1, calls: 1, promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedInputTokens: 0, byIntent: {}, byModel: {} },
    });
    const lazyModelResolver = {
      resolveMidsceneConfig: vi.fn().mockRejectedValue(new Error('midscene must not be resolved')),
      resolveAgentProviderConfig: vi.fn(async (role: string) => {
        if (role !== 'planner') throw new Error(`${role} must not be resolved`);
        return {
          config: {
            modelBaseUrl: 'https://planner.example.test/v1',
            modelApiKey: 'planner-only-secret',
            modelName: 'planner-model',
            modelFamily: 'openai',
            temperature: '0.2',
          },
        };
      }),
    };
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn().mockResolvedValue(currentState),
        input: vi.fn(),
        capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );

    await runtime.sendChatCommand({
      mode: 'ai',
      prompt: 'Save settings',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'en-US',
        headless: true,
      },
      modelConfigResolver: lazyModelResolver,
    } as never);

    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ modelApiKey: 'planner-only-secret' }),
    }));
    expect(lazyModelResolver.resolveAgentProviderConfig).toHaveBeenCalledTimes(1);
    expect(lazyModelResolver.resolveAgentProviderConfig).toHaveBeenCalledWith('planner');
    expect(lazyModelResolver.resolveMidsceneConfig).not.toHaveBeenCalled();
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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

  it('executes a direct aiQuery target without requiring a Planner plan', async () => {
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
    );

    const response = await runtime.sendChatCommand({
      mode: 'aiQuery',
      prompt: '提取当前订单总额',
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

    expect(semanticExtract).toHaveBeenCalledWith({
      target: '当前订单总额',
      prompt: '提取当前订单总额',
      config: midsceneConfig,
    });
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.steps[1]?.action).toBe('extract');
    expect(response.assistantEntry.text).toContain('提取结果：aiQuery 提取结果：{"orderTotal":128,"currency":"CNY"}');
  });

  it('keeps a direct targeted aiQuery neutral until semantic extraction is configured', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticExtract = vi.fn();
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
    );

    const response = await runtime.sendChatCommand({
      mode: 'aiQuery',
      prompt: '提取当前订单总额',
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

    expect(semanticExtract).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.events.find((event) => event.type === 'agent:assertion-result')?.verification?.summary).toContain(
      '等待 Midscene 语义提取执行',
    );
  });

  it('executes a direct selector select command without requiring a Planner plan', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const select = vi.fn().mockResolvedValue(currentState);
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      select,
      capture: vi.fn(async () => currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '在 #status 中选择 success',
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

    expect(select).toHaveBeenCalledWith({ selector: '#status', value: 'success' });
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.steps[1]?.action).toBe('select');
  });

  it('executes direct conditional wait and selector scroll commands without a Planner plan', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const waitForDataReady = vi.fn().mockResolvedValue(currentState);
    const scroll = vi.fn().mockResolvedValue(currentState);
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      waitForDataReady,
      scroll,
      capture: vi.fn(async () => currentState),
      getState: () => currentState,
    });
    const request = (prompt: string) => runtime.sendChatCommand({
      mode: 'ai',
      prompt,
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

    const waitResponse = await request('等待 #orders-table 数据加载完成 2 秒');
    const scrollResponse = await request('滚动到 #filters');

    expect(waitForDataReady).toHaveBeenCalledWith({ selector: '#orders-table', timeoutMs: 2000 });
    expect(waitResponse.agentRun.status).toBe('passed');
    expect(waitResponse.agentRun.plan.steps[1]?.action).toBe('wait');
    expect(scroll).toHaveBeenCalledWith({ selector: '#filters' });
    expect(scrollResponse.agentRun.status).toBe('passed');
    expect(scrollResponse.agentRun.plan.steps[1]?.action).toBe('scroll');
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      verifier: {
        ...defaultResolvedAgentModelConfig.verifier,
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
    const reporterSecret = 'reporter-secret';
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
      failureReason: `图表未刷新完成。provider echoed ${reporterSecret}`,
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
      summary: `Reporter 判断失败集中在图表刷新未完成。provider echoed ${reporterSecret}`,
      evidenceSummary: `断言失败证据：页面仍显示加载中。provider echoed ${reporterSecret}`,
      failureAnalysis: `图表接口或前端渲染可能未在等待窗口内完成。provider echoed ${reporterSecret}`,
      suggestedFixes: [`增加图表稳定等待 ${reporterSecret}`, '检查 /api/chart 响应耗时'],
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      reporter: {
        ...defaultResolvedAgentModelConfig.reporter,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://reporter.example.test/v1',
        modelApiKey: reporterSecret,
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
          modelApiKey: reporterSecret,
          modelName: 'reporter-large',
        }),
        run: expect.objectContaining({
          status: 'failed',
          failureReason: expect.stringContaining('[REDACTED_MODEL_SECRET]'),
        }),
      }),
    );
    expect(JSON.stringify(report.mock.calls[0]?.[0]?.run)).not.toContain(reporterSecret);
    expect(response.agentRun.status).toBe('failed');
    expect(response.agentRun.summary).toContain('Reporter 判断失败集中在图表刷新未完成。');
    expect(response.agentRun.summary).toContain('[REDACTED_MODEL_SECRET]');
    expect(response.agentRun.reporter).toEqual(expect.objectContaining({
      summary: expect.stringContaining('[REDACTED_MODEL_SECRET]'),
      evidenceSummary: expect.stringContaining('[REDACTED_MODEL_SECRET]'),
      failureAnalysis: expect.stringContaining('[REDACTED_MODEL_SECRET]'),
      suggestedFixes: [expect.stringContaining('[REDACTED_MODEL_SECRET]'), '检查 /api/chart 响应耗时'],
      recoveryPlan: expect.objectContaining({ strategy: 'observe', reason: expect.stringContaining('[REDACTED_MODEL_SECRET]') }),
      modelName: 'reporter-large',
    }));
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
    const reporterMarkdown = writeReporterReport.mock.calls[0]?.[0]?.markdown ?? '';
    expect(reporterMarkdown).toContain('[REDACTED_MODEL_SECRET]');
    expect(JSON.stringify({ response, reporterMarkdown })).not.toContain(reporterSecret);
    expect(response.agentRun.metrics).toEqual(expect.objectContaining({ calls: 2, totalTokens: 56 }));
    expect(JSON.stringify(response.agentRun)).not.toContain(reporterSecret);
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
    const input = vi.fn(async () => currentState);
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
              action: 'input',
              title: '填写账号',
              instruction: '在账号输入框输入 qa-user',
              selector: '#account',
              value: 'qa-user',
            },
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
              action: 'input',
              title: '填写账号',
              instruction: '在账号输入框输入 qa-user',
              selector: '#account',
              value: 'qa-user',
            },
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
        input,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
        completedSteps: [
          expect.objectContaining({
            stepIndex: 1,
            action: 'input',
            title: '填写账号',
            currentUrl: 'https://example.test/login',
          }),
        ],
      }),
    );
    expect(input).toHaveBeenCalledOnce();
    expect(input).toHaveBeenCalledWith({ selector: '#account', value: 'qa-user' });
    expect(clickOrder).toEqual(['#missing-login-button', '#login-button']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.title).toBe('登录工作台修正版');
    expect(response.agentRun.plan.steps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: '填写账号' })]),
    );
    expect(response.agentRun.plan.risks).toContain('已跳过 1 个与已完成步骤完全相同的动作。');
    expect(response.agentRun.events.find((event) => event.type === 'agent:plan-revised')?.planRevision).toEqual(
      expect.objectContaining({ completedStepCount: 1 }),
    );
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
      screenshotPath: '/tmp/navigation-failed.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const navigateOrder: string[] = [];
    const navigate = vi.fn(async ({ url }: { url: string }) => {
      navigateOrder.push(url);
      if (url === 'https://broken.example.test/dashboard') {
        throw new Error('Navigation failed: net::ERR_NAME_NOT_RESOLVED');
      }
      currentState = {
        ...currentState,
        currentUrl: url,
        pageTitle: 'Dashboard',
        screenshotPath: '/tmp/navigation-recovered.png',
      };
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const revision = response.agentRun.events.find((event) => event.type === 'agent:plan-revised');
    const historicalFailure = response.agentRun.events.find(
      (event) => event.type === 'agent:step-failed' && event.stepId === revision?.stepId,
    );
    const historicalObservation = response.agentRun.events.find(
      (event) => event.type === 'agent:observation-created' && event.stepId === revision?.stepId,
    );
    expect(revision?.planRevision).toEqual(
      expect.objectContaining({
        cycle: 1,
        failureCategory: 'navigation',
        recoveryStrategy: 'replanNavigation',
      }),
    );
    expect(historicalFailure?.message).toContain('ERR_NAME_NOT_RESOLVED');
    expect(historicalObservation?.observation?.screenshotPath).toBe('/tmp/navigation-failed.png');
    expect(response.agentRun.artifacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/tmp/navigation-failed.png' })]),
    );
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
        throw new Error('browser entered an indeterminate runtime error state');
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const input = vi.fn(async () => currentState);
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
              action: 'input',
              title: '填写账号',
              instruction: '在账号输入框输入 qa-user',
              selector: '#account',
              value: 'qa-user',
            },
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
              action: 'input',
              title: '填写账号',
              instruction: '在账号输入框输入 qa-user',
              selector: '#account',
              value: 'qa-user',
            },
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
              action: 'input',
              title: '填写账号',
              instruction: '在账号输入框输入 qa-user',
              selector: '#account',
              value: 'qa-user',
            },
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
        input,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    expect(input).toHaveBeenCalledOnce();
    expect(createPlan.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        completedSteps: [expect.objectContaining({ stepIndex: 1, action: 'input', selector: '#account' })],
      }),
    );
    expect(createPlan.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        completedSteps: [expect.objectContaining({ stepIndex: 1, action: 'input', selector: '#account' })],
      }),
    );
    expect(clickOrder).toEqual([
      '#missing-login-button',
      '#still-missing-login-button',
      '#login-button',
    ]);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.title).toBe('登录工作台修正版 B');
    expect(response.agentRun.plan.steps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'input', selector: '#account' })]),
    );
    const revisions = response.agentRun.events.filter((event) => event.type === 'agent:plan-revised');
    expect(revisions.map((event) => event.planRevision?.cycle)).toEqual([1, 2]);
    expect(new Set(revisions.map((event) => event.stepId)).size).toBe(2);
    expect(response.agentRun.events.filter((event) => event.type === 'agent:step-failed')).toHaveLength(2);
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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

  it('waits for network idle before retrying a transient Planner scroll runtime failure', async () => {
    let currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/start',
      pageTitle: 'Start',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const actionOrder: string[] = [];
    const scroll = vi.fn(async () => {
      actionOrder.push('scroll');
      if (scroll.mock.calls.length === 1) {
        throw new Error('browser runtime error while revealing the next section');
      }
      return currentState;
    });
    const waitForNetworkIdle = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForNetworkIdle:${timeoutMs}`);
      return currentState;
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '查看下一段内容',
        summary: '滚动到下一段内容。',
        risks: [],
        steps: [
          {
            action: 'scroll',
            title: '查看下一段内容',
            instruction: '向下滚动当前页面',
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
        scroll,
        waitForNetworkIdle,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '查看下一段内容',
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
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(waitForNetworkIdle).toHaveBeenCalledWith({ timeoutMs: 1500 });
    expect(actionOrder).toEqual([
      'scroll',
      'waitForNetworkIdle:1500',
      'scroll',
    ]);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:dynamic-wait',
          dynamicWait: expect.objectContaining({ strategy: 'networkIdle', timeoutMs: 1500 }),
        }),
        expect.objectContaining({
          type: 'agent:step-retried',
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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

  it('waits for an explicit API response before retrying a network-failed Planner action', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-orders',
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
        throw new Error('HTTP 502 response while loading order details');
      }
      return currentState;
    });
    const waitForResponse = vi.fn(async ({ urlPattern, timeoutMs }: { urlPattern: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForResponse:${urlPattern}:${timeoutMs}`);
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
        title: '打开订单详情',
        summary: '订单接口返回后打开详情。',
        risks: [],
        steps: [
          {
            action: 'click',
            title: '打开订单详情',
            instruction: '等待订单接口 /api/orders 返回后，点击订单详情按钮',
            target: '/api/orders',
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
        waitForResponse,
        waitForDataReady,
        waitForNetworkIdle,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '订单接口返回后打开订单详情',
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
    expect(waitForResponse).toHaveBeenCalledWith({ urlPattern: '/api/orders', timeoutMs: 1500 });
    expect(waitForDataReady).not.toHaveBeenCalled();
    expect(waitForNetworkIdle).not.toHaveBeenCalled();
    expect(actionOrder).toEqual([
      'click:#order-detail',
      'waitForResponse:/api/orders:1500',
      'click:#order-detail',
    ]);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:dynamic-wait',
          dynamicWait: expect.objectContaining({
            strategy: 'response',
            urlPattern: '/api/orders',
            timeoutMs: 1500,
          }),
        }),
        expect.objectContaining({
          type: 'agent:step-retried',
          retryAttempt: expect.objectContaining({
            failureCategory: 'network',
            recoveryStrategy: 'waitForReadiness',
          }),
        }),
      ]),
    );
    expect(response.agentRun.events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'agent:plan-revised' })]));
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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

  it('waits for table data instead of a generic response when network recovery has no stable endpoint', async () => {
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
        throw new Error('Network request failed while waiting for orders table data');
      }
      return currentState;
    });
    const waitForDataReady = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      actionOrder.push(`waitForDataReady:${timeoutMs}`);
      return currentState;
    });
    const waitForResponse = vi.fn(async ({ urlPattern, timeoutMs }: { urlPattern: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForResponse:${urlPattern}:${timeoutMs}`);
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
        waitForResponse,
        waitForNetworkIdle,
        capture: vi.fn(async () => currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    expect(waitForResponse).not.toHaveBeenCalled();
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

  it('keeps a failed response wait target before replanning instead of retrying a stale action', async () => {
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
        throw new Error('Network request failed while loading order details');
    });
    const waitForResponse = vi.fn(async ({ urlPattern, timeoutMs }: { urlPattern: string; timeoutMs?: number }) => {
      actionOrder.push(`waitForResponse:${urlPattern}:${timeoutMs}`);
      throw new Error('orders API is still unavailable');
    });
    const createPlan = vi
      .fn()
      .mockResolvedValueOnce({
        plan: {
          title: '查看订单详情',
        summary: '等待订单接口返回后打开详情。',
          risks: [],
          steps: [
            {
              action: 'click',
              title: '打开订单详情',
            instruction: '等待订单接口 /api/orders 返回后，点击订单详情按钮',
            target: '/api/orders',
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
      })
      .mockResolvedValueOnce({
        plan: {
          title: '订单页恢复观察',
          summary: '保留当前页面状态并重新观察。',
          risks: [],
          steps: [{ action: 'observe', title: '观察订单页', instruction: '观察当前订单页状态' }],
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
        waitForResponse,
        capture: vi.fn(async () => currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '订单页仍在加载。',
          domSummary: '订单表格尚未就绪。',
          interactiveElements: ['button "订单详情" #observed-order-detail'],
        }),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '等待订单接口返回后打开详情',
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
    expect(actionOrder).toEqual(['click:#order-detail', 'waitForResponse:/api/orders:1500']);
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:dynamic-wait',
          status: 'failed',
          message: expect.stringContaining('等待接口响应 /api/orders 1500ms'),
          dynamicWait: expect.objectContaining({
            strategy: 'response',
            urlPattern: '/api/orders',
            timeoutMs: 1500,
            failureReason: 'orders API is still unavailable',
          }),
        }),
        expect.objectContaining({ type: 'agent:plan-revised' }),
      ]),
    );
    expect(response.agentRun.events.some((event) => event.type === 'agent:step-retried')).toBe(false);
    expect(response.agentRun.events.some((event) => event.type === 'agent:selector-fallback')).toBe(false);
    expect(response.agentRun.metrics).toEqual(
      expect.objectContaining({ dynamicWaitAttempts: 1, replanningCycles: 1 }),
    );
    expect(response.agentRun.metrics?.retryAttempts ?? 0).toBe(0);
    expect(response.agentRun.metrics?.selectorFallbackAttempts ?? 0).toBe(0);
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
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
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.metrics).toEqual(
      expect.objectContaining({ durationMs: 360, calls: 2, totalTokens: 150 }),
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
        click: vi.fn().mockRejectedValue(new Error('模型服务不可用: test-key')),
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
    expect(JSON.stringify(response)).not.toContain('test-key');
    expect(JSON.stringify(response)).toContain('[REDACTED_MODEL_SECRET]');
  });

  it('redacts lazily resolved Midscene secrets from semantic runtime errors', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-lazy-midscene-error',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    const lazySecret = 'lazy-midscene-secret';
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
        click: vi.fn().mockRejectedValue(new Error(`模型服务不可用: ${lazySecret}`)),
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
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
      modelConfigResolver: {
        resolveMidsceneConfig: vi.fn().mockResolvedValue({ ...midsceneConfig, modelApiKey: lazySecret }),
        resolveAgentProviderConfig: vi.fn().mockResolvedValue({}),
      },
    });

    expect(JSON.stringify(response)).not.toContain(lazySecret);
    expect(JSON.stringify(response)).toContain('[REDACTED_MODEL_SECRET]');
  });

  it('cancels lazy Midscene resolution before semantic execution begins', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-lazy-midscene-cancelled',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    let resolveConfig: (config: typeof midsceneConfig) => void = () => undefined;
    let signalResolverStarted: () => void = () => undefined;
    const resolverStarted = new Promise<void>((resolve) => {
      signalResolverStarted = resolve;
    });
    const resolveMidsceneConfig = vi.fn(() => new Promise<typeof midsceneConfig>((resolve) => {
      resolveConfig = resolve;
      signalResolverStarted();
    }));
    const semanticClick = vi.fn().mockResolvedValue({ status: 'passed', message: '不应执行。' });
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
      { click: semanticClick, input: vi.fn(), assert: vi.fn() },
    );
    const controller = new AbortController();
    const pending = runtime.sendChatCommand({
      mode: 'ai',
      prompt: '点击登录按钮',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      cancellationSignal: controller.signal,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
      modelConfigResolver: {
        resolveMidsceneConfig,
        resolveAgentProviderConfig: vi.fn().mockResolvedValue({}),
      },
    });

    await resolverStarted;
    controller.abort();
    resolveConfig(midsceneConfig);

    await expect(pending).rejects.toThrow('用户已取消运行。');
    expect(semanticClick).not.toHaveBeenCalled();
  });

  it.each([
    ['click', 'ai', '点击登录按钮'],
    ['input', 'ai', '在用户名输入 chris'],
    ['select', 'ai', '在报表周期中选择近 30 天'],
    ['extract', 'aiQuery', '提取当前订单总额'],
    ['assert', 'aiAssert', '验证页面已经显示登录成功提示'],
  ] as const)('cancels lazy Midscene resolution before %s semantic execution begins', async (path, mode, prompt) => {
    const currentState: BrowserSessionState = {
      id: `session-lazy-midscene-${path}-cancelled`,
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    let resolveConfig: (config: typeof midsceneConfig) => void = () => undefined;
    let signalResolverStarted: () => void = () => undefined;
    const resolverStarted = new Promise<void>((resolve) => {
      signalResolverStarted = resolve;
    });
    const resolveMidsceneConfig = vi.fn(() => new Promise<typeof midsceneConfig>((resolve) => {
      resolveConfig = resolve;
      signalResolverStarted();
    }));
    const semanticAction = vi.fn().mockResolvedValue({ status: 'passed', message: '不应执行。' });
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
        click: path === 'click' ? semanticAction : vi.fn(),
        input: path === 'input' ? semanticAction : vi.fn(),
        select: path === 'select' ? semanticAction : vi.fn(),
        extract: path === 'extract' ? semanticAction : vi.fn(),
        assert: path === 'assert' ? semanticAction : vi.fn(),
      },
    );
    const controller = new AbortController();
    const pending = runtime.sendChatCommand({
      mode,
      prompt,
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      cancellationSignal: controller.signal,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
      modelConfigResolver: {
        resolveMidsceneConfig,
        resolveAgentProviderConfig: vi.fn().mockResolvedValue({}),
      },
    });

    await resolverStarted;
    controller.abort();
    resolveConfig(midsceneConfig);

    await expect(pending).rejects.toThrow('用户已取消运行。');
    expect(semanticAction).not.toHaveBeenCalled();
  });

  it.each([
    ['click', 'ai', '点击登录按钮'],
    ['input', 'ai', '在用户名输入 chris'],
    ['select', 'ai', '在报表周期中选择近 30 天'],
    ['extract', 'aiQuery', '提取当前订单总额'],
    ['assert', 'aiAssert', '验证页面已经显示登录成功提示'],
  ] as const)('redacts lazily resolved Midscene secrets from %s semantic action errors', async (path, mode, prompt) => {
    const currentState: BrowserSessionState = {
      id: `session-lazy-midscene-${path}-error`,
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    const lazySecret = `lazy-midscene-${path}-secret`;
    const semanticAction = vi.fn().mockRejectedValue(new Error(`模型服务不可用: ${lazySecret}`));
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
        click: path === 'click' ? semanticAction : vi.fn(),
        input: path === 'input' ? semanticAction : vi.fn(),
        select: path === 'select' ? semanticAction : vi.fn(),
        extract: path === 'extract' ? semanticAction : vi.fn(),
        assert: path === 'assert' ? semanticAction : vi.fn(),
      },
    );

    const response = await runtime.sendChatCommand({
      mode,
      prompt,
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
      modelConfigResolver: {
        resolveMidsceneConfig: vi.fn().mockResolvedValue({ ...midsceneConfig, modelApiKey: lazySecret }),
        resolveAgentProviderConfig: vi.fn().mockResolvedValue({}),
      },
    });

    expect(JSON.stringify(response)).not.toContain(lazySecret);
    expect(JSON.stringify(response)).toContain('[REDACTED_MODEL_SECRET]');
  });

  it.each([
    ['click', 'ai', '点击登录按钮', '等待 Midscene 语义定位执行'],
    ['input', 'ai', '在用户名输入 chris', '等待 Midscene 语义定位执行'],
    ['select', 'ai', '在报表周期中选择近 30 天', '等待 Midscene 语义选择执行'],
    ['extract', 'aiQuery', '提取当前订单总额', '等待 Midscene 语义提取执行'],
    ['assert', 'aiAssert', '验证页面已经显示登录成功提示', '等待 Verifier 或 Midscene 根据页面上下文执行判断'],
  ] as const)('keeps %s semantic actions pending without resolving Midscene config when runtime is absent', async (
    _path,
    mode,
    prompt,
    pendingMessage,
  ) => {
    const currentState: BrowserSessionState = {
      id: `session-no-runtime-${mode}`,
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    const resolveMidsceneConfig = vi.fn().mockRejectedValue(new Error('Midscene config must not be resolved'));
    const resolveAgentProviderConfig = vi.fn().mockRejectedValue(new Error('Agent provider must not be resolved'));
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      select: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      getState: () => currentState,
    });

    const response = await runtime.sendChatCommand({
      mode,
      prompt,
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
      modelConfigResolver: {
        resolveMidsceneConfig,
        resolveAgentProviderConfig,
      },
    });

    expect(resolveMidsceneConfig).not.toHaveBeenCalled();
    expect(resolveAgentProviderConfig).not.toHaveBeenCalled();
    expect(response.agentRun?.status).toBe('neutral');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      pendingMessage,
    );
  });

  it('cancels a semantic select while capturing its post-action browser state', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-semantic-select-capture-cancelled',
      status: 'ready',
      currentUrl: 'https://example.test/reports',
      pageTitle: 'Reports',
      screenshotPath: '/tmp/reports.png',
      message: 'ready',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    let notifyCaptureStarted: () => void = () => undefined;
    const captureStarted = new Promise<void>((resolve) => {
      notifyCaptureStarted = resolve;
    });
    const capture = vi.fn<() => Promise<BrowserSessionState>>()
      .mockResolvedValueOnce(currentState)
      .mockImplementationOnce(() => {
        notifyCaptureStarted();
        return new Promise<BrowserSessionState>(() => undefined);
      });
    const semanticSelect = vi.fn().mockResolvedValue({ status: 'passed', message: '已选择近 30 天。' });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture,
        getState: () => currentState,
      },
      { click: vi.fn(), input: vi.fn(), select: semanticSelect, assert: vi.fn() },
    );
    const controller = new AbortController();
    const pending = runtime.sendChatCommand({
      mode: 'ai',
      prompt: '在报表周期中选择近 30 天',
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: true,
      cancellationSignal: controller.signal,
      midsceneConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    });

    await captureStarted;
    controller.abort();

    await expect(pending).rejects.toThrow('用户已取消运行。');
    expect(semanticSelect).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledTimes(2);
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
          evidenceCompleteness: 'complete',
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
            evidenceCompleteness: 'complete',
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
            evidenceCompleteness: 'complete',
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

  it('limits named table assertions to the requested table on multi-table pages', async () => {
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
        textSummary: '订单与退款统计',
        domSummary: '页面文本约 7 字符；发现 0 个关键可交互元素、2 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
        tables: [
          {
            index: 1,
            evidenceCompleteness: 'complete',
            caption: '订单列表',
            rowCount: 2,
            columnCount: 2,
            headers: ['订单号', '状态'],
            sampleRows: [['A-100', '成功']],
          },
          {
            index: 2,
            evidenceCompleteness: 'complete',
            caption: '退款列表',
            rowCount: 1,
            columnCount: 2,
            headers: ['退款单号', '状态'],
            sampleRows: [['R-100', '处理中']],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });
    const request = (prompt: string) =>
      runtime.sendChatCommand({
        mode: 'aiAssert',
        prompt,
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

    const passedResponse = await request('断言表格「退款列表」行数为 1');
    const failedResponse = await request('断言表格「退款列表」行数为 2');

    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toBe(
      '退款列表：1 行',
    );
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格行数不等于「2」');
    expect(failedVerification?.evidence).toBe('退款列表：1 行');
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
            aggregates: [{ label: '成交量', value: '200' }],
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
            evidenceCompleteness: 'complete',
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            aggregates: [{ label: '成交量', value: '200' }],
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
            evidenceCompleteness: 'complete',
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            aggregates: [{ label: '成交量', value: '200' }],
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
    expect(passedVerification?.evidence).toContain('订单列表：成交量 合计 200');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格列合计不等于「180」');
    expect(failedVerification?.evidence).toContain('订单列表：成交量 合计 200');
  });

  it('evaluates structured table filter, pagination, and footer aggregate assertions', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders?page=2',
      pageTitle: 'Orders',
      screenshotPath: '/tmp/orders.png',
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
        textSummary: '成功订单',
        domSummary: '页面文本约 4 字符；发现 0 个关键可交互元素、1 个表格、0 个图表。',
        interactiveElements: [],
        consoleMessages: [],
        networkHints: [],
      tables: [
          {
            index: 1,
            evidenceCompleteness: 'complete',
            caption: '订单列表',
            rowCount: 10,
            columnCount: 3,
            headers: ['订单号', '成交量', '状态'],
            filters: [{ label: '状态', value: '成功' }],
            pagination: { currentPage: 2, totalPages: 4, totalItems: 36, pageSize: 10 },
            aggregates: [{ label: '成交量', value: '200' }],
            sampleRows: [
              ['A-100', '120', '成功'],
              ['A-101', '80', '成功'],
            ],
          },
        ],
        charts: [],
      }),
      getState: () => currentState,
    });
    const request = (prompt: string) =>
      runtime.sendChatCommand({
        mode: 'aiAssert',
        prompt,
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

    const filterResponse = await request('断言表格筛选 状态 为 成功');
    const pageResponse = await request('断言表格当前页为 2');
    const totalPagesResponse = await request('断言表格总页数为 4');
    const totalItemsResponse = await request('断言表格总条数为 36');
    const pageSizeResponse = await request('断言表格每页 10 条');
    const aggregateResponse = await request('断言表格聚合 成交量 为 200');
    const failedResponse = await request('断言表格当前页为 3');

    expect(filterResponse.agentRun?.status).toBe('passed');
    expect(filterResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '订单列表：状态 = 成功',
    );
    expect(pageResponse.agentRun?.status).toBe('passed');
    expect(totalPagesResponse.agentRun?.status).toBe('passed');
    expect(totalItemsResponse.agentRun?.status).toBe('passed');
    expect(pageSizeResponse.agentRun?.status).toBe('passed');
    expect(aggregateResponse.agentRun?.status).toBe('passed');
    expect(aggregateResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '订单列表：成交量 = 200',
    );
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('表格当前页不等于「3」');
    expect(failedVerification?.evidence).toContain('订单列表：2');
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
            evidenceCompleteness: 'complete',
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

  it('does not infer table sort order from sampled column values when no sort state is exposed', async () => {
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
            evidenceCompleteness: 'complete',
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
    expect(passedResponse.agentRun?.status).toBe('neutral');
    expect(passedVerification?.summary).toContain('缺少显式排序状态');
    expect(failedResponse.agentRun?.status).toBe('neutral');
    expect(failedVerification?.summary).toContain('缺少显式排序状态');
  });

  it('evaluates explicit DOM selector existence, visibility, and text assertions', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      screenshotPath: '/tmp/dashboard.png',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const inspectDom = vi
      .fn()
      .mockResolvedValueOnce({ selector: '#summary', found: true, visible: true, text: '登录成功' })
      .mockResolvedValueOnce({ selector: '#summary', found: true, visible: true, text: '登录成功' })
      .mockResolvedValueOnce({ selector: '#save', found: true, visible: false, text: '保存' })
      .mockResolvedValueOnce({
        selector: '#active-tab',
        found: true,
        visible: true,
        text: '订单',
        attribute: { name: 'aria-selected', value: 'true' },
      });
    const runtime = new StudioRuntime(vi.fn(), {
      start: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn<() => Promise<BrowserSessionState>>().mockResolvedValue(currentState),
      inspectDom,
      getState: () => currentState,
    });
    const request = (prompt: string) =>
      runtime.sendChatCommand({
        mode: 'aiAssert',
        prompt,
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

    const existsResponse = await request('断言 DOM #summary 存在');
    const textResponse = await request('断言 DOM #summary 文本包含 登录成功');
    const hiddenResponse = await request('断言 DOM #save 可见');
    const attributeResponse = await request('断言 DOM #active-tab 属性 aria-selected 为 true');

    expect(inspectDom).toHaveBeenNthCalledWith(1, '#summary');
    expect(inspectDom).toHaveBeenNthCalledWith(2, '#summary');
    expect(inspectDom).toHaveBeenNthCalledWith(3, '#save');
    expect(inspectDom).toHaveBeenNthCalledWith(4, '#active-tab', 'aria-selected');
    expect(existsResponse.agentRun?.status).toBe('passed');
    expect(existsResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '#summary：已找到且可见',
    );
    expect(textResponse.agentRun?.status).toBe('passed');
    expect(attributeResponse.agentRun?.status).toBe('passed');
    expect(attributeResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '#active-tab：已找到且可见；文本：订单；属性 aria-selected：true',
    );
    const hiddenVerification = hiddenResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(hiddenResponse.agentRun?.status).toBe('failed');
    expect(hiddenVerification?.failureReason).toContain('DOM selector 不可见「#save」');
    expect(hiddenVerification?.evidence).toContain('#save：已找到但不可见；文本：保存');
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
            evidenceCompleteness: 'complete',
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

  it('limits named chart assertions to the requested chart on multi-chart pages', async () => {
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
          { index: 1, title: '成交趋势', kind: 'canvas', width: 640, height: 240, legends: ['买入', '卖出'] },
          { index: 2, title: '资产分布', kind: 'svg', width: 320, height: 180, legends: ['现货', '合约'] },
        ],
      }),
      getState: () => currentState,
    });
    const request = (prompt: string) =>
      runtime.sendChatCommand({
        mode: 'aiAssert',
        prompt,
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

    const passedResponse = await request('断言图表「资产分布」图例包含 合约');
    const failedResponse = await request('断言图表「资产分布」图例包含 买入');

    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toBe(
      '图表图例：现货 / 合约',
    );
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('图表图例不包含「买入」');
    expect(failedVerification?.evidence).toBe('图表图例：现货 / 合约');
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
            evidenceCompleteness: 'complete',
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

  it('evaluates structured chart tooltip, data region, and trend assertions', async () => {
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
            evidenceCompleteness: 'complete',
            title: '成交趋势',
            kind: 'canvas',
            width: 640,
            height: 240,
            rendered: true,
            legends: ['买入', '卖出'],
            tooltip: '二月成交量：180',
            dataPoints: [
              { label: '一月', value: 120 },
              { label: '二月', value: 180 },
            ],
            trend: 'rising',
          },
        ],
      }),
      getState: () => currentState,
    });
    const request = (prompt: string) =>
      runtime.sendChatCommand({
        mode: 'aiAssert',
        prompt,
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

    const tooltipResponse = await request('断言图表提示包含 二月');
    const dataResponse = await request('断言图表数据区域包含 180');
    const pointResponse = await request('断言图表数据点 二月 为 180');
    const trendResponse = await request('断言图表趋势上升');
    const failedResponse = await request('断言图表趋势下降');
    const failedPointResponse = await request('断言图表数据点 二月 为 120');

    expect(tooltipResponse.agentRun?.status).toBe('passed');
    expect(tooltipResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '成交趋势：二月成交量：180',
    );
    expect(dataResponse.agentRun?.status).toBe('passed');
    expect(dataResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '一月 = 120 / 二月 = 180',
    );
    expect(pointResponse.agentRun?.status).toBe('passed');
    expect(pointResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.summary).toContain(
      '图表数据点「二月 = 180」已通过',
    );
    expect(trendResponse.agentRun?.status).toBe('passed');
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('图表趋势不匹配「下降」');
    expect(failedVerification?.evidence).toContain('成交趋势：上升');
    const failedPointVerification = failedPointResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')
      ?.verification;
    expect(failedPointResponse.agentRun?.status).toBe('failed');
    expect(failedPointVerification?.failureReason).toContain('图表数据点「二月」不等于「120」');
    expect(failedPointVerification?.evidence).toContain('二月 = 180');
  });

  it('evaluates chart data points by series, label, and value together', async () => {
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
        charts: [{
          index: 1,
          evidenceCompleteness: 'complete',
          title: '成交趋势',
          kind: 'canvas',
          width: 640,
          height: 240,
          dataPoints: [
            { series: '买入', label: '二月', value: 180 },
            { series: '卖出', label: '二月', value: 120 },
          ],
          seriesTrends: [
            { series: '买入', trend: 'rising' },
            { series: '卖出', trend: 'falling' },
          ],
        }],
      }),
      getState: () => currentState,
    });
    const request = (prompt: string) => runtime.sendChatCommand({
      mode: 'aiAssert',
      prompt,
      targetEnvironment: 'staging',
      deepThink: true,
      deepLocate: false,
      runtimeProfile: { browser: 'chromium', baseUrl: 'https://example.test', viewport: 'desktop', locale: 'zh-CN', headless: false },
    });

    const passedResponse = await request('断言图表「成交趋势」系列 买入 数据点 二月 为 180');
    const failedResponse = await request('断言图表系列 卖出 数据点 二月 为 180');
    const seriesResponse = await request('断言图表「成交趋势」系列包含 买入');
    const missingSeriesResponse = await request('断言图表系列包含 持仓');
    const dataSeriesResponse = await request('断言图表数据区域包含 买入');
    const trendResponse = await request('断言图表「成交趋势」系列 买入 趋势上升');
    const failedTrendResponse = await request('断言图表系列 买入 趋势下降');
    const passedVerification = passedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
    const failedVerification = failedResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;

    expect(passedResponse.agentRun?.status).toBe('passed');
    expect(passedVerification?.summary).toContain('图表系列数据点「买入 / 二月 = 180」已通过');
    expect(passedVerification?.evidence).toContain('买入 / 二月 = 180 / 卖出 / 二月 = 120');
    expect(failedResponse.agentRun?.status).toBe('failed');
    expect(failedVerification?.failureReason).toContain('图表系列「卖出」数据点「二月」不等于「180」');
    expect(seriesResponse.agentRun?.status).toBe('passed');
    expect(seriesResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '成交趋势：买入 / 卖出',
    );
    expect(missingSeriesResponse.agentRun?.status).toBe('failed');
    expect(missingSeriesResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.failureReason).toContain(
      '图表系列不包含「持仓」',
    );
    expect(dataSeriesResponse.agentRun?.status).toBe('passed');
    expect(trendResponse.agentRun?.status).toBe('passed');
    expect(trendResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.evidence).toContain(
      '买入 上升 / 卖出 下降',
    );
    expect(failedTrendResponse.agentRun?.status).toBe('failed');
    expect(failedTrendResponse.agentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification?.failureReason).toContain(
      '图表系列「买入」趋势不匹配「下降」',
    );
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
    const beginTrace = vi.fn().mockResolvedValue(true);
    const finishTrace = vi.fn().mockResolvedValue({
      id: 'trace-workflow',
      type: 'trace' as const,
      label: 'Playwright Trace',
      path: '/tmp/workflow-trace.zip',
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
        beginTrace,
        finishTrace,
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
      documentId: 'doc-login',
      midsceneConfig,
      browserSession: currentState,
    });

    expect(navigate).toHaveBeenCalledWith({ url: 'https://example.test/login' });
    expect(semanticClick).toHaveBeenCalledTimes(1);
    expect(semanticAssert).toHaveBeenCalledTimes(1);
    expect(response.agentRun.intent.source).toBe('workflow');
    expect(response.agentRun.intent.documentId).toBe('doc-login');
    expect(response.detail.documentId).toBe('doc-login');
    expect(response.agentRun.plan.steps.map((step) => step.action)).toEqual(['click', 'assert']);
    expect(response.agentRun.status).toBe('passed');
    expect(beginTrace).toHaveBeenCalledWith(response.runId);
    expect(finishTrace).toHaveBeenCalledOnce();
    expect(response.agentRun.artifacts).toContainEqual(
      expect.objectContaining({ type: 'trace', path: '/tmp/workflow-trace.zip' }),
    );
    expect(response.detail.agentRun).toBe(response.agentRun);
    expect(response.detail.steps).toHaveLength(2);
    expect(emitRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'complete', status: 'passed', detail: response.detail }),
    );
  });

  it('resolves Midscene config lazily for semantic workflow actions', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-workflow-lazy-midscene',
      status: 'ready',
      currentUrl: 'https://example.test/login',
      pageTitle: 'Login',
      screenshotPath: '/tmp/login.png',
      message: 'ready',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    const lazyMidsceneConfig = { ...midsceneConfig, modelApiKey: 'workflow-lazy-secret' };
    const resolveMidsceneConfig = vi.fn().mockResolvedValue(lazyMidsceneConfig);
    const semanticClick = vi.fn().mockResolvedValue({
      status: 'passed',
      message: 'Midscene 已点击登录按钮。',
    });
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
      { click: semanticClick, input: semanticInput, assert: vi.fn() },
    );

    const response = await runtime.runWorkflow({
      workflow: {
        id: 'workflow-lazy-midscene',
        kind: 'scenario',
        name: '懒加载登录流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: currentState.currentUrl,
        notes: '',
        steps: [
          { id: 'step-lazy-click', type: 'ai', title: '点击登录', body: '点击登录按钮' },
          { id: 'step-lazy-input', type: 'ai', title: '填写用户名', body: '在用户名输入 chris' },
        ],
      },
      targetEnvironment: 'staging',
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
      modelConfigResolver: {
        resolveMidsceneConfig,
        resolveAgentProviderConfig: vi.fn().mockResolvedValue({}),
      },
    });

    expect(resolveMidsceneConfig).toHaveBeenCalledTimes(2);
    expect(semanticClick).toHaveBeenCalledWith(expect.objectContaining({
      target: '登录按钮',
      config: lazyMidsceneConfig,
    }));
    expect(semanticInput).toHaveBeenCalledWith(expect.objectContaining({
      target: '用户名',
      value: 'chris',
      config: lazyMidsceneConfig,
    }));
    expect(response.agentRun.status).toBe('passed');
  });

  it('projects unsupported workflow actions to a blocked persisted result', async () => {
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
    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'unsupportedAction' });
    expect(response.detail.steps[0]?.status).toBe('blocked');
    expect(response.detail.steps[1]?.status).toBe('skipped');
  });

  it('cancels a workflow during selector readiness without running later steps', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    let beginWait: () => void = () => undefined;
    const waitStarted = new Promise<void>((resolve) => {
      beginWait = resolve;
    });
    const waitForSelector = vi.fn(() => {
      beginWait();
      return new Promise<BrowserSessionState>(() => undefined);
    });
    const laterClick = vi.fn().mockResolvedValue(currentState);
    const start = vi.fn();
    const navigate = vi.fn();
    const emitRunEvent = vi.fn();
    const runtime = new StudioRuntime(emitRunEvent, {
      start,
      navigate,
      click: laterClick,
      input: vi.fn(),
      waitForSelector,
      capture: vi.fn().mockResolvedValue(currentState),
      getState: () => currentState,
    });
    const controller = new AbortController();
    const pending = runtime.runWorkflow({
      runId: 'workflow-cancelled',
      cancellationSignal: controller.signal,
      workflow: {
        id: 'workflow-cancelled',
        kind: 'scenario',
        name: '可取消等待流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: currentState.currentUrl,
        notes: '',
        steps: [
          { id: 'step-wait', type: 'ai', title: '等待图表', body: '等待 #sales-chart 出现' },
          { id: 'step-click', type: 'ai', title: '打开详情', body: '点击 #detail' },
        ],
      },
      targetEnvironment: 'staging',
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    });

    await waitStarted;
    controller.abort();
    const response = await pending;

    expect(waitForSelector).toHaveBeenCalledWith({ selector: '#sales-chart', timeoutMs: 1000 });
    expect(laterClick).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.status).toBe('cancelled');
    expect(response.detail.reason).toMatchObject({ code: 'userCancelled' });
    expect(response.agentRun.cancellation).toEqual(expect.objectContaining({ source: 'user', reason: 'userCancelled' }));
    expect(response.detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'step-wait', status: 'cancelled' }),
        expect.objectContaining({ stepId: 'step-click', status: 'cancelled' }),
      ]),
    );
    expect(response.agentRun.events).toContainEqual(
      expect.objectContaining({ type: 'agent:run-cancelled', status: 'neutral' }),
    );
    expect(emitRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'complete', status: 'cancelled', detail: response.detail }),
    );
  });

  it('cancels an in-flight Planner request without falling back to rules or starting later workflow steps', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    let notifyPlannerStarted: () => void = () => undefined;
    const plannerStarted = new Promise<void>((resolve) => {
      notifyPlannerStarted = resolve;
    });
    const createPlan = vi.fn(() => {
      notifyPlannerStarted();
      return new Promise<never>(() => undefined);
    });
    const laterClick = vi.fn().mockResolvedValue(currentState);
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: laterClick,
        input: vi.fn(),
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };
    const cancellation = new AbortController();
    const pending = runtime.runWorkflow({
      runId: 'workflow-planner-cancelled',
      cancellationSignal: cancellation.signal,
      workflow: {
        id: 'workflow-planner-cancelled',
        kind: 'scenario',
        name: 'Planner 可取消流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: currentState.currentUrl,
        notes: '',
        steps: [
          { id: 'step-plan', type: 'ai', title: '生成登录计划', body: '完成登录流程' },
          { id: 'step-later', type: 'ai', title: '打开详情', body: '点击 #detail' },
        ],
      },
      targetEnvironment: 'staging',
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    });

    await plannerStarted;
    cancellation.abort();
    const response = await pending;

    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ cancellationSignal: cancellation.signal }));
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(laterClick).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'step-plan', status: 'cancelled' }),
        expect.objectContaining({ stepId: 'step-later', status: 'cancelled' }),
      ]),
    );
  });

  it('cancels an in-flight Verifier request without downgrading it to a pending assertion', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    let notifyVerifierStarted: () => void = () => undefined;
    const verifierStarted = new Promise<void>((resolve) => {
      notifyVerifierStarted = resolve;
    });
    const verify = vi.fn(() => {
      notifyVerifierStarted();
      return new Promise<never>(() => undefined);
    });
    const laterClick = vi.fn().mockResolvedValue(currentState);
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: laterClick,
        input: vi.fn(),
        capture: vi.fn().mockResolvedValue(currentState),
        captureObservation: vi.fn().mockResolvedValue({
          textSummary: '营收趋势图展示本周收入持续升高。',
          domSummary: '发现 1 个图表。',
        }),
        getState: () => currentState,
      },
      undefined,
      undefined,
      { verify },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      verifier: {
        ...defaultResolvedAgentModelConfig.verifier,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://verifier.example.test/v1',
        modelApiKey: 'verifier-secret',
        modelName: 'verifier-large',
      },
    };
    const cancellation = new AbortController();
    const pending = runtime.runWorkflow({
      runId: 'workflow-verifier-cancelled',
      cancellationSignal: cancellation.signal,
      workflow: {
        id: 'workflow-verifier-cancelled',
        kind: 'scenario',
        name: 'Verifier 可取消流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: currentState.currentUrl,
        notes: '',
        steps: [
          { id: 'step-verify', type: 'aiAssert', title: '验证趋势', body: '验证营收趋势图明显上升' },
          { id: 'step-later', type: 'ai', title: '打开详情', body: '点击 #detail' },
        ],
      },
      targetEnvironment: 'staging',
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    });

    await verifierStarted;
    cancellation.abort();
    const response = await pending;

    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ cancellationSignal: cancellation.signal }));
    expect(laterClick).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.summary).toBe('用户已取消运行。');
  });

  it('cancels an in-flight Reporter request without writing a report artifact', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
      pageTitle: 'Dashboard',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    let notifyReporterStarted: () => void = () => undefined;
    const reporterStarted = new Promise<void>((resolve) => {
      notifyReporterStarted = resolve;
    });
    const report = vi.fn(() => {
      notifyReporterStarted();
      return new Promise<never>(() => undefined);
    });
    const writeReporterReport = vi.fn();
    const laterClick = vi.fn().mockResolvedValue(currentState);
    const semanticAssert = vi.fn().mockResolvedValue({
      status: 'failed',
      message: '未找到刷新成功状态。',
      evidence: '页面仍显示加载中。',
      failureReason: '图表未刷新完成。',
    });
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        start: vi.fn(),
        navigate: vi.fn(),
        click: laterClick,
        input: vi.fn(),
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      { click: vi.fn(), input: vi.fn(), assert: semanticAssert },
      undefined,
      undefined,
      { report },
      { writeReporterReport },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      reporter: {
        ...defaultResolvedAgentModelConfig.reporter,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://reporter.example.test/v1',
        modelApiKey: 'reporter-secret',
        modelName: 'reporter-large',
      },
    };
    const cancellation = new AbortController();
    const pending = runtime.runWorkflow({
      runId: 'workflow-reporter-cancelled',
      cancellationSignal: cancellation.signal,
      workflow: {
        id: 'workflow-reporter-cancelled',
        kind: 'scenario',
        name: 'Reporter 可取消流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: currentState.currentUrl,
        notes: '',
        steps: [
          { id: 'step-assert', type: 'aiAssert', title: '验证刷新', body: '验证图表刷新成功' },
          { id: 'step-later', type: 'ai', title: '打开详情', body: '点击 #detail' },
        ],
      },
      targetEnvironment: 'staging',
      midsceneConfig,
      agentModelConfig,
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    });

    await reporterStarted;
    cancellation.abort();
    const response = await pending;

    expect(report).toHaveBeenCalledWith(expect.objectContaining({ cancellationSignal: cancellation.signal }));
    expect(writeReporterReport).not.toHaveBeenCalled();
    expect(laterClick).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.reporter).toBeUndefined();
  });

  it('stops and reports a semantic assertion failure without asking Planner to replan', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/checkout',
      pageTitle: 'Checkout',
      message: 'ready',
      updatedAt: '2026-07-03T08:00:00.000Z',
    };
    const semanticClick = vi.fn().mockResolvedValue({
      status: 'failed',
      message: '提交后的业务断言未满足。',
      evidence: '页面没有显示订单已创建。',
      failureReason: '断言不匹配：订单状态仍为草稿。',
    });
    const createPlan = vi.fn().mockResolvedValue({
      plan: {
        title: '提交订单',
        summary: '点击确认提交后验证订单状态。',
        risks: [],
        steps: [
          {
            action: 'click',
            title: '确认提交订单',
            instruction: '点击确认提交订单按钮并验证订单已创建',
            target: '确认提交订单按钮',
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
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      { click: semanticClick, input: vi.fn(), assert: vi.fn() },
      { createPlan },
    );
    const agentModelConfig: ResolvedAgentModelConfig = {
      ...defaultResolvedAgentModelConfig,
      planner: {
        ...defaultResolvedAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
      },
    };

    const response = await runtime.sendChatCommand({
      mode: 'ai',
      prompt: '提交订单并验证订单已创建',
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
        headless: true,
      },
    });

    expect(semanticClick).toHaveBeenCalledTimes(1);
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(response.agentRun.status).toBe('failed');
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:assertion-result',
          verification: expect.objectContaining({ recoveryStrategy: 'stopAndReport' }),
        }),
      ]),
    );
    expect(response.agentRun.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'agent:plan-revised' })]),
    );
  });

  it('projects a deterministic step without a real Playwright page to blocked evidence', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-stub',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'stub',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    const navigate = vi.fn();
    const click = vi.fn();
    const waitForSelector = vi.fn();
    const scroll = vi.fn();
    const createPlan = vi.fn();
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        hasRealPage: () => false,
        start: vi.fn(),
        navigate,
        click,
        input: vi.fn(),
        waitForSelector,
        scroll,
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );

    const response = await runtime.runDeterministicStep({
      testCaseId: 'case-orders',
      sourceStep: {
        id: 'step-open-orders',
        type: 'ai',
        title: '打开订单页',
        body: '打开订单页',
        execution: {
          schemaVersion: 2,
          intent: '打开订单页',
          reviewStatus: 'confirmed',
          actionRisk: 'low',
          action: { kind: 'navigate', url: 'https://example.test/orders' },
        },
      },
      plannedStep: {
        action: 'navigate',
        title: '打开订单页',
        instruction: '打开订单页',
        url: 'https://example.test/orders',
      },
      targetEnvironment: 'staging',
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'unsupportedAction' });
    expect(response.detail.steps).toEqual([
      expect.objectContaining({ stepId: 'step-open-orders', status: 'blocked' }),
    ]);
    expect(navigate).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(waitForSelector).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('executes one deterministic step through a real page without Planner or model execution', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-real',
      status: 'ready',
      currentUrl: 'https://example.test/start',
      pageTitle: 'Start',
      screenshotPath: '/tmp/start.png',
      message: 'ready',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    const navigatedState: BrowserSessionState = {
      ...currentState,
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      screenshotPath: '/tmp/orders.png',
    };
    const navigate = vi.fn().mockResolvedValue(navigatedState);
    const createPlan = vi.fn();
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        hasRealPage: () => true,
        start: vi.fn(),
        navigate,
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );

    const response = await runtime.runDeterministicStep({
      testCaseId: 'case-orders',
      sourceStep: {
        id: 'step-open-orders',
        type: 'ai',
        title: '打开订单页',
        body: '打开订单页',
        execution: {
          schemaVersion: 2,
          intent: '打开订单页',
          reviewStatus: 'confirmed',
          actionRisk: 'low',
          action: { kind: 'navigate', url: 'https://example.test/orders' },
        },
      },
      plannedStep: {
        action: 'navigate',
        title: '打开订单页',
        instruction: '打开订单页',
        url: 'https://example.test/orders',
      },
      targetEnvironment: 'staging',
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    });

    expect(navigate).toHaveBeenCalledWith({ url: 'https://example.test/orders' });
    expect(createPlan).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'navigate', url: 'https://example.test/orders' })]),
    );
    expect(response.agentRun.artifacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'screenshot', path: '/tmp/orders.png' })]),
    );
    expect(response.detail.steps).toEqual([
      expect.objectContaining({ stepId: 'step-open-orders', status: 'passed', screenshotPath: '/tmp/orders.png' }),
    ]);
  });

  it('evaluates a confirmed explicit assertion against a real page without Planner or model execution', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-real',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      screenshotPath: '/tmp/orders.png',
      message: 'ready',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    const getPageText = vi.fn().mockResolvedValue('订单已创建\n订单号：A-001');
    const createPlan = vi.fn();
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        hasRealPage: () => true,
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        capture: vi.fn().mockResolvedValue(currentState),
        getPageText,
        captureObservation: vi.fn().mockResolvedValue({ textSummary: '订单已创建' }),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );

    const response = await runtime.runDeterministicStep({
      testCaseId: 'case-orders',
      sourceStep: {
        id: 'step-confirm-order', type: 'aiAssert', title: '确认订单已创建', body: '确认页面包含订单已创建',
        execution: {
          schemaVersion: 2, intent: '确认订单已创建', reviewStatus: 'confirmed', actionRisk: 'low',
          assertion: { id: 'assert-order-created', version: 1, kind: 'pageContains', expected: '订单已创建' },
        },
      },
      plannedStep: { action: 'assert', title: '确认订单已创建', instruction: '确认页面包含订单已创建', expected: '订单已创建' },
      assertion: { id: 'assert-order-created', version: 1, kind: 'pageContains', expected: '订单已创建' },
      targetEnvironment: 'staging',
      runtimeProfile: { browser: 'chromium', baseUrl: 'https://example.test', viewport: 'desktop', locale: 'zh-CN', headless: true },
    });

    expect(getPageText).toHaveBeenCalledTimes(1);
    expect(createPlan).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('passed');
    expect(response.agentRun.plan.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'assert', sourceStepType: 'aiAssert' })]),
    );
    expect(response.agentRun.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent:assertion-result',
          verification: expect.objectContaining({
            assertion: { id: 'assert-order-created', version: 1, kind: 'pageContains' },
            evidence: expect.stringContaining('订单已创建'),
          }),
        }),
      ]),
    );
    expect(response.detail.steps).toEqual([
      expect.objectContaining({ stepId: 'step-confirm-order', status: 'passed', screenshotPath: '/tmp/orders.png' }),
    ]);
  });

  it('resolves a confirmed credential input only for browser dispatch and omits the value from run evidence', async () => {
    const project = { ...createEmptyProject(1), id: 'project-orders' };
    const currentState: BrowserSessionState = {
      id: 'session-real',
      status: 'ready',
      projectId: project.id,
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      screenshotPath: '/tmp/orders.png',
      message: 'ready',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    const input = vi.fn().mockResolvedValue(currentState);
    const createPlan = vi.fn();
    const resolve = vi.fn().mockResolvedValue('resolved-test-value');
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        hasRealPage: () => true,
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input,
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
      undefined,
      undefined,
      undefined,
      { resolve },
    );

    const response = await runtime.runDeterministicStep({
      project,
      testCaseId: 'case-orders',
      sourceStep: {
        id: 'step-fill-email',
        type: 'ai',
        title: '填写邮箱',
        body: '填写已确认的测试账号。',
        execution: {
          schemaVersion: 2,
          intent: '填写已确认的测试账号。',
          reviewStatus: 'confirmed',
          actionRisk: 'medium',
          action: {
            kind: 'input',
            locator: { selector: '#email', quality: 'acceptable' },
            binding: { kind: 'credential', credentialId: 'cred-qa', field: 'username' },
          },
        },
      },
      plannedStep: {
        action: 'input',
        title: '填写邮箱',
        instruction: '填写已确认的测试账号。',
        selector: '#email',
        value: 'caller-supplied-value-must-not-persist',
      },
      inputBinding: { kind: 'credential', credentialId: 'cred-qa', field: 'username' },
      targetEnvironment: 'staging',
      runtimeProfile: { browser: 'chromium', baseUrl: 'https://example.test', viewport: 'desktop', locale: 'zh-CN', headless: true },
    });

    expect(resolve).toHaveBeenCalledWith({
      projectId: project.id,
      binding: { kind: 'credential', credentialId: 'cred-qa', field: 'username' },
    });
    expect(input).toHaveBeenCalledWith({ selector: '#email', value: 'resolved-test-value' });
    expect(createPlan).not.toHaveBeenCalled();
    expect(response.agentRun.status).toBe('passed');
    const persistedInputPlanStep = response.agentRun.plan.steps.find((step) => step.action === 'input');
    expect(persistedInputPlanStep).toEqual(expect.objectContaining({ action: 'input', selector: '#email' }));
    expect(persistedInputPlanStep).not.toHaveProperty('value');
    expect(JSON.stringify({ agentRun: response.agentRun, detail: response.detail })).not.toContain('resolved-test-value');
    expect(JSON.stringify({ agentRun: response.agentRun, detail: response.detail })).not.toContain('caller-supplied-value-must-not-persist');
  });

  it('projects an unresolved credential input to blocked credential evidence', async () => {
    const project = { ...createEmptyProject(1), id: 'project-orders' };
    const currentState: BrowserSessionState = {
      id: 'session-real',
      status: 'ready',
      projectId: project.id,
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    const input = vi.fn();
    const resolve = vi.fn().mockRejectedValue(new Error('凭据已删除'));
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        hasRealPage: () => true,
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input,
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan: vi.fn() },
      undefined,
      undefined,
      undefined,
      { resolve },
    );

    const response = await runtime.runDeterministicStep({
      project,
      testCaseId: 'case-orders',
      sourceStep: {
        id: 'step-fill-email',
        type: 'ai',
        title: '填写邮箱',
        body: '填写已确认的测试账号。',
        execution: {
          schemaVersion: 2,
          intent: '填写已确认的测试账号。',
          reviewStatus: 'confirmed',
          actionRisk: 'medium',
          action: {
            kind: 'input',
            locator: { selector: '#email', quality: 'acceptable' },
            binding: { kind: 'credential', credentialId: 'cred-deleted', field: 'username' },
          },
        },
      },
      plannedStep: { action: 'input', title: '填写邮箱', instruction: '填写已确认的测试账号。', selector: '#email' },
      inputBinding: { kind: 'credential', credentialId: 'cred-deleted', field: 'username' },
      targetEnvironment: 'staging',
      runtimeProfile: { browser: 'chromium', baseUrl: 'https://example.test', viewport: 'desktop', locale: 'zh-CN', headless: true },
    });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'credentialUnavailable' });
    expect(response.detail.steps).toEqual([
      expect.objectContaining({ stepId: 'step-fill-email', status: 'blocked' }),
    ]);
    expect(input).not.toHaveBeenCalled();
  });

  it('uses the same main-process binding resolution for deterministic select steps', async () => {
    const project = { ...createEmptyProject(1), id: 'project-orders' };
    const currentState: BrowserSessionState = {
      id: 'session-real',
      status: 'ready',
      projectId: project.id,
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    const select = vi.fn().mockResolvedValue(currentState);
    const resolve = vi.fn().mockResolvedValue('region-code-from-store');
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        hasRealPage: () => true,
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        select,
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan: vi.fn() },
      undefined,
      undefined,
      undefined,
      { resolve },
    );

    const response = await runtime.runDeterministicStep({
      project,
      testCaseId: 'case-orders',
      sourceStep: {
        id: 'step-select-region',
        type: 'ai',
        title: '选择区域',
        body: '选择已确认的测试区域。',
        execution: {
          schemaVersion: 2,
          intent: '选择已确认的测试区域。',
          reviewStatus: 'confirmed',
          actionRisk: 'medium',
          action: {
            kind: 'select',
            locator: { selector: '#region', quality: 'acceptable' },
            binding: { kind: 'credential', credentialId: 'cred-region', field: 'secret' },
          },
        },
      },
      plannedStep: { action: 'select', title: '选择区域', instruction: '选择已确认的测试区域。', selector: '#region' },
      inputBinding: { kind: 'credential', credentialId: 'cred-region', field: 'secret' },
      targetEnvironment: 'staging',
      runtimeProfile: { browser: 'chromium', baseUrl: 'https://example.test', viewport: 'desktop', locale: 'zh-CN', headless: true },
    });

    expect(select).toHaveBeenCalledWith({ selector: '#region', value: 'region-code-from-store' });
    expect(response.agentRun.status).toBe('passed');
    expect(JSON.stringify({ agentRun: response.agentRun, detail: response.detail })).not.toContain('region-code-from-store');
  });

  it('cancels a deterministic selector wait without invoking the Planner', async () => {
    const currentState: BrowserSessionState = {
      id: 'session-real',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
      pageTitle: 'Orders',
      message: 'ready',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    let markWaitStarted: () => void = () => undefined;
    const waitStarted = new Promise<void>((resolve) => {
      markWaitStarted = resolve;
    });
    const waitForSelector = vi.fn(() => {
      markWaitStarted();
      return new Promise<BrowserSessionState>(() => undefined);
    });
    const createPlan = vi.fn();
    const runtime = new StudioRuntime(
      vi.fn(),
      {
        hasRealPage: () => true,
        start: vi.fn(),
        navigate: vi.fn(),
        click: vi.fn(),
        input: vi.fn(),
        waitForSelector,
        capture: vi.fn().mockResolvedValue(currentState),
        getState: () => currentState,
      },
      undefined,
      { createPlan },
    );
    const controller = new AbortController();
    const pending = runtime.runDeterministicStep({
      testCaseId: 'case-orders',
      cancellationSignal: controller.signal,
      sourceStep: {
        id: 'step-wait-orders', type: 'ai', title: '等待订单就绪', body: '等待订单就绪',
        execution: {
          schemaVersion: 2, intent: '等待订单就绪', reviewStatus: 'confirmed', actionRisk: 'low',
          action: { kind: 'waitForSelector', locator: { selector: '#orders-ready', quality: 'acceptable' } },
        },
      },
      plannedStep: { action: 'wait', title: '等待订单就绪', instruction: '等待订单就绪', selector: '#orders-ready' },
      targetEnvironment: 'staging',
      runtimeProfile: { browser: 'chromium', baseUrl: 'https://example.test', viewport: 'desktop', locale: 'zh-CN', headless: true },
    });

    await waitStarted;
    controller.abort();
    const response = await pending;

    expect(waitForSelector).toHaveBeenCalledWith({ selector: '#orders-ready', timeoutMs: 1000 });
    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.cancellation).toEqual(expect.objectContaining({ source: 'user', reason: 'userCancelled' }));
    expect(response.detail.cancellation).toEqual(expect.objectContaining({ source: 'user', reason: 'userCancelled' }));
    expect(response.detail.status).toBe('cancelled');
    expect(response.detail.reason).toMatchObject({ code: 'userCancelled' });
    expect(createPlan).not.toHaveBeenCalled();
  });
});
