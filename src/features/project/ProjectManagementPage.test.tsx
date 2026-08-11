import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectManagementPage } from './ProjectManagementPage.js';
import { createDemoStudioState, type DesktopApi } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';

describe('ProjectManagementPage', () => {
  it('uses the project overview labels by default', () => {
    render(
      <ProjectManagementPage
        onCreateGroup={vi.fn()}
        onCreateProject={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteProject={vi.fn()}
        onSaveCredential={vi.fn()}
        onSelectGroup={vi.fn()}
        onSelectProject={vi.fn()}
        onUpdateProject={vi.fn()}
        projects={[]}
        selectedGroupId=""
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '测试项目' })).toBeInTheDocument();
    expect(screen.getByText('测试用例总数')).toBeInTheDocument();
    expect(screen.getByText('创建测试项目')).toBeInTheDocument();
    expect(screen.queryByText('Test Projects')).not.toBeInTheDocument();
  });

  it('translates project forms and environment controls to English', () => {
    const state = createDemoStudioState();
    const project = state.projects[0];

    render(
      <I18nProvider locale="en-US">
        <ProjectManagementPage
          onCreateGroup={vi.fn()}
          onCreateProject={vi.fn()}
          onDeleteGroup={vi.fn()}
          onDeleteProject={vi.fn()}
          onSaveCredential={vi.fn()}
          onSelectGroup={vi.fn()}
          onSelectProject={vi.fn()}
          onUpdateProject={vi.fn()}
          projects={[project]}
          selectedGroupId={project.groups[0].id}
          selectedProject={project}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(screen.getByText('Project Name')).toBeInTheDocument();
    expect(screen.getByText('Project Description')).toBeInTheDocument();
    expect(screen.getByText('Credential Name')).toBeInTheDocument();
    expect(screen.getAllByText('Environment Name').length).toBeGreaterThan(0);
    expect(screen.getByText('Do Not Use Credentials')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Credential' })).toBeInTheDocument();
  });

  it('requires a reviewed desktop asset plan before writing a project snapshot', async () => {
    const originalDesktopApi = window.desktopApi;
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const projectDirectory = '/tmp/testbuddy-project-assets';
    const binding = {
      projectId: project.id,
      projectDirectory,
      revision: 'a'.repeat(64),
      boundAt: '2026-08-11T00:00:00.000Z',
    };
    const onProjectAssetBound = vi.fn();
    const desktopApi = {
      selectProjectAssetDirectory: vi.fn().mockResolvedValue(projectDirectory),
      planProjectAssetMigration: vi.fn().mockResolvedValue({
        projectId: project.id,
        projectDirectory,
        snapshotRevision: 'a'.repeat(64),
        files: ['project.json', 'cases/case-login.json'],
        status: 'ready',
        conflicts: [],
      }),
      writeProjectAssetSnapshot: vi.fn().mockResolvedValue(binding),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(
        <I18nProvider locale="zh-CN">
          <ProjectManagementPage
            onCreateGroup={vi.fn()}
            onCreateProject={vi.fn()}
            onDeleteGroup={vi.fn()}
            onDeleteProject={vi.fn()}
            onProjectAssetBound={onProjectAssetBound}
            onSaveCredential={vi.fn()}
            onSelectGroup={vi.fn()}
            onSelectProject={vi.fn()}
            onUpdateProject={vi.fn()}
            projects={[project]}
            selectedGroupId={project.groups[0]!.id}
            selectedProject={project}
          />
        </I18nProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
      fireEvent.click(await screen.findByRole('button', { name: '选择目录并生成计划' }));

      expect(await screen.findByText('可写入')).toBeInTheDocument();
      expect(screen.getByText(`目标目录: ${projectDirectory}`)).toBeInTheDocument();
      expect(desktopApi.planProjectAssetMigration).toHaveBeenCalledWith({ projectId: project.id, projectDirectory, project });

      fireEvent.click(screen.getByRole('button', { name: '确认写入资产快照' }));

      expect(await screen.findByText('资产快照已写入')).toBeInTheDocument();
      expect(desktopApi.writeProjectAssetSnapshot).toHaveBeenCalledWith({
        projectId: project.id,
        projectDirectory,
        project,
        plannedRevision: 'a'.repeat(64),
      });
      expect(onProjectAssetBound).toHaveBeenCalledWith(binding);
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('hides project asset snapshot controls when the desktop bridge is unavailable', () => {
    const originalDesktopApi = window.desktopApi;
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    window.desktopApi = undefined;

    try {
      render(
        <I18nProvider locale="zh-CN">
          <ProjectManagementPage
            onCreateGroup={vi.fn()}
            onCreateProject={vi.fn()}
            onDeleteGroup={vi.fn()}
            onDeleteProject={vi.fn()}
            onSaveCredential={vi.fn()}
            onSelectGroup={vi.fn()}
            onSelectProject={vi.fn()}
            onUpdateProject={vi.fn()}
            projects={[project]}
            selectedGroupId={project.groups[0]!.id}
            selectedProject={project}
          />
        </I18nProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
      expect(screen.queryByText('项目资产快照')).not.toBeInTheDocument();
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('does not expose a write command when the reviewed directory has conflicts', async () => {
    const originalDesktopApi = window.desktopApi;
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const desktopApi = {
      selectProjectAssetDirectory: vi.fn().mockResolvedValue('/tmp/non-empty-project-assets'),
      planProjectAssetMigration: vi.fn().mockResolvedValue({
        projectId: project.id,
        projectDirectory: '/tmp/non-empty-project-assets',
        snapshotRevision: 'a'.repeat(64),
        files: ['project.json'],
        status: 'requiresReview',
        conflicts: ['README.md'],
      }),
      writeProjectAssetSnapshot: vi.fn(),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(
        <I18nProvider locale="zh-CN">
          <ProjectManagementPage
            onCreateGroup={vi.fn()}
            onCreateProject={vi.fn()}
            onDeleteGroup={vi.fn()}
            onDeleteProject={vi.fn()}
            onSaveCredential={vi.fn()}
            onSelectGroup={vi.fn()}
            onSelectProject={vi.fn()}
            onUpdateProject={vi.fn()}
            projects={[project]}
            selectedGroupId={project.groups[0]!.id}
            selectedProject={project}
          />
        </I18nProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
      fireEvent.click(await screen.findByRole('button', { name: '选择目录并生成计划' }));

      expect(await screen.findByText('存在目录冲突')).toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '确认写入资产快照' })).not.toBeInTheDocument();
      expect(desktopApi.writeProjectAssetSnapshot).not.toHaveBeenCalled();
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('shows a bound snapshot diagnostic and lets the user refresh it without writing assets', async () => {
    const originalDesktopApi = window.desktopApi;
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const binding = {
      projectId: project.id,
      projectDirectory: '/tmp/project-assets',
      revision: 'a'.repeat(64),
      boundAt: '2026-08-11T00:00:00.000Z',
    };
    const reloadedProject = { ...project, name: '外部资产项目' };
    const reloadPlan = {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      snapshotRevision: 'b'.repeat(64),
      status: 'ready' as const,
      issues: [],
    };
    const onProjectAssetReloaded = vi.fn();
    const desktopApi = {
      inspectProjectAssetBinding: vi.fn().mockResolvedValue({
        projectId: project.id,
        projectDirectory: binding.projectDirectory,
        state: 'externalChanges',
        issues: [{ path: 'project.json.revision', message: '项目资产已被外部修改。' }],
      }),
      writeProjectAssetSnapshot: vi.fn(),
      planProjectAssetReload: vi.fn().mockResolvedValue(reloadPlan),
      reloadProjectAssetSnapshot: vi.fn().mockResolvedValue({
        project: reloadedProject,
        binding: { ...binding, revision: reloadPlan.snapshotRevision },
      }),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(
        <I18nProvider locale="zh-CN">
          <ProjectManagementPage
            onCreateGroup={vi.fn()}
            onCreateProject={vi.fn()}
            onDeleteGroup={vi.fn()}
            onDeleteProject={vi.fn()}
            onProjectAssetReloaded={onProjectAssetReloaded}
            onSaveCredential={vi.fn()}
            onSelectGroup={vi.fn()}
            onSelectProject={vi.fn()}
            onUpdateProject={vi.fn()}
            projectAssetBindings={[binding]}
            projects={[project]}
            selectedGroupId={project.groups[0]!.id}
            selectedProject={project}
          />
        </I18nProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));

      expect(await screen.findByText('检测到外部修改')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '生成重载计划' }));
      expect(await screen.findByText('可确认重载')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '确认重载资产快照' }));
      expect(await screen.findByText('资产快照已重载')).toBeInTheDocument();
      expect(desktopApi.planProjectAssetReload).toHaveBeenCalledWith({ projectId: project.id, project });
      expect(desktopApi.reloadProjectAssetSnapshot).toHaveBeenCalledWith({
        projectId: project.id,
        project,
        snapshotRevision: reloadPlan.snapshotRevision,
      });
      expect(onProjectAssetReloaded).toHaveBeenCalledWith({
        project: reloadedProject,
        binding: { ...binding, revision: reloadPlan.snapshotRevision },
      });
      fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
      expect(desktopApi.inspectProjectAssetBinding).toHaveBeenCalledTimes(2);
      expect(desktopApi.writeProjectAssetSnapshot).not.toHaveBeenCalled();
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });
});
