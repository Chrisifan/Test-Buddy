import type {
  BrowserNavigateRequest,
  ArtifactRetentionAudit,
  ArtifactRetentionPlan,
  BrowserSessionRequest,
  BrowserSessionState,
  CaptureStorageStateRequest,
  ChatCommandRequest,
  ChatCommandResponse,
  ChatEntry,
  MidsceneConfig,
  MidsceneConnectionTestResult,
  MaintenanceDraftAcceptanceRequest,
  MaintenanceDraftAcceptanceResult,
  MaintenanceDraftCreationRequest,
  MaintenanceDraftRejectionRequest,
  MaintenanceEvidenceOpenRequest,
  PrdSemanticAnalysisRequest,
  PrdSemanticAnalysisResponse,
  ProjectAssetBinding,
  ProjectAssetBindingStatus,
  ProjectAssetMigrationPlan,
  ProjectAssetMigrationRequest,
  ProjectAssetReloadPlan,
  ProjectAssetReloadRequest,
  ProjectAssetReloadResult,
  ProjectAssetUpdatePlan,
  ProjectAssetUpdateRequest,
  ProjectReportExportRequest,
  RevokeStorageStateRequest,
  ImportStorageStateRequest,
  FixtureScriptTrustRequest,
  FixtureScriptTrustStatus,
  HistoricalRerunExecutionResult,
  HistoricalRerunPlan,
  RunDetail,
  RunReason,
  RunStatus,
  RuntimeProfile,
  RunEventPayload,
  RecordingCapturedEvent,
  RunTestCaseRequest,
  RunTestCaseResponse,
  RunRecordingRequest,
  RunRecordingResponse,
  RunSuiteRequest,
  RunSuiteResponse,
  SuiteRunRecord,
  RunWorkflowRequest,
  RunWorkflowResponse,
  SaveCredentialRequest,
  CredentialRef,
  StorageStateRef,
  RunArtifact,
  SessionStartRequest,
  ClearModelSecretRequest,
  ModelSecretRef,
  SaveModelSecretRequest,
} from '../../shared/studio.js';
import type { MaintenanceDraft } from '../../shared/maintenance.js';
import {
  findSuiteAsset,
  findTestCaseVersion,
  getExclusiveRecordingReplayId,
  getTestCasePrdPath,
  isAgentRunnableTestCase,
  resolveSuiteTestCases,
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

function unsupportedBrowserFallbackReason(message: string): RunReason {
  return { code: 'unsupportedAction', message };
}

function missingAssetVersionReason(message: string): RunReason {
  return { code: 'missingAssetVersion', message };
}

function terminalBrowserFallbackStatus(status: RunStatus): Exclude<RunStatus, 'running'> {
  return status === 'running' ? 'blocked' : status;
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

export async function planProjectAssetUpdate(
  request: ProjectAssetUpdateRequest,
): Promise<ProjectAssetUpdatePlan | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.planProjectAssetUpdate !== 'function') {
    return undefined;
  }

  return desktopApi.planProjectAssetUpdate(request);
}

export async function updateProjectAssetSnapshot(
  request: ProjectAssetUpdateRequest,
): Promise<ProjectAssetBinding | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.updateProjectAssetSnapshot !== 'function') {
    return undefined;
  }

  return desktopApi.updateProjectAssetSnapshot(request);
}

export async function listFixtureScriptTrusts(projectId: string): Promise<FixtureScriptTrustStatus[]> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.listFixtureScriptTrusts !== 'function') {
    return [];
  }
  return desktopApi.listFixtureScriptTrusts(projectId);
}

export async function approveFixtureScriptTrust(
  request: FixtureScriptTrustRequest,
): Promise<FixtureScriptTrustStatus | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.approveFixtureScriptTrust !== 'function') {
    return undefined;
  }
  return desktopApi.approveFixtureScriptTrust(request);
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

export async function planArtifactRetention(): Promise<ArtifactRetentionPlan | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.planArtifactRetention !== 'function') {
    return undefined;
  }
  return desktopApi.planArtifactRetention();
}

export async function confirmArtifactRetention(planId: string): Promise<ArtifactRetentionAudit | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.confirmArtifactRetention !== 'function') {
    return undefined;
  }
  return desktopApi.confirmArtifactRetention(planId);
}

