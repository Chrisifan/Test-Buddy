import { describe, expect, it, vi } from 'vitest';

import {
  copyTestStep,
  createDemoStudioState,
  deriveRunCoverageRisk,
  createPrdDocumentAsset,
  createRecordingFromGeneratedPath,
  createTestStep,
  createTestCaseFromGeneratedPath,
  createEmptyProject,
  createInitialStudioState,
  createManualStepAutomationReplacement,
  createReporterFixDraft,
  getExclusiveRecordingReplayId,
  isRecordingLinkedToGeneratedPath,
  isTestCaseLinkedToGeneratedPath,
  getTestCaseRunBlocker,
  getTestStepRunBlocker,
  hydrateStudioState,
  insertTestStep,
  isAgentRunnableTestCase,
  moveTestStep,
  removeTestStep,
  prunePrdCoverageTriage,
  updatePrdDocumentAnalysis,
} from './studio.js';

describe('studio state hydration', () => {
  it('generates traceable test paths from concrete PRD requirements', () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 240,
      sourceText: `# 成员管理
- 管理员必须能新增成员，并在列表中展示邮箱与状态。
- 系统默认按创建时间倒序排序，支持按状态筛选。
- 删除成员前必须二次确认，取消后不得改变列表。
- 普通成员不能看到删除入口。`,
    });

    expect(document.generatedPaths).toHaveLength(4);
    expect(document.generatedPaths.map((path) => path.sourceExcerpt)).toEqual([
      '成员管理 - 管理员必须能新增成员，并在列表中展示邮箱与状态。',
      '成员管理 - 系统默认按创建时间倒序排序，支持按状态筛选。',
      '成员管理 - 删除成员前必须二次确认，取消后不得改变列表。',
      '成员管理 - 普通成员不能看到删除入口。',
    ]);
    expect(document.generatedPaths.map((path) => path.priority)).toEqual(['P0', 'P1', 'P0', 'P0']);
    expect(document.generatedPaths[0]).toMatchObject({
      groupName: '账号权限',
      title: expect.stringContaining('成员管理：管理员必须能新增成员'),
      steps: [
        expect.objectContaining({ type: 'ai', title: '进入对应功能页面' }),
        expect.objectContaining({ type: 'ai', body: expect.stringContaining('管理员必须能新增成员') }),
        expect.objectContaining({ type: 'aiAssert', body: expect.stringContaining('展示邮箱与状态') }),
      ],
    });
  });

  it('deduplicates repeated PRD clauses and keeps the generic fallback for unstructured text', () => {
    const duplicateDocument = createPrdDocumentAsset({
      name: 'duplicate.md',
      kind: 'markdown',
      size: 160,
      sourceText: `# 订单管理
- 用户必须填写收货地址后才能提交订单。
- 用户必须填写收货地址后才能提交订单。`,
    });
    const inlineDocument = createPrdDocumentAsset({
      name: 'inline-requirements.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 订单列表\n系统支持按状态筛选；系统默认按创建时间倒序排序。',
    });
    const fallbackDocument = createPrdDocumentAsset({
      name: 'overview.txt',
      kind: 'text',
      size: 100,
      sourceText: '这份材料说明本次迭代的整体背景、范围和体验目标，供团队讨论使用。',
    });

    expect(duplicateDocument.generatedPaths).toHaveLength(1);
    expect(duplicateDocument.generatedPaths[0]?.sourceExcerpt).toBe('订单管理 - 用户必须填写收货地址后才能提交订单。');
    expect(inlineDocument.generatedPaths.map((path) => path.sourceExcerpt)).toEqual([
      '订单列表 - 系统支持按状态筛选',
      '订单列表 - 系统默认按创建时间倒序排序。',
    ]);
    expect(fallbackDocument.generatedPaths).toHaveLength(1);
    expect(fallbackDocument.generatedPaths[0]).toMatchObject({ groupName: 'PRD 主路径' });
    expect(fallbackDocument.generatedPaths[0]?.sourceExcerpt).toBeUndefined();
  });

  it('keeps stable PRD path references when assets are renamed or a document is re-analyzed', () => {
    const project = createEmptyProject(1);
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });
    const path = document.generatedPaths[0]!;
    const testCase = createTestCaseFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      url: project.defaultUrl,
      seed: 1,
    });
    const recording = createRecordingFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      startUrl: project.defaultUrl,
      seed: 1,
    });
    const reanalyzedDocument = updatePrdDocumentAnalysis({
      ...document,
      sourceText: '# 成员管理\n- 管理员 必须能新增成员，并在列表中展示邮箱与状态。',
    });
    const reanalyzedPath = reanalyzedDocument.generatedPaths[0]!;

    expect(testCase.prdPath).toEqual({ documentId: document.id, pathId: path.id });
    expect(recording.prdPath).toEqual({ documentId: document.id, pathId: path.id });
    expect(reanalyzedPath.id).toBe(path.id);
    expect(isTestCaseLinkedToGeneratedPath({ ...testCase, name: '已改名用例' }, document.id, reanalyzedPath)).toBe(true);
    expect(isRecordingLinkedToGeneratedPath({ ...recording, name: '已改名录制' }, document.id, reanalyzedPath)).toBe(true);
    expect(isTestCaseLinkedToGeneratedPath({ ...testCase, prdPath: undefined }, document.id, path)).toBe(true);
    expect(isRecordingLinkedToGeneratedPath({ ...recording, prdPath: undefined }, document.id, path)).toBe(true);
    expect(isTestCaseLinkedToGeneratedPath(testCase, 'doc-other', reanalyzedPath)).toBe(false);
    expect(isRecordingLinkedToGeneratedPath(recording, 'doc-other', reanalyzedPath)).toBe(false);
  });

  it('starts with an empty workspace and removes the legacy demo workspace during hydration', () => {
    const initialState = createInitialStudioState();
    const hydrated = hydrateStudioState(createDemoStudioState());

    expect(initialState.projects).toEqual([]);
    expect(initialState.recentRuns).toEqual([]);
    expect(initialState.chatEntries).toEqual([]);
    expect(hydrated.projects).toEqual([]);
    expect(hydrated.recentRuns).toEqual([]);
    expect(hydrated.chatEntries).toEqual([]);
    expect(hydrated.selectedProjectId).toBe('');
  });

  it('keeps persisted user projects while removing only the legacy demo workspace', () => {
    const userProject = { ...createEmptyProject(1), id: 'project-user' };
    const legacyState = createDemoStudioState();
    const hydrated = hydrateStudioState({
      ...legacyState,
      projects: [legacyState.projects[0]!, userProject],
      selectedProjectId: 'project-demo',
    });

    expect(hydrated.projects.map((project) => project.id)).toEqual(['project-user']);
    expect(hydrated.selectedProjectId).toBe('project-user');
  });

  it('prunes invalid PRD triage records while preserving valid local governance notes', () => {
    const project = createEmptyProject(1);
    const document = createPrdDocumentAsset({
      name: 'member-management.md', kind: 'markdown', size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。',
    });
    const path = document.generatedPaths[0]!;
    const triage = prunePrdCoverageTriage([document], [
      { documentId: document.id, pathId: path.id, target: 'case', status: 'deferred', note: '等待接口稳定', updatedAt: '2026-08-04T00:00:00.000Z' },
      { documentId: document.id, pathId: path.id, target: 'recording', status: 'ignored', note: ' ', updatedAt: '2026-08-04T00:00:00.000Z' },
      { documentId: document.id, pathId: 'removed-path', target: 'case', status: 'ignored', note: '已移除', updatedAt: '2026-08-04T00:00:00.000Z' },
    ]);

    expect(triage).toEqual([
      expect.objectContaining({ documentId: document.id, pathId: path.id, target: 'case', status: 'deferred' }),
    ]);
    expect(prunePrdCoverageTriage([{ ...document, generatedPaths: [] }], triage)).toEqual([]);
    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [{ ...project, documents: [document], prdCoverageTriage: [...triage, {
        documentId: document.id,
        pathId: 'stale-path',
        target: 'recording',
        status: 'ignored',
        note: '已删除',
        updatedAt: '2026-08-04T00:00:00.000Z',
      }] }],
      selectedProjectId: project.id,
    });
    expect(hydrated.projects[0]?.prdCoverageTriage).toEqual(triage);
    expect(project.prdCoverageTriage).toEqual([]);
  });

  it('derives cross-run risk from complete project history without allowing running records to replace a terminal result', () => {
    const demoProject = createDemoStudioState().projects[0]!;
    const unrunCase = { ...demoProject.testCases[0]!, id: 'case-never-executed', name: '从未执行用例' };
    const project = { ...demoProject, testCases: [...demoProject.testCases, unrunCase] };
    const [verifiedCase, waitingCase, failedCase] = project.testCases;
    const environmentId = project.environments[0]!.id;
    const makeRun = (id: string, testCaseId: string, status: 'passed' | 'failed' | 'neutral' | 'running', startedAt?: string) => ({
      id, name: id, status, duration: '00:00:01', summary: id, projectId: project.id, testCaseId, environmentId,
      ...(startedAt ? { startedAt } : {}),
    });
    const risk = deriveRunCoverageRisk(project, [
      makeRun('waiting-newest', waitingCase!.id, 'neutral'),
      makeRun('waiting-old', waitingCase!.id, 'failed'),
      makeRun('failed-terminal', failedCase!.id, 'failed', '2026-08-02T00:00:00.000Z'),
      makeRun('failed-running', failedCase!.id, 'running', '2026-08-03T00:00:00.000Z'),
      makeRun('verified-passed', verifiedCase!.id, 'passed', '2026-08-03T00:00:00.000Z'),
      makeRun('verified-old-failed', verifiedCase!.id, 'failed', '2026-08-02T00:00:00.000Z'),
    ]);

    expect(risk).toMatchObject({ total: project.testCases.length, verified: 1 });
    expect(risk.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ testCaseId: waitingCase!.id, status: 'neutral' }),
      expect.objectContaining({ testCaseId: failedCase!.id, status: 'failed', latestRun: expect.objectContaining({ id: 'failed-terminal' }) }),
      expect.objectContaining({ testCaseId: unrunCase.id, status: 'neverExecuted' }),
    ]));
  });

  it('resets persisted browser sessions because they cannot survive an app restart', () => {
    const project = createEmptyProject(1);
    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [project],
      selectedProjectId: project.id,
      browserSession: {
        id: 'session-stale',
        status: 'error',
        projectId: project.id,
        environmentId: project.environments[0]!.id,
        currentUrl: project.defaultUrl,
        pageTitle: 'Stale browser',
        message: "浏览器启动失败：browserType.launch: Executable doesn't exist",
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    });

    expect(hydrated.browserSession).toMatchObject({
      id: 'session-idle',
      status: 'idle',
      currentUrl: '',
      pageTitle: '尚未启动浏览器',
      message: '选择项目环境后启动受控浏览器会话。',
    });
  });

  it('normalizes persisted visual diff masks and discards invalid regions', () => {
    const demoState = createDemoStudioState();
    const rawState = {
      ...demoState,
      projects: [{ ...demoState.projects[0]!, id: 'project-user' }],
      selectedProjectId: 'project-user',
    };
    const recording = rawState.projects[0]!.recordings[0]!;
    recording.visualDiffMasks = [
      { id: 'clock', label: '实时钟', x: 95, y: -2, width: 20, height: 30 },
      { id: 'invalid', label: '无效区域', x: Number.NaN, y: 0, width: 10, height: 10 },
      { id: 'empty', label: '空区域', x: 0, y: 0, width: 0, height: 10 },
    ];

    const hydrated = hydrateStudioState(rawState);

    expect(hydrated.projects[0]!.recordings[0]!.visualDiffMasks).toEqual([
      { id: 'clock', label: '实时钟', x: 95, y: 0, width: 5, height: 30 },
    ]);
  });

  it('identifies test cases that can run through the Agent workflow runtime', () => {
    const project = createEmptyProject(1);
    const baseCase = {
      id: 'case-agent',
      kind: 'scenario' as const,
      groupId: project.groups[0].id,
      environmentId: project.environments[0].id,
      source: 'manual' as const,
      name: 'Agent 用例',
      category: '核心链路',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
    };

    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [{ id: 'step-ai', type: 'ai', title: '点击登录', body: '点击登录按钮' }],
      }),
    ).toBe(true);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [{ id: 'step-manual', type: 'manual', title: '人工检查', body: '确认状态' }],
      }),
    ).toBe(false);
  });

  it('recognizes test cases that consist of exactly one recording replay', () => {
    const project = createEmptyProject(1);
    const baseCase = {
      id: 'case-recording',
      kind: 'recording' as const,
      groupId: project.groups[0].id,
      environmentId: project.environments[0].id,
      source: 'recording' as const,
      name: '录制回放用例',
      category: '核心链路',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
    };

    expect(
      getExclusiveRecordingReplayId({
        ...baseCase,
        steps: [{ id: 'replay', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'recording-1' }],
      }),
    ).toBe('recording-1');
    expect(
      getExclusiveRecordingReplayId({
        ...baseCase,
        steps: [
          { id: 'replay', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'recording-1' },
          { id: 'manual', type: 'manual', title: '确认', body: '人工确认' },
        ],
      }),
    ).toBeUndefined();
  });

  it('inserts, moves, copies, and removes serial test steps without mutating the source list', () => {
    const steps = [
      { id: 'step-1', type: 'ai' as const, title: '第一步', body: '执行第一步' },
      { id: 'step-2', type: 'aiAssert' as const, title: '第二步', body: '断言第二步' },
      { id: 'step-3', type: 'manual' as const, title: '第三步', body: '人工确认第三步' },
    ];
    const inserted = insertTestStep(steps, { id: 'step-inserted', type: 'aiQuery', title: '插入步骤', body: '提取数据' }, 1);

    expect(steps.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-3']);
    expect(inserted.map((step) => step.id)).toEqual(['step-1', 'step-inserted', 'step-2', 'step-3']);
    expect(moveTestStep(steps, 'step-1', 3).map((step) => step.id)).toEqual(['step-2', 'step-3', 'step-1']);
    expect(moveTestStep(steps, 'step-3', 0).map((step) => step.id)).toEqual(['step-3', 'step-1', 'step-2']);

    const copied = copyTestStep(steps, 'step-2', 'step-copy');
    expect(copied.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-copy', 'step-3']);
    expect(copied[2]).toMatchObject({ ...steps[1], id: 'step-copy' });
    expect(removeTestStep(copied, 'step-2').map((step) => step.id)).toEqual(['step-1', 'step-copy', 'step-3']);
    expect(moveTestStep(steps, 'missing', 0)).toBe(steps);
    expect(copyTestStep(steps, 'missing', 'step-copy')).toBe(steps);
  });

  it('creates all test step types and reports only run-blocking configuration errors', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const baseCase = project.testCases[0]!;
    const recording = project.recordings[0]!;

    expect(createTestStep('ai', 1).type).toBe('ai');
    expect(createTestStep('aiAssert', 2).type).toBe('aiAssert');
    expect(createTestStep('aiQuery', 3).type).toBe('aiQuery');
    expect(createTestStep('manual', 4)).toMatchObject({ type: 'manual', title: '人工检查步骤' });
    expect(createTestStep('recordingReplay', 5, recording)).toMatchObject({
      type: 'recordingReplay',
      recordingId: recording.id,
    });

    expect(getTestCaseRunBlocker({ ...baseCase, steps: [] }, project.recordings)).toBe('emptySteps');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'blank-title', type: 'ai', title: '  ', body: '执行操作' }] }, project.recordings)).toBe('emptyTitle');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'blank-body', type: 'manual', title: '人工检查', body: '  ' }] }, project.recordings)).toBe('emptyInstruction');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'missing-recording', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'missing' }] }, project.recordings)).toBe('missingRecording');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [createTestStep('recordingReplay', 6, recording)] }, project.recordings)).toBeUndefined();
    expect(getTestStepRunBlocker({ id: 'blank-title', type: 'ai', title: ' ', body: '执行操作' }, project.recordings)).toBe('emptyTitle');
    expect(getTestStepRunBlocker({ id: 'valid', type: 'manual', title: '人工检查', body: '确认状态' }, project.recordings)).toBeUndefined();
  });

  it('converts a manual check into an executable AI assertion without mutating its source step', () => {
    const manualStep = {
      id: 'manual-check',
      type: 'manual' as const,
      title: '确认订单状态',
      body: '订单状态显示为已支付',
    };

    const replacement = createManualStepAutomationReplacement(manualStep);

    expect(replacement).toEqual({
      id: 'manual-check',
      type: 'aiAssert',
      title: '确认订单状态',
      body: '验证：订单状态显示为已支付',
      recordingId: undefined,
    });
    expect(manualStep).toEqual({
      id: 'manual-check',
      type: 'manual',
      title: '确认订单状态',
      body: '订单状态显示为已支付',
    });
  });

  it('creates a review-only recovery draft without turning Reporter text into browser actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T08:00:00.000Z'));
    const source = createDemoStudioState().projects[0]!.testCases[0]!;

    const draft = createReporterFixDraft(
      source,
      {
        failureAnalysis: '页面数据尚未稳定。',
        suggestedFixes: ['增加数据就绪等待', '增加数据就绪等待 ', '检查 /api/orders 响应'],
        recoveryPlan: {
          failedStepId: source.steps[0]!.id,
          strategy: 'waitForDataReady',
          reason: '页面数据尚未稳定。',
        },
      },
      4,
    );

    expect(draft).toMatchObject({
      id: 'case-reporter-1785571200000-4',
      source: 'reporter',
      name: `${source.name} · 修复草稿`,
      notes: expect.stringContaining('页面数据尚未稳定。'),
    });
    expect(draft?.steps.map((step) => step.id)).not.toContain(source.steps[0]?.id);
    expect(draft?.steps).toHaveLength(source.steps.length + 1);
    expect(draft?.steps[0]).toEqual(expect.objectContaining({
      type: 'ai',
      title: '受控恢复：等待数据就绪',
      body: expect.stringContaining('不要点击、输入、选择或导航'),
    }));
    expect(draft?.steps.map((step) => step.body).join('\n')).not.toContain('检查 /api/orders 响应');
    expect(draft?.notes).toContain('检查 /api/orders 响应');
    expect(source.source).not.toBe('reporter');

    const draftWithoutSuggestedFixes = createReporterFixDraft(
      source,
      {
        failureAnalysis: '等待元素可见。',
        suggestedFixes: [],
        recoveryPlan: {
          failedStepId: source.steps[0]!.id,
          strategy: 'waitForSelector',
          selector: '#orders-ready',
          reason: '等待元素可见。',
        },
      },
      5,
    );
    expect(draftWithoutSuggestedFixes?.steps[0]).toEqual(expect.objectContaining({
      title: '受控恢复：等待元素就绪',
      body: expect.stringContaining('#orders-ready'),
    }));

    expect(createReporterFixDraft(source, { failureAnalysis: '无恢复计划', suggestedFixes: ['增加等待'] }, 6)).toBeUndefined();
    vi.useRealTimers();
  });
});
