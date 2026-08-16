import { describe, expect, it, vi } from 'vitest';

import type {
  BrowserSessionRequest,
  BrowserSessionState,
  FixtureAsset,
  FixtureLifecycleEvidence,
  ProjectDraft,
  ProjectEnvironment,
  RecordingStepDraft,
  RunEventPayload,
  TestCaseDraft,
} from '../../shared/studio.js';
import { createEmptyProject } from '../../shared/studio.js';
import { createStubAgentRun } from '../../shared/agentStub.js';
import type { RecordingReplayResult } from './browser-runtime.js';
import type { FixtureLifecycleExecutor } from './fixture-http-executor.js';
import { TestRunner } from './test-runner.js';

function createExecutableHttpFixture(
  environment: ProjectEnvironment,
  id = 'fixture-orders',
  cleanup = true,
): FixtureAsset {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    name: id,
    description: '',
    inputs: [],
    outputs: [],
    credentialIds: [],
    environmentIds: [environment.id],
    setup: {
      mode: 'http',
      summary: 'prepare',
      http: { method: 'POST', path: `/api/test-data/${id}`, expectedStatuses: [201] },
    },
    ...(cleanup ? {
      cleanup: {
        mode: 'http' as const,
        summary: 'cleanup',
        http: { method: 'DELETE' as const, path: `/api/test-data/${id}`, expectedStatuses: [204] },
      },
    } : {}),
    concurrency: 'exclusive',
    resourceLocks: [id],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function fixtureEvidence(
  fixture: FixtureAsset,
  lifecycle: 'setup' | 'cleanup',
  outcome: FixtureLifecycleEvidence['outcome'] = 'passed',
): FixtureLifecycleEvidence {
  const declaration = lifecycle === 'setup' ? fixture.setup : fixture.cleanup!;
  const http = declaration.http!;
  return {
    fixtureId: fixture.id,
    fixtureVersion: fixture.version,
    lifecycle,
    method: http.method,
    path: http.path,
    expectedStatuses: http.expectedStatuses,
    outcome,
    ...(outcome === 'passed' ? { httpStatus: http.expectedStatuses[0] } : {}),
    durationMs: 1,
  };
}

describe('TestRunner recording replay', () => {
  it('uses a real browser screenshot after startup and labels the fallback a synthetic diagnostic', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const realScreenshot = { id: 'real-start', type: 'screenshot' as const, label: '运行起始截图', path: '/tmp/real-start.png' };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({
        id: 'session-test', status: 'ready', projectId: project.id, environmentId: environment.id,
        currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString(),
      }),
      captureRunScreenshot: vi.fn().mockResolvedValue(realScreenshot),
    };
    const artifacts = { createSnapshot: vi.fn() };
    const runner = new TestRunner(artifacts as never, browserRuntime as never, vi.fn());

    const response = await runner.run({
      project,
      environment,
      testCase: { ...project.testCases[0]!, steps: [] },
    });

    expect(browserRuntime.captureRunScreenshot).toHaveBeenCalledWith(expect.stringMatching(/^run-\d+$/));
    expect(artifacts.createSnapshot).not.toHaveBeenCalled();
    expect(response.detail.artifacts).toEqual([realScreenshot]);

    browserRuntime.captureRunScreenshot.mockResolvedValueOnce(null);
    artifacts.createSnapshot.mockResolvedValueOnce({ id: 'synthetic-start', type: 'screenshot', label: 'synthetic diagnostic', path: '/tmp/synthetic-start.svg' });
    const fallback = await runner.run({
      runId: 'run-synthetic-fallback',
      project,
      environment,
      testCase: { ...project.testCases[0]!, steps: [] },
    });

    expect(artifacts.createSnapshot).toHaveBeenCalledWith(
      'run-synthetic-fallback',
      'synthetic diagnostic',
      project.testCases[0]!.name,
      environment.url,
    );
    expect(fallback.detail.artifacts).toEqual([
      expect.objectContaining({ label: 'synthetic diagnostic', path: '/tmp/synthetic-start.svg' }),
    ]);
  });

  it('records unresolved fixture execution as blocked fixture preflight before opening a browser session', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-seed',
      version: 1,
      name: '准备订单数据',
      description: '',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [environment.id],
      setup: { mode: 'http' as const, summary: '创建测试数据。' },
      concurrency: 'exclusive' as const,
      resourceLocks: ['orders'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const testCase = {
      ...project.testCases[0]!,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
    };
    const start = vi.fn();
    const artifacts = { createSnapshot: vi.fn() };
    const workflowRunner = { runWorkflow: vi.fn() };
    const runner = new TestRunner(
      artifacts as never,
      { start } as never,
      vi.fn(),
      undefined,
      workflowRunner as never,
    );

    const response = await runner.run({ project: { ...project, fixtures: [fixture] }, testCase, environment });

    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'fixturePreflight' });
    expect(response.detail.summary).toContain('HTTP 请求配置不完整');
    expect(response.detail.steps.every((step) => step.status === 'blocked')).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(artifacts.createSnapshot).not.toHaveBeenCalled();
    expect(workflowRunner.runWorkflow).not.toHaveBeenCalled();
  });

  it('keeps a trusted script fixture blocked before browser startup until an executor exists', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-script-seed',
      version: 1,
      name: '脚本准备订单数据',
      description: '',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [environment.id],
      setup: {
        mode: 'script' as const,
        summary: '执行准备脚本。',
        script: {
          relativePath: 'scripts/seed-orders.mjs',
          contentHash: 'a'.repeat(64),
          requiredEnvironment: [],
        },
      },
      concurrency: 'exclusive' as const,
      resourceLocks: ['orders'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const testCase = {
      ...project.testCases[0]!,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
    };
    const start = vi.fn();
    const runner = new TestRunner({ createSnapshot: vi.fn() } as never, { start } as never, vi.fn());

    const response = await runner.run({
      project: { ...project, fixtures: [fixture] },
      testCase,
      environment,
      fixtureScriptTrustDirectory: '/tmp/project-assets',
      fixtureScriptTrustRecords: [{
        schemaVersion: 1,
        projectId: project.id,
        projectDirectory: '/tmp/project-assets',
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        lifecycle: 'setup',
        relativePath: fixture.setup.script.relativePath,
        contentHash: fixture.setup.script.contentHash,
        approvedAt: new Date(0).toISOString(),
      }],
    });

    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'fixturePreflight' });
    expect(response.detail.summary).toContain('脚本执行器不可用');
    expect(start).not.toHaveBeenCalled();
  });

  it('runs a trusted script Fixture through a registered executor before browser startup', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-script-seed',
      version: 1,
      name: '脚本准备订单数据',
      description: '',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [environment.id],
      setup: {
        mode: 'script' as const,
        summary: '执行准备脚本。',
        script: {
          relativePath: 'scripts/seed-orders.mjs',
          contentHash: 'a'.repeat(64),
          requiredEnvironment: [],
        },
      },
      concurrency: 'exclusive' as const,
      resourceLocks: ['orders'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const testCase = {
      ...project.testCases[0]!,
      steps: [],
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
    };
    const order: string[] = [];
    const start = vi.fn().mockImplementation(async () => {
      order.push('browser');
      return { id: 'session-script', status: 'ready', projectId: project.id, environmentId: environment.id, currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() };
    });
    const fixtureExecutor: FixtureLifecycleExecutor = {
      supports: (mode) => mode === 'script',
      execute: vi.fn().mockImplementation(async (request) => {
        order.push('script');
        expect(request).toEqual(expect.objectContaining({
          projectId: project.id,
          projectDirectory: '/tmp/project-assets',
          scriptTrustRecords: expect.arrayContaining([expect.objectContaining({ fixtureId: fixture.id })]),
        }));
        return {
          evidence: {
            fixtureId: fixture.id,
            fixtureVersion: fixture.version,
            lifecycle: 'setup',
            mode: 'script',
            scriptPath: fixture.setup.script.relativePath,
            outcome: 'passed',
            durationMs: 1,
          },
          message: 'ok',
        };
      }),
    };
    const runner = new TestRunner(
      { createSnapshot: vi.fn().mockResolvedValue({ id: 'start', type: 'snapshot', label: 'start', path: '/tmp/start.png' }) } as never,
      { start } as never,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      fixtureExecutor,
    );

    const response = await runner.run({
      project: { ...project, fixtures: [fixture] },
      testCase,
      environment,
      fixtureScriptTrustDirectory: '/tmp/project-assets',
      fixtureScriptTrustRecords: [{
        schemaVersion: 1,
        projectId: project.id,
        projectDirectory: '/tmp/project-assets',
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        lifecycle: 'setup',
        relativePath: fixture.setup.script.relativePath,
        contentHash: fixture.setup.script.contentHash,
        approvedAt: new Date(0).toISOString(),
      }],
    });

    expect(order).toEqual(['script', 'browser']);
    expect(response.detail.status).toBe('passed');
    expect(response.detail.fixtureLifecycles).toEqual([
      expect.objectContaining({ mode: 'script', outcome: 'passed' }),
    ]);
  });

  it('passes a trusted script output only to the matching confirmed deterministic input', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-script-output',
      version: 1,
      name: '脚本准备订单数据',
      description: '',
      inputs: [],
      outputs: [{ name: 'orderId', type: 'string' as const, required: true }],
      credentialIds: [],
      environmentIds: [environment.id],
      setup: {
        mode: 'script' as const,
        summary: '执行准备脚本。',
        script: { relativePath: 'scripts/seed-orders.mjs', contentHash: 'a'.repeat(64), requiredEnvironment: [] },
      },
      concurrency: 'exclusive' as const,
      resourceLocks: ['orders'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const testCase = {
      ...project.testCases[0]!,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
      steps: [{
        id: 'script-output-input',
        type: 'ai' as const,
        title: '填写订单号',
        body: '填写脚本准备的订单号。',
        execution: {
          schemaVersion: 2 as const,
          intent: '填写脚本准备的订单号。',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'medium' as const,
          action: {
            kind: 'input' as const,
            locator: { selector: '#order-id', quality: 'acceptable' as const },
            binding: { kind: 'fixtureOutput' as const, fixtureId: fixture.id, fixtureVersion: fixture.version, outputName: 'orderId' },
          },
        },
      }],
    };
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockImplementation(async (request) => {
        await expect(request.inputBindingResolver?.resolve({ projectId: project.id, binding: request.inputBinding! })).resolves.toBe('script-order-456');
        return {
          runId: 'deterministic-script-output',
          title: testCase.steps[0]!.title,
          detail: {
            id: 'deterministic-script-output',
            projectId: project.id,
            testCaseId: testCase.id,
            environmentId: environment.id,
            title: testCase.steps[0]!.title,
            status: 'passed' as const,
            startedAt: new Date(0).toISOString(),
            endedAt: new Date(0).toISOString(),
            duration: '00:00:01',
            summary: '已填写订单号',
            logs: [],
            steps: [],
            artifacts: [],
          },
        };
      }),
    };
    const fixtureExecutor: FixtureLifecycleExecutor = {
      supports: (mode) => mode === 'script',
      execute: vi.fn().mockResolvedValue({
        evidence: { fixtureId: fixture.id, fixtureVersion: fixture.version, lifecycle: 'setup', mode: 'script', scriptPath: fixture.setup.script.relativePath, outcome: 'passed', durationMs: 1 },
        message: 'ok',
        outputValues: { orderId: 'script-order-456' },
      }),
    };
    const runner = new TestRunner(
      { createSnapshot: vi.fn().mockResolvedValue({ id: 'start', type: 'snapshot', label: 'start', path: '/tmp/start.png' }) } as never,
      { start: vi.fn().mockResolvedValue({ id: 'session-script', status: 'ready', projectId: project.id, environmentId: environment.id, currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() }) } as never,
      vi.fn(),
      undefined,
      undefined,
      deterministicRunner as never,
      fixtureExecutor,
    );

    const response = await runner.run({
      project: { ...project, fixtures: [fixture] },
      testCase,
      environment,
      fixtureScriptTrustDirectory: '/tmp/project-assets',
      fixtureScriptTrustRecords: [{
        schemaVersion: 1,
        projectId: project.id,
        projectDirectory: '/tmp/project-assets',
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        lifecycle: 'setup',
        relativePath: fixture.setup.script.relativePath,
        contentHash: fixture.setup.script.contentHash,
        approvedAt: new Date(0).toISOString(),
      }],
    });

    expect(response.detail.status).toBe('passed');
    expect(JSON.stringify(response.detail)).not.toContain('script-order-456');
  });

  it('records an unavailable authentication state as blocked before creating run artifacts or executing steps', async () => {
    const project = createProjectWithRecording();
    const environment = { ...project.environments[0]!, storageStateId: 'state-missing' };
    const start = vi.fn().mockResolvedValue({
      id: 'session-auth-error',
      status: 'error',
      projectId: project.id,
      environmentId: environment.id,
      currentUrl: environment.url,
      pageTitle: project.name,
      message: '认证状态引用不存在或不属于当前项目。',
      updatedAt: new Date(0).toISOString(),
    });
    const artifacts = { createSnapshot: vi.fn() };
    const runner = new TestRunner(artifacts as never, { start } as never, vi.fn());

    const response = await runner.run({ project, testCase: project.testCases[0]!, environment });

    expect(start).toHaveBeenCalledWith({ project, environment, record: false });
    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'credentialUnavailable' });
    expect(response.detail.summary).toContain('认证状态引用不存在');
    expect(response.detail.steps.every((step) => step.status === 'blocked')).toBe(true);
    expect(artifacts.createSnapshot).not.toHaveBeenCalled();
  });

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

  it('composes recording evidence into a mixed test case and stops after a blocked replay', async () => {
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
          status: 'blocked',
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
              status: 'blocked',
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
    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'unsupportedAction' });
    expect(response.detail.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/tmp/replay.png' })]));
    expect(response.detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'case-step-ai', status: 'skipped', message: expect.stringContaining('前序步骤') }),
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

  it('runs confirmed deterministic steps before replay and legacy AI steps, then preserves parent evidence', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const testCase = {
      ...project.testCases[0],
      steps: [
        {
          id: 'step-confirmed-navigate',
          type: 'ai' as const,
          title: '打开登录页',
          body: '打开登录页',
          execution: {
            schemaVersion: 2 as const,
            intent: '打开登录页',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action: { kind: 'navigate' as const, url: environment.url },
          },
        },
        project.testCases[0]!.steps[0]!,
        { id: 'step-legacy-ai', type: 'ai' as const, title: '确认登录', body: '确认当前用户已登录' },
        { id: 'step-manual', type: 'manual' as const, title: '人工检查', body: '确认页面视觉状态' },
      ],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({
        id: 'session-test',
        status: 'ready',
        projectId: project.id,
        environmentId: environment.id,
        currentUrl: environment.url,
        pageTitle: project.name,
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
    const order: string[] = [];
    const deterministicAgentRun = createStubAgentRun({
      mode: 'ai',
      prompt: '打开登录页',
      runtimeDescription: 'chromium / desktop',
      targetEnvironment: environment.name,
      plannedPlan: {
        title: '打开登录页',
        summary: '已打开登录页。',
        risks: [],
        steps: [{ action: 'navigate', title: '打开登录页', instruction: '打开登录页', url: environment.url }],
      },
      verificationStatus: 'passed',
    });
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockImplementation(async () => {
        order.push('deterministic');
        return {
          runId: deterministicAgentRun.runId,
          title: '打开登录页',
          agentRun: deterministicAgentRun,
          detail: {
            id: deterministicAgentRun.runId,
            projectId: project.id,
            testCaseId: testCase.id,
            environmentId: environment.id,
            title: '打开登录页',
            status: 'passed',
            startedAt: new Date(0).toISOString(),
            endedAt: new Date(0).toISOString(),
            duration: '00:00:01',
            summary: '确定性导航通过。',
            logs: ['deterministic complete'],
            steps: [{ id: 'deterministic-step', stepId: 'step-confirmed-navigate', title: '打开登录页', status: 'passed', message: '确定性导航通过。', screenshotPath: '/tmp/navigate.png' }],
            artifacts: [{ id: 'deterministic-artifact', type: 'screenshot', label: '导航截图', path: '/tmp/navigate.png' }],
          },
        };
      }),
    };
    const recordingRunner = {
      run: vi.fn().mockImplementation(async () => {
        order.push('recording');
        return {
          runId: 'agent-run-recording-child',
          title: '登录冒烟 回放',
          agentRun: createStubAgentRun({ mode: 'ai', prompt: '回放', verificationStatus: 'passed' }),
          detail: {
            id: 'agent-run-recording-child', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
            title: '登录冒烟 回放', status: 'passed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), duration: '00:00:01', summary: '回放通过。', logs: [], steps: [], artifacts: [],
          },
        };
      }),
    };
    const workflowRunner = {
      runWorkflow: vi.fn().mockImplementation(async () => {
        order.push('workflow');
        return {
          runId: 'agent-run-workflow-child',
          title: '确认登录',
          agentRun: createStubAgentRun({ mode: 'ai', prompt: '确认登录', verificationStatus: 'passed' }),
          detail: {
            id: 'agent-run-workflow-child', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
            title: '确认登录', status: 'passed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), duration: '00:00:01', summary: '确认通过。', logs: [],
            steps: [{ id: 'workflow-step', stepId: 'step-legacy-ai', title: '确认登录', status: 'passed', message: '确认通过。', screenshotPath: '/tmp/assert.png' }], artifacts: [],
          },
        };
      }),
    };
    const runner = new TestRunner(
      artifacts as never,
      browserRuntime as never,
      vi.fn(),
      recordingRunner as never,
      workflowRunner as never,
      deterministicRunner as never,
    );

    const response = await runner.run({ project, testCase, environment });

    expect(order).toEqual(['deterministic', 'recording', 'workflow']);
    expect(response.detail.steps).toEqual([
      expect.objectContaining({ stepId: 'step-confirmed-navigate', status: 'passed' }),
      expect.objectContaining({ stepId: 'case-step-replay', status: 'passed' }),
      expect.objectContaining({ stepId: 'step-legacy-ai', status: 'passed' }),
      expect.objectContaining({ stepId: 'step-manual', status: 'blocked' }),
    ]);
    expect(response.detail.agentRuns).toHaveLength(3);
    expect(response.detail.agentRuns?.[0]).toBe(deterministicAgentRun);
    expect(response.detail.agentRun?.plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'step-confirmed-navigate', action: 'navigate' }),
        expect.objectContaining({ id: 'case-step-replay' }),
        expect.objectContaining({ id: 'step-legacy-ai' }),
      ]),
    );
  });

  it('forwards only a confirmed credential binding for deterministic input steps', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const testCase = {
      ...project.testCases[0]!,
      steps: [{
        id: 'step-fill-email',
        type: 'ai' as const,
        title: '填写邮箱',
        body: '填写已确认的测试账号。',
        execution: {
          schemaVersion: 2 as const,
          intent: '填写已确认的测试账号。',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'medium' as const,
          action: {
            kind: 'input' as const,
            locator: { selector: '#email', quality: 'acceptable' as const },
            binding: { kind: 'credential' as const, credentialId: 'cred-qa', field: 'username' as const },
          },
        },
      }],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({
        id: 'session-test',
        status: 'ready',
        projectId: project.id,
        environmentId: environment.id,
        currentUrl: environment.url,
        pageTitle: project.name,
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
    const deterministicAgentRun = createStubAgentRun({ mode: 'ai', prompt: '填写邮箱', verificationStatus: 'passed' });
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockResolvedValue({
        runId: deterministicAgentRun.runId,
        title: '填写邮箱',
        agentRun: deterministicAgentRun,
        detail: {
          id: deterministicAgentRun.runId,
          projectId: project.id,
          testCaseId: testCase.id,
          environmentId: environment.id,
          title: '填写邮箱',
          status: 'passed',
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:01',
          summary: '凭据输入完成。',
          logs: [],
          steps: [{ id: 'input-step', stepId: 'step-fill-email', title: '填写邮箱', status: 'passed', message: '凭据输入完成。', screenshotPath: '/tmp/email.png' }],
          artifacts: [],
        },
      }),
    };
    const runner = new TestRunner(
      artifacts as never,
      browserRuntime as never,
      vi.fn(),
      undefined,
      undefined,
      deterministicRunner as never,
    );

    const response = await runner.run({ project, testCase, environment });

    expect(deterministicRunner.runDeterministicStep).toHaveBeenCalledWith(
      expect.objectContaining({
        plannedStep: {
          action: 'input',
          title: '填写邮箱',
          instruction: '填写已确认的测试账号。',
          selector: '#email',
        },
        inputBinding: { kind: 'credential', credentialId: 'cred-qa', field: 'username' },
      }),
    );
    expect(deterministicRunner.runDeterministicStep.mock.calls[0]?.[0].plannedStep).not.toHaveProperty('value');
    expect(response.detail.status).toBe('passed');
  });

  it('blocks unsupported confirmed V2 actions instead of sending them to the workflow runtime', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const testCase = {
      ...project.testCases[0],
      steps: [{
        id: 'step-confirmed-input', type: 'ai' as const, title: '填写邮箱', body: '填写测试邮箱',
        execution: {
          schemaVersion: 2 as const, intent: '填写测试邮箱', reviewStatus: 'confirmed' as const, actionRisk: 'medium' as const,
          action: { kind: 'input' as const, locator: { selector: '#email', quality: 'acceptable' as const }, value: 'qa@example.test' } as never,
        },
      }],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({ id: 'session-test', status: 'ready', currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() }),
    };
    const artifacts = { createSnapshot: vi.fn().mockResolvedValue({ id: 'artifact-start', type: 'snapshot', label: '运行起始快照', path: '/tmp/start.svg' }) };
    const deterministicRunner = { runDeterministicStep: vi.fn() };
    const workflowRunner = { runWorkflow: vi.fn() };
    const runner = new TestRunner(
      artifacts as never,
      browserRuntime as never,
      vi.fn(),
      undefined,
      workflowRunner as never,
      deterministicRunner as never,
    );

    const response = await runner.run({ project, testCase, environment });

    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'unsupportedAction' });
    expect(response.detail.steps[0]).toEqual(
      expect.objectContaining({ status: 'blocked', message: expect.stringContaining('确认的结构化动作') }),
    );
    expect(deterministicRunner.runDeterministicStep).not.toHaveBeenCalled();
    expect(workflowRunner.runWorkflow).not.toHaveBeenCalled();
  });

  it('runs a confirmed explicit assertion deterministically instead of dispatching Workflow', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const testCase = {
      ...project.testCases[0],
      steps: [{
        id: 'step-confirmed-assertion', type: 'aiAssert' as const, title: '确认订单已创建', body: '确认页面包含订单已创建',
        execution: {
          schemaVersion: 2 as const, intent: '确认订单已创建', reviewStatus: 'confirmed' as const, actionRisk: 'low' as const,
          assertion: { id: 'assert-order-created', version: 1 as const, kind: 'pageContains' as const, expected: '订单已创建' },
        },
      }],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({ id: 'session-test', status: 'ready', currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() }),
    };
    const artifacts = { createSnapshot: vi.fn().mockResolvedValue({ id: 'artifact-start', type: 'snapshot', label: '运行起始快照', path: '/tmp/start.svg' }) };
    const assertionAgentRun = createStubAgentRun({ mode: 'aiAssert', prompt: '确认订单已创建', verificationStatus: 'passed' });
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockResolvedValue({
        runId: assertionAgentRun.runId,
        title: '确认订单已创建',
        agentRun: assertionAgentRun,
        detail: {
          id: assertionAgentRun.runId, projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
          title: '确认订单已创建', status: 'passed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), duration: '00:00:01', summary: '页面文本断言通过。', logs: [],
          steps: [{ id: 'assertion-step', stepId: 'step-confirmed-assertion', title: '确认订单已创建', status: 'passed', message: '页面文本断言通过。', screenshotPath: '/tmp/assertion.png' }], artifacts: [],
        },
      }),
    };
    const workflowRunner = { runWorkflow: vi.fn() };
    const runner = new TestRunner(
      artifacts as never,
      browserRuntime as never,
      vi.fn(),
      undefined,
      workflowRunner as never,
      deterministicRunner as never,
    );

    const response = await runner.run({ project, testCase, environment });

    expect(deterministicRunner.runDeterministicStep).toHaveBeenCalledWith(
      expect.objectContaining({
        plannedStep: expect.objectContaining({ action: 'assert' }),
        assertion: { id: 'assert-order-created', version: 1, kind: 'pageContains', expected: '订单已创建' },
      }),
    );
    expect(workflowRunner.runWorkflow).not.toHaveBeenCalled();
    expect(response.detail.status).toBe('passed');
  });

  it('stops a case after a failed deterministic step without dispatching later workflow steps', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const testCase = {
      ...project.testCases[0],
      steps: [
        {
          id: 'step-confirmed-navigate', type: 'ai' as const, title: '打开登录页', body: '打开登录页',
          execution: {
            schemaVersion: 2 as const, intent: '打开登录页', reviewStatus: 'confirmed' as const, actionRisk: 'low' as const,
            action: { kind: 'navigate' as const, url: environment.url },
          },
        },
        { id: 'step-legacy-ai', type: 'ai' as const, title: '确认登录', body: '确认当前用户已登录' },
      ],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({ id: 'session-test', status: 'ready', currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() }),
    };
    const artifacts = { createSnapshot: vi.fn().mockResolvedValue({ id: 'artifact-start', type: 'snapshot', label: '运行起始快照', path: '/tmp/start.svg' }) };
    const failedAgentRun = createStubAgentRun({ mode: 'ai', prompt: '打开登录页', verificationStatus: 'failed', verificationFailureReason: '页面不可访问' });
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockResolvedValue({
        runId: failedAgentRun.runId,
        title: '打开登录页',
        agentRun: failedAgentRun,
        detail: {
          id: failedAgentRun.runId, projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
          title: '打开登录页', status: 'failed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), duration: '00:00:01', summary: '页面不可访问', failureReason: '页面不可访问', logs: [],
          steps: [{ id: 'deterministic-step', stepId: 'step-confirmed-navigate', title: '打开登录页', status: 'failed', message: '页面不可访问', screenshotPath: '/tmp/navigate.png' }], artifacts: [],
        },
      }),
    };
    const workflowRunner = { runWorkflow: vi.fn() };
    const runner = new TestRunner(
      artifacts as never,
      browserRuntime as never,
      vi.fn(),
      undefined,
      workflowRunner as never,
      deterministicRunner as never,
    );

    const response = await runner.run({ project, testCase, environment });

    expect(response.detail.status).toBe('failed');
    expect(response.detail.reason).toMatchObject({ code: 'actionFailed' });
    expect(response.detail.steps).toEqual([
      expect.objectContaining({ stepId: 'step-confirmed-navigate', status: 'failed' }),
      expect.objectContaining({ stepId: 'step-legacy-ai', status: 'skipped', message: expect.stringContaining('前序步骤') }),
    ]);
    expect(workflowRunner.runWorkflow).not.toHaveBeenCalled();
  });

  it('labels a failed deterministic assertion with assertion-failed evidence', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const testCase = {
      ...project.testCases[0],
      steps: [{
        id: 'step-assert-login', type: 'aiAssert' as const, title: '确认已登录', body: '确认页面显示欢迎语',
        execution: {
          schemaVersion: 2 as const, intent: '确认已登录', reviewStatus: 'confirmed' as const, actionRisk: 'low' as const,
          assertion: { id: 'assert-login', version: 1 as const, kind: 'pageContains' as const, expected: '欢迎回来' },
        },
      }],
    };
    const browserRuntime = {
      start: vi.fn().mockResolvedValue({ id: 'session-test', status: 'ready', currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() }),
    };
    const artifacts = { createSnapshot: vi.fn().mockResolvedValue({ id: 'artifact-start', type: 'snapshot', label: '运行起始快照', path: '/tmp/start.svg' }) };
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockResolvedValue({
        runId: 'assertion-failed',
        title: '确认已登录',
        detail: {
          id: 'assertion-failed', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
          title: '确认已登录', status: 'failed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), duration: '00:00:01', summary: '欢迎语未出现', logs: [],
          steps: [{ id: 'assertion-step', stepId: 'step-assert-login', title: '确认已登录', status: 'failed', message: '欢迎语未出现' }], artifacts: [],
        },
      }),
    };
    const runner = new TestRunner(artifacts as never, browserRuntime as never, vi.fn(), undefined, undefined, deterministicRunner as never);

    const response = await runner.run({ project, testCase, environment });

    expect(response.detail).toMatchObject({ status: 'failed', reason: { code: 'assertionFailed' } });
    expect(response.detail.steps).toEqual([expect.objectContaining({ stepId: 'step-assert-login', status: 'failed' })]);
  });
});