export function canReviewMaintenanceDrafts(): boolean {
  const desktopApi = getDesktopApi();
  return Boolean(
    desktopApi &&
    typeof desktopApi.acceptMaintenanceDraft === 'function' &&
    typeof desktopApi.rejectMaintenanceDraft === 'function' &&
    typeof desktopApi.openMaintenanceEvidence === 'function',
  );
}

type MaintenanceDesktopOperation =
  | 'listMaintenanceDrafts'
  | 'createMaintenanceDraft'
  | 'acceptMaintenanceDraft'
  | 'rejectMaintenanceDraft'
  | 'openMaintenanceEvidence';

function requireMaintenanceDesktopApi(operation: MaintenanceDesktopOperation) {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi[operation] !== 'function') {
    throw new Error('Maintenance review requires the desktop main-process runtime.');
  }
  return desktopApi;
}

export async function listMaintenanceDrafts(): Promise<MaintenanceDraft[]> {
  return requireMaintenanceDesktopApi('listMaintenanceDrafts').listMaintenanceDrafts();
}

export async function createMaintenanceDraft(request: MaintenanceDraftCreationRequest): Promise<MaintenanceDraft> {
  return requireMaintenanceDesktopApi('createMaintenanceDraft').createMaintenanceDraft(request);
}

export async function acceptMaintenanceDraft(
  request: MaintenanceDraftAcceptanceRequest,
): Promise<MaintenanceDraftAcceptanceResult> {
  return requireMaintenanceDesktopApi('acceptMaintenanceDraft').acceptMaintenanceDraft(request);
}

export async function rejectMaintenanceDraft(request: MaintenanceDraftRejectionRequest): Promise<MaintenanceDraft> {
  return requireMaintenanceDesktopApi('rejectMaintenanceDraft').rejectMaintenanceDraft(request);
}

export async function openMaintenanceEvidence(request: MaintenanceEvidenceOpenRequest): Promise<void> {
  return requireMaintenanceDesktopApi('openMaintenanceEvidence').openMaintenanceEvidence(request);
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

export async function saveModelSecret(request: SaveModelSecretRequest): Promise<ModelSecretRef> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.saveModelSecret !== 'function') {
    throw new Error('模型密钥只能在桌面端安全保存。');
  }
  return desktopApi.saveModelSecret(request);
}

export async function clearModelSecret(request: ClearModelSecretRequest): Promise<ModelSecretRef> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.clearModelSecret !== 'function') {
    throw new Error('模型密钥只能在桌面端安全清除。');
  }
  return desktopApi.clearModelSecret(request);
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

/** The desktop main process selects and reads the storageState file directly. */
export async function importStorageState(request: ImportStorageStateRequest): Promise<StorageStateRef | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.importStorageState !== 'function') {
    return undefined;
  }
  return (await desktopApi.importStorageState(request)) ?? undefined;
}

export async function captureStorageState(request: CaptureStorageStateRequest): Promise<StorageStateRef | undefined> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.captureStorageState !== 'function') {
    return undefined;
  }
  return desktopApi.captureStorageState(request);
}

