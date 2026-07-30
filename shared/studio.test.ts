import { describe, expect, it } from 'vitest';

import {
  copyTestStep,
  createTestStep,
  createEmptyProject,
  createInitialStudioState,
  getExclusiveRecordingReplayId,
  getTestCaseRunBlocker,
  hydrateStudioState,
  insertTestStep,
  isAgentRunnableTestCase,
  moveTestStep,
  removeTestStep,
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

  it('inserts, moves, copies, and removes serial test steps without mutating the source list', () => {
    const steps = [
      { id: 'step-1', type: 'ai' as const, title: '第一步', body: '执行第一步' },
      { id: 'step-2', type: 'aiAssert' as const, title: '第二步', body: '断言第二步' },
      { id: 'step-3', type: 'manual' as const, title: '第三步', body: '人工确认第三步' },
    ];
    const inserted = insertTestStep(steps, { id: 'step-inserted', type: 'aiQuery', title: '插入步骤', body: '提取数据' }, 1);

    expect(steps.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-3']);
    expect(inserted.map((step) => step.id)).toEqual(['step-1', 'step-inserted', 'step-2', 'step-3']);
    expect(moveTestStep(steps, 'step-1', 3).map((step) => step.id)).toEqual(['step-2', 'step-3', 'step-1']);
    expect(moveTestStep(steps, 'step-3', 0).map((step) => step.id)).toEqual(['step-3', 'step-1', 'step-2']);

    const copied = copyTestStep(steps, 'step-2', 'step-copy');
    expect(copied.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-copy', 'step-3']);
    expect(copied[2]).toMatchObject({ ...steps[1], id: 'step-copy' });
    expect(removeTestStep(copied, 'step-2').map((step) => step.id)).toEqual(['step-1', 'step-copy', 'step-3']);
    expect(moveTestStep(steps, 'missing', 0)).toBe(steps);
    expect(copyTestStep(steps, 'missing', 'step-copy')).toBe(steps);
  });

  it('creates all test step types and reports only run-blocking configuration errors', () => {
    const state = createInitialStudioState();
    const project = state.projects[0]!;
    const baseCase = project.testCases[0]!;
    const recording = project.recordings[0]!;

    expect(createTestStep('ai', 1).type).toBe('ai');
    expect(createTestStep('aiAssert', 2).type).toBe('aiAssert');
    expect(createTestStep('aiQuery', 3).type).toBe('aiQuery');
    expect(createTestStep('manual', 4)).toMatchObject({ type: 'manual', title: '人工检查步骤' });
    expect(createTestStep('recordingReplay', 5, recording)).toMatchObject({
      type: 'recordingReplay',
      recordingId: recording.id,
    });

    expect(getTestCaseRunBlocker({ ...baseCase, steps: [] }, project.recordings)).toBe('emptySteps');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'blank-title', type: 'ai', title: '  ', body: '执行操作' }] }, project.recordings)).toBe('emptyTitle');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'blank-body', type: 'manual', title: '人工检查', body: '  ' }] }, project.recordings)).toBe('emptyInstruction');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'missing-recording', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'missing' }] }, project.recordings)).toBe('missingRecording');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [createTestStep('recordingReplay', 6, recording)] }, project.recordings)).toBeUndefined();
  });
});
