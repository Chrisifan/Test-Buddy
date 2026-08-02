import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDemoStudioState, createTestStep, insertTestStep, removeTestStep } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { TestCaseManagementPage } from './TestCaseManagementPage.js';

const state = createDemoStudioState();
const project = state.projects[0]!;
const selectedTestCase = project.testCases[0]!;

function renderPage({
  locale = 'zh-CN',
  testCase = selectedTestCase,
  runBlocker,
  saveStatus = 'idle',
  onRetrySave = vi.fn(),
  onCreateTestCase = vi.fn(),
}: {
  locale?: 'zh-CN' | 'en-US';
  testCase?: typeof selectedTestCase | null;
  runBlocker?: 'emptySteps' | 'emptyTitle' | 'emptyInstruction' | 'missingRecording';
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  onRetrySave?: () => void;
  onCreateTestCase?: () => void;
} = {}) {
  const selectedCase = testCase ?? undefined;
  const onUpdateTestCase = vi.fn();
  const onMoveStep = vi.fn();

  return {
    onCreateTestCase,
    onMoveStep,
    onRetrySave,
    ...render(
      <I18nProvider locale={locale}>
        <TestCaseManagementPage
          isRunning={false}
          onCreateStep={vi.fn()}
          onCreateTestCase={onCreateTestCase}
          onCopyStep={vi.fn()}
          onDeleteStep={vi.fn()}
          onMoveStep={onMoveStep}
          onRetrySave={onRetrySave}
          onRunTestCase={vi.fn()}
          onSelectTestCase={vi.fn()}
          onUpdateTestCase={onUpdateTestCase}
          project={project}
          runBlocker={runBlocker}
          runStatus="neutral"
          saveStatus={saveStatus}
          selectedTestCase={selectedCase}
          selectedTestCaseId={selectedCase?.id ?? ''}
        />
      </I18nProvider>,
    ),
  };
}

function CasePageHarness({ initialTestCase = selectedTestCase }: { initialTestCase?: typeof selectedTestCase }) {
  const [testCase, setTestCase] = React.useState(initialTestCase);
  const nextStepId = React.useRef(1);

  const createStep = (type: typeof testCase.steps[number]['type'], index: number) => {
    const step = { ...createTestStep(type, nextStepId.current), id: `new-step-${nextStepId.current++}` };
    setTestCase((current) => ({ ...current, steps: insertTestStep(current.steps, step, index) }));
    return step.id;
  };

  return (
    <I18nProvider locale="zh-CN">
      <TestCaseManagementPage
        isRunning={false}
        onCopyStep={(stepId) => {
          const source = testCase.steps.find((step) => step.id === stepId);
          if (!source) return undefined;
          const copyId = `copy-step-${nextStepId.current++}`;
          setTestCase((current) => ({ ...current, steps: insertTestStep(current.steps, { ...source, id: copyId }, current.steps.findIndex((step) => step.id === stepId) + 1) }));
          return copyId;
        }}
        onCreateStep={createStep}
        onCreateTestCase={vi.fn()}
        onDeleteStep={(stepId) => setTestCase((current) => ({ ...current, steps: removeTestStep(current.steps, stepId) }))}
        onMoveStep={(stepId, index) => setTestCase((current) => ({ ...current, steps: current.steps }))}
        onRetrySave={vi.fn()}
        onRunTestCase={vi.fn()}
        onSelectTestCase={vi.fn()}
        onUpdateTestCase={(updater) => setTestCase((current) => updater(current))}
        project={{ ...project, testCases: [testCase] }}
        runStatus="neutral"
        saveStatus="idle"
        selectedTestCase={testCase}
        selectedTestCaseId={testCase.id}
      />
    </I18nProvider>
  );
}

