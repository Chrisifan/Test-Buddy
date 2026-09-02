import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptyRecordingAsset,
  createEmptyReusableFlowAsset,
  createEmptySuiteAsset,
  createEmptyTestCase,
  createInitialStudioState,
  createPrdDocumentAsset,
  type DesktopApi,
  type RunDetail,
  type StudioState,
} from '../shared/studio.js';
import { createMaintenanceDraft, transitionMaintenanceDraft } from '../shared/maintenance.js';
import { App } from './App.js';

describe('App shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the startup page on first load', async () => {
    render(<App />);

    expect(await screen.findByLabelText('启动屏')).toBeInTheDocument();
    expect(screen.queryByText('已启用的平台能力')).not.toBeInTheDocument();
    expect(screen.getByText('PRD 分析')).toBeInTheDocument();
    expect(screen.getByText('自然语言测试')).toBeInTheDocument();
    expect(screen.getByText('录制回放')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: '欢迎来到测试的新未来' })).not.toBeInTheDocument();
  });

  it('keeps the workspace read-only when desktop state loading fails', async () => {
    vi.useFakeTimers();
    const originalDesktopApi = window.desktopApi;
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState: vi.fn().mockRejectedValue(new Error('injected read failure')),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
      saveStudioState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(desktopApi.loadStudioState).toHaveBeenCalledOnce();
      expect(screen.getByRole('alert')).toHaveTextContent('无法读取本地工作台数据');
      expect(desktopApi.saveStudioState).not.toHaveBeenCalled();
    } finally {
      window.desktopApi = originalDesktopApi;
      vi.useRealTimers();
    }
  });

  it('uses the Automation Pro shell after startup is skipped', async () => {
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '跳过，进入工作台' }));

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByText('TestBuddy')).toBeInTheDocument();
    expect(container.querySelectorAll('img[src*="testbuddy-hammer-bot"]').length).toBe(2);
    expect(screen.queryByText('Project Context')).not.toBeInTheDocument();
    expect(container.querySelector('.app-topbar')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索资源...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '连接设备' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目设置' })).toBeInTheDocument();
    expect(container.querySelector('.app-project-context')).toBeNull();
    expect(screen.queryByText('Connect Device')).not.toBeInTheDocument();
    const runtimebar = container.querySelector<HTMLElement>('.app-runtimebar');
    expect(runtimebar).toBeInTheDocument();
    expect(within(runtimebar!).getByText('选择项目环境后启动受控浏览器会话。')).toBeInTheDocument();
    expect(within(runtimebar!).getByText('尚未执行')).toBeInTheDocument();
    expect(screen.queryByText('系统在线')).not.toBeInTheDocument();
    expect(screen.queryByText('工作区：默认')).not.toBeInTheDocument();
  });

  it('keeps an edited Case draft bound to its immutable source when workflow selection changes', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const caseA = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-a',
      version: 1,
      name: 'Case A',
    };
    const caseB = {
      ...createEmptyTestCase(2, project.groups[0]!.id, environment.id),
      id: 'case-b',
      version: 1,
      name: 'Case B',
    };
    const state = createInitialStudioState();
    state.projects = [{ ...project, testCases: [caseA, caseB] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseReference = { id: caseA.id, version: 1 };
    state.selectedTestCaseId = caseA.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    state.midsceneConfig = {
      ...state.midsceneConfig,
      modelBaseUrl: 'https://models.example.test/v1',
      modelSecret: { ...state.midsceneConfig.modelSecret, hasKey: true },
      modelName: 'ui-agent',
      modelFamily: 'openai',
    };
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    await screen.findByRole('heading', { level: 1, name: 'Case Workbench' });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.change(screen.getAllByLabelText('Step Title')[0]!, { target: { value: 'Case A draft step' } });

    fireEvent.click(within(navigation).getByRole('button', { name: 'Workflow' }));
    await screen.findByRole('heading', { level: 1, name: 'Workflow Testing' });
    fireEvent.click(await screen.findByRole('button', { name: /Case B/u }));
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    await screen.findByRole('heading', { level: 1, name: 'Case Workbench' });
    fireEvent.click(await screen.findByRole('button', { name: 'Publish Version' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      expect(persisted.projects[0].testCases).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'case-a', version: 2, steps: expect.arrayContaining([expect.objectContaining({ title: 'Case A draft step' })]) }),
      ]));
      expect(persisted.projects[0].testCases).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'case-b', version: 2, steps: expect.arrayContaining([expect.objectContaining({ title: 'Case A draft step' })]) }),
      ]));
    });
  });

  it('publishes the next Case version with its exact Flow bindings', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const loginV1 = {
      ...createEmptyReusableFlowAsset(1),
      id: 'flow-login',
      version: 1,
      name: 'Login Flow',
      steps: [{
        id: 'flow-login-step',
        type: 'ai' as const,
        title: 'Open login',
        body: 'Open the login page.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Open the login page.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action: { kind: 'navigate' as const, url: project.defaultUrl },
        },
      }],
    };
    const searchV1 = { ...loginV1, id: 'flow-search', name: 'Search Flow' };
    const checkoutV3 = { ...loginV1, id: 'flow-checkout', version: 3, name: 'Checkout Flow' };
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-flow-bindings',
      version: 1,
      name: 'Flow bindings Case',
      assetReferences: { fixtures: [], reusableFlows: [{ id: loginV1.id, version: loginV1.version }, { id: searchV1.id, version: searchV1.version }] },
    };
    const state = createInitialStudioState();
    state.projects = [{ ...project, reusableFlows: [loginV1, searchV1, checkoutV3], testCases: [testCase] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseReference = { id: testCase.id, version: testCase.version };
    state.selectedTestCaseId = testCase.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Case Settings' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Reusable Flows' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Checkout Flow v3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Checkout Flow up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Login Flow v1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish Version' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      expect(persisted.projects[0].testCases).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: testCase.id,
          version: 2,
          assetReferences: {
            fixtures: [],
            reusableFlows: [{ id: checkoutV3.id, version: checkoutV3.version }, { id: searchV1.id, version: searchV1.version }],
          },
        }),
      ]));
    });
  });

  it('clears an open Case draft before creating and selecting a new workflow', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const caseA = { ...createEmptyTestCase(1, project.groups[0]!.id, environment.id), id: 'case-a', version: 1, name: 'Case A' };
    const state = createInitialStudioState();
    state.projects = [{ ...project, testCases: [caseA] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseReference = { id: caseA.id, version: 1 };
    state.selectedTestCaseId = caseA.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    state.midsceneConfig = { ...state.midsceneConfig, modelBaseUrl: 'https://models.example.test/v1', modelSecret: { ...state.midsceneConfig.modelSecret, hasKey: true }, modelName: 'ui-agent', modelFamily: 'openai' };
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    await screen.findByRole('heading', { level: 1, name: 'Case Workbench' });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.change(screen.getAllByLabelText('Step Title')[0]!, { target: { value: 'stale A draft' } });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Workflow' }));
    await screen.findByRole('heading', { level: 1, name: 'Workflow Testing' });
    fireEvent.click(await screen.findByRole('button', { name: 'New Flow' }));
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));

    await screen.findByRole('heading', { level: 1, name: 'Case Workbench' });
    expect(await screen.findByRole('button', { name: 'Edit as New Version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish Version' })).not.toBeInTheDocument();
    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      expect(persisted.projects[0].testCases).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'case-a', version: 2, steps: expect.arrayContaining([expect.objectContaining({ title: 'stale A draft' })]) }),
      ]));
    });
  });

  it('discards an open Case draft before creating a Case from a PRD path', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const caseA = { ...createEmptyTestCase(1, project.groups[0]!.id, environment.id), id: 'case-a', version: 1, name: 'Case A' };
    const document = createPrdDocumentAsset({
      name: 'dashboard-prd.md',
      kind: 'markdown',
      size: 120,
      sourceText: 'Dashboard users can filter charts. The result table supports sorting and pagination.',
    });
    const generatedPath = document.generatedPaths[0]!;
    const state = createInitialStudioState();
    state.projects = [{ ...project, documents: [document], testCases: [caseA] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseReference = { id: caseA.id, version: 1 };
    state.selectedTestCaseId = caseA.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    state.midsceneConfig = { ...state.midsceneConfig, modelBaseUrl: 'https://models.example.test/v1', modelSecret: { ...state.midsceneConfig.modelSecret, hasKey: true }, modelName: 'ui-agent', modelFamily: 'openai' };
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.change(screen.getAllByLabelText('Step Title')[0]!, { target: { value: 'stale A draft' } });

    fireEvent.click(within(navigation).getByRole('button', { name: 'Requirements' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Create Case' }))[0]!);

    expect(await screen.findByRole('button', { name: 'Edit as New Version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish Version' })).not.toBeInTheDocument();

    const selectCase = screen.getByRole('button', { name: 'Select a Case' });
    fireEvent.pointerDown(selectCase, { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Case A/u }));
    expect(within(screen.getByRole('button', { name: 'Select a Case' })).getByText('Case A')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Select a Case' }), { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(generatedPath.title, 'u') }));
    expect(within(screen.getByRole('button', { name: 'Select a Case' })).getByText(generatedPath.title)).toBeInTheDocument();

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      expect(persisted.projects[0].testCases).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: caseA.id, version: 2, steps: expect.arrayContaining([expect.objectContaining({ title: 'stale A draft' })]) }),
      ]));
    });
  });

  it('clears a Case draft and appends one v3 from the latest revision after confirmed group deletion', async () => {
    const project = createEmptyProject(1);
    const sourceGroup = { ...project.groups[0]!, name: 'Source group' };
    project.groups[0] = sourceGroup;
    const fallbackGroup = { ...sourceGroup, id: 'group-fallback', name: 'Fallback group' };
    project.groups.push(fallbackGroup);
    const environment = project.environments[0]!;
    const v1 = { ...createEmptyTestCase(1, sourceGroup.id, environment.id), id: 'case-history', version: 1, name: 'Case v1' };
    const v2 = { ...v1, version: 2, name: 'Case v2' };
    const state = createInitialStudioState();
    state.projects = [{ ...project, testCases: [v1, v2] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = sourceGroup.id;
    state.selectedTestCaseReference = { id: v2.id, version: 2 };
    state.selectedTestCaseId = v2.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.click(within(navigation).getByRole('button', { name: 'Projects' }));
    await screen.findByRole('heading', { name: 'Test Projects' });
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Groups' }), { button: 0 });
    const [groupName] = await screen.findAllByLabelText('Group Name');
    fireEvent.click(within(groupName.closest('.project-group-row')!).getByRole('button'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this item?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete this item?' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    expect(await screen.findByRole('button', { name: 'Edit as New Version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish Version' })).not.toBeInTheDocument();
    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      const versions = persisted.projects[0].testCases.filter((testCase: { id: string }) => testCase.id === v1.id).map((testCase: { version: number }) => testCase.version).sort();
      expect(versions).toEqual([1, 2, 3]);
      expect(persisted.selectedTestCaseReference).toEqual({ id: v1.id, version: 3 });
    });
  });

  it('clears a Case draft and appends one detached v3 after confirmed referenced-recording deletion', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const recording = createEmptyRecordingAsset({
      seed: 1,
      source: 'imported',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      startUrl: project.defaultUrl,
    });
    recording.name = 'Referenced recording';
    project.recordings = [recording];
    const replayStep = { id: 'replay-step', type: 'recordingReplay' as const, title: 'Replay', body: 'Replay recording', recordingId: recording.id };
    const v1 = { ...createEmptyTestCase(1, project.groups[0]!.id, environment.id), id: 'case-recording-history', version: 1, name: 'Case v1', steps: [replayStep] };
    const v2 = { ...v1, version: 2, name: 'Case v2', steps: [{ ...replayStep }] };
    const state = createInitialStudioState();
    state.projects = [{ ...project, testCases: [v1, v2] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseReference = { id: v2.id, version: 2 };
    state.selectedTestCaseId = v2.id;
    state.selectedRecordingId = recording.id;
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    state.midsceneConfig = { ...state.midsceneConfig, modelBaseUrl: 'https://models.example.test/v1', modelSecret: { ...state.midsceneConfig.modelSecret, hasKey: true }, modelName: 'ui-agent', modelFamily: 'openai' };
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.click(within(navigation).getByRole('button', { name: 'Record and Replay' }));
    await screen.findByRole('heading', { name: 'Operation Recording and Replay' });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Recording' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this item?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    expect(await screen.findByRole('button', { name: 'Edit as New Version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish Version' })).not.toBeInTheDocument();
    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      const versions = persisted.projects[0].testCases.filter((testCase: { id: string }) => testCase.id === v1.id).map((testCase: { version: number }) => testCase.version).sort();
      expect(versions).toEqual([1, 2, 3]);
      expect(persisted.projects[0].testCases.find((testCase: { id: string; version: number }) => testCase.id === v1.id && testCase.version === 3).steps[0].recordingId).toBeUndefined();
      expect(persisted.selectedTestCaseReference).toEqual({ id: v1.id, version: 3 });
    });
  });

  it('opens application settings as a modal over the current workbench', async () => {
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '跳过，进入工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(await screen.findByRole('heading', { name: '应用设置' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(container.querySelector('.settings-page-shell')).toBeNull();
    expect(screen.getByLabelText('空态首页')).toBeInTheDocument();
  });

  it('persists only a Midscene secret reference after saving a key from settings', async () => {
    const originalDesktopApi = window.desktopApi;
    const initialState = createInitialStudioState();
    initialState.startupGuide.completed = true;
    const savedSecret = {
      id: 'midscene',
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState: vi.fn().mockResolvedValue(initialState),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
      saveModelSecret: vi.fn().mockResolvedValue(savedSecret),
      saveStudioState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);
      const navigation = await screen.findByRole('navigation', { name: '主导航' });
      fireEvent.click(within(navigation).getByRole('button', { name: '设置' }));
      fireEvent.click((await screen.findAllByRole('button', { name: 'MidScene' }))[0]!);
      fireEvent.change(screen.getByLabelText('MIDSCENE_MODEL_API_KEY'), { target: { value: 'sk-app-write-only' } });
      fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));

      await waitFor(() => {
        expect(desktopApi.saveModelSecret).toHaveBeenCalledWith({ scope: 'midscene', value: 'sk-app-write-only' });
      });
      await waitFor(() => {
        const persistedStates = vi.mocked(desktopApi.saveStudioState).mock.calls.map(([state]) => JSON.stringify(state));
        expect(persistedStates.some((state) => state.includes('sk-app-write-only'))).toBe(false);
        expect(persistedStates.some((state) => state.includes('"hasKey":true'))).toBe(true);
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('reloads main-owned project, binding, and maintenance state after approving a draft', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
      name: 'Sign in',
      steps: [{ id: 'step-login', type: 'manual' as const, title: 'Open form', body: 'Open the sign-in form.' }],
    };
    const draft = createMaintenanceDraft({
      id: 'maintenance-login',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'a'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'b'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Wait for the account menu.' },
      evidence: [{ runId: 'run-login', artifactId: 'artifact-login', contentHash: 'c'.repeat(64) }],
      impact: [],
    });
    const initialState = createInitialStudioState();
    initialState.projects = [{ ...project, testCases: [source] }];
    initialState.projectAssetBindings = [{
      projectId: project.id,
      projectDirectory: '/tmp/test-buddy-project',
      revision: draft.projectRevision,
      boundAt: '2026-08-25T00:00:00.000Z',
    }];
    initialState.selectedProjectId = project.id;
    initialState.selectedGroupId = project.groups[0]!.id;
    initialState.selectedTestCaseReference = { id: source.id, version: source.version };
    initialState.selectedTestCaseId = source.id;
    initialState.selectedRecordingId = '';
    initialState.maintenanceDrafts = [draft];
    initialState.startupGuide.completed = true;
    const reloadedState = structuredClone(initialState);
    reloadedState.projects = [{
      ...project,
      name: 'Reloaded sign-in project',
      testCases: [source, { ...draft.candidate, version: 2 }],
    }];
    reloadedState.projectAssetBindings = [{
      ...initialState.projectAssetBindings[0]!,
      revision: 'd'.repeat(64),
    }];
    reloadedState.maintenanceDrafts = [transitionMaintenanceDraft(draft, 'accepted', '2026-08-25T00:01:00.000Z')];
    const loadStudioState = vi.fn()
      .mockResolvedValueOnce(initialState)
      .mockResolvedValueOnce(reloadedState);
    const saveStudioState = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState,
      saveStudioState,
      acceptMaintenanceDraft: vi.fn().mockResolvedValue({
        status: 'accepted',
        draft: reloadedState.maintenanceDrafts[0],
        published: { id: source.id, version: 2 },
      }),
      rejectMaintenanceDraft: vi.fn().mockResolvedValue(reloadedState.maintenanceDrafts[0]),
      openMaintenanceEvidence: vi.fn().mockResolvedValue(undefined),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);
      const navigation = await screen.findByRole('navigation', { name: '主导航' });
      fireEvent.click(within(navigation).getByRole('button', { name: '维护审核' }));
      const approval = await screen.findByRole('button', { name: '批准草案' });
      fireEvent.click(screen.getByRole('checkbox', { name: `确认 revision ${draft.projectRevision}` }));
      fireEvent.click(approval);

      await waitFor(() => {
        expect(desktopApi.acceptMaintenanceDraft).toHaveBeenCalledWith({
          draftId: draft.id,
          expectedRevision: draft.projectRevision,
        });
      });
      await waitFor(() => expect(loadStudioState).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(saveStudioState.mock.calls.some(([state]) => {
          const candidate = state as StudioState;
          return candidate.projects[0]?.name === 'Reloaded sign-in project' &&
            candidate.projectAssetBindings[0]?.revision === 'd'.repeat(64) &&
            candidate.maintenanceDrafts[0]?.status === 'accepted' &&
            candidate.projects[0]?.testCases.some((testCase) => testCase.id === source.id && testCase.version === 2);
        })).toBe(true);
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('keeps the queue pending and shows an error when main-owned reload fails after approval', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
      name: 'Sign in',
      steps: [{ id: 'step-login', type: 'manual' as const, title: 'Open form', body: 'Open the sign-in form.' }],
    };
    const draft = createMaintenanceDraft({
      id: 'maintenance-login',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'a'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'b'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Wait for the account menu.' },
      evidence: [{ runId: 'run-login', artifactId: 'artifact-login', contentHash: 'c'.repeat(64) }],
      impact: [],
    });
    const initialState = createInitialStudioState();
    initialState.projects = [{ ...project, testCases: [source] }];
    initialState.selectedProjectId = project.id;
    initialState.selectedGroupId = project.groups[0]!.id;
    initialState.selectedTestCaseReference = { id: source.id, version: source.version };
    initialState.selectedTestCaseId = source.id;
    initialState.selectedRecordingId = '';
    initialState.maintenanceDrafts = [draft];
    initialState.startupGuide.completed = true;
    const loadStudioState = vi.fn()
      .mockResolvedValueOnce(initialState)
      .mockRejectedValueOnce(new Error('injected reload failure'));
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState,
      saveStudioState: vi.fn().mockResolvedValue(undefined),
      acceptMaintenanceDraft: vi.fn().mockResolvedValue({
        status: 'accepted',
        draft: { ...draft, status: 'accepted' },
        published: { id: source.id, version: 2 },
      }),
      rejectMaintenanceDraft: vi.fn(),
      openMaintenanceEvidence: vi.fn().mockResolvedValue(undefined),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);
      const navigation = await screen.findByRole('navigation', { name: '主导航' });
      fireEvent.click(within(navigation).getByRole('button', { name: '维护审核' }));
      fireEvent.click(await screen.findByRole('checkbox', { name: `确认 revision ${draft.projectRevision}` }));
      const approval = screen.getByRole('button', { name: '批准草案' });
      fireEvent.click(approval);

      expect(approval).toBeDisabled();
      await waitFor(() => expect(desktopApi.acceptMaintenanceDraft).toHaveBeenCalledOnce());
      expect(await screen.findByRole('alert')).toHaveTextContent('无法完成维护审核操作。');
      expect(screen.queryByText('已批准 revision')).not.toBeInTheDocument();
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('keeps maintenance review controls unavailable in the browser fallback', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
    };
    const draft = createMaintenanceDraft({
      id: 'maintenance-login',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'a'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'b'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Wait for the account menu.' },
      evidence: [{ runId: 'run-login', artifactId: 'artifact-login', contentHash: 'c'.repeat(64) }],
      impact: [],
    });
    const state = createInitialStudioState();
    state.projects = [{ ...project, testCases: [source] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseReference = { id: source.id, version: source.version };
    state.selectedTestCaseId = source.id;
    state.selectedRecordingId = '';
    state.maintenanceDrafts = [draft];
    state.startupGuide.completed = true;
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));
    window.desktopApi = undefined;

    try {
      render(<App />);
      const navigation = await screen.findByRole('navigation', { name: '主导航' });
      fireEvent.click(within(navigation).getByRole('button', { name: '维护审核' }));

      expect(await screen.findByRole('checkbox', { name: `确认 revision ${draft.projectRevision}` })).toBeDisabled();
      expect(screen.getByRole('button', { name: '批准草案' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '拒绝草案' })).toBeDisabled();
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('uses an in-app confirmation dialog when deleting a project', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '跳过，进入工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '创建新项目' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除项目' }));

    const dialog = await screen.findByRole('dialog', { name: '删除此项？' });
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('确认删除项目');

    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));

    expect(await screen.findByLabelText('空态首页')).toBeInTheDocument();
    nativeConfirm.mockRestore();
  });

  it('keeps the natural-language run bound to the group and environment selected at send time', async () => {
    const project = createEmptyProject(1);
    const state = createInitialStudioState();
    const environment = project.environments[0]!;
    state.projects = [project];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseId = '';
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    state.midsceneConfig = {
      ...state.midsceneConfig,
      modelBaseUrl: 'https://models.example.test/v1',
      modelSecret: { ...state.midsceneConfig.modelSecret, hasKey: true },
      modelName: 'ui-agent',
      modelFamily: 'openai',
    };
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    await waitFor(() => expect(screen.queryByLabelText('空态首页')).not.toBeInTheDocument());
    const navigation = await screen.findByRole('navigation', { name: '主导航' });
    fireEvent.click(within(navigation).getByRole('button', { name: '自然语言' }));
    const command = await screen.findByPlaceholderText('输入命令，例如：提取所有图表图例');
    fireEvent.change(command, { target: { value: '点击 #create-order' } });
    fireEvent.click(within(command.parentElement!).getByRole('button'));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      expect(persisted.runDetails[0]).toMatchObject({
        status: 'blocked',
        reason: { code: 'unsupportedAction' },
        agentRun: {
          intent: {
            projectId: project.id,
            groupId: project.groups[0]!.id,
            environmentId: environment.id,
          },
        },
      });
      expect(persisted.recentRuns[0]).toMatchObject({
        status: 'blocked',
        reason: { code: 'unsupportedAction' },
      });
    });
  });

  it('clears the blocked reason after manual confirmation completes a run', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-manual-confirmation',
      name: '人工确认用例',
      steps: [{ id: 'step-manual-confirmation', type: 'manual' as const, title: '确认订单', body: '检查订单详情。' }],
    };
    const state = createInitialStudioState();
    state.projects = [{ ...project, testCases: [testCase] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseId = testCase.id;
    state.selectedTestCaseReference = { id: testCase.id, version: testCase.version ?? 1 };
    state.startupGuide.completed = true;
    state.runDetails = [{
      id: 'run-manual-confirmation',
      projectId: project.id,
      testCaseId: testCase.id,
      environmentId: environment.id,
      title: testCase.name,
      status: 'blocked',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:01',
      summary: '等待人工确认。',
      reason: { code: 'unsupportedAction', message: '等待人工确认。' },
      logs: [],
      steps: [{
        id: 'run-manual-confirmation-step',
        stepId: 'step-manual-confirmation',
        title: '确认订单',
        status: 'blocked',
        message: '等待人工确认。',
      }],
      artifacts: [],
    }];
    state.recentRuns = [{
      id: 'run-manual-confirmation',
      name: testCase.name,
      status: 'blocked',
      duration: '00:00:01',
      summary: '等待人工确认。',
      reason: { code: 'unsupportedAction', message: '等待人工确认。' },
      projectId: project.id,
      testCaseId: testCase.id,
      environmentId: environment.id,
      environmentName: environment.name,
      startedAt: new Date(0).toISOString(),
    }];
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: '主导航' });
    fireEvent.click(within(navigation).getByRole('button', { name: '运行记录' }));
    fireEvent.change(await screen.findByLabelText('为 确认订单 填写人工确认说明'), {
      target: { value: '订单信息已核对。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认通过' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      expect(persisted.runDetails[0]).toMatchObject({ status: 'passed' });
      expect(persisted.runDetails[0]?.reason).toBeUndefined();
      expect(persisted.recentRuns[0]).toMatchObject({ status: 'passed' });
      expect(persisted.recentRuns[0]?.reason).toBeUndefined();
    });
  });

  it('runs a saved Suite through Case records without creating a synthetic Suite run', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-suite-catalog',
      name: 'Suite 商品目录检查',
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-release',
      name: '发布回归',
      caseReferences: [{ id: testCase.id, version: testCase.version ?? 1, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const state = createInitialStudioState();
    state.projects = [project];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseId = testCase.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: '主导航' });
    fireEvent.click(within(navigation).getByRole('button', { name: '套件' }));
    fireEvent.click(await screen.findByRole('button', { name: '运行 Suite' }));

    await screen.findByRole('heading', { level: 1, name: '运行记录' });
    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('midscene-studio-state-v2') ?? '{}');
      expect(persisted.runDetails).toEqual(expect.arrayContaining([
        expect.objectContaining({ testCaseId: testCase.id }),
      ]));
      expect(persisted.runDetails.some((detail: { id: string }) => /^suite-run-\d+$/u.test(detail.id))).toBe(false);
    });
  });

  it('retains the main-persisted Suite parent when the renderer saves completed Case state', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-main-persisted-parent',
      name: 'Main persisted child',
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-main-persisted-parent',
      name: 'Main persisted Suite',
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version ?? 1, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const state = createInitialStudioState();
    state.projects = [project];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseId = testCase.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    const suiteParent = {
      id: 'suite-main-persisted-run',
      provenance: {
        schemaVersion: 1,
        projectId: project.id,
        projectRevision: 'a'.repeat(64),
        source: 'legacyStudioStore',
        reproducibility: 'legacy',
        suite: { reference: { id: suite.id, version: suite.version }, parentRunId: 'suite-main-persisted-run' },
        fixtures: [],
        reusableFlows: [],
        baselines: [],
        environment: { id: environment.id, name: environment.name, baseUrl: environment.url },
        browserProfile: { engine: 'chromium', headless: true },
        executor: { appVersion: 'test', runnerVersion: 'test' },
        model: { hasKey: false },
        createdAt: '2026-08-23T00:00:00.000Z',
      },
      startedAt: '2026-08-23T00:00:00.000Z',
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'passed',
      memberRunIds: [],
      members: [],
      summary: { passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
    };
    const saveStudioState = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState: vi.fn().mockResolvedValue(state),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
      runSuite: vi.fn().mockResolvedValue({
        runId: suiteParent.id,
        title: suite.name,
        detail: {
          suite: {
            suiteId: suite.id,
            suiteVersion: suite.version,
            environmentId: environment.id,
            status: 'passed',
            startedAt: suiteParent.startedAt,
            endedAt: suiteParent.finishedAt,
            effectiveConcurrency: 1,
            results: [],
            issues: [],
          },
          caseDetails: [],
        },
        suiteRunRecord: suiteParent,
      }),
      saveStudioState,
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);

      const navigation = await screen.findByRole('navigation', { name: '主导航' });
      fireEvent.click(within(navigation).getByRole('button', { name: '套件' }));
      fireEvent.click(await screen.findByRole('button', { name: '运行 Suite' }));

      await waitFor(() => {
        const savedStates = vi.mocked(saveStudioState).mock.calls.map(([candidate]) => candidate as StudioState);
        expect(savedStates).toEqual(expect.arrayContaining([
          expect.objectContaining({
            suiteRunRecords: [expect.objectContaining({ id: suiteParent.id, status: 'passed' })],
          }),
        ]));
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('hydrates a rejected Suite parent into the run records immediately', async () => {
    const originalDesktopApi = window.desktopApi;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_234);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-rejected-parent',
      name: 'Rejected parent child',
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-rejected-parent',
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version ?? 1, dependsOn: [] }],
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const state = createInitialStudioState();
    state.projects = [project];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseId = testCase.id;
    state.selectedRecordingId = '';
    state.startupGuide.completed = true;
    const suiteParent = {
      id: 'suite-run-1234',
      provenance: {
        schemaVersion: 1,
        projectId: project.id,
        projectRevision: 'a'.repeat(64),
        source: 'legacyStudioStore',
        reproducibility: 'legacy',
        suite: { reference: { id: suite.id, version: suite.version }, parentRunId: 'suite-run-1234' },
        fixtures: [], reusableFlows: [], baselines: [],
        environment: { id: environment.id, name: environment.name, baseUrl: environment.url },
        browserProfile: { engine: 'chromium', headless: true },
        executor: { appVersion: 'test', runnerVersion: 'test' },
        model: { hasKey: false },
        createdAt: '2026-08-23T00:00:00.000Z',
      },
      startedAt: '2026-08-23T00:00:00.000Z',
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'error',
      reasonCode: 'executorError',
      memberRunIds: [],
      members: [],
      summary: { passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
    };
    const saveStudioState = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState: vi.fn().mockResolvedValue(state),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
      runSuite: vi.fn().mockRejectedValue(new Error('fixture trust lookup failed')),
      loadSuiteRunRecord: vi.fn().mockResolvedValue(suiteParent),
      saveStudioState,
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);

      const navigation = await screen.findByRole('navigation', { name: '主导航' });
      fireEvent.click(within(navigation).getByRole('button', { name: '套件' }));
      fireEvent.click(await screen.findByRole('button', { name: '运行 Suite' }));

      await waitFor(() => expect(desktopApi.loadSuiteRunRecord).toHaveBeenCalledWith(suiteParent.id));
      expect(await screen.findByRole('heading', { level: 1, name: '运行记录' })).toBeInTheDocument();
      expect((await screen.findAllByText(`Suite ${suite.id}@${suite.version}`)).length).toBeGreaterThan(0);
      await waitFor(() => {
        const savedStates = vi.mocked(saveStudioState).mock.calls.map(([candidate]) => candidate as StudioState);
        expect(savedStates).toEqual(expect.arrayContaining([
          expect.objectContaining({
            suiteRunRecords: [expect.objectContaining({ id: suiteParent.id, status: 'error' })],
          }),
        ]));
      });
    } finally {
      window.desktopApi = originalDesktopApi;
      dateNow.mockRestore();
    }
  });

  it('keeps historical exact-rerun status events bound to frozen provenance', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    project.id = 'project-history';
    const historicalEnvironment = {
      ...project.environments[0]!,
      id: 'env-history',
      name: 'Historical staging',
      baseUrl: 'https://history.example.test',
    };
    const currentEnvironment = {
      ...historicalEnvironment,
      id: 'env-current',
      name: 'Current preview',
      baseUrl: 'https://current.example.test',
    };
    const currentCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, currentEnvironment.id),
      id: 'case-current',
      version: 9,
      name: 'Mutable current Case',
      prdPath: { documentId: 'document-current', pathId: 'path-current' },
    };
    const historicalRun: RunDetail = {
      id: 'run-history',
      projectId: project.id,
      testCaseId: 'case-history',
      testCaseVersion: 4,
      documentId: 'document-history',
      environmentId: historicalEnvironment.id,
      title: 'Frozen Case v4',
      status: 'passed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      duration: '00:00:01',
      summary: 'Historical run passed.',
      provenance: {
        schemaVersion: 1,
        projectId: project.id,
        projectRevision: 'a'.repeat(64),
        source: 'projectDirectory',
        reproducibility: 'versioned',
        testCase: { id: 'case-history', version: 4 },
        fixtures: [],
        reusableFlows: [],
        baselines: [],
        environment: historicalEnvironment,
        browserProfile: { engine: 'chromium', headless: true },
        executor: { appVersion: '1.0.0', runnerVersion: 'runtime-bundle-v1' },
        model: { hasKey: true },
        createdAt: new Date(0).toISOString(),
      },
      logs: [],
      steps: [],
      artifacts: [],
    };
    const state = createInitialStudioState();
    state.projects = [{
      ...project,
      environments: [historicalEnvironment, currentEnvironment],
      selectedEnvironmentId: currentEnvironment.id,
      testCases: [currentCase],
    }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseId = currentCase.id;
    state.selectedTestCaseReference = { id: currentCase.id, version: currentCase.version ?? 1 };
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    state.runDetails = [historicalRun];
    state.recentRuns = [{
      id: historicalRun.id,
      name: historicalRun.title,
      status: historicalRun.status,
      duration: historicalRun.duration,
      summary: historicalRun.summary,
      projectId: historicalRun.projectId,
      testCaseId: historicalRun.testCaseId,
      documentId: historicalRun.documentId,
      environmentId: historicalRun.environmentId,
      environmentName: historicalEnvironment.name,
      startedAt: historicalRun.startedAt,
    }];

    let runEventListener: Parameters<DesktopApi['onRunEvent']>[0] = () => undefined;
    let resolveHistoricalRerun: (result: unknown) => void = () => undefined;
    const historicalRerun = new Promise((resolve) => {
      resolveHistoricalRerun = resolve;
    });
    const saveStudioState = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState: vi.fn().mockResolvedValue(state),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn((listener) => {
        runEventListener = listener;
        return () => undefined;
      }),
      planHistoricalRerun: vi.fn().mockResolvedValue({ status: 'ready', runId: historicalRun.id }),
      runHistoricalRerun: vi.fn().mockImplementation(() => historicalRerun),
      saveStudioState,
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);

      const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
      fireEvent.click(within(navigation).getByRole('button', { name: 'Run Records' }));
      const rerunButton = await screen.findByRole('button', { name: 'Rerun exact version' });
      await waitFor(() => expect(rerunButton).toBeEnabled());
      fireEvent.click(rerunButton);
      await waitFor(() => expect(desktopApi.runHistoricalRerun).toHaveBeenCalledWith(historicalRun.id));

      await act(async () => {
        runEventListener({
          runId: 'run-history-rerun',
          title: 'Frozen Case v4 rerun',
          type: 'status',
          status: 'running',
          summary: 'Historical rerun started.',
        });
      });

      await waitFor(() => {
        const persisted = saveStudioState.mock.calls
          .map(([candidate]) => candidate as StudioState)
          .find((candidate) => candidate.recentRuns.some((run) => run.id === 'run-history-rerun'));
        const rerunSummary = persisted?.recentRuns.find((run) => run.id === 'run-history-rerun');
        expect(rerunSummary).toMatchObject({
          projectId: project.id,
          testCaseId: historicalRun.provenance!.testCase.id,
          documentId: historicalRun.documentId,
          environmentId: historicalEnvironment.id,
          environmentName: historicalEnvironment.name,
        });
        expect(rerunSummary).not.toMatchObject({
          testCaseId: currentCase.id,
          documentId: currentCase.prdPath!.documentId,
          environmentId: currentEnvironment.id,
          environmentName: currentEnvironment.name,
        });
      });

      await act(async () => {
        resolveHistoricalRerun({
          status: 'completed',
          response: {
            runId: 'run-history-rerun',
            title: 'Frozen Case v4 rerun',
            detail: { ...historicalRun, id: 'run-history-rerun' },
          },
        });
        await historicalRerun;
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('pins a bound Case run to its observed project revision and directs stale snapshots to reload', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-bound-revision',
      version: 1,
    };
    const state = createInitialStudioState();
    state.projects = [{ ...project, testCases: [testCase] }];
    state.selectedProjectId = project.id;
    state.selectedGroupId = project.groups[0]!.id;
    state.selectedTestCaseId = testCase.id;
    const revision = 'a'.repeat(64);
    state.selectedTestCaseReference = { id: testCase.id, version: testCase.version ?? 1 };
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    state.projectAssetBindings = [{
      projectId: project.id,
      projectDirectory: '/tmp/bound-case-run',
      revision,
      boundAt: '2026-08-15T00:00:00.000Z',
    }];
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState: vi.fn().mockResolvedValue(state),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
      runTestCase: vi.fn().mockRejectedValue(Object.assign(new Error('snapshot changed'), { code: 'staleProjectRevision' })),
      saveStudioState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);

      const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
      fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
      await screen.findByRole('heading', { name: 'Case Workbench' });
      fireEvent.click(await screen.findByRole('button', { name: 'Run Test' }));

      await waitFor(() => expect(desktopApi.runTestCase).toHaveBeenCalledWith({
        projectId: project.id,
        testCase: { id: testCase.id, version: testCase.version ?? 1 },
        expectedProjectRevision: revision,
      }));
      expect(desktopApi.runTestCase).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('alert')).toHaveTextContent('Project snapshot changed. Reload project assets before running again.');
      fireEvent.click(screen.getByRole('button', { name: 'Open project assets' }));
      expect(await screen.findByRole('dialog')).toHaveTextContent('Project Asset Snapshot');
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('opens the failed project assets after the user selects another project while a Case run is pending', async () => {
    const originalDesktopApi = window.desktopApi;
    const projectA = createEmptyProject(1);
    projectA.id = 'project-a';
    projectA.name = 'Project A';
    const environment = projectA.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, projectA.groups[0]!.id, environment.id),
      id: 'case-project-a',
      version: 1,
    };
    projectA.testCases = [testCase];
    const projectB = createEmptyProject(2);
    projectB.id = 'project-b';
    projectB.name = 'Project B';
    const state = createInitialStudioState();
    state.projects = [projectA, projectB];
    state.selectedProjectId = projectA.id;
    state.selectedGroupId = projectA.groups[0]!.id;
    state.selectedTestCaseId = testCase.id;
    state.selectedTestCaseReference = { id: testCase.id, version: testCase.version ?? 1 };
    state.startupGuide.completed = true;
    state.appearance.localeMode = 'en-US';
    state.projectAssetBindings = [{
      projectId: projectA.id,
      projectDirectory: '/tmp/project-a-assets',
      revision: 'a'.repeat(64),
      boundAt: '2026-08-15T00:00:00.000Z',
    }];
    let rejectRun: (error: unknown) => void = () => undefined;
    const pendingRun = new Promise<never>((_resolve, reject) => {
      rejectRun = reject;
    });
    const desktopApi = {
      getRuntimeInfo: vi.fn().mockResolvedValue({ platform: 'desktop', persistence: 'file' }),
      loadStudioState: vi.fn().mockResolvedValue(state),
      onRecordingEvent: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
      runTestCase: vi.fn().mockImplementation(() => pendingRun),
      saveStudioState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<App />);

      const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
      fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Run Test' }));
      await waitFor(() => expect(desktopApi.runTestCase).toHaveBeenCalledOnce());

      fireEvent.click(within(navigation).getByRole('button', { name: 'Projects' }));
      const projectBHeading = await screen.findByRole('heading', { level: 2, name: 'Project B' });
      fireEvent.click(projectBHeading.closest('article')!);
      await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Project B' }).closest('article')).toHaveClass('is-active'));
      rejectRun(Object.assign(new Error('snapshot changed'), { code: 'staleProjectRevision' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Project snapshot changed. Reload project assets before running again.');
      fireEvent.click(screen.getByRole('button', { name: 'Open project assets' }));
      expect(within(await screen.findByRole('dialog')).getByRole('heading', { level: 2, name: 'Project A' })).toBeInTheDocument();
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

});
