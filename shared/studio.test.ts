import { describe, expect, it } from 'vitest';

import {
  createEmptyProject,
  createInitialStudioState,
  getExclusiveRecordingReplayId,
  hydrateStudioState,
  isAgentRunnableTestCase,
} from './studio.js';

describe('studio state hydration', () => {
  it('normalizes persisted visual diff masks and discards invalid regions', () => {
    const rawState = createInitialStudioState();
    const recording = rawState.projects[0]!.recordings[0]!;
    recording.visualDiffMasks = [
      { id: 'clock', label: '实时钟', x: 95, y: -2, width: 20, height: 30 },
      { id: 'invalid', label: '无效区域', x: Number.NaN, y: 0, width: 10, height: 10 },
      { id: 'empty', label: '空区域', x: 0, y: 0, width: 0, height: 10 },
    ];

    const hydrated = hydrateStudioState(rawState);

    expect(hydrated.projects[0]!.recordings[0]!.visualDiffMasks).toEqual([
      { id: 'clock', label: '实时钟', x: 95, y: 0, width: 5, height: 30 },
    ]);
  });

  it('identifies test cases that can run through the Agent workflow runtime', () => {
    const project = createEmptyProject(1);
    const baseCase = {
      id: 'case-agent',
      kind: 'scenario' as const,
      groupId: project.groups[0].id,
      environmentId: project.environments[0].id,
      source: 'manual' as const,
      name: 'Agent 用例',
      category: '核心链路',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
    };

    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [{ id: 'step-ai', type: 'ai', title: '点击登录', body: '点击登录按钮' }],
      }),
    ).toBe(true);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [{ id: 'step-manual', type: 'manual', title: '人工检查', body: '确认状态' }],
      }),
    ).toBe(false);
  });

  it('recognizes test cases that consist of exactly one recording replay', () => {
    const project = createEmptyProject(1);
    const baseCase = {
      id: 'case-recording',
      kind: 'recording' as const,
      groupId: project.groups[0].id,
      environmentId: project.environments[0].id,
      source: 'recording' as const,
      name: '录制回放用例',
      category: '核心链路',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
    };

    expect(
      getExclusiveRecordingReplayId({
        ...baseCase,
        steps: [{ id: 'replay', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'recording-1' }],
      }),
    ).toBe('recording-1');
    expect(
      getExclusiveRecordingReplayId({
        ...baseCase,
        steps: [
          { id: 'replay', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'recording-1' },
          { id: 'manual', type: 'manual', title: '确认', body: '人工确认' },
        ],
      }),
    ).toBeUndefined();
  });
});
