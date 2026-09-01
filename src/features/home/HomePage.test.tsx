import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HomePage } from './HomePage.js';
import type { AppPage } from '../../app/pageMeta.js';
import { createEmptyProject, createInitialStudioState } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';

const state = createInitialStudioState();

describe('HomePage', () => {
  it('shows the empty project state when no project exists', () => {
    const onGoToPage = vi.fn<(page: AppPage) => void>();

    render(
      <HomePage
        browserSession={state.browserSession}
        onCreateProject={vi.fn()}
        onGoToPage={onGoToPage}
        projects={[]}
        recentRuns={[]}
      />,
    );

    expect(screen.getByLabelText('空态首页')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '当前还没有测试项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建新项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PRD 分析/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /自然语言测试/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /可视化录制/ })).toBeInTheDocument();
    expect(screen.getByLabelText('平台能力')).toBeInTheDocument();
    expect(screen.getByText('支持 Electron 与 Web')).toBeInTheDocument();
    expect(screen.queryByText('系统在线')).not.toBeInTheDocument();
    expect(screen.queryByText('工作区：默认')).not.toBeInTheDocument();
  });

  it('shows workspace-wide dashboard framing cues when projects exist', () => {
    const project = createEmptyProject(1);
    const secondProject = createEmptyProject(2);

    render(
      <HomePage
        browserSession={state.browserSession}
        onCreateProject={vi.fn()}
        onGoToPage={vi.fn()}
        projects={[project, secondProject]}
        recentRuns={state.recentRuns}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '全局质量总览' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: project.name })).not.toBeInTheDocument();
    expect(screen.getByLabelText('全局工作台主体')).toBeInTheDocument();
    expect(screen.getByLabelText('全局质量洞察')).toBeInTheDocument();
    expect(screen.queryByText('工作区内 2 个项目')).not.toBeInTheDocument();
    expect(screen.getByText('工作区资产')).toBeInTheDocument();
    expect(screen.getByText('整体健康')).toBeInTheDocument();
    expect(screen.getByText('覆盖指数')).toBeInTheDocument();
    expect(screen.getAllByTestId('home-summary-icon')).toHaveLength(4);
    expect(screen.getByText('覆盖指数')).toBeInTheDocument();
    expect(screen.getByText('汇总 2 个项目的运行结果')).toBeInTheDocument();
    expect(screen.getByText('测试入口')).toBeInTheDocument();
    expect(screen.getByText('自然语言测试')).toBeInTheDocument();
    expect(screen.getByText('图表与表格巡检')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '管理项目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: '测试路径流水线' })).not.toBeInTheDocument();
    expect(screen.queryByText('快捷入口')).not.toBeInTheDocument();
  });

  it('renders the dashboard in English when the interface locale changes', () => {
    const project = createEmptyProject(1);

    render(
      <I18nProvider locale="en-US">
        <HomePage
          browserSession={state.browserSession}
          onCreateProject={vi.fn()}
          onGoToPage={vi.fn()}
          projects={[project]}
          recentRuns={[]}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Global Quality Overview' })).toBeInTheDocument();
    expect(screen.getByText('Workspace Assets')).toBeInTheDocument();
    expect(screen.getByText('Overall Health')).toBeInTheDocument();
    expect(screen.getByText('Coverage Index')).toBeInTheDocument();
    expect(screen.queryByText('全局质量总览')).not.toBeInTheDocument();
  });
});
