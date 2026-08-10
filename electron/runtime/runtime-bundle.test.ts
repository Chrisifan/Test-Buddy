import { describe, expect, it, vi } from 'vitest';

import { createEmptyProject, type RunTestCaseResponse, type RunWorkflowResponse } from '../../shared/studio.js';
import { createRuntimeBundle } from './runtime-bundle.js';

describe('RuntimeBundle cancellation', () => {
  it('aborts only the matching active run and releases it after completion', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle',
      visualDiffImageAdapter: {
        read: vi.fn(),
        write: vi.fn(),
      },
    });
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolveWorkflow: (response: RunWorkflowResponse) => void = () => undefined;
    const workflowResult = new Promise<RunWorkflowResponse>((resolve) => {
      resolveWorkflow = resolve;
    });
    let cancellationSignal: AbortSignal | undefined;
    vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockImplementation((request) => {
      cancellationSignal = request.cancellationSignal;
      markStarted();
      return workflowResult;
    });

    const pending = bundle.runWorkflow({
      runId: 'workflow-active',
      workflow: {
        id: 'workflow-active',
        kind: 'scenario',
        name: 'Active workflow',
        category: 'Core',
        lastEdited: 'now',
        url: 'https://example.test',
        notes: '',
        steps: [],
      },
      targetEnvironment: 'Staging',
      runtimeProfile: {
        browser: 'chromium',
        baseUrl: 'https://example.test',
        viewport: 'desktop',
        locale: 'en-US',
        headless: true,
      },
    });

    await started;
    expect(bundle.cancelRun('unknown-run')).toBe(false);
    expect(bundle.cancelRun('workflow-active')).toBe(true);
    expect(cancellationSignal?.aborted).toBe(true);
    expect(bundle.cancelRun('workflow-active')).toBe(false);

    resolveWorkflow({} as RunWorkflowResponse);
    await pending;

    expect(bundle.cancelRun('workflow-active')).toBe(false);
    await bundle.close();
  });
});

describe('RuntimeBundle test case routing', () => {
  it('runs a legacy pure AI case through StudioRuntime workflow', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-legacy-ai',
      visualDiffImageAdapter: {
        read: vi.fn(),
        write: vi.fn(),
      },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-legacy-ai',
      kind: 'scenario' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      name: '传统 AI 步骤',
      category: '核心链路',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '',
      steps: [{ id: 'step-legacy-ai', type: 'ai' as const, title: '登录', body: '使用语义步骤登录' }],
    };
    const workflowResponse = {} as RunWorkflowResponse;
    const testRunnerRun = vi.spyOn(bundle.testRunner, 'run').mockResolvedValue({} as RunTestCaseResponse);
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue(workflowResponse);

    await expect(
      bundle.runTestCase({
        runId: 'run-legacy-ai',
        project,
        environment,
        testCase,
      }),
    ).resolves.toBe(workflowResponse);

    expect(workflowRun).toHaveBeenCalledOnce();
    expect(testRunnerRun).not.toHaveBeenCalled();
    await bundle.close();
  });

  it.each([
    ['input', { kind: 'input' as const, locator: { selector: '#email', quality: 'acceptable' as const }, value: 'qa@example.test' }],
    ['select', { kind: 'select' as const, locator: { selector: '#region', quality: 'acceptable' as const }, value: 'shanghai' }],
    ['unknown-kind', { kind: 'unknown' } as never],
    ['primitive', 'unknown' as never],
  ])('runs a confirmed V2 %s action through TestRunner', async (actionName, action) => {
    const bundle = createRuntimeBundle({
      rootDir: `/tmp/testbuddy-runtime-bundle-confirmed-${actionName}`,
      visualDiffImageAdapter: {
        read: vi.fn(),
        write: vi.fn(),
      },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: `case-confirmed-${actionName}`,
      kind: 'scenario' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      name: `确认的 ${actionName} 步骤`,
      category: '核心链路',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '',
      steps: [
        {
          id: `step-confirmed-${actionName}`,
          type: 'ai' as const,
          title: `执行 ${actionName}`,
          body: `执行确认的 ${actionName} 动作`,
          execution: {
            schemaVersion: 2 as const,
            intent: `执行 ${actionName}`,
            reviewStatus: 'confirmed' as const,
            actionRisk: 'medium' as const,
            action,
          },
        },
      ],
    };
    const runnerResponse = { runId: `run-confirmed-${actionName}`, title: testCase.name, detail: {} } as RunTestCaseResponse;
    const testRunnerRun = vi.spyOn(bundle.testRunner, 'run').mockResolvedValue(runnerResponse);
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue({} as RunWorkflowResponse);

    await expect(
      bundle.runTestCase({
        runId: `run-confirmed-${actionName}`,
        project,
        environment,
        testCase,
      }),
    ).resolves.toBe(runnerResponse);

    expect(testRunnerRun).toHaveBeenCalledOnce();
    expect(workflowRun).not.toHaveBeenCalled();
    await bundle.close();
  });

  it('runs a case with a confirmed V2 deterministic action through TestRunner', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-routing',
      visualDiffImageAdapter: {
        read: vi.fn(),
        write: vi.fn(),
      },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-confirmed-click',
      kind: 'scenario' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      name: '确认的点击步骤',
      category: '核心链路',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '',
      steps: [
        {
          id: 'step-confirmed-click',
          type: 'ai' as const,
          title: '提交订单',
          body: '点击提交订单',
          execution: {
            schemaVersion: 2 as const,
            intent: '点击提交订单',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'medium' as const,
            action: {
              kind: 'click' as const,
              locator: { selector: '#submit-order', quality: 'acceptable' as const },
            },
          },
        },
      ],
    };
    const runnerResponse = { runId: 'run-confirmed-click', title: testCase.name, detail: {} } as RunTestCaseResponse;
    const testRunnerRun = vi.spyOn(bundle.testRunner, 'run').mockResolvedValue(runnerResponse);
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue({} as RunWorkflowResponse);

    await expect(
      bundle.runTestCase({
        runId: 'run-confirmed-click',
        project,
        environment,
        testCase,
      }),
    ).resolves.toBe(runnerResponse);

    expect(testRunnerRun).toHaveBeenCalledOnce();
    expect(workflowRun).not.toHaveBeenCalled();
    await bundle.close();
  });
});
