import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { TestCaseManagementPage } from './TestCaseManagementPage.js';

const state = createInitialStudioState();
const project = state.projects[0];
const selectedGroup = project.groups[0];
const selectedTestCase = project.testCases.find((item) => item.groupId === selectedGroup.id) ?? project.testCases[0];

function renderPage(
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
  testCase = selectedTestCase,
) {
  return render(
    <I18nProvider locale={locale}>
      <TestCaseManagementPage
        browserSession={state.browserSession}
        isBrowserBusy={false}
        isRunning={false}
        navigateUrl={project.defaultUrl}
        onAppendStep={vi.fn()}
        onCaptureBrowser={vi.fn()}
        onChangeNavigateUrl={vi.fn()}
        onCreateTestCase={vi.fn()}
        onDeleteStep={vi.fn()}
        onNavigateBrowser={vi.fn()}
        onRunTestCase={vi.fn()}
        onSelectGroup={vi.fn()}
        onSelectTestCase={vi.fn()}
        onStartBrowserSession={vi.fn()}
        onUpdateTestCase={vi.fn()}
        project={project}
        runStatus="neutral"
        selectedEnvironment={project.environments[0]}
        selectedGroup={selectedGroup}
        selectedTestCase={testCase}
        selectedTestCaseId={testCase.id}
      />
    </I18nProvider>,
  );
}

describe('TestCaseManagementPage', () => {
  it('uses Chinese case workbench controls by default', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: '用例工作台' })).toBeInTheDocument();
    expect(screen.getByText('搜索用例...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行用例' })).toBeInTheDocument();
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.queryByText('Search cases...')).not.toBeInTheDocument();
  });

  it('switches the case title and primary action to English', () => {
    const recording = project.recordings[0];
    renderPage('en-US', {
      ...selectedTestCase,
      steps: [
        {
          id: 'replay-step-test',
          type: 'recordingReplay',
          title: 'Replay checkout path',
          body: 'Replay the selected recording.',
          recordingId: recording.id,
        },
      ],
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Case Workbench' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Test' })).toBeInTheDocument();
    expect(screen.getByText('Bind Recording Asset')).toBeInTheDocument();
    expect(screen.getAllByText(`${recording.steps.length} steps`).length).toBeGreaterThan(0);
    expect(screen.queryByText('绑定录制资产')).not.toBeInTheDocument();
  });
});
