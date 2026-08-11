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
import { createStubAgentRun } from '../../shared/agentStub.js';
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
      expect.objectContaining({ stepId: 'step-manual', status: 'neutral' }),
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

  it('keeps unsupported confirmed V2 actions neutral instead of sending them to the workflow runtime', async () => {
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

    expect(response.detail.status).toBe('neutral');
    expect(response.detail.steps[0]).toEqual(
      expect.objectContaining({ status: 'neutral', message: expect.stringContaining('确认的结构化动作') }),
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
    expect(response.detail.steps).toEqual([
      expect.objectContaining({ stepId: 'step-confirmed-navigate', status: 'failed' }),
      expect.objectContaining({ stepId: 'step-legacy-ai', status: 'neutral', message: expect.stringContaining('前序步骤') }),
    ]);
    expect(workflowRunner.runWorkflow).not.toHaveBeenCalled();
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
