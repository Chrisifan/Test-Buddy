import { describe, expect, it, vi } from 'vitest';

import { createAgentIntent, deriveAgentRecoveryPlan, isTerminalAgentEvent, type AgentRunEvent } from './agent.js';
import { createPlannedAgentRun, createStubAgentRun, createTestCaseAgentRun, createWorkflowAgentRun } from './agentStub.js';
import { createRecordingAgentRun } from './recordingAgent.js';

describe('agent contract helpers', () => {
  it('creates a natural language intent with a stable source and timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T08:00:00.000Z'));

    const intent = createAgentIntent({
      source: 'naturalLanguage',
      prompt: '登录后台并验证图表刷新',
      projectId: 'project-1',
      targetUrl: 'https://example.test',
    });

    expect(intent.id).toMatch(/^agent-intent-\d+$/);
    expect(intent.source).toBe('naturalLanguage');
    expect(intent.prompt).toBe('登录后台并验证图表刷新');
    expect(intent.projectId).toBe('project-1');
    expect(intent.targetUrl).toBe('https://example.test');
    expect(intent.createdAt).toBe('2026-07-03T08:00:00.000Z');

    vi.useRealTimers();
  });

  it('detects terminal agent events', () => {
    const baseEvent: AgentRunEvent = {
      id: 'event-1',
      runId: 'run-1',
      type: 'agent:step-started',
      message: '开始执行',
      status: 'running',
      createdAt: '2026-07-03T08:00:00.000Z',
    };

    expect(isTerminalAgentEvent(baseEvent)).toBe(false);
    expect(isTerminalAgentEvent({ ...baseEvent, type: 'agent:step-failed', status: 'failed' })).toBe(true);
    expect(isTerminalAgentEvent({ ...baseEvent, type: 'agent:run-finished', status: 'passed' })).toBe(true);
  });

  it('derives only wait or observe recovery plans from recorded evidence', () => {
    const createFailedRun = () => {
      const run = createStubAgentRun({
        mode: 'aiAssert',
        prompt: '验证订单列表刷新',
        runtimeDescription: 'chromium / desktop',
        targetEnvironment: 'Staging',
        verificationStatus: 'failed',
        verificationFailureReason: '订单列表尚未刷新。',
      });
      const assertionEvent = run.events.find((event) => event.type === 'agent:assertion-result')!;
      assertionEvent.verification = {
        ...assertionEvent.verification!,
        failureCategory: 'network',
        recoveryStrategy: 'waitForReadiness',
      };
      return { run, stepId: assertionEvent.stepId! };
    };

    const response = createFailedRun();
    response.run.events.push({
      id: 'wait-response', runId: response.run.runId, type: 'agent:dynamic-wait', stepId: response.stepId,
      message: '等待订单接口', status: 'failed',
      dynamicWait: { timeoutMs: 1_500, strategy: 'response', urlPattern: '/api/orders', status: 'failed', summary: '超时', evidence: 'timeout' },
      createdAt: new Date().toISOString(),
    });
    expect(deriveAgentRecoveryPlan(response.run)).toMatchObject({
      failedStepId: response.stepId, strategy: 'waitForResponse', urlPattern: '/api/orders',
    });

    const selector = createFailedRun();
    selector.run.events.push({
      id: 'wait-selector', runId: selector.run.runId, type: 'agent:dynamic-wait', stepId: selector.stepId,
      message: '等待刷新状态', status: 'failed',
      dynamicWait: { timeoutMs: 1_000, strategy: 'selector', selector: '#orders-ready', status: 'failed', summary: '超时', evidence: 'timeout' },
      createdAt: new Date().toISOString(),
    });
    expect(deriveAgentRecoveryPlan(selector.run)).toMatchObject({ strategy: 'waitForSelector', selector: '#orders-ready' });

    const dataReady = createFailedRun();
    dataReady.run.events.push({
      id: 'wait-data', runId: dataReady.run.runId, type: 'agent:dynamic-wait', stepId: dataReady.stepId,
      message: '等待数据', status: 'failed',
      dynamicWait: { timeoutMs: 1_500, strategy: 'dataReady', status: 'failed', summary: '超时', evidence: 'timeout' },
      createdAt: new Date().toISOString(),
    });
    expect(deriveAgentRecoveryPlan(dataReady.run)?.strategy).toBe('waitForDataReady');

    const networkIdle = createFailedRun();
    networkIdle.run.events.push({
      id: 'wait-network', runId: networkIdle.run.runId, type: 'agent:dynamic-wait', stepId: networkIdle.stepId,
      message: '等待网络空闲', status: 'failed',
      dynamicWait: { timeoutMs: 1_500, strategy: 'networkIdle', status: 'failed', summary: '超时', evidence: 'timeout' },
      createdAt: new Date().toISOString(),
    });
    expect(deriveAgentRecoveryPlan(networkIdle.run)?.strategy).toBe('waitForNetworkIdle');

    const noReliableTarget = createFailedRun();
    const verification = noReliableTarget.run.events.find((event) => event.type === 'agent:assertion-result')!.verification!;
    verification.failureCategory = 'assertion';
    verification.recoveryStrategy = 'stopAndReport';
    expect(deriveAgentRecoveryPlan(noReliableTarget.run)?.strategy).toBe('observe');
  });

  it('creates a structured stub run for natural language agent execution', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T08:00:00.000Z'));

    const run = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '验证图表刷新成功',
      runtimeDescription: 'chromium / desktop / headed / https://example.test',
      targetEnvironment: 'staging',
      projectId: 'project-1',
      testCaseId: 'case-1',
      targetUrl: 'https://example.test',
      browserSession: {
        status: 'ready',
        currentUrl: 'https://example.test/dashboard',
        pageTitle: 'Dashboard',
        screenshotPath: '/tmp/dashboard.png',
      },
    });

    expect(run.intent.source).toBe('naturalLanguage');
    expect(run.intent.projectId).toBe('project-1');
    expect(run.plan.steps).toHaveLength(3);
    expect(run.plan.steps[1]?.action).toBe('assert');
    expect(run.events.map((event) => event.type)).toEqual([
      'agent:plan-created',
      'agent:step-started',
      'agent:browser-action',
      'agent:observation-created',
      'agent:assertion-result',
      'agent:run-finished',
    ]);
    expect(run.artifacts[0]?.type).toBe('report');
    expect(run.artifacts[1]?.type).toBe('screenshot');
    expect(run.events.find((event) => event.type === 'agent:observation-created')?.observation?.url).toBe(
      'https://example.test/dashboard',
    );

    vi.useRealTimers();
  });

  it('adds a Midscene HTML report artifact when the runtime provides its path', () => {
    const run = createStubAgentRun({
      mode: 'ai',
      prompt: '点击登录按钮',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'staging',
      reportArtifactPath: '/tmp/midscene-123.html',
      executionMetrics: {
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

    expect(run.artifacts).toContainEqual(
      expect.objectContaining({
        type: 'report',
        label: 'Midscene 执行报告',
        path: '/tmp/midscene-123.html',
      }),
    );
    expect(run.events).toContainEqual(
      expect.objectContaining({
        type: 'agent:artifact-created',
        artifact: expect.objectContaining({ path: '/tmp/midscene-123.html' }),
      }),
    );
    expect(run.plan.risks.join(' ')).not.toContain('尚未调用 Midscene');
    expect(run.metrics).toEqual(
      expect.objectContaining({
        durationMs: 360,
        calls: 2,
        totalTokens: 150,
      }),
    );
  });

  it('attaches resolved role model assignments to natural language agent runs', () => {
    const run = createStubAgentRun({
      mode: 'ai',
      prompt: '规划登录并验证报表',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'local',
      modelAssignments: [
        {
          role: 'planner',
          provider: 'openaiCompatible',
          source: 'agentRole',
          enabled: true,
          modelBaseUrl: 'https://planner.example.test/v1',
          modelName: 'planner-large',
          modelFamily: 'openai',
          temperature: '0.1',
          hasApiKey: true,
        },
        {
          role: 'executor',
          provider: 'reuseMidscene',
          source: 'midscene',
          enabled: true,
          modelBaseUrl: 'https://models.example.test/v1',
          modelName: 'ui-vlm',
          modelFamily: 'openai',
          hasApiKey: true,
        },
      ],
    });

    expect(run.modelAssignments).toEqual([
      expect.objectContaining({ role: 'planner', modelName: 'planner-large' }),
      expect.objectContaining({ role: 'executor', modelName: 'ui-vlm' }),
    ]);
    expect(run.events.find((event) => event.type === 'agent:plan-created')?.message).toContain(
      'Planner: planner-large',
    );
  });

  it('aggregates every completed Planner step into one passed Agent run', () => {
    const run = createPlannedAgentRun({
      mode: 'ai',
      prompt: '打开报表并检查标题',
      targetEnvironment: 'Staging',
      runtimeDescription: 'chromium / desktop',
      targetUrl: 'https://example.test',
      plannedPlan: {
        title: '报表检查',
        summary: '打开报表并检查标题。',
        risks: [],
        steps: [
          {
            action: 'navigate',
            title: '打开报表',
            instruction: '打开报表',
            url: 'https://example.test/reports',
          },
          {
            action: 'assert',
            title: '检查标题',
            instruction: '断言标题包含 Reports',
          },
        ],
      },
      planner: { source: 'model', modelName: 'planner-large' },
      executions: [
        {
          stepIndex: 0,
          status: 'passed',
          summary: '已打开报表。',
          evidence: '当前 URL：https://example.test/reports',
          browserActionMessage: '已导航到报表页。',
          browserSession: {
            status: 'ready',
            currentUrl: 'https://example.test/reports',
            pageTitle: 'Reports',
            screenshotPath: '/tmp/reports.png',
          },
        },
        {
          stepIndex: 1,
          status: 'passed',
          summary: '标题断言通过。',
          evidence: '页面标题包含 Reports。',
          browserActionMessage: '已读取页面标题。',
          reportArtifactPath: '/tmp/title-assert.html',
        },
      ],
    });

    expect(run.status).toBe('passed');
    expect(run.plan.steps.map((step) => step.title)).toEqual([
      '准备执行上下文',
      '打开报表',
      '检查标题',
      '验证执行结果',
    ]);
    expect(run.events.filter((event) => event.type === 'agent:step-started')).toHaveLength(2);
    expect(run.events.filter((event) => event.type === 'agent:assertion-result')).toHaveLength(3);
    expect(run.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/tmp/reports.png', type: 'screenshot' }),
        expect.objectContaining({ path: '/tmp/title-assert.html', type: 'report' }),
      ]),
    );
  });

  it('aggregates workflow step runs into one agent run with failure evidence and usage', () => {
    const clickRun = createStubAgentRun({
      mode: 'ai',
      prompt: '点击登录按钮',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'local',
      primaryAction: 'click',
      reportArtifactPath: '/tmp/midscene-click.html',
      modelAssignments: [
        {
          role: 'planner',
          provider: 'openaiCompatible',
          source: 'agentRole',
          enabled: true,
          modelBaseUrl: 'https://planner.example.test/v1',
          modelName: 'planner-large',
          modelFamily: 'openai',
          temperature: '0.1',
          hasApiKey: true,
        },
      ],
      executionMetrics: {
        durationMs: 360,
        modelTimeCostMs: 240,
        calls: 2,
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 10,
        replanningCycleLimit: 12,
        byIntent: { locate: { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 } },
        byModel: { model: { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 } },
      },
    });
    const assertRun = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '验证页面包含登录成功',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'local',
      verificationStatus: 'failed',
      verificationSummary: '未找到登录成功提示。',
      verificationFailureReason: '页面未显示登录成功。',
      executionMetrics: {
        durationMs: 140,
        modelTimeCostMs: 100,
        calls: 1,
        promptTokens: 60,
        completionTokens: 10,
        totalTokens: 70,
        cachedInputTokens: 5,
        replanningCycleLimit: 12,
        byIntent: { assert: { promptTokens: 60, completionTokens: 10, totalTokens: 70, calls: 1 } },
        byModel: { model: { promptTokens: 60, completionTokens: 10, totalTokens: 70, calls: 1 } },
      },
    });

    const run = createWorkflowAgentRun({
      workflow: {
        id: 'workflow-login',
        name: '登录流程',
        url: 'https://example.test/login',
        steps: [
          { id: 'workflow-step-click', type: 'ai', title: '点击登录', body: '点击登录按钮' },
          { id: 'workflow-step-assert', type: 'aiAssert', title: '验证登录', body: '验证页面包含登录成功' },
        ],
      },
      stepRuns: [clickRun, assertRun],
      projectId: 'project-1',
      environmentId: 'env-local',
    });

    expect(run.intent.source).toBe('workflow');
    expect(run.plan.steps.map((step) => [step.id, step.action])).toEqual([
      ['workflow-step-click', 'click'],
      ['workflow-step-assert', 'assert'],
    ]);
    expect(run.status).toBe('failed');
    expect(run.failureReason).toBe('页面未显示登录成功。');
    expect(run.events).toContainEqual(
      expect.objectContaining({ type: 'agent:step-failed', stepId: 'workflow-step-assert', status: 'failed' }),
    );
    expect(run.artifacts).toContainEqual(expect.objectContaining({ path: '/tmp/midscene-click.html' }));
    expect(run.metrics).toEqual(
      expect.objectContaining({ durationMs: 500, modelTimeCostMs: 340, calls: 3, totalTokens: 220 }),
    );
    expect(run.metrics?.byModel.model).toEqual({
      promptTokens: 180,
      completionTokens: 40,
      totalTokens: 220,
      calls: 3,
    });
    expect(run.modelAssignments).toEqual([
      expect.objectContaining({
        role: 'planner',
        modelName: 'planner-large',
      }),
    ]);
  });

  it('composes recording, workflow, and pending steps into one test-case agent run', () => {
    const recordingRun = createStubAgentRun({
      mode: 'ai',
      prompt: '回放登录录制',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'Staging',
      verificationStatus: 'passed',
      executionMetrics: {
        durationMs: 120,
        modelTimeCostMs: 0,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        byIntent: {},
        byModel: {},
      },
    });
    recordingRun.intent.source = 'recording';
    const assertionRun = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '确认当前用户已登录',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'Staging',
      verificationStatus: 'passed',
      executionMetrics: {
        durationMs: 80,
        modelTimeCostMs: 50,
        calls: 1,
        promptTokens: 40,
        completionTokens: 10,
        totalTokens: 50,
        cachedInputTokens: 0,
        byIntent: { assert: { promptTokens: 40, completionTokens: 10, totalTokens: 50, calls: 1 } },
        byModel: { verifier: { promptTokens: 40, completionTokens: 10, totalTokens: 50, calls: 1 } },
      },
    });
    const run = createTestCaseAgentRun({
      testCase: {
        id: 'case-login',
        kind: 'recording',
        groupId: 'group-core',
        environmentId: 'env-staging',
        source: 'recording',
        name: '登录混合用例',
        category: '核心链路',
        lastEdited: '刚刚',
        url: 'https://example.test/login',
        notes: '',
        steps: [
          { id: 'replay', type: 'recordingReplay', title: '回放登录', body: '回放登录录制', recordingId: 'recording-login' },
          { id: 'assert', type: 'aiAssert', title: '验证登录', body: '确认当前用户已登录' },
          { id: 'manual', type: 'manual', title: '人工确认', body: '确认欢迎语' },
        ],
      },
      stepRuns: [recordingRun, assertionRun, undefined],
      runId: 'agent-run-case-login',
      projectId: 'project-demo',
      environmentId: 'env-staging',
    });

    expect(run.runId).toBe('agent-run-case-login');
    expect(run.intent.testCaseId).toBe('case-login');
    expect(run.status).toBe('neutral');
    expect(run.plan.steps.map((step) => [step.id, step.sourceStepType, step.action])).toEqual([
      ['replay', 'recordingReplay', 'observe'],
      ['assert', 'aiAssert', 'assert'],
      ['manual', 'manual', 'observe'],
    ]);
    expect(run.events).toContainEqual(
      expect.objectContaining({ type: 'agent:step-started', stepId: 'manual', status: 'neutral' }),
    );
    expect(run.metrics).toEqual(expect.objectContaining({ durationMs: 200, calls: 1, totalTokens: 50 }));
  });

  it('creates a neutral recording run with paired baseline and actual screenshot evidence', () => {
    const recording = {
      id: 'recording-checkout',
      name: '结算路径',
      summary: '回放结算路径',
      source: 'live' as const,
      groupId: 'group-1',
      environmentId: 'env-local',
      startUrl: 'https://example.test/checkout',
      comparisonGoal: '提交后页面与录制基线一致',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [
        {
          id: 'recording-step-open',
          kind: 'navigate' as const,
          title: '打开结算页',
          detail: '打开结算页',
          pageUrl: 'https://example.test/checkout',
        },
        {
          id: 'recording-step-snapshot',
          kind: 'snapshot' as const,
          title: '提交后快照',
          detail: '记录提交后的页面',
          screenshotPath: '/tmp/baseline-checkout.png',
        },
      ],
    };

    const run = createRecordingAgentRun({
      recording,
      projectId: 'project-1',
      replayResults: [
        {
          step: recording.steps[0],
          status: 'passed',
          message: '已回放：打开结算页',
          screenshotPath: '/tmp/actual-open.png',
        },
        {
          step: recording.steps[1],
          status: 'passed',
          message: '已回放：提交后快照',
          screenshotPath: '/tmp/actual-checkout.png',
        },
      ],
    });

    expect(run.intent.source).toBe('recording');
    expect(run.intent.recordingId).toBe(recording.id);
    expect(run.plan.steps.map((step) => step.action)).toEqual(['navigate', 'observe']);
    expect(run.status).toBe('neutral');
    expect(run.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '基线 · 提交后快照', path: '/tmp/baseline-checkout.png' }),
        expect.objectContaining({ label: '实际 · 提交后快照', path: '/tmp/actual-checkout.png' }),
      ]),
    );
    expect(
      run.events.find(
        (event) => event.type === 'agent:assertion-result' && event.stepId === 'recording-step-snapshot',
      )?.verification,
    ).toEqual(
      expect.objectContaining({
        status: 'neutral',
        evidence: expect.stringContaining('基线与实际截图证据已配对'),
      }),
    );
  });

  it('fails a recording run when a replay node fails', () => {
    const step = {
      id: 'recording-step-click',
      kind: 'click' as const,
      title: '点击提交',
      detail: '点击提交按钮',
      selector: '#submit',
    };
    const run = createRecordingAgentRun({
      recording: {
        id: 'recording-submit',
        name: '提交路径',
        summary: '',
        source: 'live',
        groupId: 'group-1',
        environmentId: 'env-local',
        startUrl: 'https://example.test',
        comparisonGoal: '',
        tags: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        steps: [step],
      },
      replayResults: [{ step, status: 'failed', message: '回放失败：未找到 #submit' }],
    });

    expect(run.status).toBe('failed');
    expect(run.failureReason).toContain('未找到 #submit');
    expect(run.events).toContainEqual(
      expect.objectContaining({ type: 'agent:step-failed', stepId: step.id, status: 'failed' }),
    );
  });

  it('fails a recording run when visual comparison detects changed pixels', () => {
    const step = {
      id: 'recording-step-chart',
      kind: 'snapshot' as const,
      title: '图表快照',
      detail: '保存图表',
      screenshotPath: '/tmp/chart-baseline.png',
    };
    const run = createRecordingAgentRun({
      recording: {
        id: 'recording-chart',
        name: '图表回放',
        summary: '',
        source: 'live',
        groupId: 'group-1',
        environmentId: 'env-local',
        startUrl: 'https://example.test/chart',
        comparisonGoal: '图表与基线一致',
        tags: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        steps: [step],
      },
      replayResults: [
        {
          step,
          status: 'passed',
          message: '已回放：图表快照',
          screenshotPath: '/tmp/chart-actual.png',
        },
      ],
      visualComparisons: [
        {
          stepId: step.id,
          status: 'failed',
          message: '视觉基线对比发现 12/120 个像素变化。',
          changedPixels: 12,
          totalPixels: 120,
          differenceRatio: 0.1,
          baselinePath: step.screenshotPath,
          actualPath: '/tmp/chart-actual.png',
          diffPath: '/tmp/chart-actual-diff.png',
        },
      ],
    });

    expect(run.status).toBe('failed');
    expect(run.failureReason).toContain('12/120');
    expect(run.artifacts).toContainEqual(
      expect.objectContaining({ label: '差异 · 图表快照', path: '/tmp/chart-actual-diff.png' }),
    );
  });
});
