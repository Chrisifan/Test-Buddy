import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectManagementPage } from './ProjectManagementPage.js';
import { createDemoStudioState, type DesktopApi } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';

function ProjectPageHarness() {
  const state = createDemoStudioState();
  const [project, setProject] = React.useState(state.projects[0]!);

  return (
    <I18nProvider locale="zh-CN">
      <ProjectManagementPage
        onCreateGroup={vi.fn()}
        onCreateProject={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteProject={vi.fn()}
        onSaveCredential={vi.fn()}
        onSelectGroup={vi.fn()}
        onSelectProject={vi.fn()}
        onUpdateProject={(updater) => setProject((current) => updater(current))}
        projects={[project]}
        selectedGroupId={project.groups[0]!.id}
        selectedProject={project}
      />
    </I18nProvider>
  );
}

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

  it('labels an unbound project as legacy and not reproducible', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;

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
          selectedGroupId={project.groups[0]!.id}
          selectedProject={project}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Legacy - not reproducible')).toBeInTheDocument();
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

  it('creates an immutable fixture version without replacing the prior version', async () => {
    render(<ProjectPageHarness />);

    fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
    fireEvent.click(screen.getByRole('button', { name: '新建 Fixture' }));
    fireEvent.change(screen.getByLabelText('Fixture 名称'), { target: { value: '准备订单数据' } });
    fireEvent.change(screen.getByLabelText('同源 API 路径'), { target: { value: '/api/test-data/orders' } });
    fireEvent.click(screen.getByRole('button', { name: '新建 Fixture' }));

    expect(await screen.findByText(/v1/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建版本' }));
    fireEvent.change(screen.getByLabelText('Fixture 名称'), { target: { value: '准备订单数据（含优惠券）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存新版本' }));

    expect(await screen.findByText(/v2/u)).toBeInTheDocument();
    expect(screen.getByText('准备订单数据')).toBeInTheDocument();
    expect(screen.getByText('准备订单数据（含优惠券）')).toBeInTheDocument();
  });

  it('requires a valid same-origin HTTP lifecycle before creating a fixture version', () => {
    render(<ProjectPageHarness />);

    fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
    fireEvent.click(screen.getByRole('button', { name: '新建 Fixture' }));
    fireEvent.change(screen.getByLabelText('Fixture 名称'), { target: { value: '准备订单数据' } });

    expect(screen.getByRole('button', { name: '新建 Fixture' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('同源 API 路径'), { target: { value: 'https://outside.example.test/seed' } });
    expect(screen.getByRole('button', { name: '新建 Fixture' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('同源 API 路径'), { target: { value: '/api/test-data/orders' } });

    expect(screen.getByRole('button', { name: '新建 Fixture' })).toBeEnabled();
  });

  it('records explicit script trust without starting a fixture or browser', async () => {
    const originalDesktopApi = window.desktopApi;
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-script',
      version: 1,
      name: '导入订单数据',
      description: '导入本地准备数据。',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [project.environments[0]!.id],
      setup: {
        mode: 'script' as const,
        summary: '导入准备数据。',
        script: {
          relativePath: 'scripts/import-orders.mjs',
          contentHash: 'a'.repeat(64),
          requiredEnvironment: [],
        },
      },
      concurrency: 'exclusive' as const,
      resourceLocks: ['orders'],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    const binding = {
      projectId: project.id,
      projectDirectory: '/tmp/project-assets',
      revision: 'a'.repeat(64),
      boundAt: '2026-08-11T00:00:00.000Z',
    };
    const trusted = {
      fixtureId: fixture.id,
      fixtureVersion: fixture.version,
      lifecycle: 'setup' as const,
      relativePath: fixture.setup.script.relativePath,
      contentHash: fixture.setup.script.contentHash,
      approvedAt: '2026-08-11T00:01:00.000Z',
    };
    const desktopApi = {
      listFixtureScriptTrusts: vi.fn().mockResolvedValue([]),
      approveFixtureScriptTrust: vi.fn().mockResolvedValue(trusted),
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
            projectAssetBindings={[binding]}
            projects={[{ ...project, fixtures: [fixture] }]}
            selectedGroupId={project.groups[0]!.id}
            selectedProject={{ ...project, fixtures: [fixture] }}
          />
        </I18nProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
      expect(await screen.findByText('未信任')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '信任脚本' }));

      expect(await screen.findByText('已信任')).toBeInTheDocument();
      expect(desktopApi.approveFixtureScriptTrust).toHaveBeenCalledWith({
        projectId: project.id,
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        lifecycle: 'setup',
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('imports a renderer-safe authentication-state reference and makes it available to an environment', async () => {
    const originalDesktopApi = window.desktopApi;
    const imported = {
      id: 'state-staging-admin',
      label: '预发布管理员登录态',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      availability: 'available' as const,
    };
    const desktopApi = {
      importStorageState: vi.fn().mockResolvedValue(imported),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<ProjectPageHarness />);

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
      fireEvent.change(screen.getByLabelText('认证状态名称'), { target: { value: imported.label } });
      fireEvent.click(screen.getByRole('button', { name: '导入 storageState' }));

      expect(await screen.findByText(imported.label)).toBeInTheDocument();
      expect(screen.getByText('可用')).toBeInTheDocument();
      expect(desktopApi.importStorageState).toHaveBeenCalledWith({
        projectId: 'project-demo',
        label: imported.label,
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('captures, refreshes, and revokes a browser authentication state without exposing its contents', async () => {
    const originalDesktopApi = window.desktopApi;
    const captured = {
      id: 'state-staging-admin',
      label: '预发布管理员登录态',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      availability: 'unknown' as const,
    };
    const refreshed = { ...captured, updatedAt: '2026-08-12T00:00:00.000Z', availability: 'available' as const };
    const desktopApi = {
      captureStorageState: vi.fn().mockResolvedValueOnce(captured).mockResolvedValueOnce(refreshed),
      revokeStorageState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      render(<ProjectPageHarness />);

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
      fireEvent.change(screen.getByLabelText('认证状态名称'), { target: { value: captured.label } });
      fireEvent.click(screen.getByRole('button', { name: '捕获当前浏览器状态' }));
      expect(await screen.findByText(captured.label)).toBeInTheDocument();
      expect(desktopApi.captureStorageState).toHaveBeenCalledWith({ projectId: 'project-demo', label: captured.label });

      fireEvent.click(screen.getByRole('button', { name: '刷新认证状态' }));
      await waitFor(() => expect(desktopApi.captureStorageState).toHaveBeenCalledTimes(2));
      expect(desktopApi.captureStorageState).toHaveBeenLastCalledWith({
        projectId: 'project-demo',
        label: captured.label,
        storageStateId: captured.id,
      });
      expect(await screen.findByText('可用')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '撤销认证状态' }));
      await waitFor(() => expect(desktopApi.revokeStorageState).toHaveBeenCalledWith({
        projectId: 'project-demo',
        storageStateId: captured.id,
      }));
      await waitFor(() => expect(screen.queryByText(captured.label)).not.toBeInTheDocument());
    } finally {
      window.desktopApi = originalDesktopApi;
    }
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

  it('publishes local project edits only after a reviewed update plan is confirmed', async () => {
    const originalDesktopApi = window.desktopApi;
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const binding = {
      projectId: project.id,
      projectDirectory: '/tmp/project-assets',
      revision: 'a'.repeat(64),
      boundAt: '2026-08-11T00:00:00.000Z',
    };
    const updatePlan = {
      projectId: project.id,
      projectDirectory: binding.projectDirectory,
      publishedRevision: binding.revision,
      snapshotRevision: 'b'.repeat(64),
      files: ['project.json', 'cases/case-login.json'],
      status: 'ready' as const,
      issues: [],
    };
    const onProjectAssetBound = vi.fn();
    const desktopApi = {
      inspectProjectAssetBinding: vi.fn().mockResolvedValue({
        projectId: project.id,
        projectDirectory: binding.projectDirectory,
        state: 'localChanges',
        issues: [{ path: 'studio-data', message: '本地项目存在尚未写入资产快照的修改。' }],
      }),
      planProjectAssetUpdate: vi.fn().mockResolvedValue(updatePlan),
      updateProjectAssetSnapshot: vi.fn().mockResolvedValue({ ...binding, revision: updatePlan.snapshotRevision }),
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
            projectAssetBindings={[binding]}
            projects={[project]}
            selectedGroupId={project.groups[0]!.id}
            selectedProject={project}
          />
        </I18nProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: '管理配置' }));
      expect(await screen.findByText('本地有未快照修改')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '生成更新计划' }));
      expect(await screen.findByText('可确认更新')).toBeInTheDocument();
      expect(desktopApi.updateProjectAssetSnapshot).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: '确认更新资产快照' }));
      expect(await screen.findByText('资产快照已更新')).toBeInTheDocument();
      expect(desktopApi.planProjectAssetUpdate).toHaveBeenCalledWith({
        projectId: project.id,
        project,
        expectedRevision: binding.revision,
      });
      expect(desktopApi.updateProjectAssetSnapshot).toHaveBeenCalledWith({
        projectId: project.id,
        project,
        expectedRevision: binding.revision,
        plannedRevision: updatePlan.snapshotRevision,
      });
      expect(onProjectAssetBound).toHaveBeenCalledWith({ ...binding, revision: updatePlan.snapshotRevision });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });
});
