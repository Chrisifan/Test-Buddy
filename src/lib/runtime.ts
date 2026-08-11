import type {
  BrowserNavigateRequest,
  BrowserSessionRequest,
  BrowserSessionState,
  ChatCommandRequest,
  ChatCommandResponse,
  ChatEntry,
  MidsceneConfig,
  MidsceneConnectionTestResult,
  PrdSemanticAnalysisRequest,
  PrdSemanticAnalysisResponse,
  ProjectAssetBinding,
  ProjectAssetBindingStatus,
  ProjectAssetMigrationPlan,
  ProjectAssetMigrationRequest,
  ProjectAssetReloadPlan,
  ProjectAssetReloadRequest,
  ProjectAssetReloadResult,
  ProjectReportExportRequest,
  RunDetail,
  RuntimeProfile,
  RunEventPayload,
  RecordingCapturedEvent,
  RunTestCaseRequest,
  RunTestCaseResponse,
  RunRecordingRequest,
  RunRecordingResponse,
  RunWorkflowRequest,
  RunWorkflowResponse,
  SaveCredentialRequest,
  CredentialRef,
  RunArtifact,
  SessionStartRequest,
} from '../../shared/studio.js';
import {
  getExclusiveRecordingReplayId,
  getTestCasePrdPath,
  isAgentRunnableTestCase,
  testCaseToWorkflow,
  updatePrdDocumentAnalysis,
} from '../../shared/studio.js';
import { createStubAgentRun, createWorkflowAgentRun } from '../../shared/agentStub.js';
import { createRecordingAgentRun } from '../../shared/recordingAgent.js';

const listeners = new Set<(event: RunEventPayload) => void>();

function nowLabel(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function emit(event: RunEventPayload) {
  listeners.forEach((listener) => listener(event));
}

function getDesktopApi() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.desktopApi ?? null;
}

export function canPublishProjectAssetSnapshot(): boolean {
  return Boolean(getDesktopApi());
}

export async function selectProjectAssetDirectory(): Promise<string | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return undefined;
  }

  return (await desktopApi.selectProjectAssetDirectory()) ?? undefined;
}

export async function planProjectAssetMigration(
  request: ProjectAssetMigrationRequest,
): Promise<ProjectAssetMigrationPlan | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return undefined;
  }

  return desktopApi.planProjectAssetMigration(request);
}

export async function writeProjectAssetSnapshot(request: ProjectAssetMigrationRequest): Promise<ProjectAssetBinding | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return undefined;
  }

  return desktopApi.writeProjectAssetSnapshot(request);
}

export async function inspectProjectAssetBinding(projectId: string): Promise<ProjectAssetBindingStatus | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.inspectProjectAssetBinding !== 'function') {
    return undefined;
  }

  return (await desktopApi.inspectProjectAssetBinding(projectId)) ?? undefined;
}

export async function planProjectAssetReload(
  request: ProjectAssetReloadRequest,
): Promise<ProjectAssetReloadPlan | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.planProjectAssetReload !== 'function') {
    return undefined;
  }

  return desktopApi.planProjectAssetReload(request);
}

export async function reloadProjectAssetSnapshot(
  request: ProjectAssetReloadRequest,
): Promise<ProjectAssetReloadResult | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.reloadProjectAssetSnapshot !== 'function') {
    return undefined;
  }

  return desktopApi.reloadProjectAssetSnapshot(request);
}

export async function openArtifact(artifactPath: string): Promise<void> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return;
  }

  await desktopApi.openArtifact(artifactPath);
}

export async function exportArtifact(artifactPath: string): Promise<boolean> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return false;
  }

  return desktopApi.exportArtifact(artifactPath);
}

export async function exportProjectReport(request: ProjectReportExportRequest): Promise<boolean> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return false;
  }

  return desktopApi.exportProjectReport(request);
}

export async function cancelRun(runId: string): Promise<boolean> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return false;
  }

  return desktopApi.cancelRun(runId);
}

export async function attachManualEvidence(): Promise<RunArtifact | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return undefined;
  }

  return (await desktopApi.attachManualEvidence()) ?? undefined;
}

