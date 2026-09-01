import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyProject, createEmptySuiteAsset, createEmptyTestCase, type ReusableFlowAsset } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { ReusableFlowsPage } from './ReusableFlowsPage.js';

function publishedFlow(): ReusableFlowAsset {
  return {
    schemaVersion: 1,
    id: 'flow-login',
    version: 1,
    name: '登录准备',
    description: '',
    tags: [],
    steps: [{
      id: 'flow-login-open',
      type: 'ai',
      title: '打开登录页',
      body: '打开登录页。',
      execution: {
        schemaVersion: 2,
        intent: '打开登录页。',
        reviewStatus: 'confirmed',
        actionRisk: 'low',
        action: { kind: 'navigate', url: 'https://example.test/login' },
      },
    }],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('ReusableFlowsPage', () => {
  it('keeps a saved Flow read-only and publishes an edit as its next immutable version', () => {
    const project = { ...createEmptyProject(1), reusableFlows: [publishedFlow()] };
    const onPublishFlow = vi.fn();
    render(
      <I18nProvider locale="zh-CN">
        <ReusableFlowsPage onPublishFlow={onPublishFlow} onSelectFlow={vi.fn()} project={project} selectedReference={{ id: 'flow-login', version: 1 }} />
      </I18nProvider>,
    );

    expect(screen.getByLabelText('Flow 名称')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '编辑为新版本' }));
    fireEvent.change(screen.getByLabelText('Flow 名称'), { target: { value: '登录准备 v2' } });
    fireEvent.click(screen.getByRole('button', { name: '发布 Flow 版本' }));

    expect(onPublishFlow).toHaveBeenCalledWith(expect.objectContaining({ id: 'flow-login', version: 2, name: '登录准备 v2' }));
  });

  it('does not publish an empty new Flow until it contains a confirmed deterministic step', () => {
    const project = createEmptyProject(1);
    const onPublishFlow = vi.fn();
    render(
      <I18nProvider locale="zh-CN">
        <ReusableFlowsPage onPublishFlow={onPublishFlow} onSelectFlow={vi.fn()} project={project} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '新建 Flow' }));
    expect(screen.getByRole('button', { name: '发布 Flow 版本' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '添加导航步骤' }));
    expect(screen.getByRole('button', { name: '发布 Flow 版本' })).toBeEnabled();
  });

  it('uses the latest published version when editing a historical Flow version', () => {
    const flowV1 = { ...publishedFlow(), name: 'Login preparation' };
    const flowV5 = { ...flowV1, version: 5, updatedAt: '2026-08-22T00:00:00.000Z' };
    const project = { ...createEmptyProject(1), reusableFlows: [flowV1, flowV5] };

    render(
      <I18nProvider locale="en-US">
        <ReusableFlowsPage onPublishFlow={vi.fn()} onSelectFlow={vi.fn()} project={project} selectedReference={{ id: flowV1.id, version: flowV1.version }} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit as New Version' }));

    expect(screen.getByText('v6 Draft')).toBeInTheDocument();
  });

  it('confirms selected Case upgrades against an explicit same-Flow target and shows immutable Suite proposals', async () => {
    const baseProject = createEmptyProject(1);
    const flowV1 = { ...publishedFlow(), name: 'Login preparation' };
    const flowV2 = { ...flowV1, version: 2, updatedAt: '2026-08-22T00:00:00.000Z' };
    const unrelatedFlow = { ...flowV1, id: 'flow-search', name: 'Other Flow' };
    const loginCase = {
      ...createEmptyTestCase(1, baseProject.groups[0]!.id, baseProject.environments[0]!.id),
      id: 'case-login',
      version: 1,
      name: 'Login Case',
      assetReferences: {
        fixtures: [{ id: 'fixture-login', version: 3 }],
        baseline: { id: 'baseline-login', version: 2 },
        reusableFlows: [{ id: flowV1.id, version: flowV1.version }],
      },
    };
    const profileCase = {
      ...loginCase,
      id: 'case-profile',
      name: 'Profile Case',
    };
    const suite = {
      ...createEmptySuiteAsset(baseProject, 1),
      id: 'suite-release',
      name: 'Release Suite',
      caseReferences: [{ id: loginCase.id, version: loginCase.version, dependsOn: [] }],
    };
    const profileSuite = {
      ...suite,
      id: 'suite-profile',
      name: 'Profile Suite',
      caseReferences: [{ id: profileCase.id, version: profileCase.version, dependsOn: [] }],
    };
    const project = {
      ...baseProject,
      reusableFlows: [flowV1, flowV2, unrelatedFlow],
      testCases: [loginCase, profileCase],
      suites: [suite, profileSuite],
    };
    const onUpgradeCases = vi.fn();

    render(
      <I18nProvider locale="en-US">
        <ReusableFlowsPage
          onPublishFlow={vi.fn()}
          onSelectFlow={vi.fn()}
          onUpgradeCases={onUpgradeCases}
          project={project}
          selectedReference={{ id: flowV1.id, version: flowV1.version }}
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Source Flow')).toBeInTheDocument();
    expect(screen.getByText('Login preparation v1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Target Flow Version' }));
    expect(await screen.findByRole('option', { name: 'Login preparation v2' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Login preparation v1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /other flow/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Login preparation v2' }));

    expect(screen.getAllByText('flow-login@1 -> flow-login@2')).toHaveLength(2);
    expect(screen.getAllByText('fixture-login@3')).toHaveLength(2);
    expect(screen.getAllByText('baseline-login@2')).toHaveLength(2);
    expect(screen.getByText('suite-release@1')).toBeInTheDocument();
    expect(screen.getByText('suite-profile@1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Case Versions' }));
    expect(onUpgradeCases).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: 'Confirm Case Upgrade' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')).toHaveTextContent('Login preparation v1');
    expect(within(dialog).getByRole('checkbox', { name: 'Upgrade Login Case v1' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Upgrade Profile Case v1' })).toBeChecked();
    expect(within(dialog).getByText('Suite Upgrade Proposals')).toBeInTheDocument();
    expect(within(dialog).getByText('Release Suite v1')).toBeInTheDocument();
    expect(within(dialog).getByText('Suites are not rewritten automatically.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Upgrade Profile Case v1' }));
    expect(screen.getByText('suite-profile@1')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Case Upgrade' }));

    expect(onUpgradeCases).toHaveBeenCalledWith(
      { id: flowV1.id, version: flowV1.version },
      { id: flowV2.id, version: flowV2.version },
      [{ id: loginCase.id, version: loginCase.version }],
    );
    expect(project.suites[0]?.caseReferences).toEqual([{ id: loginCase.id, version: loginCase.version, dependsOn: [] }]);
  });

  it('blocks confirmation when more than one historical revision of a logical Case is selected', async () => {
    const baseProject = createEmptyProject(1);
    const flowV1 = { ...publishedFlow(), name: 'Login preparation' };
    const flowV2 = { ...flowV1, version: 2, updatedAt: '2026-08-22T00:00:00.000Z' };
    const caseV1 = {
      ...createEmptyTestCase(1, baseProject.groups[0]!.id, baseProject.environments[0]!.id),
      id: 'case-history',
      version: 1,
      name: 'History Case',
      assetReferences: { fixtures: [], reusableFlows: [{ id: flowV1.id, version: flowV1.version }] },
    };
    const caseV2 = { ...caseV1, version: 2 };

    render(
      <I18nProvider locale="en-US">
        <ReusableFlowsPage
          onPublishFlow={vi.fn()}
          onSelectFlow={vi.fn()}
          onUpgradeCases={vi.fn()}
          project={{ ...baseProject, reusableFlows: [flowV1, flowV2], testCases: [caseV1, caseV2] }}
          selectedReference={{ id: flowV1.id, version: flowV1.version }}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Create New Case Versions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm Case Upgrade' });
    expect(within(dialog).getByRole('checkbox', { name: 'Upgrade History Case v2' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Upgrade History Case v1' })).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Upgrade History Case v1' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Cannot confirm this selection.');
    expect(within(dialog).getByRole('button', { name: 'Confirm Case Upgrade' })).toBeDisabled();
  });
});
