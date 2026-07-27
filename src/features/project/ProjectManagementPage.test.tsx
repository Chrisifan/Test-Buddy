import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectManagementPage } from './ProjectManagementPage.js';
import { createInitialStudioState } from '../../../shared/studio.js';
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
    const state = createInitialStudioState();
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
});
