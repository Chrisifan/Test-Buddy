import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptySuiteAsset,
  createEmptyTestCase,
  type RunTestCaseResponse,
  type RunWorkflowResponse,
} from '../../shared/studio.js';
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
  it('converts an unclassified Case executor exception into persisted executor-error evidence', async () => {
    const emitRunEvent = vi.fn();
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-executor-error',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      emitRunEvent,
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-executor-error',
      steps: [{ id: 'step-executor-error', type: 'manual' as const, title: 'Manual boundary', body: 'manual' }],
    };
    vi.spyOn(bundle.testRunner, 'run').mockRejectedValue(new Error('browser process exited'));

    const response = await bundle.runTestCase({
      runId: 'run-executor-error',
      projectSnapshot: projectSnapshot({ ...project, testCases: [testCase] }),
      environment,
      testCase,
    });

    expect(response.detail).toMatchObject({
      status: 'error',
      reason: { code: 'executorError' },
      steps: expect.arrayContaining([expect.objectContaining({ status: 'error' })]),
    });
    expect(emitRunEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'complete', status: 'error', detail: response.detail }));
    await bundle.close();
  });

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
        projectSnapshot: projectSnapshot(project),
        environment,
        testCase,
      }),
    ).resolves.toBe(workflowResponse);

    expect(workflowRun).toHaveBeenCalledOnce();
    expect(testRunnerRun).not.toHaveBeenCalled();
    await bundle.close();
  });

  it.each([
    ['input', { kind: 'input' as const, locator: { selector: '#email', quality: 'acceptable' as const }, binding: { kind: 'credential' as const, credentialId: 'cred-qa', field: 'username' as const } }],
    ['select', { kind: 'select' as const, locator: { selector: '#region', quality: 'acceptable' as const }, binding: { kind: 'credential' as const, credentialId: 'cred-region', field: 'secret' as const } }],
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
        projectSnapshot: projectSnapshot(project),
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
        projectSnapshot: projectSnapshot(project),
        environment,
        testCase,
      }),
    ).resolves.toBe(runnerResponse);

    expect(testRunnerRun).toHaveBeenCalledOnce();
    expect(workflowRun).not.toHaveBeenCalled();
    await bundle.close();
  });

  it('runs a case with a confirmed V2 explicit assertion through TestRunner', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-confirmed-assertion',
      visualDiffImageAdapter: {
        read: vi.fn(),
        write: vi.fn(),
      },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-confirmed-assertion',
      kind: 'assertion' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      name: '确认的订单断言',
      category: '核心链路',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '',
      steps: [
        {
          id: 'step-confirmed-assertion',
          type: 'aiAssert' as const,
          title: '确认订单已创建',
          body: '确认页面包含订单已创建',
          execution: {
            schemaVersion: 2 as const,
            intent: '确认订单已创建',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            assertion: { id: 'assert-order-created', version: 1 as const, kind: 'pageContains' as const, expected: '订单已创建' },
          },
        },
      ],
    };
    const runnerResponse = { runId: 'run-confirmed-assertion', title: testCase.name, detail: {} } as RunTestCaseResponse;
    const testRunnerRun = vi.spyOn(bundle.testRunner, 'run').mockResolvedValue(runnerResponse);
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue({} as RunWorkflowResponse);

    await expect(
      bundle.runTestCase({
        runId: 'run-confirmed-assertion',
        projectSnapshot: projectSnapshot(project),
        environment,
        testCase,
      }),
    ).resolves.toBe(runnerResponse);

    expect(testRunnerRun).toHaveBeenCalledOnce();
    expect(workflowRun).not.toHaveBeenCalled();
    await bundle.close();
  });
});

