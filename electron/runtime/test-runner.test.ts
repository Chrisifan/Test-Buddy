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

  it('composes recording evidence into a mixed test case and stops after a neutral replay', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0];
    const testCase = {
      ...project.testCases[0],
      steps: [
        project.testCases[0].steps[0],
        {
          id: 'case-step-ai',
          type: 'ai' as const,
          title: '确认登录状态',
          body: '确认当前用户已登录',
        },
      ],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({
        id: 'session-test',
        status: 'ready',
        projectId: project.id,
        environmentId: environment.id,
        currentUrl: environment.url,
        message: 'ready',
        updatedAt: new Date(0).toISOString(),
      }),
    };
    const artifacts = {
      createSnapshot: vi.fn().mockResolvedValue({
        id: 'artifact-start',
        type: 'snapshot',
        label: '运行起始快照',
        path: '/tmp/start.svg',
      }),
    };
    const recordingRunner = {
      run: vi.fn().mockResolvedValue({
        runId: 'agent-run-recording-child',
        title: '登录冒烟 回放',
        detail: {
          id: 'agent-run-recording-child',
          projectId: project.id,
          testCaseId: testCase.id,
          environmentId: environment.id,
          title: '登录冒烟 回放',
          status: 'neutral',
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:01',
          summary: '缺少可比较的视觉基线，回放保持等待态。',
          logs: ['agent:verification-result: 缺少可比较的视觉基线'],
          steps: [
            {
              id: 'child-step',
              stepId: project.recordings[0].steps[0].id,
              title: '打开首页',
              status: 'neutral',
              message: '缺少可比较的视觉基线。',
              screenshotPath: '/tmp/replay.png',
            },
          ],
          artifacts: [
            {
              id: 'child-artifact',
              type: 'screenshot',
              label: '实际截图',
              path: '/tmp/replay.png',
            },
          ],
        },
        agentRun: {},
      }),
    };
    const emitRunEvent = vi.fn<(event: RunEventPayload) => void>();
    const runner = new TestRunner(
      artifacts as never,
      browserRuntime as never,
      emitRunEvent,
      recordingRunner as never,
    );

    const response = await runner.run({ project, testCase, environment });

    expect(recordingRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ testCaseId: testCase.id, parentRunId: response.runId }),
    );
    expect(response.detail.status).toBe('neutral');
    expect(response.detail.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/tmp/replay.png' })]));
    expect(response.detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'case-step-ai', status: 'neutral', message: expect.stringContaining('前序步骤') }),
      ]),
    );
    expect(emitRunEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'agent-run-recording-child' }),
    );
  });

  it('continues a mixed test case through the workflow runtime after a passed replay', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0];
    const testCase = {
      ...project.testCases[0],
      steps: [
        project.testCases[0].steps[0],
        {
          id: 'case-step-assert',
          type: 'aiAssert' as const,
          title: '确认登录状态',
          body: '确认当前用户已登录',
        },
      ],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({
        id: 'session-test',
        status: 'ready',
        projectId: project.id,
        environmentId: environment.id,
        currentUrl: environment.url,
        message: 'ready',
        updatedAt: new Date(0).toISOString(),
      }),
    };
    const artifacts = {
      createSnapshot: vi.fn().mockResolvedValue({
        id: 'artifact-start',
        type: 'snapshot',
        label: '运行起始快照',
        path: '/tmp/start.svg',
      }),
    };
    const recordingRunner = {
      run: vi.fn().mockResolvedValue({
        runId: 'agent-run-recording-child',
        title: '登录冒烟 回放',
        detail: {
          id: 'agent-run-recording-child',
          projectId: project.id,
          testCaseId: testCase.id,
          environmentId: environment.id,
          title: '登录冒烟 回放',
          status: 'passed',
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:01',
          summary: '回放和视觉比较通过。',
          logs: [],
          steps: [],
          artifacts: [],
        },
        agentRun: {},
      }),
    };
    const workflowRunner = {
      runWorkflow: vi.fn().mockResolvedValue({
        runId: 'agent-run-workflow-child',
        title: '登录冒烟回放',
        detail: {
          id: 'agent-run-workflow-child',
          projectId: project.id,
          testCaseId: testCase.id,
          environmentId: environment.id,
          title: '登录冒烟回放',
          status: 'passed',
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:01',
          summary: '登录状态已验证。',
          logs: [],
          steps: [
            {
              id: 'workflow-step',
              stepId: 'case-step-assert',
              title: '确认登录状态',
              status: 'passed',
              message: '登录状态已验证。',
              screenshotPath: '/tmp/assert.png',
            },
          ],
          artifacts: [],
        },
        agentRun: {},
      }),
    };
    const runner = new TestRunner(
      artifacts as never,
      browserRuntime as never,
      vi.fn(),
      recordingRunner as never,
      workflowRunner as never,
    );

    const response = await runner.run({ project, testCase, environment });

    expect(workflowRunner.runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        parentRunId: response.runId,
        preserveCurrentPage: true,
        workflow: expect.objectContaining({ steps: [expect.objectContaining({ id: 'case-step-assert' })] }),
      }),
    );
    expect(response.detail.status).toBe('passed');
    expect(response.detail.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ stepId: 'case-step-assert', status: 'passed' })]),
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
