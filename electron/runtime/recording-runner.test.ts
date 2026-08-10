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
      prdPath: { documentId: 'doc-login', pathId: 'path-login' },
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

    const response = await runner.run({ project, environment, recording, testCaseId: 'case-recording-login' });

    expect(start).toHaveBeenCalledWith({ project, environment, record: false });
    expect(navigate).toHaveBeenCalledWith({ url: recording.startUrl });
    expect(replayRecordingSteps).toHaveBeenCalledWith(recording.steps, response.runId);
    expect(response.agentRun.intent.source).toBe('recording');
    expect(response.agentRun.intent.testCaseId).toBe('case-recording-login');
    expect(response.agentRun.intent.documentId).toBe('doc-login');
    expect(response.detail.testCaseId).toBe('case-recording-login');
    expect(response.detail.documentId).toBe('doc-login');
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

  it('attaches an archived trace to recording evidence when the browser runtime provides one', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const recording = {
      id: 'recording-trace',
      name: '带 Trace 的回放',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '回放完成',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [],
    };
    const beginTrace = vi.fn().mockResolvedValue(true);
    const finishTrace = vi.fn().mockResolvedValue({
      id: 'trace-1',
      type: 'trace' as const,
      label: 'Playwright Trace',
      path: '/tmp/recording-trace.zip',
    });
    const runner = new RecordingRunner(
      {
        beginTrace,
        finishTrace,
        start: vi.fn().mockResolvedValue({
          id: 'session-trace',
          status: 'ready',
          currentUrl: environment.url,
          pageTitle: 'Home',
          message: 'ready',
          updatedAt: new Date(0).toISOString(),
        }),
        navigate: vi.fn(),
        replayRecordingSteps: vi.fn().mockResolvedValue([]),
      },
      vi.fn(),
    );

    const response = await runner.run({ project, environment, recording });

    expect(beginTrace).toHaveBeenCalledWith(response.runId);
    expect(finishTrace).toHaveBeenCalledOnce();
    expect(response.agentRun.artifacts).toContainEqual(
      expect.objectContaining({ type: 'trace', path: '/tmp/recording-trace.zip' }),
    );
    expect(response.agentRun.events).toContainEqual(
      expect.objectContaining({ type: 'agent:artifact-created', artifact: expect.objectContaining({ type: 'trace' }) }),
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

  it('marks an interrupted replay and remaining recording nodes as neutral', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const recording = {
      id: 'recording-cancelled',
      name: '可取消回放',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '回放完成',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [
        { id: 'recording-step-wait', kind: 'wait' as const, title: '等待页面', detail: '等待页面稳定' },
        { id: 'recording-step-next', kind: 'click' as const, title: '继续操作', detail: '点击后续按钮' },
      ],
    };
    let beginReplay: () => void = () => undefined;
    const replayStarted = new Promise<void>((resolve) => {
      beginReplay = resolve;
    });
    const replayRecordingSteps = vi.fn(() => {
      beginReplay();
      return new Promise<RecordingReplayResult[]>(() => undefined);
    });
    const emitRunEvent = vi.fn<(event: RunEventPayload) => void>();
    const runner = new RecordingRunner(
      {
        start: vi.fn().mockResolvedValue({
          id: 'session-recording',
          status: 'ready',
          currentUrl: environment.url,
          message: 'ready',
          updatedAt: new Date(0).toISOString(),
        }),
        navigate: vi.fn(),
        replayRecordingSteps,
      } as never,
      emitRunEvent,
    );
    const controller = new AbortController();
    const pending = runner.run({ project, environment, recording, cancellationSignal: controller.signal });

    await replayStarted;
    controller.abort();
    const response = await pending;

    expect(replayRecordingSteps).toHaveBeenCalledWith(recording.steps, response.runId, controller.signal);
    expect(response.detail.status).toBe('neutral');
    expect(response.detail.cancellation).toEqual(expect.objectContaining({ source: 'user', reason: 'userCancelled' }));
    expect(response.detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'recording-step-wait', status: 'neutral' }),
        expect.objectContaining({ stepId: 'recording-step-next', status: 'neutral' }),
      ]),
    );
    expect(response.agentRun.events).toContainEqual(
      expect.objectContaining({ type: 'agent:run-cancelled', status: 'neutral' }),
    );
    expect(emitRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'complete', status: 'neutral', detail: response.detail }),
    );
  });

  it('keeps a rejected visual comparison as neutral evidence without dropping replay artifacts', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const recording = {
      id: 'recording-visual-error',
      name: '视觉比较异常',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '页面与基线一致',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [
        {
          id: 'recording-step-snapshot',
          kind: 'snapshot' as const,
          title: '报表快照',
          detail: '保存报表页面',
          screenshotPath: '/tmp/report-baseline.png',
        },
      ],
    };
    const runner = new RecordingRunner(
      {
        start: vi.fn().mockResolvedValue({
          id: 'session-visual-error',
          status: 'ready',
          currentUrl: environment.url,
          message: 'ready',
          updatedAt: new Date(0).toISOString(),
        }),
        navigate: vi.fn(),
        replayRecordingSteps: vi.fn().mockResolvedValue([
          {
            step: recording.steps[0],
            status: 'passed',
            message: '已回放：报表快照',
            screenshotPath: '/tmp/report-actual.png',
          },
        ]),
      } as never,
      vi.fn(),
      { compare: vi.fn().mockRejectedValue(new Error('baseline image is corrupt')) } as never,
    );

    const response = await runner.run({ project, environment, recording });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.events).toContainEqual(
      expect.objectContaining({
        type: 'agent:assertion-result',
        verification: expect.objectContaining({ status: 'neutral', summary: expect.stringContaining('视觉对比不可用') }),
      }),
    );
    expect(response.detail.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/tmp/report-baseline.png' }),
        expect.objectContaining({ path: '/tmp/report-actual.png' }),
      ]),
    );
  });
});
