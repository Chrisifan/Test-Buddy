import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDemoStudioState } from '../../../shared/studio.js';
import type { BrowserSessionState } from '../../../shared/studio.js';
import { RecordingPage } from './RecordingPage.js';
import { I18nProvider } from '../../i18n/index.js';

const renderRecordingConsole = (browserSession: BrowserSessionState) => {
  const state = createDemoStudioState();
  const project = state.projects[0]!;
  const recording = project.recordings[0]!;

  render(
    <RecordingPage
      browserSession={browserSession}
      browserSessionMessage={browserSession.message}
      environment={project.environments[0]}
      isReplaying={false}
      onAppendStep={vi.fn()}
      onCaptureSnapshot={vi.fn()}
      onCreateRecording={vi.fn()}
      onCreateTestCaseFromRecording={vi.fn()}
      onDeleteRecording={vi.fn()}
      onImportPlayback={vi.fn()}
      onRunRecording={vi.fn()}
      onSelectRecording={vi.fn()}
      onStartRecording={vi.fn()}
      onUpdateRecording={vi.fn()}
      project={project}
      recording={recording}
    />,
  );
};

describe('RecordingPage', () => {
  it('shows an idle browser stage without fabricated interactions', () => {
    const state = createDemoStudioState();
    renderRecordingConsole({ ...state.browserSession, screenshotPath: undefined, status: 'idle' });

    expect(screen.getByText('浏览器尚未启动')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '启动录制器' })).not.toHaveLength(0);
    expect(screen.queryByText('受控浏览器已就绪')).not.toBeInTheDocument();
    expect(screen.queryByText('点击图表筛选器')).not.toBeInTheDocument();
    expect(screen.queryByText('正在录制')).not.toBeInTheDocument();
  });

  it('describes a ready browser stage without inventing captured interactions', () => {
    const state = createDemoStudioState();
    renderRecordingConsole({ ...state.browserSession, screenshotPath: undefined, status: 'ready' });

    expect(screen.getByText('受控浏览器已就绪')).toBeInTheDocument();
    expect(screen.queryByText('点击图表筛选器')).not.toBeInTheDocument();
    expect(screen.queryByText('正在录制')).not.toBeInTheDocument();
  });

  it('shows an explicit browser error state without fabricated interactions', () => {
    const state = createDemoStudioState();
    renderRecordingConsole({ ...state.browserSession, screenshotPath: undefined, status: 'error' });

    expect(screen.getByText('浏览器启动失败')).toBeInTheDocument();
    expect(screen.queryByText('受控浏览器已就绪')).not.toBeInTheDocument();
    expect(screen.queryByText('点击图表筛选器')).not.toBeInTheDocument();
  });

  it('guides users to projects before opening the recording console', () => {
    const onOpenProjects = vi.fn();
    const state = createDemoStudioState();

    render(
      <I18nProvider locale="zh-CN">
        <RecordingPage
          browserSession={state.browserSession}
          browserSessionMessage={state.browserSession.message}
          isReplaying={false}
          onAppendStep={vi.fn()}
          onCaptureSnapshot={vi.fn()}
          onCreateRecording={vi.fn()}
          onCreateTestCaseFromRecording={vi.fn()}
          onDeleteRecording={vi.fn()}
          onImportPlayback={vi.fn()}
          onOpenProjects={onOpenProjects}
          onRunRecording={vi.fn()}
          onSelectRecording={vi.fn()}
          onStartRecording={vi.fn()}
          onUpdateRecording={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('尚未选择项目')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });

  it('runs the selected recording directly from the replay workbench', () => {
    const state = createDemoStudioState();
    const project = state.projects[0];
    const recording = project.recordings[0];
    const environment = project.environments.find((item) => item.id === recording.environmentId) ?? project.environments[0];
    const onRunRecording = vi.fn();

    render(
      <RecordingPage
        browserSession={state.browserSession}
        browserSessionMessage={state.browserSession.message}
        environment={environment}
        isReplaying={false}
        onAppendStep={vi.fn()}
        onCaptureSnapshot={vi.fn()}
        onCreateRecording={vi.fn()}
        onCreateTestCaseFromRecording={vi.fn()}
        onDeleteRecording={vi.fn()}
        onImportPlayback={vi.fn()}
        onRunRecording={onRunRecording}
        onSelectRecording={vi.fn()}
        onStartRecording={vi.fn()}
        onUpdateRecording={vi.fn()}
        project={project}
        recording={recording}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '运行回放' }));

    expect(onRunRecording).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: '操作录制回放' })).toBeInTheDocument();
    expect(screen.getByText('受控浏览器')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '捕获快照' })).toBeInTheDocument();
    expect(screen.queryByText('Start Recording')).not.toBeInTheDocument();
  });

  it('switches recording actions to English', () => {
    const state = createDemoStudioState();
    const project = state.projects[0];
    const recording = project.recordings[0];

    render(
      <I18nProvider locale="en-US">
        <RecordingPage
          browserSession={state.browserSession}
          browserSessionMessage={state.browserSession.message}
          environment={project.environments[0]}
          isReplaying={false}
          onAppendStep={vi.fn()}
          onCaptureSnapshot={vi.fn()}
          onCreateRecording={vi.fn()}
          onCreateTestCaseFromRecording={vi.fn()}
          onDeleteRecording={vi.fn()}
          onImportPlayback={vi.fn()}
          onRunRecording={vi.fn()}
          onSelectRecording={vi.fn()}
          onStartRecording={vi.fn()}
          onUpdateRecording={vi.fn()}
          project={project}
          recording={recording}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Operation Recording and Replay' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Start Recorder' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Run Replay' })).toBeInTheDocument();
  });

  it('stores the visual difference threshold as a normalized percentage', () => {
    const state = createDemoStudioState();
    const project = state.projects[0];
    const recording = project.recordings[0];
    const onUpdateRecording = vi.fn();

    render(
      <RecordingPage
        browserSession={state.browserSession}
        browserSessionMessage={state.browserSession.message}
        environment={project.environments[0]}
        isReplaying={false}
        onAppendStep={vi.fn()}
        onCaptureSnapshot={vi.fn()}
        onCreateRecording={vi.fn()}
        onCreateTestCaseFromRecording={vi.fn()}
        onDeleteRecording={vi.fn()}
        onImportPlayback={vi.fn()}
        onRunRecording={vi.fn()}
        onSelectRecording={vi.fn()}
        onStartRecording={vi.fn()}
        onUpdateRecording={onUpdateRecording}
        project={project}
        recording={recording}
      />,
    );

    fireEvent.change(screen.getByLabelText('视觉差异阈值（%）'), { target: { value: '15' } });

    const updater = onUpdateRecording.mock.calls[0]?.[0] as (current: typeof recording) => typeof recording;
    expect(updater(recording)).toEqual(expect.objectContaining({ visualDiffThreshold: 0.15 }));
  });

  it('adds a screenshot-relative dynamic region mask to the recording asset', () => {
    const state = createDemoStudioState();
    const project = state.projects[0];
    const recording = project.recordings[0];
    const onUpdateRecording = vi.fn();

    render(
      <RecordingPage
        browserSession={state.browserSession}
        browserSessionMessage={state.browserSession.message}
        environment={project.environments[0]}
        isReplaying={false}
        onAppendStep={vi.fn()}
        onCaptureSnapshot={vi.fn()}
        onCreateRecording={vi.fn()}
        onCreateTestCaseFromRecording={vi.fn()}
        onDeleteRecording={vi.fn()}
        onImportPlayback={vi.fn()}
        onRunRecording={vi.fn()}
        onSelectRecording={vi.fn()}
        onStartRecording={vi.fn()}
        onUpdateRecording={onUpdateRecording}
        project={project}
        recording={recording}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加动态区域遮罩' }));

    const updater = onUpdateRecording.mock.calls[0]?.[0] as (current: typeof recording) => typeof recording;
    expect(updater(recording)).toEqual(expect.objectContaining({
      visualDiffMasks: [expect.objectContaining({ label: '动态区域 1', x: 0, y: 0, width: 10, height: 10 })],
    }));
  });
});
