import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState, testCaseToWorkflow } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { WorkflowPage } from './WorkflowPage.js';

const state = createInitialStudioState();
const workflow = testCaseToWorkflow(state.projects[0].testCases[0]);

function renderPage(locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  return render(
    <I18nProvider locale={locale}>
      <WorkflowPage
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
}

describe('WorkflowPage', () => {
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
});
