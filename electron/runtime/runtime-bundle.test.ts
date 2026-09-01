import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptySuiteAsset,
  createEmptyTestCase,
  createInitialStudioState,
  deriveProjectRunReport,
  hydrateStudioState,
  type RunTestCaseResponse,
  type RunWorkflowResponse,
} from '../../shared/studio.js';
import { appendRunToStudioState } from './run-history.js';
import { createRunProvenance } from './run-provenance.js';
import { BrowserPool } from './browser-pool.js';
import { createRuntimeBundle } from './runtime-bundle.js';

describe('RuntimeBundle cancellation', () => {
  it('keeps an injected worker BrowserPool separate from the interactive browser session', async () => {
    const browserPool = new BrowserPool({
      createBrowser: async () => ({ newContext: vi.fn() }),
    });
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-worker-pool',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      browserPool,
    });

    expect(bundle.browserPool).toBe(browserPool);
    expect(bundle.browserRuntime.getPage()).toBeNull();
    await bundle.close();
  });

  it('opens a leased worker context without changing the interactive browser session', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue('worker page'),
      url: vi.fn(() => 'http://worker.test'),
      screenshot: vi.fn().mockRejectedValue(new Error('test screenshot unavailable')),
      on: vi.fn(),
    };
    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browserPool = new BrowserPool({
      createBrowser: async () => ({ newContext: vi.fn().mockResolvedValue(context) }),
    });
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-worker-context',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      browserPool,
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const lease = await browserPool.acquire({ environment, locks: [] });
    const worker = (bundle.browserRuntime as unknown as {
      createWorker: (workerLease: typeof lease) => typeof bundle.browserRuntime;
    }).createWorker(lease);

    try {
      const session = await worker.start({ project, environment, record: false });

      expect(session.status).toBe('error');
      expect(context.newPage).toHaveBeenCalledOnce();
      expect(bundle.browserRuntime.getPage()).toBeNull();
      expect(bundle.browserRuntime.getState().status).toBe('idle');
    } finally {
      await worker.close();
      expect(context.close).toHaveBeenCalledOnce();
      expect(browserPool.activeLeaseCount).toBe(0);
      await bundle.close();
    }
  });

  it('returns a worker lease even when its page close fails', async () => {
    const page = {
      close: vi.fn().mockRejectedValue(new Error('worker page close failed')),
    };
    const context = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browserPool = new BrowserPool({
      createBrowser: async () => ({ newContext: vi.fn().mockResolvedValue(context) }),
    });
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-worker-close',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      browserPool,
    });
    const lease = await browserPool.acquire({ environment: createEmptyProject(1).environments[0]!, locks: [] });
    const worker = (bundle.browserRuntime as unknown as {
      createWorker: (workerLease: typeof lease) => typeof bundle.browserRuntime;
    }).createWorker(lease);
    (worker as unknown as { page: unknown }).page = page;

    try {
      await expect(worker.close()).rejects.toThrow('worker page close failed');
      expect(context.close).toHaveBeenCalledOnce();
      expect(browserPool.activeLeaseCount).toBe(0);
    } finally {
      await bundle.close();
    }
  });

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
  it('resolves a registered attachment for controlled upload without exposing its path outside the main runtime', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-runtime-bundle-upload-'));
    const policy = { resolve: vi.fn(async () => ({})) };
    const bundle = createRuntimeBundle({
      rootDir,
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      deterministicInteractionPreflightPolicy: policy,
    });
    const uploadPath = await bundle.artifactManager.createDownloadPath('avatar.png');
    await fs.writeFile(uploadPath, 'approved avatar', 'utf8');
    const attachment = await bundle.artifactManager.registerExisting({
      id: 'attachment-runtime-upload',
      path: uploadPath,
      type: 'attachment',
      label: 'Approved avatar',
      evidenceKind: 'attachment',
      retentionClass: 'standard',
      protectedBy: [],
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const action = {
      kind: 'upload' as const,
      locator: { selector: '#avatar', quality: 'acceptable' as const },
      fileRef: { kind: 'attachment' as const, id: attachment.id },
    };
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-managed-runtime-upload',
      steps: [{
        id: 'step-managed-runtime-upload',
        type: 'ai' as const,
        title: 'Upload approved avatar',
        body: 'Upload the approved attachment.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Upload the approved attachment.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action,
        },
      }],
    };
    const session = {
      id: 'session-managed-runtime-upload', status: 'ready' as const, projectId: project.id, environmentId: environment.id,
      currentUrl: environment.url, pageTitle: project.name, message: 'ready', updatedAt: new Date(0).toISOString(),
    };
    const start = vi.spyOn(bundle.browserRuntime, 'start').mockResolvedValue(session);
    let resolvedPath: string | undefined;
    const execute = vi.spyOn(bundle.browserRuntime, 'executeControlledDeterministicAction').mockImplementation(async (request) => {
      resolvedPath = await request.resolveUploadPath?.(action.fileRef);
      return { message: 'Uploaded approved attachment.', artifacts: [] };
    });

    try {
      const response = await bundle.runTestCase({
        runId: 'run-managed-runtime-upload',
        projectSnapshot: projectSnapshot({ ...project, testCases: [testCase] }),
        environment,
        testCase,
      });

      expect(response.detail.status).toBe('passed');
      expect(policy.resolve).toHaveBeenCalledWith({ projectId: project.id, environmentId: environment.id, testCaseId: testCase.id });
      expect(start).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledOnce();
      expect(resolvedPath).toBe(uploadPath);
      expect(JSON.stringify(response)).not.toContain(uploadPath);
    } finally {
      await bundle.close();
    }
  });

  it('forwards main-only interaction policy to TestRunner before BrowserRuntime starts', async () => {
    const secret = 'resolved-runtime-policy-secret';
    const policy = { resolve: vi.fn(async () => ({ knownSecrets: [secret] })) };
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-interaction-policy',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      deterministicInteractionPreflightPolicy: policy,
    } as never);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-policy-secret',
      steps: [{
        id: 'step-policy-secret', type: 'ai' as const, title: 'Copy controlled value', body: 'Copy the reviewed value.',
        execution: {
          schemaVersion: 2 as const, intent: 'Copy the reviewed value.', reviewStatus: 'confirmed' as const, actionRisk: 'low' as const,
          action: { kind: 'clipboard' as const, value: `sentinel-${secret}` },
        },
      }],
    };

    try {
      const response = await bundle.runTestCase({
        runId: 'run-policy-secret',
        projectSnapshot: projectSnapshot({ ...project, testCases: [testCase] }),
        environment,
        testCase,
      });

      expect(policy.resolve).toHaveBeenCalledWith({ projectId: project.id, environmentId: environment.id, testCaseId: testCase.id });
      expect(response.detail.reason).toEqual({ code: 'unsupportedAction', message: 'deterministic interaction blocked: resolvedSecret' });
      expect(JSON.stringify(response)).not.toContain(secret);
    } finally {
      await bundle.close();
    }
  });

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

  it('redacts resolved model keys before executor failures reach events, history, provenance, or reports', async () => {
    const secret = 'sk-runtime-bundle-redaction';
    const emitRunEvent = vi.fn();
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-secret-redaction',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      emitRunEvent,
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      steps: [{ id: 'step-secret-redaction', type: 'manual' as const, title: 'Manual boundary', body: 'manual' }],
    };
    vi.spyOn(bundle.testRunner, 'run').mockRejectedValue(new Error(`provider rejected Bearer ${secret}`));

    const response = await bundle.runTestCase({
      runId: 'run-secret-redaction',
      projectSnapshot: projectSnapshot({ ...project, testCases: [testCase] }),
      environment,
      testCase,
      midsceneConfig: {
        modelBaseUrl: 'https://models.example.test/v1',
        modelSecret: { id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        modelApiKey: secret,
        modelName: 'ui-agent-model',
        modelFamily: 'openai',
        preferredLanguage: 'Chinese',
        replanningCycleLimit: '10',
        openaiHttpProxy: '',
        defaultContext: '',
      },
    });

    const initialState = createInitialStudioState();
    const stateWithHistory = appendRunToStudioState(
      initialState,
      response,
      environment,
      initialState.browserSession,
    );
    const provenance = createRunProvenance(
      projectSnapshot({ ...project, testCases: [testCase] }),
      testCase,
      environment,
      {
        browserProfile: { engine: 'chromium', headless: true },
        executor: { appVersion: 'test-buddy-desktop', runnerVersion: 'runtime-bundle-v1' },
        model: {
          provider: 'openaiCompatible',
          name: 'ui-agent-model',
          endpoint: `https://models.example.test/v1?api_key=${secret}`,
          hasKey: true,
        },
      },
    );
    const report = deriveProjectRunReport(
      { ...project, testCases: [testCase] },
      stateWithHistory.recentRuns,
      stateWithHistory.runDetails,
      '2026-08-17T00:00:00.000Z',
    );

    expect(JSON.stringify({ response, events: emitRunEvent.mock.calls, stateWithHistory, provenance, report })).not.toContain(secret);
    expect(response.detail.summary).toContain('Runtime executor failed');
    expect(response.detail.summary).toContain('[REDACTED_MODEL_SECRET]');
    expect(stateWithHistory.runDetails[0]?.summary).toContain('[REDACTED_MODEL_SECRET]');
    expect(report.problemRuns[0]).toMatchObject({ summary: response.detail.summary });
    expect(provenance.model.endpointFingerprint).toMatch(/^sha256:/);
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
    ['controlled upload', {
      kind: 'upload',
      locator: { selector: '#avatar', quality: 'acceptable' },
      fileRef: { kind: 'attachment', id: '/private/malformed-upload-must-not-persist' },
    }, '/private/malformed-upload-must-not-persist'],
    ['base navigate', { kind: 'navigate', url: ' ' }, undefined],
  ] as const)('blocks a hydrated malformed %s action before model or browser startup', async (_label, action, discardedPayload) => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-hydrated-malformed-action',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const rawState = {
      ...createInitialStudioState(),
      selectedProjectId: project.id,
      projects: [{
        ...project,
        testCases: [{
          ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
          id: 'case-hydrated-malformed-action',
          steps: [{
            id: 'step-hydrated-malformed-action',
            type: 'ai' as const,
            title: 'Malformed action',
            body: 'Do not execute this.',
            execution: {
              schemaVersion: 2 as const,
              intent: 'Do not execute this.',
              reviewStatus: 'confirmed' as const,
              actionRisk: 'low' as const,
              action,
            },
          }],
        }],
      }],
    } as never;
    const hydrated = hydrateStudioState(rawState);
    const hydratedProject = hydrated.projects[0]!;
    const testCase = hydratedProject.testCases[0]!;
    const browserStart = vi.spyOn(bundle.browserRuntime, 'start');
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue({} as RunWorkflowResponse);

    const response = await bundle.runTestCase({
      runId: 'run-hydrated-malformed-action',
      projectSnapshot: projectSnapshot(hydratedProject),
      environment,
      testCase,
      modelConfigResolver: { resolveMidsceneConfig: vi.fn(), resolveAgentProviderConfig: vi.fn() },
    } as never);

    expect(workflowRun).not.toHaveBeenCalled();
    expect(browserStart).not.toHaveBeenCalled();
    expect(response.detail.reason).toEqual({
      code: 'unsupportedAction',
      message: 'deterministic interaction blocked: malformedAction',
    });
    if (discardedPayload) {
      expect(JSON.stringify({ testCase, response })).not.toContain(discardedPayload);
    }
    await bundle.close();
  });

  it('blocks an unconfirmed controlled interaction before policy, model, or browser startup', async () => {
    const policy = { resolve: vi.fn() };
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-unconfirmed-controlled-action',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      deterministicInteractionPreflightPolicy: policy,
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-unconfirmed-controlled-action',
      steps: [{
        id: 'step-unconfirmed-tab',
        type: 'ai' as const,
        title: 'Open reviewed tab',
        body: 'Open the reviewed tab.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Open the reviewed tab.',
          reviewStatus: 'needsReview' as const,
          actionRisk: 'low' as const,
          action: { kind: 'tab' as const, url: `${environment.url}/help` },
        },
      }],
    };
    const browserStart = vi.spyOn(bundle.browserRuntime, 'start');
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue({} as RunWorkflowResponse);

    const response = await bundle.runTestCase({
      runId: 'run-unconfirmed-controlled-action',
      projectSnapshot: projectSnapshot(project),
      environment,
      testCase,
      modelConfigResolver: { resolveMidsceneConfig: vi.fn(), resolveAgentProviderConfig: vi.fn() },
    } as never);

    expect(workflowRun).not.toHaveBeenCalled();
    expect(browserStart).not.toHaveBeenCalled();
    expect(policy.resolve).not.toHaveBeenCalled();
    expect(response.detail).toMatchObject({ status: 'blocked', reason: { code: 'unsupportedAction' } });
    await bundle.close();
  });

  it('routes Flow-bearing Agent Cases through TestRunner to preserve Flow-first execution', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-flow-routing',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const flow = {
      schemaVersion: 1 as const,
      id: 'flow-auth',
      version: 1,
      name: 'Auth',
      description: '',
      tags: [],
      steps: [{
        id: 'flow-step',
        type: 'ai' as const,
        title: 'Open login',
        body: 'Open login',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Open login',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action: { kind: 'navigate' as const, url: environment.url },
        },
      }],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      steps: [{ id: 'case-agent-step', type: 'ai' as const, title: 'Continue', body: 'Continue' }],
      assetReferences: { fixtures: [], reusableFlows: [{ id: flow.id, version: flow.version }] },
    };
    const testRunnerRun = vi.spyOn(bundle.testRunner, 'run').mockResolvedValue({
      runId: 'flow-test-run',
      title: testCase.name,
      detail: {} as never,
    });
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue({} as RunWorkflowResponse);

    await expect(bundle.runTestCase({
      runId: 'run-flow-routing',
      projectSnapshot: projectSnapshot({ ...project, reusableFlows: [flow], testCases: [testCase] }),
      environment,
      testCase,
    })).resolves.toMatchObject({ runId: 'flow-test-run' });

    expect(testRunnerRun).toHaveBeenCalledOnce();
    expect(workflowRun).not.toHaveBeenCalled();
    await bundle.close();
  });

  it('passes a lazy model resolver into an Agent Case without resolving unrelated scopes', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-lazy-agent-models',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-lazy-agent-models',
      steps: [{ id: 'step-lazy-agent-models', type: 'ai' as const, title: 'Click save', body: 'click save' }],
    };
    const lazyModelResolver = {
      resolveMidsceneConfig: vi.fn(),
      resolveAgentProviderConfig: vi.fn(),
    };
    const workflowRun = vi.spyOn(bundle.studioRuntime, 'runWorkflow').mockResolvedValue({} as RunWorkflowResponse);

    await bundle.runTestCase({
      runId: 'run-lazy-agent-models',
      projectSnapshot: projectSnapshot(project),
      environment,
      testCase,
      modelConfigResolver: lazyModelResolver,
    } as never);

    expect(workflowRun).toHaveBeenCalledWith(expect.objectContaining({ modelConfigResolver: lazyModelResolver }));
    expect(lazyModelResolver.resolveMidsceneConfig).not.toHaveBeenCalled();
    expect(lazyModelResolver.resolveAgentProviderConfig).not.toHaveBeenCalled();
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
  it('keeps a legacy Suite serial without acquiring an injected worker pool', async () => {
    const newContext = vi.fn();
    const browserPool = new BrowserPool({
      capacity: 2,
      createBrowser: async () => ({ newContext }),
    });
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-legacy-suite-pool',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      browserPool,
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const members = [1, 2].map((seed) => ({
      ...createEmptyTestCase(seed, project.groups[0]!.id, environment.id),
      id: `case-legacy-worker-${seed}`,
      version: 1,
      steps: [],
    }));
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-legacy-worker',
      environmentId: environment.id,
      caseReferences: members.map((testCase) => ({ id: testCase.id, version: testCase.version!, dependsOn: [] })),
      execution: { concurrency: 8, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    const runtimeProject = { ...project, testCases: members, suites: [suite] };
    vi.spyOn(bundle.testRunner, 'run').mockImplementation(async ({ runId, testCase }) => ({
      runId: runId!,
      title: testCase.name,
      detail: {
        id: runId!, projectId: runtimeProject.id, testCaseId: testCase.id, environmentId: environment.id,
        title: testCase.name, status: 'passed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(),
        duration: '00:00:00', summary: 'Passed', logs: [], steps: [], artifacts: [],
      },
    }));

    try {
      const response = await bundle.runSuite({
        projectSnapshot: {
          project: runtimeProject,
          revision: 'b'.repeat(64),
          source: 'legacyStudioStore',
          reproducibility: 'legacy',
        },
        suite,
        environment,
      });

      expect(response.detail.suite.effectiveConcurrency).toBe(1);
      expect(newContext).not.toHaveBeenCalled();
    } finally {
      await bundle.close();
    }
  });

  it.each([
    { label: 'Firefox', browser: 'firefox' as const, headless: true },
    { label: 'WebKit', browser: 'webkit' as const, headless: true },
    { label: 'headed Chromium', browser: 'chromium' as const, headless: false },
  ])('keeps a versioned $label Suite serial without acquiring the Chromium worker pool', async ({ browser, headless }) => {
    const newContext = vi.fn();
    const browserPool = new BrowserPool({
      capacity: 2,
      createBrowser: async () => ({ newContext }),
    });
    const bundle = createRuntimeBundle({
      rootDir: `/tmp/testbuddy-runtime-bundle-ineligible-${browser}-${headless}`,
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      browserPool,
    });
    const project = createEmptyProject(1);
    const environment = { ...project.environments[0]!, browser, headless };
    project.environments = [environment];
    const members = [1, 2].map((seed) => ({
      ...createEmptyTestCase(seed, project.groups[0]!.id, environment.id),
      id: `case-ineligible-worker-${browser}-${headless}-${seed}`,
      version: 1,
      steps: [],
    }));
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: `suite-ineligible-worker-${browser}-${headless}`,
      environmentId: environment.id,
      caseReferences: members.map((testCase) => ({ id: testCase.id, version: testCase.version!, dependsOn: [] })),
      execution: { concurrency: 8, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    const runtimeProject = { ...project, testCases: members, suites: [suite] };
    vi.spyOn(bundle.testRunner, 'run').mockImplementation(async ({ runId, testCase }) => ({
      runId: runId!,
      title: testCase.name,
      detail: {
        id: runId!, projectId: runtimeProject.id, testCaseId: testCase.id, environmentId: environment.id,
        title: testCase.name, status: 'passed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(),
        duration: '00:00:00', summary: 'Passed', logs: [], steps: [], artifacts: [],
      },
    }));

    try {
      const response = await bundle.runSuite({
        projectSnapshot: {
          project: runtimeProject,
          revision: 'c'.repeat(64),
          source: 'projectDirectory',
          reproducibility: 'versioned',
        },
        suite,
        environment,
      });

      expect(response.detail.suite.effectiveConcurrency).toBe(1);
      expect(newContext).not.toHaveBeenCalled();
    } finally {
      await bundle.close();
    }
  });

  it('uses isolated pool workers only for a versioned Suite and reports the pool-capped concurrency', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue('worker page'),
      url: vi.fn(() => 'http://worker.test'),
      screenshot: vi.fn().mockRejectedValue(new Error('test screenshot unavailable')),
      on: vi.fn(),
    };
    const contexts = Array.from({ length: 3 }, () => ({
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    const availableContexts = [...contexts];
    const newContext = vi.fn(async () => availableContexts.shift()!);
    const browserPool = new BrowserPool({
      capacity: 2,
      createBrowser: async () => ({ newContext }),
    });
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-versioned-suite-pool',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      browserPool,
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const members = [1, 2, 3].map((seed) => ({
      ...createEmptyTestCase(seed, project.groups[0]!.id, environment.id),
      id: `case-versioned-worker-${seed}`,
      version: 1,
      steps: [{ id: `step-versioned-worker-${seed}`, type: 'manual' as const, title: 'Manual', body: 'Manual.' }],
    }));
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-versioned-worker',
      environmentId: environment.id,
      caseReferences: members.map((testCase) => ({ id: testCase.id, version: testCase.version!, dependsOn: [] })),
      execution: { concurrency: 8, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    const runtimeProject = { ...project, testCases: members, suites: [suite] };

    try {
      const response = await bundle.runSuite({
        projectSnapshot: {
          project: runtimeProject,
          revision: 'a'.repeat(64),
          source: 'projectDirectory',
          reproducibility: 'versioned',
        },
        suite,
        environment,
      });

      expect(response.detail.suite.effectiveConcurrency).toBe(2);
      expect(response.detail.caseDetails).toHaveLength(3);
      expect(newContext).toHaveBeenCalledTimes(3);
      contexts.forEach((context) => expect(context.close).toHaveBeenCalledOnce());
      expect(browserPool.activeLeaseCount).toBe(0);
      expect(bundle.browserRuntime.getState().status).toBe('idle');
    } finally {
      await bundle.close();
    }
  });

  it('keeps a worker lease open until its asynchronous Case runner settles', async () => {
    let resolvePage: ((page: typeof page) => void) | undefined;
    const pageReady = new Promise<typeof page>((resolve) => {
      resolvePage = resolve;
    });
    let markNewPageCalled: (() => void) | undefined;
    const newPageCalled = new Promise<void>((resolve) => {
      markNewPageCalled = resolve;
    });
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue('worker page'),
      url: vi.fn(() => 'http://worker.test'),
      screenshot: vi.fn().mockRejectedValue(new Error('test screenshot unavailable')),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = {
      newPage: vi.fn(async () => {
        markNewPageCalled?.();
        return pageReady;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browserPool = new BrowserPool({
      createBrowser: async () => ({ newContext: vi.fn().mockResolvedValue(context) }),
    });
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-worker-lease-lifetime',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
      browserPool,
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-worker-lease-lifetime',
      version: 1,
      name: 'Worker lifetime fixture',
      description: '',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [environment.id],
      setup: {
        mode: 'http' as const,
        summary: 'Set up worker data.',
        http: { method: 'POST' as const, path: '/api/worker-lifetime', expectedStatuses: [201] },
      },
      cleanup: {
        mode: 'http' as const,
        summary: 'Clean up worker data.',
        http: { method: 'DELETE' as const, path: '/api/worker-lifetime', expectedStatuses: [204] },
      },
      concurrency: 'parallel' as const,
      resourceLocks: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-worker-lease-lifetime',
      version: 1,
      steps: [{ id: 'step-worker-lease-lifetime', type: 'manual' as const, title: 'Manual', body: 'Manual.' }],
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-worker-lease-lifetime',
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version!, dependsOn: [] }],
      execution: { concurrency: 1, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    const runtimeProject = { ...project, fixtures: [fixture], testCases: [testCase], suites: [suite] };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
      new Response('', { status: init?.method === 'DELETE' ? 204 : 201 }),
    ));

    try {
      const running = bundle.runSuite({
        projectSnapshot: {
          project: runtimeProject,
          revision: 'c'.repeat(64),
          source: 'projectDirectory',
          reproducibility: 'versioned',
        },
        suite,
        environment,
      });

      await newPageCalled;
      expect(context.close).not.toHaveBeenCalled();

      resolvePage?.(page);
      await running;

      expect(context.close).toHaveBeenCalledOnce();
      expect(browserPool.activeLeaseCount).toBe(0);
    } finally {
      resolvePage?.(page);
      vi.unstubAllGlobals();
      await bundle.close();
    }
  });

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

  it('emits each completed Suite Case detail with its exact Case version', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-suite-progress',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-suite-progress',
      version: 2,
      steps: [{ id: 'step-suite-progress', type: 'manual' as const, title: 'Confirm progress', body: 'Confirm progress.' }],
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-progress',
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
      execution: { concurrency: 1, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    project.testCases = [testCase];
    project.suites = [suite];
    vi.spyOn(bundle.testRunner, 'run').mockResolvedValue({
      runId: 'suite-progress-member-run',
      title: testCase.name,
      detail: {
        id: 'suite-progress-member-run',
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
    } satisfies RunTestCaseResponse);
    const onCaseCompleted = vi.fn();

    await bundle.runSuite({
      runId: 'suite-progress-run',
      projectSnapshot: projectSnapshot(project),
      suite,
      environment,
      onCaseCompleted,
    });

    expect(onCaseCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'suite-progress-member-run',
        testCaseId: testCase.id,
        testCaseVersion: testCase.version,
        status: 'passed',
      }),
      1,
    );
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

  it('does not resolve model secrets before executing a deterministic Suite member', async () => {
    const bundle = createRuntimeBundle({
      rootDir: '/tmp/testbuddy-runtime-bundle-suite-deterministic-models',
      visualDiffImageAdapter: { read: vi.fn(), write: vi.fn() },
    });
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-suite-deterministic-no-models',
      version: 1,
      steps: [{ id: 'step-suite-deterministic', type: 'manual' as const, title: 'Check result', body: 'Verify output.' }],
    };
    project.testCases = [testCase];
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-deterministic-no-models',
      caseReferences: [{ id: testCase.id, version: testCase.version, dependsOn: [] }],
    };
    project.suites = [suite];
    const resolveModelConfigs = vi.fn().mockRejectedValue(new Error('dangling model secret must stay unread'));
    const run = vi.spyOn(bundle.testRunner, 'run').mockResolvedValue({
      runId: 'suite-deterministic-member-run',
      title: testCase.name,
      detail: {
        id: 'suite-deterministic-member-run',
        projectId: project.id,
        testCaseId: testCase.id,
        environmentId: environment.id,
        title: testCase.name,
        status: 'passed',
        startedAt: new Date(0).toISOString(),
        endedAt: new Date(0).toISOString(),
        duration: '00:00:00',
        summary: 'Passed',
        logs: [],
        steps: [],
        artifacts: [],
      },
    });

    const response = await bundle.runSuite({
      runId: 'suite-deterministic-no-models-run',
      projectSnapshot: projectSnapshot(project),
      suite,
      environment,
      resolveModelConfigs,
    });

    expect(response.detail.suite.status).toBe('passed');
    expect(run).toHaveBeenCalledOnce();
    expect(resolveModelConfigs).not.toHaveBeenCalled();
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
