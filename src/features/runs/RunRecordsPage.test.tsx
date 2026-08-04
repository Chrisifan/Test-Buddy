import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RunRecordsPage } from './RunRecordsPage.js';
import { createDemoStudioState, createPrdDocumentAsset, type RunDetail } from '../../../shared/studio.js';
import { createStubAgentRun } from '../../../shared/agentStub.js';
import { I18nProvider } from '../../i18n/index.js';

describe('RunRecordsPage', () => {
  it('shows the linked PRD source for a generated test run', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。',
    });
    const projectWithDocument = { ...project, documents: [document] };
    const detail: RunDetail = {
      id: 'run-prd-source',
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      documentId: document.id,
      environmentId: project.testCases[0]!.environmentId,
      title: '需求路径回归',
      status: 'passed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:01',
      summary: '需求路径已通过。',
      logs: [],
      steps: [],
      artifacts: [],
    };

    render(
      <RunRecordsPage
        onSelectRun={vi.fn()}
        project={projectWithDocument}
        recentRuns={[{
          id: detail.id,
          name: detail.title,
          status: detail.status,
          duration: detail.duration,
          summary: detail.summary,
          projectId: detail.projectId,
          testCaseId: detail.testCaseId,
          documentId: detail.documentId,
          environmentId: detail.environmentId,
        }]}
        runDetails={[detail]}
        selectedRunId={detail.id}
      />,
    );

    expect(screen.getAllByText(`PRD：${document.name}`).length).toBeGreaterThan(0);
  });

  it('shows aggregated analysis signals for the current project', () => {
    const state = createDemoStudioState();
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
    expect(screen.getByRole('heading', { level: 1, name: '运行记录' })).toBeInTheDocument();
    expect(screen.getByText('运行列表')).toBeInTheDocument();
    expect(screen.queryByText('Quality Signal')).not.toBeInTheDocument();
  });

  it('clusters equivalent failure reasons across visible runs', () => {
    const state = createDemoStudioState();
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
    const state = createDemoStudioState();
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

  it('reruns a completed record through its original test case', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const detail: RunDetail = {
      id: 'run-rerun',
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      environmentId: project.testCases[0]!.environmentId,
      title: project.testCases[0]!.name,
      status: 'failed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:01',
      summary: '登录失败。',
      logs: [],
      steps: [],
      artifacts: [],
    };
    const onRerunTestCase = vi.fn();

    render(
      <RunRecordsPage
        onRerunTestCase={onRerunTestCase}
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[{
          id: detail.id,
          name: detail.title,
          status: detail.status,
          duration: detail.duration,
          summary: detail.summary,
          projectId: detail.projectId,
          testCaseId: detail.testCaseId,
          environmentId: detail.environmentId,
        }]}
        runDetails={[detail]}
        selectedRunId={detail.id}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '复跑用例' }));

    expect(onRerunTestCase).toHaveBeenCalledWith(detail);
  });

  it('exposes persisted Reporter fixes as an explicit fix-draft action', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const agentRun = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '验证订单列表刷新',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: project.environments[0]!.name,
    });
    agentRun.status = 'failed';
    agentRun.reporter = {
      summary: '订单列表未及时刷新。',
      evidenceSummary: '页面仍显示旧数据。',
      failureAnalysis: '刷新后的数据接口或页面稳定等待不足。',
      suggestedFixes: ['增加订单列表的数据就绪等待', '检查 /api/orders 响应'],
      recoveryPlan: {
        failedStepId: project.testCases[0]!.steps[0]!.id,
        strategy: 'waitForDataReady',
        reason: '刷新后的数据接口或页面稳定等待不足。',
      },
      modelName: 'reporter-large',
    };
    const detail: RunDetail = {
      id: 'run-reporter-fixes',
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      environmentId: project.testCases[0]!.environmentId,
      title: project.testCases[0]!.name,
      status: 'failed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:03',
      summary: '订单列表验证失败。',
      logs: [],
      steps: [],
      artifacts: [],
      agentRun,
    };
    const onCreateReporterFixDraft = vi.fn();

    render(
      <RunRecordsPage
        onCreateReporterFixDraft={onCreateReporterFixDraft}
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[{
          id: detail.id,
          name: detail.title,
          status: detail.status,
          duration: detail.duration,
          summary: detail.summary,
          projectId: detail.projectId,
          testCaseId: detail.testCaseId,
          environmentId: detail.environmentId,
        }]}
        runDetails={[detail]}
        selectedRunId={detail.id}
      />,
    );

    expect(screen.getByText('刷新后的数据接口或页面稳定等待不足。')).toBeInTheDocument();
    expect(screen.getByText('增加订单列表的数据就绪等待')).toBeInTheDocument();
    expect(screen.getByText('受控恢复计划')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创建修复草稿' }));

    expect(onCreateReporterFixDraft).toHaveBeenCalledWith(detail, agentRun.reporter);
  });

  it('filters runs by test case and compares the selected run with its prior run in the same environment', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const testCase = project.testCases[0]!;
    const environment = project.environments.find((item) => item.id === testCase.environmentId)!;
    const baseline: RunDetail = {
      id: 'run-compare-baseline',
      projectId: project.id,
      testCaseId: testCase.id,
      environmentId: environment.id,
      title: '登录回归',
      status: 'failed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(1_000).toISOString(),
      duration: '00:00:01',
      summary: '登录按钮定位失败。',
      logs: [],
      steps: [{ id: 'baseline-step', stepId: testCase.steps[0]!.id, title: testCase.steps[0]!.title, status: 'failed', message: '定位失败。' }],
      artifacts: [{ id: 'baseline-shot', type: 'screenshot', label: '失败截图', path: 'memory://baseline-shot' }],
    };
    const current: RunDetail = {
      ...baseline,
      id: 'run-compare-current',
      status: 'passed',
      startedAt: new Date(2_000).toISOString(),
      endedAt: new Date(4_000).toISOString(),
      duration: '00:00:02',
      summary: '登录验证通过。',
      steps: [{ ...baseline.steps[0]!, id: 'current-step', status: 'passed', message: '验证通过。' }],
      artifacts: [
        ...baseline.artifacts,
        { id: 'current-report', type: 'report', label: '运行报告', path: 'memory://current-report' },
      ],
    };
    const otherCase = project.testCases.find((item) => item.id !== testCase.id)!;
    const otherRun: RunDetail = {
      ...current,
      id: 'run-compare-other',
      testCaseId: otherCase.id,
      environmentId: otherCase.environmentId,
      title: '不应参与对比的用例',
    };
    const summaries = [current, baseline, otherRun].map((detail) => ({
      ...state.recentRuns[0]!,
      id: detail.id,
      name: detail.title,
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      projectId: detail.projectId,
      testCaseId: detail.testCaseId,
      environmentId: detail.environmentId,
      startedAt: detail.startedAt,
    }));

    render(
      <RunRecordsPage
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={summaries}
        runDetails={[current, baseline, otherRun]}
        selectedRunId={current.id}
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: '运行对比' })).toBeInTheDocument();
    expect(screen.getByText('结果：失败 -> 通过')).toBeInTheDocument();
    expect(screen.getByText('步骤状态变化：1/1')).toBeInTheDocument();
    expect(screen.getByText('产物变化：1')).toBeInTheDocument();
    expect(screen.getByText('耗时：00:00:01 -> 00:00:02')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: '用例' }));
    fireEvent.click(screen.getByRole('option', { name: testCase.name }));

    expect(screen.queryByText(otherRun.title)).not.toBeInTheDocument();
  });

  it('switches between persisted agent segments for a mixed test case', () => {
    const state = createDemoStudioState();
    const project = state.projects[0];
    const recordingRun = createStubAgentRun({
      mode: 'ai',
      prompt: '回放登录录制',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'Staging',
    });
    recordingRun.intent.source = 'recording';
    const workflowRun = createStubAgentRun({
      mode: 'aiAssert',
      prompt: '确认登录成功',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'Staging',
    });
    workflowRun.intent.source = 'workflow';
    const detail: RunDetail = {
      id: 'mixed-case-run',
      projectId: project.id,
      testCaseId: project.testCases[0]!.id,
      environmentId: project.environments[0]!.id,
      title: '登录混合用例',
      status: 'passed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:02',
      summary: '录制回放和登录验证均已完成。',
      logs: [],
      steps: [],
      artifacts: [],
      agentRuns: [recordingRun, workflowRun],
    };
    const summary = {
      ...state.recentRuns[0]!,
      id: detail.id,
      name: detail.title,
      status: detail.status,
      summary: detail.summary,
      projectId: detail.projectId,
      testCaseId: detail.testCaseId,
      environmentId: detail.environmentId,
    };

    render(
      <RunRecordsPage
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[summary]}
        runDetails={[detail]}
        selectedRunId={detail.id}
      />,
    );

    expect(screen.getByRole('tablist', { name: '执行段' })).toBeInTheDocument();
    const segments = screen.getAllByRole('tab');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(segments[1]!);

    expect(segments[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('流程执行')).toBeInTheDocument();
  });

  it('submits a required evidence note for a pending manual step', () => {
    const state = createDemoStudioState();
    const project = {
      ...state.projects[0]!,
      testCases: [
        {
          id: 'case-manual',
          kind: 'scenario' as const,
          groupId: state.projects[0]!.groups[0]!.id,
          environmentId: state.projects[0]!.environments[0]!.id,
          source: 'manual' as const,
          name: '人工检查用例',
          category: '核心链路',
          lastEdited: '刚刚',
          url: state.projects[0]!.environments[0]!.url,
          notes: '',
          steps: [{ id: 'manual-step', type: 'manual' as const, title: '审核付款页', body: '确认付款信息' }],
        },
      ],
    };
    const detail: RunDetail = {
      id: 'run-manual',
      projectId: project.id,
      testCaseId: 'case-manual',
      environmentId: project.environments[0]!.id,
      title: '人工检查用例',
      status: 'neutral',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:01',
      summary: '等待人工检查。',
      logs: [],
      steps: [
        {
          id: 'run-manual-step',
          stepId: 'manual-step',
          title: '审核付款页',
          status: 'neutral',
          message: '等待人工检查。',
        },
      ],
      artifacts: [],
    };
    const onConfirmManualStep = vi.fn();

    render(
      <RunRecordsPage
        onConfirmManualStep={onConfirmManualStep}
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[{
          id: detail.id,
          name: detail.title,
          status: detail.status,
          duration: detail.duration,
          summary: detail.summary,
          projectId: detail.projectId,
          testCaseId: detail.testCaseId,
          environmentId: detail.environmentId,
        }]}
        runDetails={[detail]}
        selectedRunId={detail.id}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: '确认通过' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('为 审核付款页 填写人工确认说明'), {
      target: { value: '订单号和付款金额已核对。' },
    });
    fireEvent.click(confirmButton);

    expect(onConfirmManualStep).toHaveBeenCalledWith(
      detail.id,
      'manual-step',
      'passed',
      '订单号和付款金额已核对。',
    );
  });

  it('attaches a fresh browser snapshot to a manual confirmation', async () => {
    const state = createDemoStudioState();
    const project = {
      ...state.projects[0]!,
      testCases: [
        {
          id: 'case-manual',
          kind: 'scenario' as const,
          groupId: state.projects[0]!.groups[0]!.id,
          environmentId: state.projects[0]!.environments[0]!.id,
          source: 'manual' as const,
          name: '人工检查用例',
          category: '核心链路',
          lastEdited: '刚刚',
          url: state.projects[0]!.environments[0]!.url,
          notes: '',
          steps: [{ id: 'manual-step', type: 'manual' as const, title: '审核付款页', body: '确认付款信息' }],
        },
      ],
    };
    const detail: RunDetail = {
      id: 'run-manual-snapshot',
      projectId: project.id,
      testCaseId: 'case-manual',
      environmentId: project.environments[0]!.id,
      title: '人工检查用例',
      status: 'neutral',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:01',
      summary: '等待人工检查。',
      logs: [],
      steps: [
        {
          id: 'run-manual-snapshot-step',
          stepId: 'manual-step',
          title: '审核付款页',
          status: 'neutral',
          message: '等待人工检查。',
        },
      ],
      artifacts: [],
    };
    const onCaptureManualEvidence = vi.fn().mockResolvedValue('/tmp/manual-proof.png');
    const onConfirmManualStep = vi.fn();

    render(
      <RunRecordsPage
        onCaptureManualEvidence={onCaptureManualEvidence}
        onConfirmManualStep={onConfirmManualStep}
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[{
          id: detail.id,
          name: detail.title,
          status: detail.status,
          duration: detail.duration,
          summary: detail.summary,
          projectId: detail.projectId,
          testCaseId: detail.testCaseId,
          environmentId: detail.environmentId,
        }]}
        runDetails={[detail]}
        selectedRunId={detail.id}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '采集当前页面' }));
    await waitFor(() => expect(onCaptureManualEvidence).toHaveBeenCalledWith(detail.id, 'manual-step'));

    const preview = await screen.findByAltText('人工检查截图证据：审核付款页');
    expect(preview).toHaveAttribute('src', 'file:///tmp/manual-proof.png');

    fireEvent.change(screen.getByLabelText('为 审核付款页 填写人工确认说明'), {
      target: { value: '订单号和付款金额已核对。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认通过' }));

    expect(onConfirmManualStep).toHaveBeenCalledWith(
      detail.id,
      'manual-step',
      'passed',
      '订单号和付款金额已核对。',
      '/tmp/manual-proof.png',
    );
  });

  it('attaches, removes, and submits managed file evidence for a manual confirmation', async () => {
    const state = createDemoStudioState();
    const project = {
      ...state.projects[0]!,
      testCases: [
        {
          id: 'case-manual-attachment',
          kind: 'scenario' as const,
          groupId: state.projects[0]!.groups[0]!.id,
          environmentId: state.projects[0]!.environments[0]!.id,
          source: 'manual' as const,
          name: '人工检查用例',
          category: '核心链路',
          lastEdited: '刚刚',
          url: state.projects[0]!.environments[0]!.url,
          notes: '',
          steps: [{ id: 'manual-step', type: 'manual' as const, title: '审核付款页', body: '确认付款信息' }],
        },
      ],
    };
    const detail: RunDetail = {
      id: 'run-manual-attachment',
      projectId: project.id,
      testCaseId: 'case-manual-attachment',
      environmentId: project.environments[0]!.id,
      title: '人工检查用例',
      status: 'neutral',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:01',
      summary: '等待人工检查。',
      logs: [],
      steps: [{
        id: 'run-manual-attachment-step',
        stepId: 'manual-step',
        title: '审核付款页',
        status: 'neutral',
        message: '等待人工检查。',
      }],
      artifacts: [],
    };
    const attachment = {
      id: 'artifact-manual-proof',
      type: 'attachment' as const,
      label: 'payment-proof.pdf',
      path: '/tmp/playtest-artifacts/payment-proof.pdf',
    };
    const onAttachManualEvidence = vi.fn().mockResolvedValue(attachment);
    const onConfirmManualStep = vi.fn();

    render(
      <RunRecordsPage
        onAttachManualEvidence={onAttachManualEvidence}
        onConfirmManualStep={onConfirmManualStep}
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[{
          id: detail.id,
          name: detail.title,
          status: detail.status,
          duration: detail.duration,
          summary: detail.summary,
          projectId: detail.projectId,
          testCaseId: detail.testCaseId,
          environmentId: detail.environmentId,
        }]}
        runDetails={[detail]}
        selectedRunId={detail.id}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '附加文件证据' }));
    await waitFor(() => expect(onAttachManualEvidence).toHaveBeenCalledWith(detail.id, 'manual-step'));
    expect(await screen.findByText('payment-proof.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除附件 payment-proof.pdf' }));
    expect(screen.queryByText('payment-proof.pdf')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '附加文件证据' }));
    await waitFor(() => expect(screen.getByText('payment-proof.pdf')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('为 审核付款页 填写人工确认说明'), {
      target: { value: '订单号和付款金额已核对。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认通过' }));

    expect(onConfirmManualStep).toHaveBeenCalledWith(
      detail.id,
      'manual-step',
      'passed',
      '订单号和付款金额已核对。',
      undefined,
      [attachment],
    );
  });

  it('shows structured agent evidence for natural language runs', () => {
    const state = createDemoStudioState();
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
    expect(screen.getByText('Model cost for this event · 2 model calls · 150 tokens · Model duration 240 ms')).toBeInTheDocument();
    expect(screen.getByText('Evidence Trail')).toBeInTheDocument();
    expect(screen.getByText('Selected Evidence')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect agent:browser-action evidence' }));
    expect(screen.getByText('Model cost for this event')).toBeInTheDocument();
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
    const state = createDemoStudioState();
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

    expect(screen.getByRole('heading', { level: 1, name: 'Run Records' })).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });

  it('shows project coverage risk even when no run is selected', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;

    render(
      <RunRecordsPage
        onSelectRun={vi.fn()}
        project={project}
        recentRuns={[]}
        runDetails={[]}
        selectedRunId=""
      />,
    );

    expect(screen.getByRole('heading', { name: '跨运行覆盖风险' })).toBeInTheDocument();
    expect(screen.getAllByText(/从未运行/).length).toBe(project.testCases.length);
  });
});