describe('TestCaseManagementPage', () => {
  it('guides users to projects before opening the case composer', () => {
    const onOpenProjects = vi.fn();

    render(
      <I18nProvider locale="zh-CN">
        <TestCaseManagementPage
          isRunning={false}
          onCopyStep={vi.fn()}
          onCreateStep={vi.fn()}
          onCreateTestCase={vi.fn()}
          onDeleteStep={vi.fn()}
          onMoveStep={vi.fn()}
          onOpenProjects={onOpenProjects}
          onRetrySave={vi.fn()}
          onRunTestCase={vi.fn()}
          onSelectTestCase={vi.fn()}
          onUpdateTestCase={vi.fn()}
          runStatus="neutral"
          saveStatus="idle"
          selectedTestCaseId=""
        />
      </I18nProvider>,
    );

    expect(screen.getByText('尚未选择项目')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });

  it('renders the focused editor as a serial flow with the first step selected', async () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: '用例工作台' })).toBeInTheDocument();
    expect(await screen.findByText('步骤属性')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加步骤' })).toBeInTheDocument();
    expect(screen.getByText('开始').closest('[data-flow-terminal]')).toHaveAttribute('data-flow-terminal', 'start');
    expect(screen.getByText('结束').closest('[data-flow-terminal]')).toHaveAttribute('data-flow-terminal', 'end');
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('data-selected', 'true');
  });

  it('keeps a start-to-end flow when a case has no steps', () => {
    renderPage({ testCase: { ...selectedTestCase, steps: [] } });

    expect(screen.getByText('开始').closest('[data-flow-terminal]')).toHaveAttribute('data-flow-terminal', 'start');
    expect(screen.getByRole('button', { name: '在第 1 步前插入' })).toBeInTheDocument();
    expect(screen.getByText('结束').closest('[data-flow-terminal]')).toHaveAttribute('data-flow-terminal', 'end');
  });

  it('creates a selected step from the shared type menu and focuses its title', async () => {
    render(<CasePageHarness />);

    fireEvent.pointerDown(screen.getByRole('button', { name: '添加步骤' }), { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: '动作' }));

    const title = await screen.findByLabelText('步骤标题');
    expect(title).toHaveFocus();
  });

  it('starts dragging only from the handle and moves to an insertion zone', () => {
    const { onMoveStep } = renderPage();
    const step = selectedTestCase.steps[1]!;

    fireEvent.dragStart(screen.getByRole('button', { name: `拖拽步骤：${step.title}` }));
    fireEvent.drop(screen.getByRole('button', { name: '在第 1 步前插入' }));

    expect(onMoveStep).toHaveBeenCalledWith(step.id, 0);
  });

  it('does not persist a movement when a dragged step returns to its current position', () => {
    const { onMoveStep } = renderPage();
    const firstStep = selectedTestCase.steps[0]!;

    fireEvent.dragStart(screen.getByRole('button', { name: `拖拽步骤：${firstStep.title}` }));
    fireEvent.drop(screen.getByRole('button', { name: '在第 2 步前插入' }));

    expect(onMoveStep).not.toHaveBeenCalled();
  });

  it('provides a create-case entry point when the selected project has no test cases', () => {
    const onCreateTestCase = vi.fn();
    renderPage({ testCase: null, onCreateTestCase });

    fireEvent.click(screen.getByRole('button', { name: '新建用例' }));
    expect(onCreateTestCase).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('步骤属性')).not.toBeInTheDocument();
  });

  it('keeps save state as a tag and exposes a separate retry action', () => {
    const onRetrySave = vi.fn();
    renderPage({ saveStatus: 'error', onRetrySave });

    expect(screen.getByText('保存失败')).not.toHaveAttribute('role', 'button');
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it('disables execution and presents the localized blocker when a step is invalid', () => {
    renderPage({ runBlocker: 'missingRecording' });

    expect(screen.getByRole('button', { name: '运行用例' })).toBeDisabled();
    expect(screen.getByText('录制回放步骤需要绑定有效的录制资产。')).toBeInTheDocument();
  });

  it('converts a manual check into an editable AI assertion', () => {
    const manualCase = {
      ...selectedTestCase,
      steps: [{ id: 'manual-step', type: 'manual' as const, title: '确认订单状态', body: '订单状态显示为已支付' }],
    };

    render(<CasePageHarness initialTestCase={manualCase} />);

    fireEvent.click(screen.getByRole('button', { name: '转换为智能断言' }));

    expect(screen.getByRole('combobox', { name: '步骤类型' })).toHaveTextContent('断言');
    expect(screen.getByLabelText('执行指令')).toHaveValue('验证：订单状态显示为已支付');
  });

  it('uses English labels for the editor controls', async () => {
    renderPage({ locale: 'en-US' });

    expect(screen.getByRole('button', { name: 'Add Step' })).toBeInTheDocument();
    expect(await screen.findByText('Step Properties')).toBeInTheDocument();
    expect(screen.queryByText('添加步骤')).not.toBeInTheDocument();
  });
});
