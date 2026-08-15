import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyProject, createEmptySuiteAsset, createEmptyTestCase, type ProjectDraft, type SuiteAsset } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { SuiteManagementPage } from './SuiteManagementPage.js';

function createProject(): ProjectDraft {
  const project = createEmptyProject(1);
  const environment = project.environments[0]!;
  project.testCases = [
    {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-catalog',
      version: 3,
      name: '商品目录检查',
      steps: [{ id: 'step-catalog', type: 'manual', title: '确认商品目录', body: '确认商品列表存在。' }],
    },
    {
      ...createEmptyTestCase(2, project.groups[0]!.id, environment.id),
      id: 'case-checkout',
      version: 2,
      name: '结算检查',
      steps: [{ id: 'step-checkout', type: 'manual', title: '确认结算', body: '确认结算页存在。' }],
    },
  ];
  return project;
}

function renderPage({
  project = createProject(),
  selectedSuiteReference,
  onPublishSuite = vi.fn(),
  onRunSuite = vi.fn(),
  onOpenRun = vi.fn(),
  onCancelSuite = vi.fn(),
  isRunning = false,
  activeRunId,
}: {
  project?: ProjectDraft;
  selectedSuiteReference?: { id: string; version: number };
  onPublishSuite?: (suite: SuiteAsset) => void;
  onRunSuite?: (reference: { id: string; version: number }) => void;
  onOpenRun?: (runId: string) => void;
  onCancelSuite?: (runId: string) => void;
  isRunning?: boolean;
  activeRunId?: string;
} = {}) {
  return {
    onOpenRun,
    onPublishSuite,
    onRunSuite,
    ...render(
      <I18nProvider locale="zh-CN">
        <SuiteManagementPage
          activeRunId={activeRunId}
          isRunning={isRunning}
          onCancelSuite={onCancelSuite}
          onOpenRun={onOpenRun}
          onPublishSuite={onPublishSuite}
          onRunSuite={onRunSuite}
          onSelectSuite={vi.fn()}
          project={project}
          selectedSuiteReference={selectedSuiteReference ?? (project.suites[0] ? { id: project.suites[0].id, version: project.suites[0].version } : undefined)}
        />
      </I18nProvider>,
    ),
  };
}