describe('TestRunner HTTP fixture lifecycle', () => {
  it('runs bound HTTP setups before the browser and records cleanup separately after a passed case', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = createExecutableHttpFixture(environment);
    const testCase = { ...project.testCases[0]!, steps: [], assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] } };
    const order: string[] = [];
    const browserRuntime = {
      start: vi.fn().mockImplementation(async () => {
        order.push('browser');
        return { id: 'session-fixture', status: 'ready', projectId: project.id, environmentId: environment.id, currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() };
      }),
    };
    const artifacts = { createSnapshot: vi.fn().mockResolvedValue({ id: 'start', type: 'snapshot', label: 'start', path: '/tmp/start.png' }) };
    const fixtureExecutor: FixtureLifecycleExecutor = {
      execute: vi.fn().mockImplementation(async ({ fixture: currentFixture, lifecycle }) => {
        order.push(lifecycle);
        return { evidence: fixtureEvidence(currentFixture, lifecycle), message: 'ok' };
      }),
    };
    const runner = new TestRunner(artifacts as never, browserRuntime as never, vi.fn(), undefined, undefined, undefined, fixtureExecutor);

    const response = await runner.run({ project: { ...project, fixtures: [fixture] }, testCase, environment });

    expect(order).toEqual(['setup', 'browser', 'cleanup']);
    expect(response.detail.status).toBe('passed');
    expect(response.detail.fixtureLifecycles).toEqual([
      expect.objectContaining({ lifecycle: 'setup', outcome: 'passed' }),
      expect.objectContaining({ lifecycle: 'cleanup', outcome: 'passed' }),
    ]);
  });

  it('stops before browser startup and cleans only already prepared fixtures when setup fails', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const first = createExecutableHttpFixture(environment, 'fixture-first');
    const second = createExecutableHttpFixture(environment, 'fixture-second');
    const testCase = { ...project.testCases[0]!, assetReferences: { fixtures: [{ id: first.id, version: 1 }, { id: second.id, version: 1 }], reusableFlows: [] } };
    const start = vi.fn();
    const order: string[] = [];
    const fixtureExecutor: FixtureLifecycleExecutor = {
      execute: vi.fn().mockImplementation(async ({ fixture, lifecycle }) => {
        order.push(`${lifecycle}:${fixture.id}`);
        const failed = lifecycle === 'setup' && fixture.id === second.id;
        return { evidence: fixtureEvidence(fixture, lifecycle, failed ? 'failed' : 'passed'), message: failed ? 'setup failed' : 'ok' };
      }),
    };
    const runner = new TestRunner({ createSnapshot: vi.fn() } as never, { start } as never, vi.fn(), undefined, undefined, undefined, fixtureExecutor);

    const response = await runner.run({ project: { ...project, fixtures: [first, second] }, testCase, environment });

    expect(order).toEqual(['setup:fixture-first', 'setup:fixture-second', 'cleanup:fixture-first']);
    expect(start).not.toHaveBeenCalled();
    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'fixturePreflight' });
    expect(response.detail.fixtureLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ fixtureId: second.id, lifecycle: 'setup', outcome: 'failed' }),
      expect.objectContaining({ fixtureId: first.id, lifecycle: 'cleanup', outcome: 'passed' }),
    ]));
  });

  it('preserves a failed case result when cleanup fails', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = createExecutableHttpFixture(environment);
    const testCase = {
      ...project.testCases[0]!,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
      steps: [{
        id: 'step-fail',
        type: 'ai' as const,
        title: '打开页面',
        body: '打开页面',
        execution: {
          schemaVersion: 2 as const,
          intent: '打开页面',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action: { kind: 'navigate' as const, url: environment.url },
        },
      }],
    };
    const browserRuntime = { start: vi.fn().mockResolvedValue({ id: 'session-fixture', status: 'ready', projectId: project.id, environmentId: environment.id, currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() }) };
    const artifacts = { createSnapshot: vi.fn().mockResolvedValue({ id: 'start', type: 'snapshot', label: 'start', path: '/tmp/start.png' }) };
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockResolvedValue({
        runId: 'deterministic-fail',
        title: '打开页面',
        detail: { id: 'deterministic-fail', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id, title: '打开页面', status: 'failed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), duration: '00:00:01', summary: '页面不可访问', failureReason: '页面不可访问', logs: [], steps: [], artifacts: [] },
      }),
    };
    const fixtureExecutor: FixtureLifecycleExecutor = {
      execute: vi.fn().mockImplementation(async ({ fixture: currentFixture, lifecycle }) => ({
        evidence: fixtureEvidence(currentFixture, lifecycle, lifecycle === 'cleanup' ? 'failed' : 'passed'),
        message: lifecycle === 'cleanup' ? 'cleanup failed' : 'ok',
      })),
    };
    const runner = new TestRunner(artifacts as never, browserRuntime as never, vi.fn(), undefined, undefined, deterministicRunner as never, fixtureExecutor);

    const response = await runner.run({ project: { ...project, fixtures: [fixture] }, testCase, environment });

    expect(response.detail.status).toBe('failed');
    expect(response.detail.failureReason).toBe('页面不可访问');
    expect(response.detail.fixtureLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ lifecycle: 'cleanup', outcome: 'failed' }),
    ]));
  });

  it('runs cleanup after cancellation without reopening or closing the browser session', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = createExecutableHttpFixture(environment);
    const testCase = { ...project.testCases[0]!, assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] } };
    const controller = new AbortController();
    const start = vi.fn();
    const fixtureExecutor: FixtureLifecycleExecutor = {
      execute: vi.fn().mockImplementation(async ({ fixture: currentFixture, lifecycle, cancellationSignal }) => {
        if (lifecycle === 'setup') {
          expect(cancellationSignal).toBe(controller.signal);
          controller.abort();
        } else {
          expect(cancellationSignal).toBeUndefined();
        }
        return { evidence: fixtureEvidence(currentFixture, lifecycle), message: 'ok' };
      }),
    };
    const runner = new TestRunner({ createSnapshot: vi.fn() } as never, { start } as never, vi.fn(), undefined, undefined, undefined, fixtureExecutor);

    const response = await runner.run({ project: { ...project, fixtures: [fixture] }, testCase, environment, cancellationSignal: controller.signal });

    expect(start).not.toHaveBeenCalled();
    expect(response.detail.status).toBe('cancelled');
    expect(response.detail.reason).toMatchObject({ code: 'userCancelled' });
    expect(response.detail.cancellation).toEqual(expect.objectContaining({ reason: 'userCancelled' }));
    expect(response.detail.fixtureLifecycles).toEqual([
      expect.objectContaining({ lifecycle: 'setup', outcome: 'passed' }),
      expect.objectContaining({ lifecycle: 'cleanup', outcome: 'passed' }),
    ]);
  });

  it('resolves a Fixture output only through the current deterministic input step', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = {
      ...createExecutableHttpFixture(environment),
      outputs: [{ name: 'orderId', type: 'string' as const, required: true }],
      setup: {
        mode: 'http' as const,
        summary: 'prepare',
        http: {
          method: 'POST' as const,
          path: '/api/test-data/fixture-orders',
          expectedStatuses: [201],
          responseOutputs: [{ outputName: 'orderId', jsonPointer: '/orderId' }],
        },
      },
    };
    const testCase = {
      ...project.testCases[0]!,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
      steps: [{
        id: 'step-input-fixture-output',
        type: 'ai' as const,
        title: '输入订单号',
        body: '输入已准备订单的 ID。',
        execution: {
          schemaVersion: 2 as const,
          intent: '输入已准备订单的 ID。',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'medium' as const,
          action: {
            kind: 'input' as const,
            locator: { selector: '#order-id', quality: 'acceptable' as const },
            binding: { kind: 'fixtureOutput' as const, fixtureId: fixture.id, fixtureVersion: fixture.version, outputName: 'orderId' },
          },
        },
      }],
    };
    const start = vi.fn().mockResolvedValue({ id: 'session-fixture', status: 'ready', projectId: project.id, environmentId: environment.id, currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString() });
    const deterministicRunner = {
      runDeterministicStep: vi.fn().mockImplementation(async (request) => {
        await expect(request.inputBindingResolver?.resolve({
          projectId: project.id,
          binding: request.inputBinding!,
        })).resolves.toBe('fixture-order-123');
        return {
          runId: 'deterministic-fixture-output',
          title: testCase.steps[0]!.title,
          detail: {
            id: 'deterministic-fixture-output',
            projectId: project.id,
            testCaseId: testCase.id,
            environmentId: environment.id,
            title: testCase.steps[0]!.title,
            status: 'passed' as const,
            startedAt: new Date(0).toISOString(),
            endedAt: new Date(0).toISOString(),
            duration: '00:00:01',
            summary: '已填写订单号',
            logs: [],
            steps: [],
            artifacts: [],
          },
        };
      }),
    };
    const fixtureExecutor: FixtureLifecycleExecutor = {
      execute: vi.fn().mockImplementation(async ({ fixture: currentFixture, lifecycle }) => ({
        evidence: fixtureEvidence(currentFixture, lifecycle),
        message: 'ok',
        ...(lifecycle === 'setup' ? { outputValues: { orderId: 'fixture-order-123' } } : {}),
      })),
    };
    const runner = new TestRunner(
      { createSnapshot: vi.fn().mockResolvedValue({ id: 'start', type: 'snapshot', label: 'start', path: '/tmp/start.png' }) } as never,
      { start } as never,
      vi.fn(),
      undefined,
      undefined,
      deterministicRunner as never,
      fixtureExecutor,
    );

    const response = await runner.run({ project: { ...project, fixtures: [fixture] }, testCase, environment });

    expect(start).toHaveBeenCalledTimes(1);
    expect(deterministicRunner.runDeterministicStep).toHaveBeenCalledWith(expect.objectContaining({
      inputBinding: { kind: 'fixtureOutput', fixtureId: fixture.id, fixtureVersion: fixture.version, outputName: 'orderId' },
      inputBindingResolver: expect.any(Object),
    }));
    expect(response.detail.status).toBe('passed');
    expect(JSON.stringify(response.detail)).not.toContain('fixture-order-123');
  });

  it('blocks a missing Fixture output before browser startup or deterministic browser input', async () => {
    const project = createProjectWithRecording();
    const environment = project.environments[0]!;
    const fixture = {
      ...createExecutableHttpFixture(environment),
      outputs: [{ name: 'orderId', type: 'string' as const, required: true }],
      setup: {
        mode: 'http' as const,
        summary: 'prepare',
        http: {
          method: 'POST' as const,
          path: '/api/test-data/fixture-orders',
          expectedStatuses: [201],
          responseOutputs: [{ outputName: 'orderId', jsonPointer: '/orderId' }],
        },
      },
    };
    const testCase = {
      ...project.testCases[0]!,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
      steps: [{
        id: 'step-input-missing-fixture-output',
        type: 'ai' as const,
        title: '输入订单号',
        body: '输入已准备订单的 ID。',
        execution: {
          schemaVersion: 2 as const,
          intent: '输入已准备订单的 ID。',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'medium' as const,
          action: {
            kind: 'input' as const,
            locator: { selector: '#order-id', quality: 'acceptable' as const },
            binding: { kind: 'fixtureOutput' as const, fixtureId: fixture.id, fixtureVersion: fixture.version, outputName: 'orderId' },
          },
        },
      }],
    };
    const start = vi.fn();
    const deterministicRunner = { runDeterministicStep: vi.fn() };
    const fixtureExecutor: FixtureLifecycleExecutor = {
      execute: vi.fn().mockImplementation(async ({ fixture: currentFixture, lifecycle }) => ({
        evidence: fixtureEvidence(currentFixture, lifecycle),
        message: 'ok',
      })),
    };
    const runner = new TestRunner({ createSnapshot: vi.fn() } as never, { start } as never, vi.fn(), undefined, undefined, deterministicRunner as never, fixtureExecutor);

    const response = await runner.run({ project: { ...project, fixtures: [fixture] }, testCase, environment });

    expect(response.detail.status).toBe('blocked');
    expect(response.detail.reason).toMatchObject({ code: 'fixturePreflight' });
    expect(response.detail.summary).toContain('未在当前准备请求中生成');
    expect(start).not.toHaveBeenCalled();
    expect(deterministicRunner.runDeterministicStep).not.toHaveBeenCalled();
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