export async function testMidsceneConnection(config: MidsceneConfig): Promise<MidsceneConnectionTestResult> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.testMidsceneConnection(config);
  }

  return {
    status: 'failed',
    modelName: config.modelName.trim(),
    durationMs: 0,
    failure: 'network',
  };
}

export async function analyzePrdDocument(
  request: PrdSemanticAnalysisRequest,
): Promise<PrdSemanticAnalysisResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.analyzePrdDocument(request);
  }

  const document = updatePrdDocumentAnalysis(request.document);
  return {
    document: {
      ...document,
      analysisMetadata: {
        source: 'rule',
        analyzedAt: new Date().toISOString(),
        fallbackReason: 'desktopUnavailable',
      },
    },
    source: 'rule',
    fallbackReason: 'desktopUnavailable',
  };
}

function describeRuntimeProfile(profile: RuntimeProfile): string {
  return `${profile.browser} / ${profile.viewport} / ${profile.headless ? 'headless' : 'headed'} / ${profile.baseUrl}`;
}

function makeAssistantReply(
  mode: ChatCommandRequest['mode'],
  prompt: string,
  runtimeProfile: RuntimeProfile,
): string {
  if (mode === 'aiAssert') {
    return `已记录一条断言：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，后续接入执行引擎后，这里会展示真实断言结果和失败原因。`;
  }

  if (mode === 'aiQuery') {
    return `已记录一条提取请求：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，后续会在这里展示结构化提取结果和变量保存信息。`;
  }

  return `已记录一条动作指令：${prompt}。当前运行配置为 ${describeRuntimeProfile(runtimeProfile)}，UI 和命令协议已经与桌面端保持一致。`;
}

function extractExplicitUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s"'<>，。；、)）\]]+/i);
  return match?.[0];
}

function extractClickIntent(text: string): { selector?: string; target?: string } | undefined {
  const selectorMatch = text.match(/(?:点击|click)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])/i);
  if (selectorMatch?.[1]) {
    return { selector: selectorMatch[1].replace(/^`|`$/g, '') };
  }

  const targetMatch = text.match(/(?:点击|click)\s*([^，。；,.、\n]+)/i);
  const target = targetMatch?.[1]?.trim();
  return target ? { target } : undefined;
}

function extractInputIntent(text: string): { selector?: string; target?: string; value: string } | undefined {
  const selectorInput = text.match(
    /(?:在|向|给|输入到|填入)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:中|里)?\s*(?:输入|填入|填写)\s*([^，。；,\n]+)/i,
  );
  if (selectorInput?.[1] && selectorInput[2]) {
    return {
      selector: selectorInput[1].replace(/^`|`$/g, ''),
      value: selectorInput[2].trim(),
    };
  }

  const fillSelector = text.match(/(?:fill|type)\s+(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s+(?:with\s+)?([^，。；,\n]+)/i);
  if (fillSelector?.[1] && fillSelector[2]) {
    return {
      selector: fillSelector[1].replace(/^`|`$/g, ''),
      value: fillSelector[2].trim(),
    };
  }

  const semanticInput = text.match(/(?:在|向|给)\s*([^，。；,\n]+?)\s*(?:中|里)?\s*(?:输入|填入|填写)\s*([^，。；,\n]+)/i);
  if (semanticInput?.[1] && semanticInput[2]) {
    return {
      target: semanticInput[1].trim(),
      value: semanticInput[2].trim(),
    };
  }

  return undefined;
}

export async function startSession(request: SessionStartRequest): Promise<ChatEntry> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.startSession(request);
  }

  return {
    id: `chat-${Date.now()}-system`,
    role: 'system',
    text: `浏览器 fallback runtime 已启动会话，当前环境为 ${request.targetEnvironment}，运行配置为 ${describeRuntimeProfile(request.runtimeProfile)}。`,
  };
}

export async function saveCredential(request: SaveCredentialRequest): Promise<CredentialRef> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.saveCredential(request);
  }

  return {
    id: `cred-${Date.now()}`,
    label: request.label,
    kind: request.kind,
    username: request.username,
    updatedAt: new Date().toISOString(),
    hasSecret: Boolean(request.secret),
  };
}

