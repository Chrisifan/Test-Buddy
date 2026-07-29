import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState } from '../../../shared/studio.js';
import { RecordingPage } from './RecordingPage.js';
import { I18nProvider } from '../../i18n/index.js';

describe('RecordingPage', () => {
  it('runs the selected recording directly from the replay workbench', () => {
    const state = createInitialStudioState();
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
    expect(screen.getByText('录制回放工作台')).toBeInTheDocument();
    expect(screen.getByText('受控浏览器')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '捕获快照' })).toBeInTheDocument();
    expect(screen.queryByText('Start Recording')).not.toBeInTheDocument();
  });

  it('switches recording actions to English', () => {
    const state = createInitialStudioState();
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
    const state = createInitialStudioState();
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
    const state = createInitialStudioState();
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
