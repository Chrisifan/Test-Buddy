import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptySuiteAsset,
  createEmptyTestCase,
  type ChatCommandRequest,
  type DesktopApi,
} from '../../shared/studio.js';
import * as runtime from './runtime.js';

const {
  inspectProjectAssetBinding,
  planProjectAssetMigration,
  planProjectAssetReload,
  planProjectAssetUpdate,
  reloadProjectAssetSnapshot,
  runRecording,
  runSuite,
  runTestCase,
  runWorkflow,
  saveModelSecret,
  selectProjectAssetDirectory,
  sendChatCommand,
  testMidsceneConnection,
  clearModelSecret,
  confirmArtifactRetention,
  planArtifactRetention,
  canReviewMaintenanceDrafts,
  listMaintenanceDrafts,
  createMaintenanceDraft,
  acceptMaintenanceDraft,
  rejectMaintenanceDraft,
  updateProjectAssetSnapshot,
  writeProjectAssetSnapshot,
} = runtime;

const openMaintenanceEvidence = (runtime as unknown as {
  openMaintenanceEvidence: (request: {
    draftId: string;
    citation: { runId: string; artifactId: string; contentHash: string };
  }) => Promise<void>;
}).openMaintenanceEvidence;

const request: ChatCommandRequest = {
  mode: 'ai',
  prompt: '点击登录按钮',
  targetEnvironment: 'staging',
  deepThink: true,
  deepLocate: true,
  runtimeProfile: {
    browser: 'chromium',
    baseUrl: 'https://example.test',
    viewport: 'desktop',
    locale: 'zh-CN',
    headless: false,
  },
};

