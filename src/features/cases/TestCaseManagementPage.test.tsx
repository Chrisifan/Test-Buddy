import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  createDemoStudioState,
  createTestStep,
  insertTestStep,
  removeTestStep,
  type DeterministicTestAction,
  type ExplicitTestAssertion,
  type TestCaseDraft,
} from '../../../shared/studio.js';
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
    onUpdateTestCase,
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

function createStructuredActionCase(
  action: DeterministicTestAction,
  reviewStatus: 'needsReview' | 'confirmed' = 'needsReview',
): TestCaseDraft {
  return {
    ...selectedTestCase,
    steps: [
      {
        id: 'structured-action-step',
        type: 'ai',
        title: '进入订单页',
        body: '打开订单列表并等待页面可用。',
        execution: {
          schemaVersion: 2,
          intent: '进入订单页',
          reviewStatus,
          actionRisk: 'low',
          action,
          provenance: {
            source: 'agentRun',
            runId: 'run-structured-action',
            stepId: 'agent-step-structured-action',
          },
        },
      },
    ],
  };
}

function createStructuredAssertionCase(
  assertion: ExplicitTestAssertion,
  reviewStatus: 'needsReview' | 'confirmed' = 'needsReview',
): TestCaseDraft {
  return {
    ...selectedTestCase,
    steps: [
      {
        id: 'structured-assertion-step',
        type: 'aiAssert',
        title: '确认订单状态',
        body: '确认页面显示订单已创建。',
        execution: {
          schemaVersion: 2,
          intent: '确认订单状态',
          reviewStatus,
          actionRisk: 'low',
          assertion,
          provenance: {
            source: 'agentRun',
            runId: 'run-structured-assertion',
            stepId: 'agent-step-structured-assertion',
          },
        },
      },
    ],
  };
}