export async function startBrowserSession(
  request: BrowserSessionRequest,
): Promise<BrowserSessionState> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.startBrowserSession(request);
  }

  const url = `${request.environment.url.replace(/\/$/, '')}${
    request.environment.entryPath.startsWith('/')
      ? request.environment.entryPath
      : `/${request.environment.entryPath}`
  }`;
  return {
    id: `session-${Date.now()}`,
    status: 'ready',
    projectId: request.project.id,
    environmentId: request.environment.id,
    currentUrl: url,
    pageTitle: request.project.name,
    message: '浏览器预览模式使用模拟受控会话。',
    updatedAt: new Date().toISOString(),
  };
}

export async function navigateBrowserSession(
  request: BrowserNavigateRequest,
): Promise<BrowserSessionState> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.navigateBrowserSession(request);
  }

  return {
    id: `session-${Date.now()}`,
    status: 'ready',
    currentUrl: request.url,
    pageTitle: 'Browser fallback',
    message: '浏览器预览模式已记录导航 URL。',
    updatedAt: new Date().toISOString(),
  };
}

export async function captureBrowserSnapshot(): Promise<BrowserSessionState> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.captureBrowserSnapshot();
  }

  return {
    id: `session-${Date.now()}`,
    status: 'ready',
    currentUrl: '',
    pageTitle: 'Browser fallback',
    message: '浏览器预览模式已生成模拟快照。',
    updatedAt: new Date().toISOString(),
  };
}

export async function endSession(): Promise<ChatEntry> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.endSession();
  }

  return {
    id: `chat-${Date.now()}-system`,
    role: 'system',
    text: '浏览器 fallback runtime 已结束会话。',
  };
}

export async function sendChatCommand(
  request: ChatCommandRequest,
): Promise<ChatCommandResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.sendChatCommand(request);
  }

  const explicitUrl = extractExplicitUrl(request.prompt);
  const clickIntent = extractClickIntent(request.prompt);
  const inputIntent = extractInputIntent(request.prompt);
  const browserActionMessage = explicitUrl
    ? `浏览器 fallback runtime 已识别用户指定 URL：${explicitUrl}。`
    : inputIntent?.selector
      ? `浏览器 fallback runtime 已识别用户指定输入 selector：${inputIntent.selector}。`
      : inputIntent?.target
        ? `浏览器 fallback runtime 已识别输入目标「${inputIntent.target}」，等待 Midscene 语义定位。`
    : clickIntent?.selector
      ? `浏览器 fallback runtime 已识别用户指定 selector：${clickIntent.selector}。`
      : clickIntent?.target
        ? `浏览器 fallback runtime 已识别点击目标「${clickIntent.target}」，等待 Midscene 语义定位。`
        : request.browserSession
          ? `Agent 已读取浏览器会话快照：${request.browserSession.currentUrl || '尚未导航'}`
          : '浏览器 fallback runtime 尚未提供会话快照。';
  const primaryExecution = inputIntent?.selector
    ? {
        primaryAction: 'input' as const,
        primaryInstruction: `在 ${inputIntent.selector} 输入 ${inputIntent.value}`,
        primaryExpected: '目标输入控件可填写，并成功捕获输入后的页面状态。',
        primarySelector: inputIntent.selector,
        primaryValue: inputIntent.value,
      }
    : inputIntent?.target
      ? {
          primaryAction: 'input' as const,
          primaryInstruction: `在「${inputIntent.target}」输入 ${inputIntent.value}`,
          primaryExpected: '等待 Midscene 语义定位输入控件后填写内容。',
          primaryValue: inputIntent.value,
        }
      : clickIntent?.selector
    ? {
        primaryAction: 'click' as const,
        primaryInstruction: `点击 ${clickIntent.selector}`,
        primaryExpected: '目标元素可点击，并成功捕获点击后的页面状态。',
        primarySelector: clickIntent.selector,
      }
    : clickIntent?.target
      ? {
          primaryAction: 'click' as const,
          primaryInstruction: `点击「${clickIntent.target}」`,
          primaryExpected: '等待 Midscene 语义定位目标元素后执行点击。',
        }
      : explicitUrl
        ? {
            primaryAction: 'navigate' as const,
            primaryInstruction: `导航到 ${explicitUrl}`,
            primaryExpected: '目标页面可访问，并成功捕获页面观察快照。',
          }
        : {};
  const agentRun = createStubAgentRun({
    mode: request.mode,
    prompt: request.prompt,
    runtimeDescription: describeRuntimeProfile(request.runtimeProfile),
    targetEnvironment: request.targetEnvironment,
    targetUrl: explicitUrl ?? request.runtimeProfile.baseUrl,
    browserActionMessage,
    ...primaryExecution,
    verificationStatus: 'neutral',
    verificationSummary: '浏览器 fallback 模式未执行页面动作，当前结果保持等待态。',
    verificationEvidence: '需要桌面端 BrowserRuntime 或 Midscene runtime 产生真实执行证据。',
    ...(request.browserSession
      ? {
          browserSession: {
            status: request.browserSession.status,
            currentUrl: request.browserSession.currentUrl,
            pageTitle: request.browserSession.pageTitle,
            ...(request.browserSession.screenshotPath ? { screenshotPath: request.browserSession.screenshotPath } : {}),
          },
        }
      : {}),
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.groupId ? { groupId: request.groupId } : {}),
    ...(request.environmentId ? { environmentId: request.environmentId } : {}),
    ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
  });

  return {
    userEntry: {
      id: `chat-${Date.now()}-user`,
      role: 'user',
      text: request.prompt,
    },
    assistantEntry: {
      id: `chat-${Date.now()}-assistant`,
      role: 'assistant',
      text: `${makeAssistantReply(request.mode, request.prompt, request.runtimeProfile)}\n\nAgent 计划已生成：${agentRun.plan.steps
        .map((step, index) => `${index + 1}. ${step.title}`)
        .join(' / ')}`,
    },
    agentRun,
  };
}