export async function revokeStorageState(request: RevokeStorageStateRequest): Promise<boolean> {
  const desktopApi = getDesktopApi();
  if (!desktopApi || typeof desktopApi.revokeStorageState !== 'function') {
    return false;
  }
  await desktopApi.revokeStorageState(request);
  return true;
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

  const runId = request.runId ?? `run-${Date.now().toString().slice(-5)}`;
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
    status: 'blocked',
    startedAt: agentRun.startedAt,
    endedAt: agentRun.endedAt,
    duration: '00:00:00',
    summary: agentRun.summary,
    reason: unsupportedBrowserFallbackReason('浏览器 fallback 只生成计划，桌面 Agent runtime 不可用。'),
    logs: agentRun.events.map((event) => `[${nowLabel()}] ${event.type}: ${event.message}`),
    steps: request.workflow.steps.map((step, index) => ({
      id: `${runId}-step-${index}`,
      stepId: step.id,
      title: step.title,
      status: 'blocked',
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
    status: detail.status,
    duration: detail.duration,
    summary: detail.summary,
    detail,
  });

  return { runId, title, detail, agentRun };
}

export async function runTestCase(request: RunTestCaseRequest): Promise<RunTestCaseResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.runTestCase({
      ...(request.runId ? { runId: request.runId } : {}),
      projectId: request.project.id,
      testCase: { id: request.testCase.id, version: request.testCase.version ?? 1 },
      ...(request.expectedProjectRevision ? { expectedProjectRevision: request.expectedProjectRevision } : {}),
    });
  }

  const testCaseReference = { id: request.testCase.id, version: request.testCase.version ?? 1 };
  const testCase = findTestCaseVersion(request.project, testCaseReference);
  if (!testCase) {
    return createMissingLegacyCaseResponse(request, testCaseReference);
  }

  const documentId = getTestCasePrdPath(testCase)?.documentId;
  const recordingId = getExclusiveRecordingReplayId(testCase);
  const recording = recordingId
    ? request.project.recordings.find((item) => item.id === recordingId)
    : undefined;
  if (recording) {
    return runRecording({
      ...(request.runId ? { runId: request.runId } : {}),
      project: request.project,
      environment: request.environment,
      recording,
      testCaseId: testCase.id,
      ...(documentId ? { documentId } : {}),
    });
  }

  if (isAgentRunnableTestCase(testCase)) {
    return runWorkflow({
      ...(request.runId ? { runId: request.runId } : {}),
      workflow: testCaseToWorkflow(testCase),
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

  const runId = request.runId ?? `run-${Date.now().toString().slice(-5)}`;
  const title = testCase.name;
  emit({
    runId,
    title,
    type: 'status',
    status: 'running',
    summary: `已排队执行 ${testCase.steps.length} 个步骤。`,
  });

  const logs = [
    `[${nowLabel()}] Test case queued: ${testCase.name}`,
    `[${nowLabel()}] Project: ${request.project.name}`,
    `[${nowLabel()}] Environment: ${request.environment.name}`,
  ];
  logs.forEach((line) => emit({ runId, title, type: 'log', line }));
  const summary = `浏览器 legacy fallback 未执行 ${testCase.steps.length} 个步骤，结果已标记为阻塞。`;

  const detail: RunDetail = {
    id: runId,
    projectId: request.project.id,
    testCaseId: testCase.id,
    ...(documentId ? { documentId } : {}),
    environmentId: request.environment.id,
    title,
    status: 'blocked',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    duration: `00:00:${String(Math.max(1, testCase.steps.length * 2)).padStart(2, '0')}`,
    summary,
    reason: unsupportedBrowserFallbackReason(summary),
    logs,
    steps: testCase.steps.map((step, index) => ({
      id: `run-step-${runId}-${index}`,
      stepId: step.id,
      title: step.title,
      status: 'blocked',
      message: `步骤等待桌面执行器：${step.body}`,
    })),
    artifacts: [],
  };

  setTimeout(() => {
    emit({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });
  }, 600);

  return { runId, title, detail };
}

function createMissingLegacyCaseResponse(
  request: RunTestCaseRequest,
  reference: { id: string; version: number },
): RunTestCaseResponse {
  const runId = request.runId ?? `run-${Date.now().toString().slice(-5)}`;
  const now = new Date().toISOString();
  const title = `Case ${reference.id}@${reference.version}`;
  const summary = `浏览器 legacy fallback 未找到 Case：${reference.id}@${reference.version}。`;
  return {
    runId,
    title,
    detail: {
      id: runId,
      projectId: request.project.id,
      testCaseId: reference.id,
      environmentId: request.environment.id,
      title,
      status: 'blocked',
      startedAt: now,
      endedAt: now,
      duration: '00:00:00',
      summary,
      reason: missingAssetVersionReason(summary),
      logs: [],
      steps: [],
      artifacts: [],
    },
  };
}

export async function runSuite(request: RunSuiteRequest): Promise<RunSuiteResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.runSuite({
      ...(request.runId ? { runId: request.runId } : {}),
      projectId: request.project.id,
      suite: { id: request.suite.id, version: request.suite.version },
      ...(request.expectedProjectRevision ? { expectedProjectRevision: request.expectedProjectRevision } : {}),
    });
  }

  const runId = request.runId ?? `suite-run-${Date.now().toString().slice(-5)}`;
  const suite = findSuiteAsset(request.project, request.suite);
  const now = new Date().toISOString();
  if (!suite) {
    const issue = `未找到 Suite：${request.suite.id}@${request.suite.version}。`;
    return {
      runId,
      title: `Suite ${request.suite.id}@${request.suite.version}`,
      detail: {
        suite: {
          suiteId: request.suite.id,
          suiteVersion: request.suite.version,
          environmentId: '',
          status: 'blocked',
          reason: missingAssetVersionReason(issue),
          startedAt: now,
          endedAt: now,
          effectiveConcurrency: 1,
          results: [],
          issues: [issue],
        },
        caseDetails: [],
      },
    };
  }

  const resolution = resolveSuiteTestCases(request.project, suite);
  if (!resolution.environment || resolution.issues.length) {
    const issues = resolution.issues.map((issue) => issue.message);
    const summary = issues[0] ?? 'Suite 浏览器 fallback 缺少可执行环境。';
    return {
      runId,
      title: suite.name,
      detail: {
        suite: {
          suiteId: suite.id,
          suiteVersion: suite.version,
          environmentId: suite.environmentId,
          status: 'blocked',
          reason: missingAssetVersionReason(summary),
          startedAt: now,
          endedAt: new Date().toISOString(),
          effectiveConcurrency: 1,
          results: [],
          issues,
        },
        caseDetails: [],
      },
    };
  }

  const caseDetails = [] as RunDetail[];
  for (const { testCase } of resolution.orderedCases) {
    const response = await runTestCase({
      runId: `${runId}-${testCase.id}-attempt-1`,
      project: request.project,
      testCase,
      environment: resolution.environment,
      ...(request.runtimeProfile ? { runtimeProfile: request.runtimeProfile } : {}),
      ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
      ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
      ...(request.browserSession ? { browserSession: request.browserSession } : {}),
    });
    caseDetails.push(response.detail);
  }
  const results = caseDetails.map((detail, index) => ({
    testCaseId: detail.testCaseId,
    testCaseVersion: resolution.orderedCases[index]!.testCase.version ?? 1,
    status: terminalBrowserFallbackStatus(detail.status),
    summary: detail.summary,
    ...(detail.reason ? { reason: detail.reason } : {}),
    attempts: 1,
    flaky: false,
    runId: detail.id,
  }));
  const firstNonPassed = results.find((result) => result.status !== 'passed');
  return {
    runId,
    title: suite.name,
    detail: {
      suite: {
        suiteId: suite.id,
        suiteVersion: suite.version,
        environmentId: suite.environmentId,
        status: firstNonPassed?.status ?? 'passed',
        ...(firstNonPassed?.reason ? { reason: firstNonPassed.reason } : {}),
        startedAt: now,
        endedAt: new Date().toISOString(),
        effectiveConcurrency: 1,
        results,
        issues: [],
      },
      caseDetails,
    },
  };
}