function CasePageHarness({
  initialProject = project,
  initialTestCase = selectedTestCase,
}: {
  initialProject?: typeof project;
  initialTestCase?: typeof selectedTestCase;
}) {
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
        project={{ ...initialProject, testCases: [testCase] }}
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

  it('lets a user confirm a supported structured deterministic action', () => {
    const testCase = createStructuredActionCase({ kind: 'navigate', url: 'https://example.test/orders' });
    const { onUpdateTestCase } = renderPage({ testCase });

    fireEvent.click(screen.getByRole('button', { name: '确认确定性动作' }));

    const updater = onUpdateTestCase.mock.calls[0]?.[0] as ((testCase: TestCaseDraft) => TestCaseDraft) | undefined;
    expect(updater).toBeTypeOf('function');
    expect(updater?.(testCase).steps[0]?.execution?.reviewStatus).toBe('confirmed');
  });

  it('lets a user revoke confirmation for a structured deterministic action', () => {
    const testCase = createStructuredActionCase(
      { kind: 'waitForSelector', locator: { selector: '#orders', quality: 'acceptable' } },
      'confirmed',
    );
    const { onUpdateTestCase } = renderPage({ testCase });

    fireEvent.click(screen.getByRole('button', { name: '撤销确认' }));

    const updater = onUpdateTestCase.mock.calls[0]?.[0] as ((testCase: TestCaseDraft) => TestCaseDraft) | undefined;
    expect(updater).toBeTypeOf('function');
    expect(updater?.(testCase).steps[0]?.execution?.reviewStatus).toBe('needsReview');
  });

  it('lets a user confirm a supported structured deterministic assertion', () => {
    const testCase = createStructuredAssertionCase({
      id: 'assert-order-created',
      version: 1,
      kind: 'pageContains',
      expected: '订单已创建',
    });
    const { onUpdateTestCase } = renderPage({ testCase });

    fireEvent.click(screen.getByRole('button', { name: '确认确定性断言' }));

    const updater = onUpdateTestCase.mock.calls[0]?.[0] as ((testCase: TestCaseDraft) => TestCaseDraft) | undefined;
    expect(updater).toBeTypeOf('function');
    expect(updater?.(testCase).steps[0]?.execution?.reviewStatus).toBe('confirmed');
  });

  it('returns a confirmed structured action to review when visible intent is edited', () => {
    const testCase = createStructuredActionCase(
      { kind: 'click', locator: { selector: '#create-order', quality: 'acceptable' } },
      'confirmed',
    );
    const { onUpdateTestCase } = renderPage({ testCase });

    fireEvent.change(screen.getByLabelText('步骤标题'), { target: { value: '创建订单' } });

    const updater = onUpdateTestCase.mock.calls[0]?.[0] as ((testCase: TestCaseDraft) => TestCaseDraft) | undefined;
    expect(updater).toBeTypeOf('function');
    expect(updater?.(testCase).steps[0]).toMatchObject({
      title: '创建订单',
      execution: { reviewStatus: 'needsReview' },
    });
  });

  it('returns a confirmed structured action to review when its instruction is edited', () => {
    const testCase = createStructuredActionCase(
      { kind: 'waitForTimeout', timeoutMs: 800 },
      'confirmed',
    );
    const { onUpdateTestCase } = renderPage({ testCase });

    fireEvent.change(screen.getByLabelText('执行指令'), { target: { value: '等待订单列表刷新。' } });

    const updater = onUpdateTestCase.mock.calls[0]?.[0] as ((testCase: TestCaseDraft) => TestCaseDraft) | undefined;
    expect(updater).toBeTypeOf('function');
    expect(updater?.(testCase).steps[0]).toMatchObject({
      body: '等待订单列表刷新。',
      execution: { reviewStatus: 'needsReview' },
    });
  });

  it('returns a confirmed structured action to review when its type changes', async () => {
    const testCase = createStructuredActionCase(
      { kind: 'scrollTo', locator: { selector: '#orders', quality: 'acceptable' } },
      'confirmed',
    );
    const { onUpdateTestCase } = renderPage({ testCase });

    fireEvent.click(screen.getByRole('combobox', { name: '步骤类型' }));
    fireEvent.click(await screen.findByRole('option', { name: '断言' }));

    const updater = onUpdateTestCase.mock.calls[0]?.[0] as ((testCase: TestCaseDraft) => TestCaseDraft) | undefined;
    expect(updater).toBeTypeOf('function');
    expect(updater?.(testCase).steps[0]).toMatchObject({
      type: 'aiAssert',
      execution: { reviewStatus: 'needsReview' },
    });
  });

  it('binds an Agent input target to a saved credential and requires explicit confirmation', async () => {
    const testCase: TestCaseDraft = {
      ...selectedTestCase,
      steps: [{
        id: 'credential-input-step',
        type: 'ai',
        title: '填写邮箱',
        body: '填写已保存的测试账号。',
        execution: {
          schemaVersion: 2,
          intent: '填写待绑定的测试账号。',
          reviewStatus: 'needsReview',
          actionRisk: 'medium',
          inputBindingTarget: {
            kind: 'input',
            locator: { selector: '#email', quality: 'acceptable' },
          },
        },
      }],
    };

    render(<CasePageHarness initialTestCase={testCase} />);

    expect(screen.queryByRole('button', { name: '确认确定性动作' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: '凭据' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Staging 管理员' }));

    expect(await screen.findByRole('button', { name: '确认确定性动作' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认确定性动作' }));
    expect(screen.getByText('已确认')).toBeInTheDocument();
  });

  it('offers only mapped string outputs from Fixture versions bound to the edited Case', async () => {
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-order-output',
      version: 2,
      name: '准备订单数据',
      description: '',
      inputs: [],
      outputs: [
        { name: 'orderId', type: 'string' as const, required: true },
        { name: 'rowCount', type: 'number' as const, required: true },
      ],
      credentialIds: [],
      environmentIds: [project.environments[0]!.id],
      setup: {
        mode: 'http' as const,
        summary: '创建订单。',
        http: {
          method: 'POST' as const,
          path: '/api/test-data/orders',
          expectedStatuses: [201],
          responseOutputs: [
            { outputName: 'orderId', jsonPointer: '/orderId' },
            { outputName: 'rowCount', jsonPointer: '/rowCount' },
          ],
        },
      },
      concurrency: 'exclusive' as const,
      resourceLocks: [],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    const testCase: TestCaseDraft = {
      ...selectedTestCase,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
      steps: [{
        id: 'fixture-output-input-step',
        type: 'ai',
        title: '填写订单号',
        body: '填写已准备的订单号。',
        execution: {
          schemaVersion: 2,
          intent: '填写已准备的订单号。',
          reviewStatus: 'needsReview',
          actionRisk: 'medium',
          inputBindingTarget: { kind: 'input', locator: { selector: '#order-id', quality: 'acceptable' } },
        },
      }],
    };

    render(<CasePageHarness initialProject={{ ...project, fixtures: [fixture] }} initialTestCase={testCase} />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Fixture 输出' }));
    expect(await screen.findByRole('option', { name: '准备订单数据 v2 / orderId' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /rowCount/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '准备订单数据 v2 / orderId' }));

    expect(await screen.findByRole('button', { name: '确认确定性动作' })).toBeInTheDocument();
  });

  it('edits structured business intent separately from case notes', () => {
    const testCase: TestCaseDraft = {
      ...selectedTestCase,
      notes: '保留给编辑者的补充说明。',
      intent: {
        schemaVersion: 1,
        businessGoal: '验证订单提交流程',
        preconditions: ['使用已准备的测试账号'],
        successCriteria: ['页面展示提交成功提示'],
      },
    };

    render(<CasePageHarness initialTestCase={testCase} />);

    fireEvent.click(screen.getByRole('button', { name: '用例设置' }));
    fireEvent.change(screen.getByLabelText('业务目标'), { target: { value: '验证订单提交和结果展示' } });
    fireEvent.change(screen.getByLabelText('前置条件'), {
      target: { value: '使用已准备的测试账号\n使用已准备的测试账号\n订单数据存在' },
    });
    fireEvent.change(screen.getByLabelText('成功标准'), {
      target: { value: '页面展示提交成功提示\n订单状态更新为已提交' },
    });

    expect(screen.getByLabelText('业务目标')).toHaveValue('验证订单提交和结果展示');
    expect(screen.getByLabelText('前置条件')).toHaveValue('使用已准备的测试账号\n订单数据存在');
    expect(screen.getByLabelText('成功标准')).toHaveValue('页面展示提交成功提示\n订单状态更新为已提交');
    expect(screen.getByLabelText('用例说明')).toHaveValue('保留给编辑者的补充说明。');
  });

  it('binds and removes an exact fixture version without changing the fixture asset', async () => {
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-order-data',
      version: 1,
      name: '准备订单数据',
      description: '创建可用于断言的订单。',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [project.environments[0]!.id],
      setup: { mode: 'http' as const, summary: '创建订单' },
      concurrency: 'exclusive' as const,
      resourceLocks: ['orders:seed'],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    const fixtureCase: TestCaseDraft = {
      ...selectedTestCase,
      assetReferences: { fixtures: [], reusableFlows: [] },
    };

    render(<CasePageHarness initialProject={{ ...project, fixtures: [fixture] }} initialTestCase={fixtureCase} />);

    fireEvent.click(screen.getByRole('button', { name: '用例设置' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Fixture 依赖' }));
    fireEvent.click(await screen.findByRole('option', { name: '准备订单数据 v1' }));

    const remove = await screen.findByRole('button', { name: '解除 准备订单数据 v1 绑定' });
    fireEvent.click(remove);

    expect(await screen.findByText('当前用例没有绑定 Fixture。')).toBeInTheDocument();
  });

  it('uses English labels for the editor controls', async () => {
    renderPage({ locale: 'en-US' });

    expect(screen.getByRole('button', { name: 'Add Step' })).toBeInTheDocument();
    expect(await screen.findByText('Step Properties')).toBeInTheDocument();
    expect(screen.queryByText('添加步骤')).not.toBeInTheDocument();
  });
});