export async function runWorkflow(
  request: RunWorkflowRequest,
): Promise<RunWorkflowResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.runWorkflow(request);
  }

  const runId = `run-${Date.now().toString().slice(-5)}`;
  const title = request.workflow.name;
  const agentRun = createWorkflowAgentRun({
    workflow: request.workflow,
    stepRuns: [],
    runId,
    ...(request.project ? { projectId: request.project.id } : {}),
    ...(request.environment ? { environmentId: request.environment.id } : {}),
    ...(request.documentId ? { documentId: request.documentId } : {}),
  });
  const detail: RunDetail = {
    id: runId,
    projectId: request.project?.id ?? '',
    testCaseId: request.workflow.id,
    ...(request.documentId ? { documentId: request.documentId } : {}),
    environmentId: request.environment?.id ?? request.targetEnvironment,
    title,
    status: 'neutral',
    startedAt: agentRun.startedAt,
    endedAt: agentRun.endedAt,
    duration: '00:00:00',
    summary: agentRun.summary,
    logs: agentRun.events.map((event) => `[${nowLabel()}] ${event.type}: ${event.message}`),
    steps: request.workflow.steps.map((step, index) => ({
      id: `${runId}-step-${index}`,
      stepId: step.id,
      title: step.title,
      status: 'neutral',
      message: '浏览器 fallback 只生成计划，该步骤等待桌面 Agent runtime 执行。',
    })),
    artifacts: agentRun.artifacts,
    agentRun,
  };

  emit({ runId, title, type: 'status', status: 'running', summary: `正在生成 ${request.workflow.steps.length} 步 Agent 计划。` });
  emit({
    runId,
    title,
    type: 'complete',
    status: 'neutral',
    duration: detail.duration,
    summary: detail.summary,
    detail,
  });

  return { runId, title, detail, agentRun };
}