describe('SuiteManagementPage', () => {
  it('offers each logical Case once and pins its latest revision in a new Suite', () => {
    const project = createProject();
    const catalogV1 = { ...project.testCases[0]!, version: 1, name: '商品目录检查 v1' };
    const catalogV2 = { ...catalogV1, version: 2, name: '商品目录检查 v2' };
    project.testCases = [catalogV1, catalogV2];
    const { onPublishSuite } = renderPage({ project });

    fireEvent.click(screen.getByRole('button', { name: '新建 Suite' }));
    expect(screen.getAllByRole('button', { name: '添加用例 商品目录检查 v2' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '添加用例 商品目录检查 v1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加用例 商品目录检查 v2' }));
    fireEvent.click(screen.getByRole('button', { name: '发布版本' }));

    expect(onPublishSuite).toHaveBeenCalledWith(expect.objectContaining({
      caseReferences: [{ id: 'case-catalog', version: 2, dependsOn: [] }],
    }));
  });

  it('creates a Suite draft and publishes exact current Case versions', () => {
    const { onPublishSuite } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: '新建 Suite' }));
    fireEvent.change(screen.getByLabelText('Suite 名称'), { target: { value: '发布回归' } });
    fireEvent.click(screen.getByRole('button', { name: '添加用例 商品目录检查' }));
    fireEvent.click(screen.getByRole('button', { name: '添加用例 结算检查' }));
    fireEvent.click(screen.getByRole('button', { name: '发布版本' }));

    expect(onPublishSuite).toHaveBeenCalledWith(expect.objectContaining({
      name: '发布回归',
      version: 1,
      caseReferences: [
        { id: 'case-catalog', version: 3, dependsOn: [] },
        { id: 'case-checkout', version: 2, dependsOn: [] },
      ],
    }));
  });

  it('resolves Suite member and dependency labels from their pinned Case revisions', () => {
    const project = createProject();
    const catalogV1 = { ...project.testCases[0]!, version: 1, name: '目录 v1' };
    const catalogV2 = { ...catalogV1, version: 2, name: '目录 v2' };
    const checkoutV1 = { ...project.testCases[1]!, version: 1, name: '结算 v1' };
    const checkoutV2 = { ...checkoutV1, version: 2, name: '结算 v2' };
    project.testCases = [catalogV1, catalogV2, checkoutV1, checkoutV2];
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-exact-labels',
      caseReferences: [
        { id: catalogV2.id, version: 2, dependsOn: [] },
        { id: checkoutV2.id, version: 2, dependsOn: [{ id: catalogV2.id, version: 2 }] },
      ],
    };
    project.suites = [suite];

    renderPage({ project, selectedSuiteReference: { id: suite.id, version: suite.version } });

    expect(screen.getByText('1. 目录 v2')).toBeInTheDocument();
    expect(screen.getByText('2. 结算 v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设为 结算 v2 依赖 目录 v2' })).toBeInTheDocument();
  });

  it('blocks Suite execution until the shared preflight has valid members', () => {
    const project = createProject();
    const emptySuite = { ...createEmptySuiteAsset(project, 1), id: 'suite-empty', name: '空 Suite' };
    project.suites = [emptySuite];

    renderPage({ project, selectedSuiteReference: { id: emptySuite.id, version: emptySuite.version } });

    expect(screen.getByText(/未选择任何用例/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行 Suite' })).toBeDisabled();
  });

  it('edits a published Suite as a new immutable version with its dependency and execution settings', () => {
    const project = createProject();
    project.environments.push({
      ...project.environments[0]!,
      id: 'env-production',
      name: 'Production',
      kind: 'productionMirror',
    });
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-release',
      version: 2,
      name: '发布回归',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      caseReferences: [{ id: 'case-catalog', version: 3, dependsOn: [] }],
    };
    project.suites = [suite];
    const { onPublishSuite } = renderPage({ project, selectedSuiteReference: { id: suite.id, version: suite.version } });

    fireEvent.click(screen.getByRole('button', { name: '编辑为新版本' }));
    fireEvent.change(screen.getByLabelText('Suite 名称'), { target: { value: '发布回归增强版' } });
    fireEvent.click(screen.getByRole('combobox', { name: '运行环境' }));
    fireEvent.click(screen.getByRole('option', { name: 'Production' }));
    fireEvent.change(screen.getByLabelText('请求并发'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('重试次数'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('combobox', { name: '失败策略' }));
    fireEvent.click(screen.getByRole('option', { name: '失败即停止' }));
    fireEvent.click(screen.getByRole('button', { name: '添加用例 结算检查' }));
    fireEvent.click(screen.getByRole('button', { name: '设为 结算检查 依赖 商品目录检查' }));
    fireEvent.click(screen.getByRole('button', { name: '发布版本' }));

    expect(onPublishSuite).toHaveBeenCalledWith(expect.objectContaining({
      id: suite.id,
      version: 3,
      name: '发布回归增强版',
      createdAt: expect.any(String),
      environmentId: 'env-production',
      execution: { concurrency: 4, failurePolicy: 'failFast', retryLimit: 2 },
      caseReferences: [
        { id: 'case-catalog', version: 3, dependsOn: [] },
        { id: 'case-checkout', version: 2, dependsOn: [{ id: 'case-catalog', version: 3 }] },
      ],
    }));
    expect(suite).toMatchObject({
      version: 2,
      name: '发布回归',
      caseReferences: [{ id: 'case-catalog', version: 3, dependsOn: [] }],
    });
  });

  it('shows a cyclic dependency in preflight and keeps Suite execution disabled', () => {
    const project = createProject();
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-cycle',
      name: '循环 Suite',
      caseReferences: [
        { id: 'case-catalog', version: 3, dependsOn: [{ id: 'case-checkout', version: 2 }] },
        { id: 'case-checkout', version: 2, dependsOn: [{ id: 'case-catalog', version: 3 }] },
      ],
    };
    project.suites = [suite];

    renderPage({ project, selectedSuiteReference: { id: suite.id, version: suite.version } });

    expect(screen.getByText(/存在循环依赖/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行 Suite' })).toBeDisabled();
  });

  it('submits a saved exact Suite reference and renders Case results', () => {
    const project = createProject();
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-release',
      version: 2,
      name: '发布回归',
      caseReferences: [{ id: 'case-catalog', version: 3, dependsOn: [] }],
    };
    project.suites = [suite];
    const onRunSuite = vi.fn();
    const onOpenRun = vi.fn();
    const { rerender } = renderPage({ project, selectedSuiteReference: { id: suite.id, version: suite.version }, onRunSuite, onOpenRun });

    fireEvent.click(screen.getByRole('button', { name: '运行 Suite' }));
    expect(onRunSuite).toHaveBeenCalledWith({ id: suite.id, version: suite.version });

    rerender(
      <I18nProvider locale="zh-CN">
        <SuiteManagementPage
          isRunning={false}
          lastRun={{
            suite: {
              suiteId: suite.id,
              suiteVersion: suite.version,
              environmentId: suite.environmentId,
              status: 'passed',
              startedAt: new Date(0).toISOString(),
              endedAt: new Date(0).toISOString(),
              effectiveConcurrency: 1,
              issues: [],
              results: [{
                testCaseId: 'case-catalog',
                testCaseVersion: 3,
                status: 'passed',
                summary: '商品目录检查已通过。',
                attempts: 2,
                flaky: true,
                runId: 'run-catalog',
              }],
            },
            caseDetails: [],
          }}
          onOpenRun={onOpenRun}
          onPublishSuite={vi.fn()}
          onRunSuite={onRunSuite}
          onSelectSuite={vi.fn()}
          project={project}
          selectedSuiteReference={{ id: suite.id, version: suite.version }}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('第 2 次尝试')).toBeInTheDocument();
    expect(screen.getByText('Flaky')).toBeInTheDocument();
    expect(screen.getByText('商品目录检查已通过。')).toBeInTheDocument();
    expect(screen.getAllByText('通过').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '查看 商品目录检查 运行' }));
    expect(onOpenRun).toHaveBeenCalledWith('run-catalog');
  });

  it('sends the active parent Suite run id to the cancellation handler', () => {
    const project = createProject();
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-release',
      name: '发布回归',
      caseReferences: [{ id: 'case-catalog', version: 3, dependsOn: [] }],
    };
    project.suites = [suite];
    const onCancelSuite = vi.fn();

    renderPage({ activeRunId: 'suite-run-123', isRunning: true, onCancelSuite, project, selectedSuiteReference: { id: suite.id, version: suite.version } });

    fireEvent.click(screen.getByRole('button', { name: '取消 Suite' }));
    expect(onCancelSuite).toHaveBeenCalledWith('suite-run-123');
  });

  it('selects and runs an older published Suite version by its exact reference', () => {
    const project = createProject();
    const versionOne = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-release',
      version: 1,
      name: '发布回归',
      caseReferences: [{ id: 'case-catalog', version: 3, dependsOn: [] }],
    };
    const versionTwo = {
      ...versionOne,
      version: 2,
      caseReferences: [{ id: 'case-checkout', version: 2, dependsOn: [] }],
    };
    project.suites = [versionOne, versionTwo];
    const onRunSuite = vi.fn();

    function SuiteSelectionHarness() {
      const [selectedSuiteReference, setSelectedSuiteReference] = useState({
        id: versionTwo.id,
        version: versionTwo.version,
      });
      return (
        <I18nProvider locale="zh-CN">
          <SuiteManagementPage
            isRunning={false}
            onOpenRun={vi.fn()}
            onPublishSuite={vi.fn()}
            onRunSuite={onRunSuite}
            onSelectSuite={setSelectedSuiteReference}
            project={project}
            selectedSuiteReference={selectedSuiteReference}
          />
        </I18nProvider>
      );
    }

    render(<SuiteSelectionHarness />);

    fireEvent.click(screen.getByRole('button', { name: '选择 发布回归 v1' }));
    fireEvent.click(screen.getByRole('button', { name: '运行 Suite' }));

    expect(onRunSuite).toHaveBeenCalledWith({ id: versionOne.id, version: versionOne.version });
  });
});
