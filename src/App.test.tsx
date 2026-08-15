import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptySuiteAsset,
  createEmptyTestCase,
  createInitialStudioState,
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
