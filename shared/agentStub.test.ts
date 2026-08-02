import { describe, expect, it, vi } from 'vitest';

import { createPlannedAgentRun } from './agentStub.js';

describe('createPlannedAgentRun replanning history', () => {
  it('keeps abandoned failure evidence while the recovered run passes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const initialPlan = {
      title: '打开工作台',
      summary: '使用原地址。',
      risks: [],
      steps: [
        {
          action: 'navigate' as const,
          title: '进入工作台',
          instruction: '打开旧地址',
          url: 'https://broken.test',
        },
      ],
    };
    const revisedPlan = {
      title: '打开工作台修正版',
      summary: '使用可用地址。',
      risks: [],
      steps: [
        {
          action: 'navigate' as const,
          title: '进入工作台',
          instruction: '打开新地址',
          url: 'https://example.test',
        },
      ],
    };
    const planningMetrics = {
      durationMs: 84,
      modelTimeCostMs: 64,
      calls: 1,
      promptTokens: 42,
      completionTokens: 8,
      totalTokens: 50,
      cachedInputTokens: 0,
      byIntent: { planner: { promptTokens: 42, completionTokens: 8, totalTokens: 50, calls: 1 } },
      byModel: { 'planner-large': { promptTokens: 42, completionTokens: 8, totalTokens: 50, calls: 1 } },
    };
    const actionMetrics = {
      durationMs: 360,
      modelTimeCostMs: 240,
      calls: 2,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 10,
      byIntent: { action: { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 } },
      byModel: { 'ui-agent-model': { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 } },
    };

    const run = createPlannedAgentRun({
      mode: 'ai',
      prompt: '打开工作台',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'staging',
      plannedPlan: revisedPlan,
      planner: { source: 'model', modelName: 'planner-large' },
      planningMetrics,
      replanningHistory: [
        {
          cycle: 1,
          previousPlan: initialPlan,
          revisedPlan,
          failedStepIndex: 0,
          executions: [
            {
              stepIndex: 0,
              status: 'failed',
              summary: '旧地址不可达',
              evidence: 'net::ERR_NAME_NOT_RESOLVED',
              failureReason: '导航失败',
              failureCategory: 'navigation',
              recoveryStrategy: 'replanNavigation',
              browserSession: {
                status: 'ready',
                currentUrl: 'https://start.test',
                pageTitle: 'Start',
                screenshotPath: '/tmp/replan.png',
              },
              observation: { domSummary: '仍停留在起始页' },
              reportArtifactPath: '/tmp/replan-report.html',
            },
          ],
        },
      ],
      executions: [
        {
          stepIndex: 0,
          status: 'passed',
          summary: '已打开工作台',
          evidence: 'URL 已更新',
          metrics: actionMetrics,
          browserSession: {
            status: 'ready',
            currentUrl: 'https://example.test',
            pageTitle: 'Dashboard',
            screenshotPath: '/tmp/replan.png',
          },
        },
      ],
    });
    const revision = run.events.find((event) => event.type === 'agent:plan-revised');

    expect(run.status).toBe('passed');
    expect(run.plan.title).toBe('打开工作台修正版');
    expect(revision).toEqual(
      expect.objectContaining({
        status: 'neutral',
        stepId: expect.stringContaining('replan-1-step-1'),
        planRevision: expect.objectContaining({
          cycle: 1,
          previousPlanTitle: '打开工作台',
          revisedPlanTitle: '打开工作台修正版',
          failureCategory: 'navigation',
          recoveryStrategy: 'replanNavigation',
        }),
      }),
    );
    expect(run.events.findIndex((event) => event.type === 'agent:step-failed')).toBeLessThan(
      run.events.findIndex((event) => event.type === 'agent:plan-revised'),
    );
    expect(run.artifacts.filter((artifact) => artifact.path === '/tmp/replan.png')).toHaveLength(1);
    expect(run.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/tmp/replan-report.html' })]));
    expect(run.events.find((event) => event.type === 'agent:plan-created')?.metrics).toEqual(planningMetrics);
    expect(run.events.find((event) => event.type === 'agent:browser-action' && event.metrics)?.metrics).toEqual(actionMetrics);
  });

  it('uses the unrecovered final failure as the run failure reason', () => {
    const initialPlan = {
      title: '旧计划',
      summary: '旧步骤失败后重规划。',
      risks: [],
      steps: [{ action: 'click' as const, title: '旧步骤', instruction: '点击旧按钮', selector: '#old' }],
    };
    const finalPlan = {
      title: '新计划',
      summary: '重规划后的步骤仍然失败。',
      risks: [],
      steps: [{ action: 'click' as const, title: '新步骤', instruction: '点击新按钮', selector: '#new' }],
    };

    const run = createPlannedAgentRun({
      mode: 'ai',
      prompt: '完成操作',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'staging',
      plannedPlan: finalPlan,
      planner: { source: 'model' },
      replanningHistory: [
        {
          cycle: 1,
          previousPlan: initialPlan,
          revisedPlan: finalPlan,
          failedStepIndex: 0,
          executions: [
            {
              stepIndex: 0,
              status: 'failed',
              summary: '旧步骤失败',
              evidence: '旧证据',
              failureReason: '旧失败',
              failureCategory: 'selector',
              recoveryStrategy: 'replaceSelector',
            },
          ],
        },
      ],
      executions: [
        {
          stepIndex: 0,
          status: 'failed',
          summary: '新步骤失败',
          evidence: '最终证据',
          failureReason: '最终失败',
          failureCategory: 'runtime',
          recoveryStrategy: 'stopAndReport',
        },
      ],
    });

    expect(run.status).toBe('failed');
    expect(run.failureReason).toBe('最终失败');
    expect(run.events.some((event) => event.message.includes('旧失败'))).toBe(true);
  });
});
