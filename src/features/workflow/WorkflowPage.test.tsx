import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDemoStudioState, testCaseToWorkflow } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { WorkflowPage } from './WorkflowPage.js';

const state = createDemoStudioState();
const workflow = testCaseToWorkflow(state.projects[0].testCases[0]);

const renderPage = (locale: 'zh-CN' | 'en-US' = 'zh-CN') => {
  return render(
    <I18nProvider locale={locale}>
      <WorkflowPage
        hasProject
        isRunning={false}
        onAppendStep={vi.fn()}
        onCreateWorkflow={vi.fn()}
        onDeleteStep={vi.fn()}
        onDuplicateStepType={vi.fn()}
        onRunWorkflow={vi.fn()}
        onSelectWorkflow={vi.fn()}
        onUpdateRuntimeProfile={vi.fn()}
        onUpdateWorkflow={vi.fn()}
        runId=""
        runLogs={[]}
        runStatus="neutral"
        runTitle=""
        runtimeProfile={state.runtimeProfile}
        selectedWorkflow={workflow}
        selectedWorkflowId={workflow.id}
        workflows={[workflow]}
      />
    </I18nProvider>,
  );
};

describe('WorkflowPage', () => {
  it('guides users to projects before creating a flow', () => {
    const onOpenProjects = vi.fn();

    render(
      <I18nProvider locale="zh-CN">
        <WorkflowPage
          hasProject={false}
          isRunning={false}
          onAppendStep={vi.fn()}
          onCreateWorkflow={vi.fn()}
          onDeleteStep={vi.fn()}
          onDuplicateStepType={vi.fn()}
          onOpenProjects={onOpenProjects}
          onRunWorkflow={vi.fn()}
          onSelectWorkflow={vi.fn()}
          onUpdateRuntimeProfile={vi.fn()}
          onUpdateWorkflow={vi.fn()}
          runId=""
          runLogs={[]}
          runStatus="neutral"
          runTitle=""
          runtimeProfile={state.runtimeProfile}
          selectedWorkflowId=""
          workflows={[]}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('选择一个项目')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建流程' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });

  it('uses Chinese workflow labels by default', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: '流程编排测试' })).toBeInTheDocument();
    expect(screen.getByText('流程库')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '添加步骤' }).length).toBeGreaterThan(0);
    expect(screen.getByText('运行配置')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '购物车到支付' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '步骤序列' })).toBeInTheDocument();
    expect(screen.queryByText('Flow Configuration')).not.toBeInTheDocument();
  });

  it('switches workflow actions to English', () => {
    renderPage('en-US');

    expect(screen.getByRole('heading', { level: 1, name: 'Workflow Testing' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add Step' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Run Current Flow' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Flow Name')).toBeInTheDocument();
    expect(screen.getByText('Business Tag')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Step Title').length).toBeGreaterThan(0);
  });

  it('shows one latest workflow revision and keeps published controls read-only until explicit editing', () => {
    const older = { ...workflow, name: '旧版流程', version: 1 };
    const latest = { ...workflow, name: '最新版流程', version: 2 };
    const onEditAsNewVersion = vi.fn();
    const onPublish = vi.fn();
    const onDiscard = vi.fn();

    const { rerender } = render(
      <I18nProvider locale="zh-CN">
        <WorkflowPage
          hasProject
          isEditable={false}
          isRunning={false}
          onAppendStep={vi.fn()}
          onCreateWorkflow={vi.fn()}
          onDeleteStep={vi.fn()}
          onDiscardDraft={onDiscard}
          onDuplicateStepType={vi.fn()}
          onEditAsNewVersion={onEditAsNewVersion}
          onPublish={onPublish}
          onRunWorkflow={vi.fn()}
          onSelectWorkflow={vi.fn()}
          onUpdateRuntimeProfile={vi.fn()}
          onUpdateWorkflow={vi.fn()}
          runId=""
          runLogs={[]}
          runStatus="neutral"
          runTitle=""
          runtimeProfile={state.runtimeProfile}
          selectedWorkflow={latest}
          selectedWorkflowId={latest.id}
          workflows={[older, latest]}
        />
      </I18nProvider>,
    );

    expect(screen.getAllByText('最新版流程')).toHaveLength(2);
    expect(screen.queryByText('旧版流程')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑为新版本' })).toBeInTheDocument();
    screen.getAllByLabelText('步骤标题').forEach((input) => expect(input).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '编辑为新版本' }));
    expect(onEditAsNewVersion).toHaveBeenCalledOnce();

    rerender(
      <I18nProvider locale="zh-CN">
        <WorkflowPage
          hasProject
          isEditable
          isRunning={false}
          onAppendStep={vi.fn()}
          onCreateWorkflow={vi.fn()}
          onDeleteStep={vi.fn()}
          onDiscardDraft={onDiscard}
          onDuplicateStepType={vi.fn()}
          onEditAsNewVersion={onEditAsNewVersion}
          onPublish={onPublish}
          onRunWorkflow={vi.fn()}
          onSelectWorkflow={vi.fn()}
          onUpdateRuntimeProfile={vi.fn()}
          onUpdateWorkflow={vi.fn()}
          runId=""
          runLogs={[]}
          runStatus="neutral"
          runTitle=""
          runtimeProfile={state.runtimeProfile}
          selectedWorkflow={latest}
          selectedWorkflowId={latest.id}
          workflows={[older, latest]}
        />
      </I18nProvider>,
    );

    screen.getAllByLabelText('步骤标题').forEach((input) => expect(input).toBeEnabled());
    expect(screen.getByRole('button', { name: '发布版本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放弃草稿' })).toBeInTheDocument();
  });

  it('disables workflow library selection and execution while a Case draft is open', () => {
    const secondWorkflow = { ...workflow, id: 'workflow-second', name: '第二个流程' };

    render(
      <I18nProvider locale="zh-CN">
        <WorkflowPage
          hasProject
          isEditable
          isRunning={false}
          onAppendStep={vi.fn()}
          onCreateWorkflow={vi.fn()}
          onDeleteStep={vi.fn()}
          onDiscardDraft={vi.fn()}
          onDuplicateStepType={vi.fn()}
          onEditAsNewVersion={vi.fn()}
          onPublish={vi.fn()}
          onRunWorkflow={vi.fn()}
          onSelectWorkflow={vi.fn()}
          onUpdateRuntimeProfile={vi.fn()}
          onUpdateWorkflow={vi.fn()}
          runId=""
          runLogs={[]}
          runStatus="neutral"
          runTitle=""
          runtimeProfile={state.runtimeProfile}
          selectedWorkflow={workflow}
          selectedWorkflowId={workflow.id}
          workflows={[workflow, secondWorkflow]}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('button', { name: /第二个流程/u })).toBeDisabled();
    screen.getAllByRole('button', { name: '执行当前流程' }).forEach((button) => expect(button).toBeDisabled());
  });
});
