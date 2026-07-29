import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RunRecordsPage } from './RunRecordsPage.js';
import { createInitialStudioState, type RunDetail } from '../../../shared/studio.js';
import { createStubAgentRun } from '../../../shared/agentStub.js';
import { I18nProvider } from '../../i18n/index.js';

describe('RunRecordsPage', () => {
  it('shows aggregated analysis signals for the current project', () => {
    const state = createInitialStudioState();
    const project = state.projects[0];
    const failedRunDetail: RunDetail = {
      id: 'run-2397',
      projectId: project.id,
      testCaseId: 'wf-003',
      environmentId: 'env-staging',
      title: 'Login happy path',
      status: 'failed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:51',
      summary: '验证码遮罩导致登录按钮定位失败。',
      failureReason: '验证码遮罩导致登录按钮定位失败。',
      logs: ['[13:20] Login failed'],
      steps: [
        {
          id: 'run-step-login',
          stepId: 'step-004',
          title: '点击登录',
          status: 'failed',
          message: '登录按钮被遮罩覆盖。',
        },
      ],
      artifacts: [],
    };

    render(
      <RunRecordsPage
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={state.recentRuns}
        runDetails={[failedRunDetail]}
        selectedRunId="run-2397"
      />,
    );

    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getAllByText('高风险')).toHaveLength(2);
    expect(screen.getByText('核心链路 · 1/3 失败')).toBeInTheDocument();
    expect(screen.getByText('Staging · 1/3 失败')).toBeInTheDocument();
    expect(screen.getByText('最近失败原因：验证码遮罩导致登录按钮定位失败。')).toBeInTheDocument();
    expect(screen.getByText('运行智能分析')).toBeInTheDocument();
    expect(screen.getByText('运行列表')).toBeInTheDocument();
    expect(screen.queryByText('Quality Signal')).not.toBeInTheDocument();
  });

  it('clusters equivalent failure reasons across visible runs', () => {
    const state = createInitialStudioState();
    const project = state.projects[0];
    const failureReason = '验证码遮罩导致登录按钮定位失败。';
    const firstRun: RunDetail = {
      id: 'run-cluster-1',
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      environmentId: project.environments[0]!.id,
      title: '登录流程 A',
      status: 'failed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:12',
      summary: failureReason,
      failureReason,
      logs: [],
      steps: [],
      artifacts: [],
    };
    const secondRun: RunDetail = {
      ...firstRun,
      id: 'run-cluster-2',
      title: '登录流程 B',
      failureReason: '验证码遮罩导致登录按钮定位失败',
    };
    const firstSummary = {
      ...state.recentRuns[0]!,
      id: firstRun.id,
      projectId: project.id,
      testCaseId: firstRun.testCaseId,
      environmentId: firstRun.environmentId,
      name: firstRun.title,
      status: 'failed' as const,
      summary: failureReason,
    };
    const secondSummary = {
      ...firstSummary,
      id: secondRun.id,
      name: secondRun.title,
      summary: secondRun.failureReason!,
    };

    render(
      <RunRecordsPage
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[firstSummary, secondSummary]}
        runDetails={[firstRun, secondRun]}
        selectedRunId={firstRun.id}
      />,
    );

    expect(screen.getByText('失败模式')).toBeInTheDocument();
    expect(screen.getAllByText(failureReason)).toHaveLength(2);
    expect(screen.getByText('2 次')).toBeInTheDocument();
    expect(screen.queryByText('2 个模式')).not.toBeInTheDocument();
  });

  it('derives a failure trend from chronological run samples', () => {
    const state = createInitialStudioState();
    const project = state.projects[0];
    const statuses: Array<'passed' | 'failed'> = ['passed', 'passed', 'failed', 'failed'];
    const summaries = statuses.map((status, index) => ({
      ...state.recentRuns[0]!,
      id: `run-trend-${index}`,
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      environmentId: project.environments[0]!.id,
      name: `趋势样本 ${index + 1}`,
      status,
      startedAt: new Date(index * 60_000).toISOString(),
      summary: status === 'failed' ? '登录失败' : '登录成功',
    }));
    const selectedDetail: RunDetail = {
      id: summaries[0]!.id,
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      environmentId: project.environments[0]!.id,
      title: summaries[0]!.name,
      status: summaries[0]!.status,
      startedAt: summaries[0]!.startedAt!,
      endedAt: summaries[0]!.startedAt,
      duration: '00:00:01',
      summary: summaries[0]!.summary,
      logs: [],
      steps: [],
      artifacts: [],
    };

    render(
      <RunRecordsPage
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={summaries}
        runDetails={[selectedDetail]}
        selectedRunId={selectedDetail.id}
      />,
    );

    expect(screen.getByText('失败趋势')).toBeInTheDocument();
    expect(screen.getByText('失败率上升 · +100%')).toBeInTheDocument();
  });

  it('shows structured agent evidence for natural language runs', () => {
    const state = createInitialStudioState();
    const project = state.projects[0];
    const agentRun = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '断言页面包含 登录成功',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'Staging',
      browserSession: {
        status: 'ready',
        currentUrl: 'https://example.test/dashboard',
        pageTitle: 'Dashboard',
        screenshotPath: '/tmp/dashboard.png',
      },
      observation: {
        textSummary: '登录成功 工作台 报表总览',
        domSummary: '页面文本约 12 字符；发现 1 个关键可交互元素、1 个表格、1 个图表。',
        interactiveElements: ['button "导出" #export'],
        consoleMessages: ['error: chart render failed once'],
        networkHints: ['GET https://example.test/api/chart -> net::ERR_FAILED'],
        tables: [
          {
            index: 1,
            caption: '订单列表',
            rowCount: 2,
            columnCount: 3,
            headers: ['交易对', '成交量', '状态'],
            filters: [{ label: '状态', value: '成功' }],
            pagination: { currentPage: 2, totalPages: 4, totalItems: 36, pageSize: 10 },
            aggregates: [{ label: '成交量', value: '200' }],
            sortStates: [{ column: '成交量', direction: 'descending' }],
            sampleRows: [['BTC/USDT', '120', '成功']],
          },
        ],
        charts: [
          {
            index: 1,
            title: '成交趋势',
            kind: 'canvas',
            width: 640,
            height: 240,
            rendered: true,
            legends: ['买入', '卖出'],
            tooltip: '二月成交量：180',
            dataPoints: [
              { series: '买入', label: '一月', value: 120 },
              { series: '买入', label: '二月', value: 180 },
            ],
            seriesTrends: [{ series: '买入', trend: 'rising' }],
            trend: 'rising',
          },
        ],
      },
      verificationStatus: 'passed',
      verificationSummary: '页面包含「登录成功」已通过。',
      verificationEvidence: '页面文本长度 12，期望片段：登录成功',
      reportArtifactPath: '/tmp/midscene-login.html',
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
          modelName: 'ui-agent-model',
          modelFamily: 'openai',
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
        replanningCycles: 1,
        retryAttempts: 1,
        dynamicWaitAttempts: 1,
        selectorFallbackAttempts: 1,
        byIntent: {
          insight: { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 },
        },
        byModel: {
          'ui-agent-model': { promptTokens: 120, completionTokens: 30, totalTokens: 150, calls: 2 },
        },
      },
    });
    const historicalStepId = 'historical-step';
    const historicalScreenshot = {
      id: `${agentRun.runId}-artifact-historical-screenshot`,
      type: 'screenshot' as const,
      label: '旧计划失败截图',
      path: '/tmp/navigation-failed.png',
    };
    agentRun.artifacts.push(historicalScreenshot);
    agentRun.events.push(
      {
        id: `${agentRun.runId}-event-historical-observation`,
        runId: agentRun.runId,
        type: 'agent:observation-created',
        message: '仍停留在起始页',
        status: 'failed',
        stepId: historicalStepId,
        observation: {
          id: `${agentRun.runId}-observation-historical`,
          stepId: historicalStepId,
          url: 'https://example.test/start',
          title: 'Start',
          screenshotPath: historicalScreenshot.path,
          domSummary: '仍停留在起始页',
          createdAt: agentRun.startedAt,
        },
        browserSession: {
          status: 'ready',
          currentUrl: 'https://example.test/start',
          pageTitle: 'Start',
          screenshotPath: historicalScreenshot.path,
        },
        createdAt: agentRun.startedAt,
      },
      {
        id: `${agentRun.runId}-event-historical-verification`,
        runId: agentRun.runId,
        type: 'agent:assertion-result',
        message: 'Navigation failed: net::ERR_NAME_NOT_RESOLVED',
        status: 'failed',
        stepId: historicalStepId,
        verification: {
          id: `${agentRun.runId}-verification-historical`,
          stepId: historicalStepId,
          status: 'failed',
          summary: '导航失败',
          evidence: 'Navigation failed: net::ERR_NAME_NOT_RESOLVED',
          createdAt: agentRun.startedAt,
        },
        createdAt: agentRun.startedAt,
      },
      {
        id: `${agentRun.runId}-event-historical-artifact`,
        runId: agentRun.runId,
        type: 'agent:artifact-created',
        message: '旧计划失败截图已归档。',
        status: 'failed',
        stepId: historicalStepId,
        artifact: historicalScreenshot,
        createdAt: agentRun.startedAt,
      },
      {
        id: `${agentRun.runId}-event-plan-revised-1`,
        runId: agentRun.runId,
        type: 'agent:plan-revised',
        message: '第 1 次重规划：旧计划 -> 新计划',
        status: 'neutral',
        stepId: historicalStepId,
        planRevision: {
          cycle: 1,
          previousPlanTitle: '旧计划',
          revisedPlanTitle: '新计划',
          triggerStepId: historicalStepId,
          triggerStepTitle: '进入工作台',
          triggerStatus: 'failed',
          failureCategory: 'navigation',
          recoveryStrategy: 'replanNavigation',
        },
        createdAt: agentRun.startedAt,
      },
    );
    const runDetail: RunDetail = {
      id: agentRun.runId,
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      environmentId: project.environments[0]!.id,
      title: agentRun.plan.title,
      status: agentRun.status,
      startedAt: agentRun.startedAt,
      endedAt: agentRun.endedAt,
      duration: '00:00:01',
      summary: agentRun.summary,
      logs: agentRun.events.map((event) => event.message),
      steps: [],
      artifacts: agentRun.artifacts,
      agentRun,
    };

    render(
      <I18nProvider locale="en-US">
        <RunRecordsPage
          onSelectRun={vi.fn()}
          project={project}
          recentRuns={[
            {
              id: agentRun.runId,
              name: agentRun.plan.title,
              status: agentRun.status,
              duration: '00:00:01',
              summary: agentRun.summary,
              projectId: project.id,
              testCaseId: project.testCases[0]!.id,
              environmentId: project.environments[0]!.id,
            },
          ]}
          runDetails={[runDetail]}
          selectedRunId={agentRun.runId}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Execution Evidence')).toBeInTheDocument();
    expect(screen.getAllByText('登录成功 工作台 报表总览').length).toBeGreaterThan(0);
    expect(screen.getByText('button "导出" #export')).toBeInTheDocument();
    expect(screen.getByText('Table: 订单列表')).toBeInTheDocument();
    expect(screen.getByText('2 rows / 3 columns')).toBeInTheDocument();
    expect(screen.getByText('交易对 · 成交量 · 状态')).toBeInTheDocument();
    expect(screen.getByText('Sort: 成交量 descending')).toBeInTheDocument();
    expect(screen.getByText('Filters: 状态 = 成功')).toBeInTheDocument();
    expect(screen.getByText('Pagination: page 2 / 4 · 36 items · 10 per page')).toBeInTheDocument();
    expect(screen.getByText('Aggregates: 成交量 = 200')).toBeInTheDocument();
    expect(screen.getByText('BTC/USDT · 120 · 成功')).toBeInTheDocument();
    expect(screen.getByText('Chart: 成交趋势')).toBeInTheDocument();
    expect(screen.getByText('canvas · 640x240 · Rendered · Legends: 买入 / 卖出')).toBeInTheDocument();
    expect(screen.getByText('Tooltip: 二月成交量：180 · Data: 买入 / 一月 = 120 / 买入 / 二月 = 180 · Series trends: 买入 Rising · Trend: Rising')).toBeInTheDocument();
    expect(screen.getAllByText('页面包含「登录成功」已通过。').length).toBeGreaterThan(0);
    expect(screen.getByText('error: chart render failed once')).toBeInTheDocument();
    expect(screen.getByText('GET https://example.test/api/chart -> net::ERR_FAILED')).toBeInTheDocument();
    expect(screen.getByText('Agent Event Stream')).toBeInTheDocument();
    expect(screen.getByText('Agent Models')).toBeInTheDocument();
    expect(screen.getByText('Planner · planner-large')).toBeInTheDocument();
    expect(screen.getByText('Executor · ui-agent-model')).toBeInTheDocument();
    expect(screen.getByText('360 ms')).toBeInTheDocument();
    expect(screen.getByText('2 model calls')).toBeInTheDocument();
    expect(screen.getByText('150 tokens')).toBeInTheDocument();
    expect(screen.getByText('Replanning limit 12')).toBeInTheDocument();
    expect(screen.getByText('Replanned 1 time')).toBeInTheDocument();
    expect(screen.getByText('Retried 1 time')).toBeInTheDocument();
    expect(screen.getByText('Dynamic wait 1 time')).toBeInTheDocument();
    expect(screen.getByText('Selector fallback 1 time')).toBeInTheDocument();
    expect(screen.getByText('Evidence Trail')).toBeInTheDocument();
    expect(screen.getByText('Selected Evidence')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Inspect agent:assertion-result evidence' })[0]!);
    expect(screen.getByText('Verification Evidence')).toBeInTheDocument();
    expect(screen.getByText('页面文本长度 12，期望片段：登录成功')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect agent:plan-revised evidence' }));
    expect(screen.getAllByText('仍停留在起始页').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Navigation failed: net::ERR_NAME_NOT_RESOLVED').length).toBeGreaterThan(0);
    expect(screen.getByText('https://example.test/start')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Evidence screenshot preview' })).toHaveAttribute(
      'src',
      'file:///tmp/navigation-failed.png',
    );
    expect(screen.getByRole('button', { name: 'Open Midscene 执行报告' })).not.toHaveAttribute('href');
    expect(screen.getByRole('button', { name: 'Export Midscene 执行报告' })).toBeInTheDocument();
  });

  it('renders run navigation in English when selected', () => {
    const state = createInitialStudioState();
    const project = state.projects[0];

    render(
      <I18nProvider locale="en-US">
        <RunRecordsPage
          onSelectRun={vi.fn()}
          project={project}
          recentRuns={state.recentRuns}
          runDetails={[]}
          selectedRunId=""
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Run Intelligence')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Run Records' })).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });
});
