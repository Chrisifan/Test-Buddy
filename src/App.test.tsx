import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptyRecordingAsset,
  createEmptySuiteAsset,
  createEmptyTestCase,
  createInitialStudioState,
  createPrdDocumentAsset,
  type DesktopApi,
} from '../shared/studio.js';
import { App } from './App.js';

describe('App shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the startup page on first load', async () => {
    render(<App />);

    expect(await screen.findByLabelText('启动屏')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '先把 AI 测试引擎接入工作台' })).toBeInTheDocument();
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
    expect(container.querySelector('.app-runtimebar')).toBeInTheDocument();
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
      modelApiKey: 'test-key',
      modelName: 'ui-agent',
      modelFamily: 'openai',
    };
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.change(screen.getAllByLabelText('Step Title')[0]!, { target: { value: 'Case A draft step' } });

    fireEvent.click(within(navigation).getByRole('button', { name: 'Workflow' }));
    fireEvent.click(await screen.findByRole('button', { name: /Case B/u }));
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
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
    state.midsceneConfig = { ...state.midsceneConfig, modelBaseUrl: 'https://models.example.test/v1', modelApiKey: 'test-key', modelName: 'ui-agent', modelFamily: 'openai' };
    window.localStorage.setItem('midscene-studio-state-v2', JSON.stringify(state));

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Main Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as New Version' }));
    fireEvent.change(screen.getAllByLabelText('Step Title')[0]!, { target: { value: 'stale A draft' } });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Workflow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New Flow' }));
    fireEvent.click(within(navigation).getByRole('button', { name: 'Cases' }));

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
    state.midsceneConfig = { ...state.midsceneConfig, modelBaseUrl: 'https://models.example.test/v1', modelApiKey: 'test-key', modelName: 'ui-agent', modelFamily: 'openai' };
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
    state.midsceneConfig = { ...state.midsceneConfig, modelBaseUrl: 'https://models.example.test/v1', modelApiKey: 'test-key', modelName: 'ui-agent', modelFamily: 'openai' };
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
      modelApiKey: 'test-key',
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
      expect(persisted.runDetails[0]?.agentRun?.intent).toMatchObject({
        projectId: project.id,
        groupId: project.groups[0]!.id,
        environmentId: environment.id,
      });
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
});