describe('browser fallback agent runtime', () => {
  it('does not expose maintenance review capability without the desktop bridge', () => {
    const originalDesktopApi = window.desktopApi;
    window.desktopApi = undefined;

    try {
      expect(canReviewMaintenanceDrafts()).toBe(false);
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('requires controlled evidence opening before enabling maintenance review', () => {
    const originalDesktopApi = window.desktopApi;
    window.desktopApi = {
      acceptMaintenanceDraft: vi.fn(),
      rejectMaintenanceDraft: vi.fn(),
    } as unknown as DesktopApi;

    try {
      expect(canReviewMaintenanceDrafts()).toBe(false);
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('keeps maintenance review operations on the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const candidate = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
    };
    const request = {
      runId: 'run-login',
      target: { kind: 'case' as const, id: 'case-login', version: 1 },
      proposedCase: candidate,
      citations: [{ artifactId: 'artifact-login', contentHash: 'a'.repeat(64) }],
    };
    const draft = { id: 'maintenance-login', status: 'draft' as const };
    const openMaintenanceEvidenceMock = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      listMaintenanceDrafts: vi.fn().mockResolvedValue([draft]),
      createMaintenanceDraft: vi.fn().mockResolvedValue(draft),
      acceptMaintenanceDraft: vi.fn().mockResolvedValue({ status: 'accepted', draft, published: { id: 'case-login', version: 2 } }),
      rejectMaintenanceDraft: vi.fn().mockResolvedValue({ ...draft, status: 'rejected' }),
      openMaintenanceEvidence: openMaintenanceEvidenceMock,
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      await expect(listMaintenanceDrafts()).resolves.toEqual([draft]);
      await expect(createMaintenanceDraft(request)).resolves.toBe(draft);
      await expect(acceptMaintenanceDraft({ draftId: draft.id, expectedRevision: 'b'.repeat(64) })).resolves.toMatchObject({ status: 'accepted' });
      await expect(rejectMaintenanceDraft({
        draftId: draft.id,
        rationale: 'The cited failure does not reproduce in the pinned environment.',
      } as never)).resolves.toMatchObject({ status: 'rejected' });
      await expect(openMaintenanceEvidence({
        draftId: draft.id,
        citation: { runId: 'run-login', artifactId: 'artifact-login', contentHash: 'a'.repeat(64) },
      })).resolves.toBeUndefined();

      expect(desktopApi.listMaintenanceDrafts).toHaveBeenCalledWith();
      expect(desktopApi.createMaintenanceDraft).toHaveBeenCalledWith(request);
      expect(desktopApi.acceptMaintenanceDraft).toHaveBeenCalledWith({ draftId: draft.id, expectedRevision: 'b'.repeat(64) });
      expect(desktopApi.rejectMaintenanceDraft).toHaveBeenCalledWith({
        draftId: draft.id,
        rationale: 'The cited failure does not reproduce in the pinned environment.',
      });
      expect(openMaintenanceEvidenceMock).toHaveBeenCalledWith({
        draftId: draft.id,
        citation: { runId: 'run-login', artifactId: 'artifact-login', contentHash: 'a'.repeat(64) },
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('requires only the desktop maintenance operation being invoked', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = {
      acceptMaintenanceDraft: vi.fn().mockResolvedValue({
        status: 'stale',
        draft: { id: 'maintenance-login', status: 'stale' },
      }),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      await expect(acceptMaintenanceDraft({
        draftId: 'maintenance-login',
        expectedRevision: 'a'.repeat(64),
      })).resolves.toMatchObject({ status: 'stale' });
      expect(desktopApi.acceptMaintenanceDraft).toHaveBeenCalledOnce();
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('forwards retention review and explicit confirmation only through the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = {
      planArtifactRetention: vi.fn().mockResolvedValue({ id: 'retention-1', entries: [] }),
      confirmArtifactRetention: vi.fn().mockResolvedValue({ planId: 'retention-1', deleted: [] }),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;
    await expect(planArtifactRetention()).resolves.toEqual({ id: 'retention-1', entries: [] });
    await expect(confirmArtifactRetention('retention-1')).resolves.toEqual({ planId: 'retention-1', deleted: [] });
    expect(desktopApi.planArtifactRetention).toHaveBeenCalledWith();
    expect(desktopApi.confirmArtifactRetention).toHaveBeenCalledWith('retention-1');
    window.desktopApi = originalDesktopApi;
  });

  it('blocks exact Suite members in stable order when the desktop bridge is unavailable', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const first = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-fallback-first',
      version: 1,
      steps: [{ id: 'step-first', type: 'manual' as const, title: '确认首页', body: '确认首页状态。' }],
    };
    const second = {
      ...createEmptyTestCase(2, project.groups[0]!.id, environment.id),
      id: 'case-fallback-second',
      version: 1,
      steps: [{ id: 'step-second', type: 'manual' as const, title: '确认订单', body: '确认订单状态。' }],
    };
    project.testCases = [first, second];
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-fallback',
      name: 'Fallback Suite',
      caseReferences: [
        { id: second.id, version: second.version!, dependsOn: [{ id: first.id, version: first.version! }] },
        { id: first.id, version: first.version!, dependsOn: [] },
      ],
    };
    project.suites = [suite];

    const response = await runSuite({
      runId: 'suite-run-fallback',
      project,
      suite: { id: suite.id, version: suite.version },
    });

    expect(response.detail.suite).toMatchObject({
      suiteId: suite.id,
      suiteVersion: suite.version,
      status: 'blocked',
      reason: { code: 'unsupportedAction' },
      effectiveConcurrency: 1,
      results: [
        { testCaseId: first.id, status: 'blocked', reason: { code: 'unsupportedAction' } },
        { testCaseId: second.id, status: 'blocked', reason: { code: 'unsupportedAction' } },
      ],
    });
    expect(response.detail.caseDetails.map((detail) => detail.testCaseId)).toEqual([first.id, second.id]);
    expect(response.runId).toBe('suite-run-fallback');
    expect(response.detail.caseDetails.map((detail) => detail.id)).toEqual([
      'suite-run-fallback-case-fallback-first-attempt-1',
      'suite-run-fallback-case-fallback-second-attempt-1',
    ]);
  });

  it('blocks a missing Suite version before browser fallback execution', async () => {
    const project = createEmptyProject(1);

    const response = await runSuite({
      runId: 'suite-run-missing',
      project,
      suite: { id: 'suite-missing', version: 2 },
    });

    expect(response.detail.suite).toMatchObject({
      status: 'blocked',
      reason: { code: 'missingAssetVersion' },
      results: [],
    });
  });

  it('blocks an unresolved Suite Case reference before browser fallback execution', async () => {
    const project = createEmptyProject(1);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-unresolved',
      caseReferences: [{ id: 'case-missing', version: 2, dependsOn: [] }],
    };
    project.suites = [suite];

    const response = await runSuite({
      runId: 'suite-run-unresolved',
      project,
      suite: { id: suite.id, version: suite.version },
    });

    expect(response.detail.suite).toMatchObject({
      status: 'blocked',
      reason: { code: 'missingAssetVersion' },
      results: [],
    });
  });

  it('delegates an exact Suite intent rather than renderer-owned project state to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const request = {
      project,
      expectedProjectRevision: 'a'.repeat(64),
      suite: {
        ...createEmptySuiteAsset(project, 1),
        id: 'suite-release',
        version: 2,
        name: 'Mutable renderer Suite',
        caseReferences: [{ id: 'case-login', version: 1, dependsOn: [] }],
        execution: { concurrency: 4, failurePolicy: 'continue' as const, retryLimit: 2 },
      },
    };
    const response = { runId: 'suite-run-1', title: '发布回归', detail: { suite: {}, caseDetails: [] } };
    const desktopApi = { runSuite: vi.fn().mockResolvedValue(response) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      await expect(runSuite(request)).resolves.toBe(response);
      expect(desktopApi.runSuite).toHaveBeenCalledWith({
        projectId: project.id,
        suite: { id: 'suite-release', version: 2 },
        expectedProjectRevision: 'a'.repeat(64),
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('delegates the exact Case revision rather than a mutable Case draft to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-login',
      version: 2,
    };
    project.testCases = [testCase];
    const response = { runId: 'run-login', title: testCase.name, detail: {} };
    const desktopApi = { runTestCase: vi.fn().mockResolvedValue(response) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      await expect(runTestCase({
        project,
        environment,
        testCase,
        runId: 'run-login',
        expectedProjectRevision: 'a'.repeat(64),
      })).resolves.toBe(response);
      expect(desktopApi.runTestCase).toHaveBeenCalledWith({
        projectId: project.id,
        testCase: { id: 'case-login', version: 2 },
        runId: 'run-login',
        expectedProjectRevision: 'a'.repeat(64),
      });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('blocks a missing Case version before browser fallback execution', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const missingCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-missing',
      version: 2,
    };

    const response = await runTestCase({
      project,
      environment,
      testCase: missingCase,
    });

    expect(response.detail).toMatchObject({
      status: 'blocked',
      reason: { code: 'missingAssetVersion' },
      steps: [],
    });
  });

  it('keeps semantic actions neutral when no Midscene runtime is connected', async () => {
    const response = await sendChatCommand(request);

    expect(response.agentRun?.status).toBe('neutral');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '等待 Midscene 语义定位',
    );
  });

  it('keeps parsed selectors neutral when the browser fallback cannot execute them', async () => {
    const response = await sendChatCommand({ ...request, prompt: '点击 #login-button' });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.events.find((event) => event.type === 'agent:assertion-result')?.message).toContain(
      '浏览器 fallback 模式未执行页面动作',
    );
  });

  it('preserves the source group and environment in fallback natural-language runs', async () => {
    const response = await sendChatCommand({
      ...request,
      projectId: 'project-orders',
      groupId: 'group-orders',
      environmentId: 'env-staging',
    });

    expect(response.agentRun.intent).toMatchObject({
      projectId: 'project-orders',
      groupId: 'group-orders',
      environmentId: 'env-staging',
    });
  });

  it('persists browser fallback workflow runs as blocked instead of simulating a pass', async () => {
    const response = await runWorkflow({
      workflow: {
        id: 'workflow-login',
        kind: 'scenario',
        name: '登录流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: 'https://example.test/login',
        notes: '',
        steps: [{ id: 'step-click', type: 'ai', title: '点击登录', body: '点击登录按钮' }],
      },
      targetEnvironment: 'local',
      runtimeProfile: request.runtimeProfile,
    });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail).toMatchObject({
      status: 'blocked',
      reason: { code: 'unsupportedAction' },
      steps: [{ status: 'blocked' }],
    });
    expect(response.detail.agentRun).toBe(response.agentRun);
    expect(response.detail.summary).toContain('等待完成执行');
  });

  it('routes Agent-only test cases through the workflow runtime with canonical PRD provenance', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const testCase = {
      id: 'case-agent-only',
      version: 1,
      kind: 'scenario' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      source: 'prd' as const,
      provenance: [{ kind: 'prdPath' as const, documentId: 'doc-login', pathId: 'path-login' }],
      name: '登录验证',
      category: '核心链路',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '',
      steps: [{ id: 'step-assert', type: 'aiAssert' as const, title: '验证登录', body: '断言页面包含 登录成功' }],
    };
    project.testCases = [testCase];
    const response = await runTestCase({
      project,
      environment,
      runtimeProfile: request.runtimeProfile,
      testCase,
    });

    expect(response.detail).toMatchObject({
      status: 'blocked',
      reason: { code: 'unsupportedAction' },
    });
    expect(response.detail.documentId).toBe('doc-login');
    expect(response.detail.agentRun?.intent.source).toBe('workflow');
    expect(response.detail.agentRun?.intent.documentId).toBe('doc-login');
    expect(response.detail.steps[0]?.message).toContain('等待桌面 Agent runtime 执行');
  });

  it('preserves a supplied Suite member run id through browser fallback Agent and recording routes', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const recording = {
      id: 'recording-suite-route',
      name: 'Suite 回放',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [],
    };
    project.recordings = [recording];
    const agentCase = {
      id: 'case-agent',
      version: 1,
      kind: 'scenario' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      name: 'Agent Case',
      category: '',
      lastEdited: '',
      url: environment.url,
      notes: '',
      steps: [{ id: 'step-agent', type: 'ai' as const, title: '检查', body: '检查页面' }],
    };
    const recordingCase = {
      id: 'case-recording',
      version: 1,
      kind: 'recording' as const,
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'recording' as const,
      name: 'Recording Case',
      category: '',
      lastEdited: '',
      url: environment.url,
      notes: '',
      steps: [{ id: 'step-recording', type: 'recordingReplay' as const, title: '回放', body: '回放', recordingId: recording.id }],
    };
    project.testCases = [agentCase, recordingCase];

    const agentResponse = await runTestCase({
      runId: 'suite-run-fallback-case-agent-attempt-1',
      project,
      environment,
      testCase: agentCase,
    });
    const recordingResponse = await runTestCase({
      runId: 'suite-run-fallback-case-recording-attempt-1',
      project,
      environment,
      testCase: recordingCase,
    });

    expect(agentResponse.runId).toBe('suite-run-fallback-case-agent-attempt-1');
    expect(agentResponse.detail.agentRun?.intent.source).toBe('workflow');
    expect(recordingResponse.runId).toBe('suite-run-fallback-case-recording-attempt-1');
    expect(recordingResponse.detail.agentRun?.intent.source).toBe('recording');
  });

  it('blocks non-Agent test cases when desktop execution is unavailable', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const testCase = {
      id: 'case-manual',
      version: 1,
      kind: 'scenario' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      source: 'manual' as const,
      name: '人工检查',
      category: '核心链路',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '',
      steps: [{ id: 'step-manual', type: 'manual' as const, title: '确认页面', body: '人工确认状态' }],
    };
    project.testCases = [testCase];
    const response = await runTestCase({
      project,
      environment,
      testCase,
    });

    expect(response.detail).toMatchObject({
      status: 'blocked',
      reason: { code: 'unsupportedAction' },
    });
    expect(response.detail.steps[0]?.status).toBe('blocked');
    expect(response.detail.summary).toContain('未执行');
  });

  it('routes an exclusive recording replay test case through the recording Agent', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const recording = {
      id: 'recording-case-route',
      name: '登录回放',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [],
    };
    project.recordings = [recording];
    const testCase = {
      id: 'case-recording-route',
      version: 1,
      kind: 'recording' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      source: 'recording' as const,
      name: '登录回放用例',
      category: '核心链路',
      lastEdited: '刚刚',
      url: environment.url,
      notes: '',
      steps: [{ id: 'step-replay', type: 'recordingReplay' as const, title: '回放录制', body: '回放', recordingId: recording.id }],
    };
    project.testCases = [testCase];

    const response = await runTestCase({
      project,
      environment,
      testCase,
    });

    expect(response.detail.testCaseId).toBe('case-recording-route');
    expect(response.detail.agentRun?.intent.source).toBe('recording');
    expect(response.detail.agentRun?.intent.testCaseId).toBe('case-recording-route');
  });

  it('persists a blocked recording plan when desktop replay is unavailable', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const recording = {
      id: 'recording-fallback',
      name: 'Fallback 回放',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '页面与基线一致',
      tags: [],
      prdPath: { documentId: 'doc-recording', pathId: 'path-recording' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [],
    };

    const response = await runRecording({ project, environment, recording });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.intent.documentId).toBe('doc-recording');
    expect(response.detail.documentId).toBe('doc-recording');
    expect(response.detail).toMatchObject({
      status: 'blocked',
      reason: { code: 'unsupportedAction' },
      steps: [],
    });
    expect(response.detail.agentRun).toBe(response.agentRun);
  });

  it('delegates artifact opening to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = { openArtifact: vi.fn().mockResolvedValue(undefined) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await runtime.openArtifact('/tmp/playtest-artifacts/agent-run-1-reporter.html');

    expect(desktopApi.openArtifact).toHaveBeenCalledWith('/tmp/playtest-artifacts/agent-run-1-reporter.html');
    window.desktopApi = originalDesktopApi;
  });

  it('delegates artifact export to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = { exportArtifact: vi.fn().mockResolvedValue(true) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(runtime.exportArtifact('/tmp/playtest-artifacts/agent-run-1-reporter.html')).resolves.toBe(true);

    expect(desktopApi.exportArtifact).toHaveBeenCalledWith('/tmp/playtest-artifacts/agent-run-1-reporter.html');
    window.desktopApi = originalDesktopApi;
  });

  it('delegates project report export to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = { exportProjectReport: vi.fn().mockResolvedValue(true) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(runtime.exportProjectReport({ projectId: 'project-1', locale: 'zh-CN' })).resolves.toBe(true);

    expect(desktopApi.exportProjectReport).toHaveBeenCalledWith({ projectId: 'project-1', locale: 'zh-CN' });
    window.desktopApi = originalDesktopApi;
  });

  it('delegates the reviewed project asset snapshot flow to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const request = { projectId: 'project-orders', projectDirectory: '/tmp/orders-assets' };
    const plan = {
      ...request,
      snapshotRevision: 'a'.repeat(64),
      files: ['project.json', 'cases/case-orders.json'],
      status: 'ready' as const,
      conflicts: [],
    };
    const binding = {
      projectId: request.projectId,
      projectDirectory: request.projectDirectory,
      revision: 'a'.repeat(64),
      boundAt: '2026-08-11T00:00:00.000Z',
    };
    const bindingStatus = {
      projectId: request.projectId,
      projectDirectory: request.projectDirectory,
      state: 'inSync' as const,
      issues: [],
    };
    const reloadPlan = {
      projectId: request.projectId,
      projectDirectory: request.projectDirectory,
      snapshotRevision: 'b'.repeat(64),
      status: 'ready' as const,
      issues: [],
    };
    const reloadedProject = createEmptyProject(1);
    reloadedProject.id = request.projectId;
    const reloadResult = {
      project: reloadedProject,
      binding: { ...binding, revision: reloadPlan.snapshotRevision },
    };
    const reloadRequest = {
      projectId: request.projectId,
      project: reloadedProject,
      snapshotRevision: reloadPlan.snapshotRevision,
    };
    const updatePlan = {
      projectId: request.projectId,
      projectDirectory: request.projectDirectory,
      publishedRevision: binding.revision,
      snapshotRevision: 'c'.repeat(64),
      files: ['project.json', 'cases/case-orders.json'],
      status: 'ready' as const,
      issues: [],
    };
    const updateRequest = {
      projectId: request.projectId,
      project: reloadedProject,
      expectedRevision: binding.revision,
      plannedRevision: updatePlan.snapshotRevision,
    };
    const desktopApi = {
      selectProjectAssetDirectory: vi.fn().mockResolvedValue(request.projectDirectory),
      planProjectAssetMigration: vi.fn().mockResolvedValue(plan),
      writeProjectAssetSnapshot: vi.fn().mockResolvedValue(binding),
      inspectProjectAssetBinding: vi.fn().mockResolvedValue(bindingStatus),
      planProjectAssetReload: vi.fn().mockResolvedValue(reloadPlan),
      reloadProjectAssetSnapshot: vi.fn().mockResolvedValue(reloadResult),
      planProjectAssetUpdate: vi.fn().mockResolvedValue(updatePlan),
      updateProjectAssetSnapshot: vi.fn().mockResolvedValue({ ...binding, revision: updatePlan.snapshotRevision }),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(selectProjectAssetDirectory()).resolves.toBe(request.projectDirectory);
    await expect(planProjectAssetMigration(request)).resolves.toEqual(plan);
    await expect(writeProjectAssetSnapshot(request)).resolves.toEqual(binding);
    await expect(inspectProjectAssetBinding(request.projectId)).resolves.toEqual(bindingStatus);
    await expect(planProjectAssetReload({ projectId: request.projectId, project: reloadedProject })).resolves.toEqual(reloadPlan);
    await expect(reloadProjectAssetSnapshot(reloadRequest)).resolves.toEqual(reloadResult);
    await expect(planProjectAssetUpdate({ projectId: request.projectId, project: reloadedProject, expectedRevision: binding.revision })).resolves.toEqual(updatePlan);
    await expect(updateProjectAssetSnapshot(updateRequest)).resolves.toEqual({ ...binding, revision: updatePlan.snapshotRevision });

    expect(desktopApi.selectProjectAssetDirectory).toHaveBeenCalledOnce();
    expect(desktopApi.planProjectAssetMigration).toHaveBeenCalledWith(request);
    expect(desktopApi.writeProjectAssetSnapshot).toHaveBeenCalledWith(request);
    expect(desktopApi.inspectProjectAssetBinding).toHaveBeenCalledWith(request.projectId);
    expect(desktopApi.planProjectAssetReload).toHaveBeenCalledWith({ projectId: request.projectId, project: reloadedProject });
    expect(desktopApi.reloadProjectAssetSnapshot).toHaveBeenCalledWith(reloadRequest);
    expect(desktopApi.planProjectAssetUpdate).toHaveBeenCalledWith({ projectId: request.projectId, project: reloadedProject, expectedRevision: binding.revision });
    expect(desktopApi.updateProjectAssetSnapshot).toHaveBeenCalledWith(updateRequest);
    window.desktopApi = originalDesktopApi;
  });

  it('delegates cancellation to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = { cancelRun: vi.fn().mockResolvedValue(true) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(runtime.cancelRun('run-active')).resolves.toBe(true);

    expect(desktopApi.cancelRun).toHaveBeenCalledWith('run-active');
    window.desktopApi = originalDesktopApi;
  });

  it('uses the desktop bridge for local fixture script trust records only', async () => {
    const originalDesktopApi = window.desktopApi;
    const trust = {
      fixtureId: 'fixture-seed',
      fixtureVersion: 1,
      lifecycle: 'setup' as const,
      relativePath: 'scripts/seed.mjs',
      contentHash: 'a'.repeat(64),
      approvedAt: '2026-08-11T00:00:00.000Z',
    };
    const desktopApi = {
      listFixtureScriptTrusts: vi.fn().mockResolvedValue([trust]),
      approveFixtureScriptTrust: vi.fn().mockResolvedValue(trust),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(runtime.listFixtureScriptTrusts('project-orders')).resolves.toEqual([trust]);
    await expect(runtime.approveFixtureScriptTrust({
      projectId: 'project-orders',
      fixtureId: trust.fixtureId,
      fixtureVersion: trust.fixtureVersion,
      lifecycle: trust.lifecycle,
    })).resolves.toEqual(trust);

    expect(desktopApi.listFixtureScriptTrusts).toHaveBeenCalledWith('project-orders');
    expect(desktopApi.approveFixtureScriptTrust).toHaveBeenCalledWith({
      projectId: 'project-orders',
      fixtureId: trust.fixtureId,
      fixtureVersion: trust.fixtureVersion,
      lifecycle: trust.lifecycle,
    });
    window.desktopApi = originalDesktopApi;
  });

  it('keeps storageState capture and revocation on the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const reference = {
      id: 'state-staging-admin',
      label: '预发布管理员登录态',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      availability: 'available' as const,
    };
    const desktopApi = {
      captureStorageState: vi.fn().mockResolvedValue(reference),
      revokeStorageState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    try {
      await expect(runtime.captureStorageState({
        projectId: 'project-orders',
        label: reference.label,
        storageStateId: reference.id,
      })).resolves.toEqual(reference);
      await expect(runtime.revokeStorageState({ projectId: 'project-orders', storageStateId: reference.id })).resolves.toBe(true);

      expect(desktopApi.captureStorageState).toHaveBeenCalledWith({
        projectId: 'project-orders',
        label: reference.label,
        storageStateId: reference.id,
      });
      expect(desktopApi.revokeStorageState).toHaveBeenCalledWith({ projectId: 'project-orders', storageStateId: reference.id });
    } finally {
      window.desktopApi = originalDesktopApi;
    }
  });

  it('delegates manual evidence attachment to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const attachment = {
      id: 'artifact-manual-1',
      type: 'attachment' as const,
      label: 'payment-proof.pdf',
      path: '/tmp/playtest-artifacts/manual-1.pdf',
    };
    const desktopApi = { attachManualEvidence: vi.fn().mockResolvedValue(attachment) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(runtime.attachManualEvidence()).resolves.toEqual(attachment);

    expect(desktopApi.attachManualEvidence).toHaveBeenCalledOnce();
    window.desktopApi = originalDesktopApi;
  });

  it('delegates the MidScene connection probe to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const result = { status: 'passed' as const, modelName: 'ui-agent-model', durationMs: 42 };
    const desktopApi = { testMidsceneConnection: vi.fn().mockResolvedValue(result) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(
      testMidsceneConnection({
        modelBaseUrl: 'https://models.example.test/v1',
        modelSecret: { id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        modelName: 'ui-agent-model',
        modelFamily: 'openai',
        preferredLanguage: 'Chinese',
        replanningCycleLimit: '10',
        openaiHttpProxy: '',
        defaultContext: '',
      }),
    ).resolves.toEqual(result);

    expect(desktopApi.testMidsceneConnection).toHaveBeenCalledOnce();
    window.desktopApi = originalDesktopApi;
  });

  it('uses the desktop bridge for model secret refs without retaining the submitted key', async () => {
    const originalDesktopApi = window.desktopApi;
    const savedReference = { id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' };
    const clearedReference = { id: 'midscene', hasKey: false, updatedAt: '2026-08-17T00:01:00.000Z' };
    const desktopApi = {
      saveModelSecret: vi.fn().mockResolvedValue(savedReference),
      clearModelSecret: vi.fn().mockResolvedValue(clearedReference),
    } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(saveModelSecret({ scope: 'midscene', value: 'sk-runtime-only' })).resolves.toEqual(savedReference);
    await expect(clearModelSecret({ scope: 'midscene' })).resolves.toEqual(clearedReference);

    expect(desktopApi.saveModelSecret).toHaveBeenCalledWith({ scope: 'midscene', value: 'sk-runtime-only' });
    expect(desktopApi.clearModelSecret).toHaveBeenCalledWith({ scope: 'midscene' });
    window.desktopApi = originalDesktopApi;
  });
});
