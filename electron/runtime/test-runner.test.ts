import { describe, expect, it, vi } from 'vitest';

import type {
  BrowserSessionRequest,
  BrowserSessionState,
  ProjectDraft,
  ProjectEnvironment,
  RecordingStepDraft,
  RunEventPayload,
  TestCaseDraft,
} from '../../shared/studio.js';
import { createEmptyProject } from '../../shared/studio.js';
import type { RecordingReplayResult } from './browser-runtime.js';
import { TestRunner } from './test-runner.js';

describe('TestRunner recording replay', () => {
  it('runs replay sessions without recording and persists replay logs', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0];
    const testCase = project.testCases[0];
    const start = vi.fn<(request: BrowserSessionRequest) => Promise<BrowserSessionState>>().mockResolvedValue({
      id: 'session-test',
      status: 'ready',
      projectId: project.id,
      environmentId: environment.id,
      currentUrl: environment.url,
      pageTitle: project.name,
      message: 'ready',
      updatedAt: new Date(0).toISOString(),
    });
    const replayRecordingSteps = vi
      .fn<(steps: RecordingStepDraft[], sessionId: string) => Promise<RecordingReplayResult[]>>()
      .mockResolvedValue([
        {
          step: project.recordings[0].steps[0],
          status: 'passed',
          message: '已回放：打开首页',
          screenshotPath: '/tmp/replay-1.png',
        },
      ]);
    const browserRuntime = {
      start,
      replayRecordingSteps,
    };
    const artifacts = {
      createSnapshot: vi.fn().mockResolvedValue({
        id: 'artifact-start',
        type: 'snapshot',
        label: '运行起始快照',
        path: '/tmp/start.svg',
      }),
    };
    const emitRunEvent = vi.fn<(event: RunEventPayload) => void>();
    const runner = new TestRunner(artifacts as never, browserRuntime as never, emitRunEvent);

    const response = await runner.run({ project, testCase, environment });

    expect(start).toHaveBeenCalledWith({ project, environment, record: false });
    expect(replayRecordingSteps).toHaveBeenCalledWith(project.recordings[0].steps, expect.stringMatching(/^run-\d+-0$/));
    expect(response.detail.logs).toEqual(expect.arrayContaining([expect.stringContaining('已回放：打开首页')]));
    expect(response.detail.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '登录冒烟 / 打开首页',
          path: '/tmp/replay-1.png',
          type: 'snapshot',
        }),
      ]),
    );
  });
});

function createProjectWithRecording(): {
  project: ProjectDraft;
  environment: ProjectEnvironment;
  testCase: TestCaseDraft;
}['project'] {
  const project = createEmptyProject(1);
  const environment = project.environments[0];
  const group = project.groups[0];
  const recording = {
    id: 'recording-login',
    name: '登录冒烟',
    summary: '登录路径',
    source: 'live' as const,
    groupId: group.id,
    environmentId: environment.id,
    startUrl: environment.url,
    comparisonGoal: '登录成功',
    tags: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    steps: [
      {
        id: 'recording-step-1',
        kind: 'navigate' as const,
        title: '打开首页',
        detail: `打开页面：${environment.url}`,
        pageUrl: environment.url,
      },
    ],
  };
  const testCase = {
    id: 'case-recording',
    kind: 'recording' as const,
    groupId: group.id,
    environmentId: environment.id,
    source: 'recording' as const,
    name: '登录冒烟回放',
    category: '录制回放',
    lastEdited: '刚刚',
    url: environment.url,
    notes: '',
    steps: [
      {
        id: 'case-step-replay',
        type: 'recordingReplay' as const,
        title: '回放录制片段',
        body: '回放',
        recordingId: recording.id,
      },
    ],
  };

  return {
    ...project,
    selectedEnvironmentId: environment.id,
    recordings: [recording],
    testCases: [testCase],
  };
}