export async function runTestCase(request: RunTestCaseRequest): Promise<RunTestCaseResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.runTestCase(request);
  }

  const documentId = getTestCasePrdPath(request.testCase)?.documentId;
  const recordingId = getExclusiveRecordingReplayId(request.testCase);
  const recording = recordingId
    ? request.project.recordings.find((item) => item.id === recordingId)
    : undefined;
  if (recording) {
    return runRecording({
      project: request.project,
      environment: request.environment,
      recording,
      testCaseId: request.testCase.id,
      ...(documentId ? { documentId } : {}),
    });
  }

  if (isAgentRunnableTestCase(request.testCase)) {
    return runWorkflow({
      workflow: testCaseToWorkflow(request.testCase),
      targetEnvironment: request.environment.name,
      runtimeProfile: request.runtimeProfile ?? {
        browser: request.environment.browser,
        baseUrl: request.environment.url,
        viewport: request.environment.viewport,
        locale: request.environment.locale,
        headless: request.environment.headless,
      },
      ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
      ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
      ...(request.browserSession ? { browserSession: request.browserSession } : {}),
      project: request.project,
      environment: request.environment,
      ...(documentId ? { documentId } : {}),
    });
  }

  const runId = `run-${Date.now().toString().slice(-5)}`;
  const title = request.testCase.name;
  emit({
    runId,
    title,
    type: 'status',
    status: 'running',
    summary: `已排队执行 ${request.testCase.steps.length} 个步骤。`,
  });

  const logs = [
    `[${nowLabel()}] Test case queued: ${request.testCase.name}`,
    `[${nowLabel()}] Project: ${request.project.name}`,
    `[${nowLabel()}] Environment: ${request.environment.name}`,
  ];
  logs.forEach((line) => emit({ runId, title, type: 'log', line }));

  const detail: RunDetail = {
    id: runId,
    projectId: request.project.id,
    testCaseId: request.testCase.id,
    ...(documentId ? { documentId } : {}),
    environmentId: request.environment.id,
    title,
    status: 'neutral',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    duration: `00:00:${String(Math.max(1, request.testCase.steps.length * 2)).padStart(2, '0')}`,
    summary: `浏览器 fallback 未执行 ${request.testCase.steps.length} 个步骤，结果保持等待态。`,
    logs,
    steps: request.testCase.steps.map((step, index) => ({
      id: `run-step-${runId}-${index}`,
      stepId: step.id,
      title: step.title,
      status: 'neutral',
      message: `步骤等待桌面执行器：${step.body}`,
    })),
    artifacts: [],
  };

  setTimeout(() => {
    emit({
      runId,
      title,
      type: 'complete',
      status: 'neutral',
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });
  }, 600);

  return { runId, title, detail };
}

export async function runRecording(request: RunRecordingRequest): Promise<RunRecordingResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.runRecording(request);
  }

  const runId = `agent-run-recording-${Date.now()}`;
  const title = `${request.recording.name} 回放`;
  const documentId = request.documentId ?? request.recording.prdPath?.documentId;
  const agentRun = createRecordingAgentRun({
    recording: request.recording,
    replayResults: [],
    projectId: request.project.id,
    ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
    ...(documentId ? { documentId } : {}),
    runId,
  });
  const detail: RunDetail = {
    id: runId,
    projectId: request.project.id,
    testCaseId: request.testCaseId ?? request.recording.id,
    ...(documentId ? { documentId } : {}),
    environmentId: request.environment.id,
    title,
    status: 'neutral',
    startedAt: agentRun.startedAt,
    endedAt: agentRun.endedAt,
    duration: '00:00:00',
    summary: agentRun.summary,
    logs: agentRun.events.map((event) => `[${nowLabel()}] ${event.type}: ${event.message}`),
    steps: request.recording.steps.map((step, index) => ({
      id: `${runId}-step-${index}`,
      stepId: step.id,
      title: step.title,
      status: 'neutral',
      message: '浏览器 fallback 只生成回放计划，该节点等待桌面 BrowserRuntime 执行。',
    })),
    artifacts: agentRun.artifacts,
    agentRun,
  };

  emit({ runId, title, type: 'status', status: 'running', summary: `正在生成 ${request.recording.steps.length} 节点回放计划。` });
  emit({
    runId,
    title,
    type: 'complete',
    status: 'neutral',
    duration: detail.duration,
    summary: detail.summary,
    detail,
  });

  return { runId, title, detail, agentRun };
}

export async function loadRunDetail(runId: string): Promise<RunDetail | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.loadRunDetail(runId);
  }

  return null;
}

export function onRunEvent(listener: (event: RunEventPayload) => void): () => void {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.onRunEvent(listener);
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function onRecordingEvent(listener: (event: RecordingCapturedEvent) => void): () => void {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.onRecordingEvent(listener);
  }

  return () => {};
}