export async function runRecording(request: RunRecordingRequest): Promise<RunRecordingResponse> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.runRecording(request);
  }

  const runId = request.runId ?? `agent-run-recording-${Date.now()}`;
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
  const summary = agentRun.summary;
  const detail: RunDetail = {
    id: runId,
    projectId: request.project.id,
    testCaseId: request.testCaseId ?? request.recording.id,
    ...(documentId ? { documentId } : {}),
    environmentId: request.environment.id,
    title,
    status: 'blocked',
    startedAt: agentRun.startedAt,
    endedAt: agentRun.endedAt,
    duration: '00:00:00',
    summary,
    reason: unsupportedBrowserFallbackReason('浏览器 fallback 只生成回放计划，桌面 BrowserRuntime 不可用。'),
    logs: agentRun.events.map((event) => `[${nowLabel()}] ${event.type}: ${event.message}`),
    steps: request.recording.steps.map((step, index) => ({
      id: `${runId}-step-${index}`,
      stepId: step.id,
      title: step.title,
      status: 'blocked',
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
    status: detail.status,
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

export async function loadSuiteRunRecord(runId: string): Promise<SuiteRunRecord | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi && typeof desktopApi.loadSuiteRunRecord === 'function') {
    return desktopApi.loadSuiteRunRecord(runId);
  }

  return null;
}

export async function planHistoricalRerun(runId: string): Promise<HistoricalRerunPlan> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.planHistoricalRerun(runId);
  }

  return unavailableHistoricalRerunPlan(runId);
}

export async function runHistoricalRerun(runId: string): Promise<HistoricalRerunExecutionResult> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.runHistoricalRerun(runId);
  }

  return unavailableHistoricalRerunPlan(runId);
}

function unavailableHistoricalRerunPlan(runId: string): Extract<HistoricalRerunPlan, { status: 'blocked' }> {
  return {
    status: 'blocked',
    runId,
    reason: {
      code: 'legacyAmbiguousNeutral',
      message: 'Exact historical reruns require the desktop main-process runtime.',
    },
    missingReferences: [],
  };
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