describe('RuntimeBundle desktop Suite adapter', () => {
  it('runs exact Suite members through the existing Case execution path', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-suite',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const first = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-suite-first',
      version: 1,
      steps: [{ id: 'step-suite-first', type: 'manual' as const, title: '确认首页', body: '人工确认首页状态。' }],
    };
    const second = {
      ...createEmptyTestCase(2, project.groups[0]!.id, environment.id),
      id: 'case-suite-second',
      version: 1,
      steps: [{ id: 'step-suite-second', type: 'manual' as const, title: '确认订单', body: '人工确认订单状态。' }],
    };
    project.testCases = [first, second];
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-desktop',
      name: '桌面回归',
      caseReferences: [
        { id: first.id, version: first.version!, dependsOn: [] },
        { id: second.id, version: second.version!, dependsOn: [{ id: first.id, version: first.version! }] },
      ],
      execution: { concurrency: 3, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    project.suites = [suite];
    const caseCalls: string[] = [];
    vi.spyOn(bundle.testRunner, 'run').mockImplementation(async ({ testCase, environment: caseEnvironment }) => {
      caseCalls.push(`${testCase.id}:${caseEnvironment.id}`);
      return {
        runId: `run-${testCase.id}`,
        title: testCase.name,
        detail: {
          id: `run-${testCase.id}`,
          projectId: project.id,
          testCaseId: testCase.id,
          environmentId: caseEnvironment.id,
          title: testCase.name,
          status: 'passed',
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:01',
          summary: `${testCase.name} passed`,
          logs: [],
          steps: [],
          artifacts: [],
        },
      } satisfies RunTestCaseResponse;
    });

    const response = await bundle.runSuite({
      projectSnapshot: projectSnapshot(project),
      suite,
      environment,
    });

    expect(caseCalls).toEqual([`${first.id}:${environment.id}`, `${second.id}:${environment.id}`]);
    expect(response).toMatchObject({
      title: suite.name,
      detail: {
        suite: {
          suiteId: suite.id,
          suiteVersion: suite.version,
          effectiveConcurrency: 1,
          status: 'passed',
          results: [
            { testCaseId: first.id, attempts: 1, status: 'passed' },
            { testCaseId: second.id, attempts: 1, status: 'passed' },
          ],
        },
        caseDetails: [
          { id: `run-${first.id}` },
          { id: `run-${second.id}` },
        ],
      },
    });
    await bundle.close();
  });

  it('keeps same-ID Suite Case versions in distinct versioned run details', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-suite-versioned-members',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const first = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case/versioned-member',
      version: 1,
      steps: [{ id: 'step-versioned-v1', type: 'manual' as const, title: 'V1', body: 'V1' }],
    };
    const second = {
      ...first,
      version: 2,
      name: 'Version two',
      steps: [{ id: 'step-versioned-v2', type: 'manual' as const, title: 'V2', body: 'V2' }],
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-versioned-members',
      environmentId: environment.id,
      caseReferences: [
        { id: first.id, version: first.version, dependsOn: [] },
        { id: second.id, version: second.version, dependsOn: [] },
      ],
      execution: { concurrency: 1, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    project.testCases = [first, second];
    project.suites = [suite];
    vi.spyOn(bundle.testRunner, 'run').mockImplementation(async ({ runId, testCase }) => ({
      runId: runId!,
      title: testCase.name,
      detail: {
        id: runId!,
        projectId: project.id,
        testCaseId: testCase.id,
        environmentId: environment.id,
        title: testCase.name,
        status: 'passed',
        startedAt: new Date(0).toISOString(),
        endedAt: new Date(0).toISOString(),
        duration: '00:00:01',
        summary: 'Passed',
        logs: [],
        steps: [],
        artifacts: [],
      },
    } satisfies RunTestCaseResponse));

    const response = await bundle.runSuite({
      runId: 'suite-versioned-run',
      projectSnapshot: projectSnapshot(project),
      suite,
      environment,
    });

    expect(response.detail.caseDetails).toEqual([
      expect.objectContaining({ id: 'suite-versioned-run-case/versioned-member@1-attempt-1', testCaseVersion: 1 }),
      expect.objectContaining({ id: 'suite-versioned-run-case/versioned-member@2-attempt-1', testCaseVersion: 2 }),
    ]);
    expect(response.detail.suite.results.map((result) => result.runId)).toEqual([
      'suite-versioned-run-case/versioned-member@1-attempt-1',
      'suite-versioned-run-case/versioned-member@2-attempt-1',
    ]);
    await bundle.close();
  });

  it('retains every Case RunDetail when a failed attempt recovers on retry', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-suite-retry-details',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-suite-retry',
      version: 1,
      steps: [{ id: 'step-suite-retry', type: 'manual' as const, title: '验证重试', body: '验证失败后重试。' }],
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-retry-details',
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version!, dependsOn: [] }],
      execution: { concurrency: 1, failurePolicy: 'continue' as const, retryLimit: 1 },
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const runIdPrefix = `suite-retry-run-${testCase.id}@${testCase.version}`;
    const attemptResponses = [
      {
        runId: `${runIdPrefix}-attempt-1`,
        title: testCase.name,
        detail: {
          id: `${runIdPrefix}-attempt-1`,
          projectId: project.id,
          testCaseId: testCase.id,
          environmentId: environment.id,
          title: testCase.name,
          status: 'failed' as const,
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:01',
          summary: 'Attempt 1 failed',
          logs: [],
          steps: [],
          artifacts: [],
        },
      },
      {
        runId: `${runIdPrefix}-attempt-2`,
        title: testCase.name,
        detail: {
          id: `${runIdPrefix}-attempt-2`,
          projectId: project.id,
          testCaseId: testCase.id,
          environmentId: environment.id,
          title: testCase.name,
          status: 'passed' as const,
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:01',
          summary: 'Attempt 2 passed',
          logs: [],
          steps: [],
          artifacts: [],
        },
      },
    ] satisfies RunTestCaseResponse[];
    vi.spyOn(bundle.testRunner, 'run').mockImplementation(async ({ runId }) => {
      const response = attemptResponses.find((candidate) => candidate.runId === runId);
      if (!response) {
        throw new Error(`Unexpected Suite attempt: ${runId}`);
      }
      return response;
    });

    const response = await bundle.runSuite({
      runId: 'suite-retry-run',
      projectSnapshot: projectSnapshot(project),
      suite,
      environment,
    });

    expect(response.detail.caseDetails.map((detail) => detail.id)).toEqual([
      `${runIdPrefix}-attempt-1`,
      `${runIdPrefix}-attempt-2`,
    ]);
    expect(response.detail.caseDetails.map((detail) => detail.testCaseVersion)).toEqual([1, 1]);
    expect(response.detail.suite).toMatchObject({
      status: 'passed',
      results: [{ testCaseId: testCase.id, attempts: 2, status: 'passed', flaky: true }],
    });
    await bundle.close();
  });

  it('does not dispatch Suite Cases when the parent request was already cancelled', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-suite-cancelled',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = { ...createEmptyTestCase(1, project.groups[0]!.id, environment.id), id: 'case-suite-cancelled', version: 1 };
    project.testCases = [testCase];
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-cancelled',
      caseReferences: [{ id: testCase.id, version: testCase.version!, dependsOn: [] }],
    };
    project.suites = [suite];
    const controller = new AbortController();
    controller.abort();
    const caseRun = vi.spyOn(bundle.testRunner, 'run');

    const response = await bundle.runSuite({
      runId: 'suite-cancelled-run',
      cancellationSignal: controller.signal,
      projectSnapshot: projectSnapshot(project),
      suite,
      environment,
    });

    expect(caseRun).not.toHaveBeenCalled();
    expect(response.detail.suite).toMatchObject({ status: 'cancelled', reason: { code: 'userCancelled' }, effectiveConcurrency: 1 });
    expect(response.detail.suite.results).toEqual([
      expect.objectContaining({ testCaseId: testCase.id, status: 'cancelled', attempts: 0, reason: expect.objectContaining({ code: 'userCancelled' }) }),
    ]);
    expect(bundle.cancelRun('suite-cancelled-run')).toBe(false);
    await bundle.close();
  });
});

function projectSnapshot(project: ReturnType<typeof createEmptyProject>) {
  return {
    project,
    revision: 'a'.repeat(64),
    source: 'legacyStudioStore' as const,
    reproducibility: 'legacy' as const,
  };
}
