import { describe, expect, it, vi } from 'vitest';

import { createEmptyProject, type BrowserSessionRequest, type BrowserSessionState, type RunEventPayload } from '../../shared/studio.js';
import type { RecordingReplayResult } from './browser-runtime.js';
import { RecordingRunner } from './recording-runner.js';

describe('RecordingRunner', () => {
  it('replays a recording and returns an agent-backed run detail', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const recording = {
      id: 'recording-login',
      name: '登录回放',
      summary: '登录路径',
      source: 'live' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      startUrl: `${environment.url}/login`,
      comparisonGoal: '登录后页面与基线一致',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [
        {
          id: 'recording-step-login',
          kind: 'snapshot' as const,
          title: '登录后快照',
          detail: '记录登录后的页面',
          screenshotPath: '/tmp/login-baseline.png',
        },
      ],
    };
    const start = vi.fn<(request: BrowserSessionRequest) => Promise<BrowserSessionState>>().mockResolvedValue({
      id: 'session-recording',
      status: 'ready',
      projectId: project.id,
      environmentId: environment.id,
      currentUrl: environment.url,
      pageTitle: 'Login',
      message: 'ready',
      updatedAt: new Date(0).toISOString(),
    });
    const replayRecordingSteps = vi
      .fn<() => Promise<RecordingReplayResult[]>>()
      .mockResolvedValue([
        {
          step: recording.steps[0],
          status: 'passed',
          message: '已回放：登录后快照',
          screenshotPath: '/tmp/login-actual.png',
        },
      ]);
    const navigate = vi.fn().mockResolvedValue({
      id: 'session-recording',
      status: 'ready',
      currentUrl: recording.startUrl,
      pageTitle: 'Login',
      message: 'navigated',
      updatedAt: new Date(0).toISOString(),
    });
    const emitRunEvent = vi.fn<(event: RunEventPayload) => void>();
    const runner = new RecordingRunner({ start, navigate, replayRecordingSteps } as never, emitRunEvent);

    const response = await runner.run({ project, environment, recording });

    expect(start).toHaveBeenCalledWith({ project, environment, record: false });
    expect(navigate).toHaveBeenCalledWith({ url: recording.startUrl });
    expect(replayRecordingSteps).toHaveBeenCalledWith(recording.steps, response.runId);
    expect(response.agentRun.intent.source).toBe('recording');
    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.agentRun).toBe(response.agentRun);
    expect(response.detail.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/tmp/login-baseline.png' }),
        expect.objectContaining({ path: '/tmp/login-actual.png' }),
      ]),
    );
    expect(emitRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'complete', status: 'neutral', detail: response.detail }),
    );
  });

  it('passes a replay with a baseline only after visual comparison confirms the screenshots', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const recording = {
      id: 'recording-visual-pass',
      name: '视觉回放',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '页面与基线一致',
      visualDiffThreshold: 0.15,
      visualDiffMasks: [{ id: 'clock', label: '实时时钟', x: 0, y: 0, width: 10, height: 10 }],
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [
        {
          id: 'recording-step-visual',
          kind: 'snapshot' as const,
          title: '报表快照',
          detail: '保存报表页面',
          screenshotPath: '/tmp/report-baseline.png',
        },
      ],
    };
    const start = vi.fn().mockResolvedValue({
      id: 'session-visual',
      status: 'ready',
      projectId: project.id,
      environmentId: environment.id,
      currentUrl: environment.url,
      message: 'ready',
      updatedAt: new Date(0).toISOString(),
    });
    const replayRecordingSteps = vi.fn().mockResolvedValue([
      {
        step: recording.steps[0],
        status: 'passed',
        message: '已回放：报表快照',
        screenshotPath: '/tmp/report-actual.png',
      },
    ]);
    const visualDiff = {
      compare: vi.fn().mockResolvedValue({
        status: 'passed',
        message: '视觉基线对比通过，未发现像素差异。',
        changedPixels: 0,
        totalPixels: 12,
        differenceRatio: 0,
        diffPath: '/tmp/report-actual-diff.png',
      }),
    };
    const runner = new RecordingRunner(
      { start, navigate: vi.fn(), replayRecordingSteps } as never,
      vi.fn(),
      visualDiff as never,
    );

    const response = await runner.run({ project, environment, recording });

    expect(visualDiff.compare).toHaveBeenCalledWith({
      baselinePath: '/tmp/report-baseline.png',
      actualPath: '/tmp/report-actual.png',
      diffPath: '/tmp/report-actual-diff.png',
      differenceThreshold: 0.15,
      ignoredRegions: [{ id: 'clock', label: '实时时钟', x: 0, y: 0, width: 10, height: 10 }],
    });
    expect(response.agentRun.status).toBe('passed');
    expect(response.detail.artifacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: '差异 · 报表快照', path: '/tmp/report-actual-diff.png' })]),
    );
  });
});
