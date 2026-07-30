import type { AgentModelAssignment, AgentRunResult } from './agent.js';

export type RunTone = 'running' | 'passed' | 'failed' | 'neutral';
export type ChatRole = 'system' | 'user' | 'assistant';
export type CommandMode = 'ai' | 'aiAssert' | 'aiQuery';
export type StepType = 'ai' | 'aiAssert' | 'aiQuery';
export type TestStepType = StepType | 'recordingReplay' | 'manual';
export type TestCaseRunBlocker = 'emptySteps' | 'emptyTitle' | 'emptyInstruction' | 'missingRecording';
export type WorkflowKind = 'scenario' | 'assertion' | 'extraction';
export type TestCaseKind = WorkflowKind | 'recording';
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';
export type ViewportPreset = 'desktop' | 'laptop' | 'mobile';
export type TestCaseSource = 'manual' | 'naturalLanguage' | 'recording' | 'prd';
export type EnvironmentKind = 'local' | 'staging' | 'productionMirror';
export type CredentialKind = 'password' | 'cookie' | 'token';
export type BrowserSessionStatus = 'idle' | 'starting' | 'ready' | 'navigating' | 'closed' | 'error';
export type PrdDocumentKind = 'pdf' | 'markdown' | 'text';
export type PrdAnalysisStatus = 'draft' | 'analyzed';
export type RecordingSource = 'live' | 'imported';
export type RecordingStepKind = 'navigate' | 'click' | 'input' | 'wait' | 'assert' | 'snapshot';
export type ThemeMode = 'light' | 'dark' | 'system';
export type LocaleMode = 'zh-CN' | 'en-US' | 'system';
export type AgentModelRole = 'planner' | 'executor' | 'verifier' | 'reporter';
export type AgentModelProvider = 'reuseMidscene' | 'openaiCompatible';

export interface RunSummary {
  id: string;
  name: string;
  status: RunTone;
  duration: string;
  summary: string;
  projectId?: string;
  testCaseId?: string;
  environmentId?: string;
  environmentName?: string;
  startedAt?: string;
}

export interface WorkflowStepDraft {
  id: string;
  type: StepType;
  title: string;
  body: string;
}

export interface WorkflowDraft {
  id: string;
  kind: WorkflowKind;
  name: string;
  category: string;
  lastEdited: string;
  url: string;
  notes: string;
  steps: WorkflowStepDraft[];
}

export interface TestStepDraft {
  id: string;
  type: TestStepType;
  title: string;
  body: string;
  recordingId?: string;
}

export interface TestCaseDraft extends Omit<WorkflowDraft, 'kind' | 'steps'> {
  kind: TestCaseKind;
  groupId: string;
  environmentId: string;
  source: TestCaseSource;
  steps: TestStepDraft[];
}

export interface RecordingStepDraft {
  id: string;
  kind: RecordingStepKind;
  title: string;
  detail: string;
  pageUrl?: string;
  screenshotPath?: string;
  capturedAt?: string;
  selector?: string;
  value?: string;
}

export interface VisualDiffMask {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingCapturedEvent {
  id: string;
  kind: RecordingStepKind;
  title: string;
  detail: string;
  pageUrl: string;
  capturedAt: string;
  selector?: string;
  value?: string;
}

export interface RecordingAsset {
  id: string;
  name: string;
  summary: string;
  source: RecordingSource;
  groupId: string;
  environmentId: string;
  startUrl: string;
  comparisonGoal: string;
  visualDiffThreshold?: number;
  visualDiffMasks?: VisualDiffMask[];
  tags: string[];
  steps: RecordingStepDraft[];
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedTestPath {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  groupName: string;
  rationale: string;
  steps: TestStepDraft[];
}

export interface PrdDocumentAsset {
  id: string;
  name: string;
  kind: PrdDocumentKind;
  size: number;
  uploadedAt: string;
  status: PrdAnalysisStatus;
  sourceText: string;
  summary: string;
  coverageAreas: string[];
  generatedPaths: GeneratedTestPath[];
}

export interface ProjectGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface CredentialRef {
  id: string;
  label: string;
  kind: CredentialKind;
  username?: string;
  updatedAt: string;
  hasSecret: boolean;
}

export interface ProjectEnvironment {
  id: string;
  name: string;
  kind: EnvironmentKind;
  url: string;
  entryPath: string;
  browser: BrowserEngine;
  viewport: ViewportPreset;
  locale: string;
  headless: boolean;
  credentialId?: string;
}

export interface ProjectDraft {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  selectedEnvironmentId: string;
  environments: ProjectEnvironment[];
  groups: ProjectGroup[];
  testCases: TestCaseDraft[];
  recordings: RecordingAsset[];
  documents: PrdDocumentAsset[];
  credentialRefs: CredentialRef[];
  createdAt: string;
  updatedAt: string;
}

export interface RunArtifact {
  id: string;
  type: 'screenshot' | 'trace' | 'report' | 'snapshot';
  label: string;
  path: string;
}

export interface RunStepLog {
  id: string;
  stepId: string;
  title: string;
  status: RunTone;
  message: string;
  screenshotPath?: string;
}

export interface ManualStepEvidence {
  stepId: string;
  status: 'passed' | 'failed';
  note: string;
  confirmedAt: string;
}

export interface RunDetail {
  id: string;
  projectId: string;
  testCaseId: string;
  environmentId: string;
  title: string;
  status: RunTone;
  startedAt: string;
  endedAt?: string;
  duration: string;
  summary: string;
  logs: string[];
  steps: RunStepLog[];
  artifacts: RunArtifact[];
  agentRun?: AgentRunResult;
  agentRuns?: AgentRunResult[];
  manualEvidence?: ManualStepEvidence[];
  failureReason?: string;
}

export interface BrowserSessionState {
  id: string;
  status: BrowserSessionStatus;
  projectId?: string;
  environmentId?: string;
  currentUrl: string;
  pageTitle: string;
  screenshotPath?: string;
  message: string;
  updatedAt: string;
}

export interface ChatEntry {
  id: string;
  role: ChatRole;
  text: string;
}

export interface RuntimeProfile {
  browser: BrowserEngine;
  baseUrl: string;
  viewport: ViewportPreset;
  locale: string;
  headless: boolean;
}

export interface MidsceneConfig {
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  modelFamily: string;
  preferredLanguage: string;
  replanningCycleLimit: string;
  openaiHttpProxy: string;
  defaultContext: string;
}

export interface AgentRoleModelConfig {
  provider: AgentModelProvider;
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  modelFamily: string;
  temperature: string;
  enabled: boolean;
}

export type AgentModelConfig = Record<AgentModelRole, AgentRoleModelConfig>;

export interface AppearanceConfig {
  themeMode: ThemeMode;
  localeMode: LocaleMode;
}

export interface StartupGuideState {
  completed: boolean;
  completedAt?: string;
  mode?: 'configured' | 'skipped';
}

export interface StudioState {
  selectedProjectId: string;
  selectedGroupId: string;
  selectedTestCaseId: string;
  selectedRecordingId: string;
  projects: ProjectDraft[];
  runDetails: RunDetail[];
  recentRuns: RunSummary[];
  chatEntries: ChatEntry[];
  runtimeProfile: RuntimeProfile;
  midsceneConfig: MidsceneConfig;
  agentModelConfig: AgentModelConfig;
  appearance: AppearanceConfig;
  startupGuide: StartupGuideState;
  browserSession: BrowserSessionState;
  selectedWorkflowId?: string;
  workflows?: WorkflowDraft[];
}

export interface RuntimeInfo {
  platform: 'desktop' | 'browser';
  persistence: 'file' | 'localStorage';
  storagePath?: string;
}

export interface ChatCommandRequest {
  mode: CommandMode;
  prompt: string;
  targetEnvironment: string;
  deepThink: boolean;
  deepLocate: boolean;
  runtimeProfile: RuntimeProfile;
  midsceneConfig?: MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
  project?: ProjectDraft;
  environment?: ProjectEnvironment;
  projectId?: string;
  testCaseId?: string;
}

export interface ChatCommandResponse {
  userEntry: ChatEntry;
  assistantEntry: ChatEntry;
  agentRun: AgentRunResult;
}

export interface RunWorkflowRequest {
  workflow: WorkflowDraft;
  targetEnvironment: string;
  runtimeProfile: RuntimeProfile;
  parentRunId?: string;
  preserveCurrentPage?: boolean;
  project?: ProjectDraft;
  environment?: ProjectEnvironment;
  midsceneConfig?: MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
}

export interface RunTestCaseRequest {
  project: ProjectDraft;
  testCase: TestCaseDraft;
  environment: ProjectEnvironment;
  runtimeProfile?: RuntimeProfile;
  midsceneConfig?: MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
}

export interface RunRecordingRequest {
  project: ProjectDraft;
  recording: RecordingAsset;
  environment: ProjectEnvironment;
  testCaseId?: string;
  parentRunId?: string;
}

export interface RunWorkflowResponse {
  runId: string;
  title: string;
  detail: RunDetail;
  agentRun: AgentRunResult;
}

export interface RunTestCaseResponse {
  runId: string;
  title: string;
  detail: RunDetail;
}

export interface RunRecordingResponse {
  runId: string;
  title: string;
  detail: RunDetail;
  agentRun: AgentRunResult;
}

export interface SessionStartRequest {
  targetEnvironment: string;
  runtimeProfile: RuntimeProfile;
}

export interface BrowserSessionRequest {
  project: ProjectDraft;
  environment: ProjectEnvironment;
  record?: boolean;
}

export interface BrowserNavigateRequest {
  url: string;
}

export interface BrowserClickRequest {
  selector: string;
}

export interface BrowserInputRequest {
  selector: string;
  value: string;
}

export interface BrowserWaitRequest {
  timeoutMs?: number;
}

export interface BrowserWaitForSelectorRequest {
  selector: string;
  timeoutMs?: number;
}

export interface BrowserWaitForResponseRequest {
  urlPattern: string;
  timeoutMs?: number;
}

export interface BrowserWaitForChartStableRequest {
  selector?: string;
  timeoutMs?: number;
  stableMs?: number;
}

export interface BrowserWaitForDataReadyRequest {
  selector?: string;
  timeoutMs?: number;
  stableMs?: number;
}

export interface BrowserWaitForNetworkIdleRequest {
  timeoutMs?: number;
}

export interface BrowserScrollRequest {
  selector?: string;
  x?: number;
  y?: number;
}

export interface BrowserSelectRequest {
  selector: string;
  value: string;
}

export interface SaveCredentialRequest {
  projectId: string;
  label: string;
  kind: CredentialKind;
  username?: string;
  secret: string;
}

export interface RunEventPayload {
  runId: string;
  title: string;
  type: 'status' | 'log' | 'complete';
  status?: RunTone;
  line?: string;
  summary?: string;
  duration?: string;
  detail?: RunDetail;
}

export interface DesktopApi {
  loadStudioState: () => Promise<StudioState | null>;
  saveStudioState: (state: StudioState) => Promise<void>;
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  createProject: (project: ProjectDraft) => Promise<ProjectDraft>;
  updateProject: (project: ProjectDraft) => Promise<ProjectDraft>;
  saveCredential: (request: SaveCredentialRequest) => Promise<CredentialRef>;
  startBrowserSession: (request: BrowserSessionRequest) => Promise<BrowserSessionState>;
  navigateBrowserSession: (request: BrowserNavigateRequest) => Promise<BrowserSessionState>;
  captureBrowserSnapshot: () => Promise<BrowserSessionState>;
  runTestCase: (request: RunTestCaseRequest) => Promise<RunTestCaseResponse>;
  runRecording: (request: RunRecordingRequest) => Promise<RunRecordingResponse>;
  loadRunDetail: (runId: string) => Promise<RunDetail | null>;
  openArtifact: (artifactPath: string) => Promise<void>;
  exportArtifact: (artifactPath: string) => Promise<boolean>;
  startSession: (request: SessionStartRequest) => Promise<ChatEntry>;
  endSession: () => Promise<ChatEntry>;
  sendChatCommand: (request: ChatCommandRequest) => Promise<ChatCommandResponse>;
  runWorkflow: (request: RunWorkflowRequest) => Promise<RunWorkflowResponse>;
  onRunEvent: (listener: (event: RunEventPayload) => void) => () => void;
  onRecordingEvent: (listener: (event: RecordingCapturedEvent) => void) => () => void;
}

export const defaultRuntimeProfile: RuntimeProfile = {
  browser: 'chromium',
  baseUrl: 'https://demo-shop.local',
  viewport: 'desktop',
  locale: 'zh-CN',
  headless: true,
};

export const defaultMidsceneConfig: MidsceneConfig = {
  modelBaseUrl: '',
  modelApiKey: '',
  modelName: '',
  modelFamily: '',
  preferredLanguage: 'Chinese',
  replanningCycleLimit: '10',
  openaiHttpProxy: '',
  defaultContext: '',
};

const defaultAgentRoleModelConfig: AgentRoleModelConfig = {
  provider: 'reuseMidscene',
  modelBaseUrl: '',
  modelApiKey: '',
  modelName: '',
  modelFamily: '',
  temperature: '0.2',
  enabled: true,
};

export const defaultAgentModelConfig: AgentModelConfig = {
  planner: structuredClone(defaultAgentRoleModelConfig),
  executor: structuredClone(defaultAgentRoleModelConfig),
  verifier: structuredClone(defaultAgentRoleModelConfig),
  reporter: structuredClone(defaultAgentRoleModelConfig),
};

export const defaultAppearanceConfig: AppearanceConfig = {
  themeMode: 'light',
  localeMode: 'zh-CN',
};

const agentModelRoleOrder: AgentModelRole[] = ['planner', 'executor', 'verifier', 'reporter'];

export function resolveAgentModelAssignments({
  agentModelConfig = defaultAgentModelConfig,
  midsceneConfig,
}: {
  agentModelConfig?: AgentModelConfig;
  midsceneConfig: MidsceneConfig;
}): AgentModelAssignment[] {
  return agentModelRoleOrder.map((role) => {
    const roleConfig = {
      ...defaultAgentModelConfig[role],
      ...(agentModelConfig[role] ?? {}),
    };

    if (roleConfig.provider === 'openaiCompatible') {
      return {
        role,
        provider: roleConfig.provider,
        source: 'agentRole',
        enabled: roleConfig.enabled,
        modelBaseUrl: roleConfig.modelBaseUrl,
        modelName: roleConfig.modelName,
        modelFamily: roleConfig.modelFamily,
        temperature: roleConfig.temperature,
        hasApiKey: Boolean(roleConfig.modelApiKey.trim()),
      };
    }

    return {
      role,
      provider: roleConfig.provider,
      source: 'midscene',
      enabled: roleConfig.enabled,
      modelBaseUrl: midsceneConfig.modelBaseUrl,
      modelName: midsceneConfig.modelName,
      modelFamily: midsceneConfig.modelFamily,
      hasApiKey: Boolean(midsceneConfig.modelApiKey.trim()),
    };
  });
}

export const defaultBrowserSession: BrowserSessionState = {
  id: 'session-idle',
  status: 'idle',
  currentUrl: '',
  pageTitle: '尚未启动浏览器',
  message: '选择项目环境后启动受控浏览器会话。',
  updatedAt: new Date(0).toISOString(),
};

export const initialRecentRuns: RunSummary[] = [
  {
    id: 'run-2401',
    name: 'Checkout smoke',
    status: 'running',
    duration: '00:03:17',
    summary: '执行到支付方式选择步骤，正在等待结算区域稳定。',
    projectId: 'project-demo',
    testCaseId: 'wf-001',
    environmentId: 'env-staging',
    environmentName: 'Staging',
  },
  {
    id: 'run-2398',
    name: 'Search regression',
    status: 'passed',
    duration: '00:01:42',
    summary: '搜索、筛选和结果断言全部通过。',
    projectId: 'project-demo',
    testCaseId: 'wf-002',
    environmentId: 'env-staging',
    environmentName: 'Staging',
  },
  {
    id: 'run-2397',
    name: 'Login happy path',
    status: 'failed',
    duration: '00:00:51',
    summary: '验证码遮罩导致登录按钮定位失败。',
    projectId: 'project-demo',
    testCaseId: 'wf-003',
    environmentId: 'env-staging',
    environmentName: 'Staging',
  },
];

export const initialWorkflows: WorkflowDraft[] = [
  {
    id: 'wf-001',
    kind: 'scenario',
    name: '购物车到支付',
    category: '核心链路',
    lastEdited: '2 小时前',
    url: 'https://demo-shop.local/checkout',
    notes: '用于验证从商品详情页到结算页的关键路径。',
    steps: [
      {
        id: 'step-001',
        type: 'ai',
        title: '搜索商品',
        body: '在搜索框输入 {{keyword}} 并提交，等待结果列表稳定。',
      },
      {
        id: 'step-002',
        type: 'aiAssert',
        title: '断言结果列表',
        body: '页面展示了与 {{keyword}} 相关的搜索结果。',
      },
      {
        id: 'step-003',
        type: 'aiQuery',
        title: '提取首个标题',
        body: '读取第一页第一个商品卡片标题，并保存到 firstCardTitle。',
      },
    ],
  },
  {
    id: 'wf-002',
    kind: 'assertion',
    name: '搜索页关键断言',
    category: '断言验证',
    lastEdited: '昨天',
    url: 'https://demo-shop.local/search',
    notes: '专门用于验证搜索页的排序、筛选和关键状态文案。',
    steps: [
      {
        id: 'step-004',
        type: 'aiAssert',
        title: '断言默认排序',
        body: '页面初始状态下，排序控件显示“综合排序”。',
      },
      {
        id: 'step-005',
        type: 'aiAssert',
        title: '断言结果数量',
        body: '结果区域展示了总数，并且首屏至少出现 1 个商品卡片。',
      },
    ],
  },
  {
    id: 'wf-003',
    kind: 'extraction',
    name: '商品卡片信息提取',
    category: '数据提取',
    lastEdited: '3 天前',
    url: 'https://demo-shop.local/search',
    notes: '从搜索结果页提取关键字段，供后续断言或回填流程使用。',
    steps: [
      {
        id: 'step-006',
        type: 'aiQuery',
        title: '提取首个商品标题',
        body: '读取第一页第一个商品卡片标题，并保存到 firstCardTitle。',
      },
      {
        id: 'step-007',
        type: 'aiQuery',
        title: '提取价格与库存',
        body: '提取首个商品的价格与库存文案，保存到 firstCardPrice 和 firstCardStock。',
      },
    ],
  },
];

export const initialChatTimeline: ChatEntry[] = [
  {
    id: 'chat-001',
    role: 'system',
    text: `浏览器会话已准备完成，当前目标页面为 ${defaultRuntimeProfile.baseUrl}。`,
  },
  {
    id: 'chat-002',
    role: 'user',
    text: '搜索 “wireless keyboard”，筛选价格低于 300，并打开第一个商品详情页。',
  },
  {
    id: 'chat-003',
    role: 'assistant',
    text: '已完成搜索、筛选和跳转。当前页面位于商品详情，库存提示为“有货”。',
  },
];

export const initialRunLog = [
  '[13:20:10] Browser session started',
  '[13:20:12] MidScene agent initialized with checkout context',
  '[13:20:17] Task 1 / Step 2 passed: aiAssert',
  '[13:20:23] Captured variable currentPrice = "¥249.00"',
  '[13:20:31] Waiting for order summary to stabilize',
];

export function workflowToTestCase(
  workflow: WorkflowDraft,
  groupId = 'group-core',
  environmentId = 'env-staging',
): TestCaseDraft {
  return {
    ...workflow,
    groupId,
    environmentId,
    source: 'manual',
    steps: workflow.steps.map((step) => ({ ...step })),
  };
}

export function testCaseToWorkflow(testCase: TestCaseDraft): WorkflowDraft {
  return {
    id: testCase.id,
    kind: testCase.kind === 'recording' ? 'scenario' : testCase.kind,
    name: testCase.name,
    category: testCase.category,
    lastEdited: testCase.lastEdited,
    url: testCase.url,
    notes: testCase.notes,
    steps: testCase.steps
      .filter((step): step is TestStepDraft & { type: StepType } =>
        step.type === 'ai' || step.type === 'aiAssert' || step.type === 'aiQuery',
      )
      .map((step) => ({
        id: step.id,
        type: step.type,
        title: step.title,
        body: step.body,
      })),
  };
}

export function isAgentRunnableTestCase(testCase: TestCaseDraft): boolean {
  return (
    testCase.steps.length > 0 &&
    testCase.steps.every(
      (step) => step.type === 'ai' || step.type === 'aiAssert' || step.type === 'aiQuery',
    )
  );
}

export function getExclusiveRecordingReplayId(testCase: TestCaseDraft): string | undefined {
  const [step] = testCase.steps;
  return testCase.steps.length === 1 && step?.type === 'recordingReplay' ? step.recordingId : undefined;
}

export function createDemoProject(): ProjectDraft {
  const now = new Date().toISOString();
  return {
    id: 'project-demo',
    name: 'Demo Shop 自动化',
    description: '围绕图表、表格和交易链路验证的本地测试项目。',
    defaultUrl: 'https://demo-shop.local',
    selectedEnvironmentId: 'env-staging',
    createdAt: now,
    updatedAt: now,
    environments: [
      {
        id: 'env-staging',
        name: 'Staging',
        kind: 'staging',
        url: 'https://demo-shop.local',
        entryPath: '/dashboard',
        browser: 'chromium',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
        credentialId: 'cred-demo-admin',
      },
      {
        id: 'env-local',
        name: 'Local Preview',
        kind: 'local',
        url: 'http://127.0.0.1:4173',
        entryPath: '/',
        browser: 'chromium',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    ],
    groups: [
      {
        id: 'group-core',
        name: '核心链路',
        description: '登录、检索、筛选、图表和表格关键路径。',
        createdAt: now,
      },
      {
        id: 'group-reporting',
        name: '数据看板',
        description: '图表展示、表格排序、筛选和导出相关用例。',
        createdAt: now,
      },
    ],
    credentialRefs: [
      {
        id: 'cred-demo-admin',
        label: 'Staging 管理员',
        kind: 'password',
        username: 'qa@example.com',
        updatedAt: now,
        hasSecret: true,
      },
    ],
    recordings: [
      {
        id: 'recording-demo-dashboard',
        name: '数据看板筛选回放',
        summary: '覆盖时间范围切换、业务线筛选和图表刷新后的关键状态对比。',
        source: 'live',
        groupId: 'group-reporting',
        environmentId: 'env-staging',
        startUrl: 'https://demo-shop.local/dashboard',
        comparisonGoal: '回放后断言图表、指标卡片和明细表格都已刷新，并且没有空白区域。',
        tags: ['图表', '筛选', '回放基线'],
        createdAt: now,
        updatedAt: now,
        steps: [
          {
            id: 'recording-step-001',
            kind: 'navigate',
            title: '进入数据看板',
            detail: '打开 /dashboard 页面并等待图表骨架屏消失。',
          },
          {
            id: 'recording-step-002',
            kind: 'click',
            title: '切换时间范围',
            detail: '点击“近 30 天”筛选项，等待趋势图刷新。',
          },
          {
            id: 'recording-step-003',
            kind: 'click',
            title: '选择业务线',
            detail: '在业务线筛选中选择“企业服务”。',
          },
          {
            id: 'recording-step-004',
            kind: 'assert',
            title: '验证图表与表格',
            detail: '趋势图、指标卡片和表格都展示了企业服务相关数据。',
          },
        ],
      },
    ],
    documents: [],
    testCases: initialWorkflows.map((workflow) => workflowToTestCase(workflow)),
  };
}

export function createInitialStudioState(): StudioState {
  const project = createDemoProject();
  return {
    selectedProjectId: project.id,
    selectedGroupId: project.groups[0]?.id ?? '',
    selectedTestCaseId: project.testCases[0]?.id ?? '',
    selectedRecordingId: project.recordings[0]?.id ?? '',
    projects: [project],
    runDetails: [],
    recentRuns: structuredClone(initialRecentRuns),
    chatEntries: structuredClone(initialChatTimeline),
    runtimeProfile: structuredClone(defaultRuntimeProfile),
    midsceneConfig: structuredClone(defaultMidsceneConfig),
    agentModelConfig: structuredClone(defaultAgentModelConfig),
    appearance: structuredClone(defaultAppearanceConfig),
    startupGuide: {
      completed: false,
    },
    browserSession: {
      ...defaultBrowserSession,
      updatedAt: new Date().toISOString(),
    },
    selectedWorkflowId: project.testCases[0]?.id ?? '',
    workflows: project.testCases.map(testCaseToWorkflow),
  };
}

export function hydrateStudioState(
  rawState: Partial<StudioState> | null | undefined,
): StudioState {
  const initialState = createInitialStudioState();
  if (!rawState) {
    return initialState;
  }

  const migratedProjects =
    Array.isArray(rawState.projects) && rawState.projects.length
      ? rawState.projects.map(normalizeProjectDraft)
      : [
          {
            ...createDemoProject(),
            testCases: Array.isArray(rawState.workflows)
              ? rawState.workflows.map((workflow) =>
                  workflowToTestCase(normalizeWorkflowDraft(workflow)),
                )
              : initialState.projects[0].testCases,
          },
        ];

  const selectedProjectId =
    rawState.selectedProjectId && migratedProjects.some((project) => project.id === rawState.selectedProjectId)
      ? rawState.selectedProjectId
      : migratedProjects[0]?.id ?? '';
  const selectedProject = migratedProjects.find((project) => project.id === selectedProjectId);
  const selectedGroupId =
    rawState.selectedGroupId && selectedProject?.groups.some((group) => group.id === rawState.selectedGroupId)
      ? rawState.selectedGroupId
      : selectedProject?.groups[0]?.id ?? '';
  const selectedTestCaseId =
    rawState.selectedTestCaseId &&
    selectedProject?.testCases.some((testCase) => testCase.id === rawState.selectedTestCaseId)
      ? rawState.selectedTestCaseId
      : selectedProject?.testCases[0]?.id ?? '';
  const selectedRecordingId =
    rawState.selectedRecordingId &&
    selectedProject?.recordings.some((recording) => recording.id === rawState.selectedRecordingId)
      ? rawState.selectedRecordingId
      : selectedProject?.recordings[0]?.id ?? '';
  const rawMidsceneConfig = (rawState.midsceneConfig ?? {}) as Partial<MidsceneConfig> & {
    endpoint?: string;
    workspaceName?: string;
  };
  const hydratedMidsceneConfig = {
    ...initialState.midsceneConfig,
    ...rawMidsceneConfig,
    modelBaseUrl: rawMidsceneConfig.modelBaseUrl ?? rawMidsceneConfig.endpoint ?? '',
    modelName: rawMidsceneConfig.modelName ?? rawMidsceneConfig.workspaceName ?? '',
  };
  const rawAgentModelConfig = (rawState.agentModelConfig ?? {}) as Partial<AgentModelConfig>;
  const hydratedAgentModelConfig = (Object.keys(initialState.agentModelConfig) as AgentModelRole[]).reduce(
    (nextConfig, role) => ({
      ...nextConfig,
      [role]: {
        ...initialState.agentModelConfig[role],
        ...rawAgentModelConfig[role],
      },
    }),
    {} as AgentModelConfig,
  );
  const rawStartupGuide: Partial<StartupGuideState> = rawState.startupGuide ?? {};

  return {
    selectedProjectId,
    selectedGroupId,
    selectedTestCaseId,
    selectedRecordingId,
    projects: migratedProjects,
    runDetails: Array.isArray(rawState.runDetails) ? rawState.runDetails : initialState.runDetails,
    recentRuns: Array.isArray(rawState.recentRuns)
      ? rawState.recentRuns
      : initialState.recentRuns,
    chatEntries: Array.isArray(rawState.chatEntries)
      ? rawState.chatEntries
      : initialState.chatEntries,
    runtimeProfile: {
      ...initialState.runtimeProfile,
      ...(rawState.runtimeProfile ?? {}),
    },
    midsceneConfig: hydratedMidsceneConfig,
    agentModelConfig: hydratedAgentModelConfig,
    appearance: {
      ...initialState.appearance,
      ...(rawState.appearance ?? {}),
    },
    startupGuide: {
      ...initialState.startupGuide,
      ...rawStartupGuide,
      completed: rawStartupGuide.completed ?? isMidsceneConfigured(hydratedMidsceneConfig),
    },
    browserSession: {
      ...initialState.browserSession,
      ...(rawState.browserSession ?? {}),
    },
    selectedWorkflowId: selectedTestCaseId,
    workflows: selectedProject?.testCases.map(testCaseToWorkflow) ?? initialState.workflows,
  };
}

export function isMidsceneConfigured(config: MidsceneConfig): boolean {
  return Boolean(
    config.modelBaseUrl.trim() &&
      config.modelApiKey.trim() &&
      config.modelName.trim() &&
      config.modelFamily.trim(),
  );
}

function inferWorkflowKind(steps: WorkflowStepDraft[]): WorkflowKind {
  const scores = steps.reduce(
    (current, step) => {
      if (step.type === 'aiAssert') {
        current.assertion += 1;
      } else if (step.type === 'aiQuery') {
        current.extraction += 1;
      } else {
        current.scenario += 1;
      }
      return current;
    },
    {
      scenario: 0,
      assertion: 0,
      extraction: 0,
    },
  );

  if (scores.extraction >= scores.scenario && scores.extraction >= scores.assertion) {
    return 'extraction';
  }

  if (scores.assertion >= scores.scenario && scores.assertion >= scores.extraction) {
    return 'assertion';
  }

  return 'scenario';
}

function normalizeWorkflowDraft(rawWorkflow: WorkflowDraft): WorkflowDraft {
  return {
    ...rawWorkflow,
    kind: rawWorkflow.kind ?? inferWorkflowKind(rawWorkflow.steps),
    steps: Array.isArray(rawWorkflow.steps) ? rawWorkflow.steps : [],
  };
}

function normalizeProjectDraft(rawProject: ProjectDraft): ProjectDraft {
  const fallback = createDemoProject();
  const environments = Array.isArray(rawProject.environments) && rawProject.environments.length
    ? rawProject.environments
    : fallback.environments;
  const groups = Array.isArray(rawProject.groups) && rawProject.groups.length
    ? rawProject.groups
    : fallback.groups;
  const environmentId = rawProject.selectedEnvironmentId || environments[0]?.id || '';
  const recordings = Array.isArray(rawProject.recordings)
    ? rawProject.recordings.map((recording) => ({
        ...recording,
        groupId: recording.groupId || groups[0]?.id || '',
        environmentId: recording.environmentId || environmentId,
        startUrl: recording.startUrl || rawProject.defaultUrl || fallback.defaultUrl,
        comparisonGoal:
          recording.comparisonGoal || '回放录制路径后，断言页面状态与基线一致。',
        visualDiffThreshold:
          typeof recording.visualDiffThreshold === 'number' && Number.isFinite(recording.visualDiffThreshold)
            ? Math.min(1, Math.max(0, recording.visualDiffThreshold))
            : 0,
        visualDiffMasks: normalizeVisualDiffMasks(recording.visualDiffMasks),
        tags: Array.isArray(recording.tags) ? recording.tags : [],
        steps: Array.isArray(recording.steps)
          ? recording.steps.map((step) => ({
              ...step,
              pageUrl: step.pageUrl,
              screenshotPath: step.screenshotPath,
              capturedAt: step.capturedAt,
              selector: step.selector,
              value: step.value,
            }))
          : [],
      }))
    : [];

  return {
    ...fallback,
    ...rawProject,
    selectedEnvironmentId: environmentId,
    environments,
    groups,
    credentialRefs: Array.isArray(rawProject.credentialRefs) ? rawProject.credentialRefs : [],
    recordings,
    documents: Array.isArray(rawProject.documents)
      ? rawProject.documents.map(normalizePrdDocument)
      : [],
    testCases: Array.isArray(rawProject.testCases)
      ? rawProject.testCases.map((testCase) => ({
          ...testCase,
          groupId: testCase.groupId || groups[0]?.id || '',
          environmentId: testCase.environmentId || environmentId,
          source: testCase.source || 'manual',
          steps: Array.isArray(testCase.steps) ? testCase.steps : [],
        }))
      : fallback.testCases,
  };
}

function normalizeVisualDiffMasks(rawMasks: unknown): VisualDiffMask[] {
  if (!Array.isArray(rawMasks)) {
    return [];
  }

  return rawMasks.flatMap((rawMask, index) => {
    if (!rawMask || typeof rawMask !== 'object') {
      return [];
    }

    const mask = rawMask as Partial<VisualDiffMask>;
    const values = [mask.x, mask.y, mask.width, mask.height];
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return [];
    }

    const x = Math.min(100, Math.max(0, mask.x!));
    const y = Math.min(100, Math.max(0, mask.y!));
    const width = Math.min(100 - x, Math.max(0, mask.width!));
    const height = Math.min(100 - y, Math.max(0, mask.height!));
    if (!width || !height) {
      return [];
    }

    return [{
      id: typeof mask.id === 'string' && mask.id ? mask.id : `visual-mask-${index + 1}`,
      label: typeof mask.label === 'string' && mask.label.trim() ? mask.label.trim() : `动态区域 ${index + 1}`,
      x,
      y,
      width,
      height,
    }];
  });
}

export function createEmptyWorkflow(
  nextId: number,
  kind: WorkflowKind = 'scenario',
): WorkflowDraft {
  return {
    id: `wf-${String(nextId).padStart(3, '0')}`,
    kind,
    name: `新的流程 ${nextId}`,
    category:
      kind === 'scenario' ? '端到端' : kind === 'assertion' ? '断言验证' : '数据提取',
    lastEdited: '刚刚',
    url: 'https://demo-app.local',
    notes: '在这里补充流程意图、上下文和环境要求。',
    steps: [createStep(kind === 'scenario' ? 'ai' : kind === 'assertion' ? 'aiAssert' : 'aiQuery', nextId)],
  };
}

export function createEmptyProject(nextId: number): ProjectDraft {
  const now = new Date().toISOString();
  const environmentId = `env-${Date.now()}`;
  return {
    id: `project-${Date.now()}`,
    name: `新的测试项目 ${nextId}`,
    description: '用于管理一个 Web 应用的测试环境、分组、用例和运行记录。',
    defaultUrl: 'https://your-app.example.com',
    selectedEnvironmentId: environmentId,
    createdAt: now,
    updatedAt: now,
    credentialRefs: [],
    recordings: [],
    documents: [],
    environments: [
      {
        id: environmentId,
        name: 'Staging',
        kind: 'staging',
        url: 'https://your-app.example.com',
        entryPath: '/',
        browser: 'chromium',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    ],
    groups: [
      {
        id: `group-${Date.now()}`,
        name: '默认分组',
        description: '承接第一批自然语言、录制和手工编排用例。',
        createdAt: now,
      },
    ],
    testCases: [],
  };
}

export function createPrdDocumentAsset({
  name,
  kind,
  size,
  sourceText,
}: {
  name: string;
  kind: PrdDocumentKind;
  size: number;
  sourceText: string;
}): PrdDocumentAsset {
  const analysis = analyzePrdText(sourceText, name);
  return {
    id: `doc-${Date.now()}`,
    name,
    kind,
    size,
    uploadedAt: new Date().toISOString(),
    status: analysis.generatedPaths.length ? 'analyzed' : 'draft',
    sourceText,
    summary: analysis.summary,
    coverageAreas: analysis.coverageAreas,
    generatedPaths: analysis.generatedPaths,
  };
}

export function updatePrdDocumentAnalysis(document: PrdDocumentAsset): PrdDocumentAsset {
  const analysis = analyzePrdText(document.sourceText, document.name);
  return {
    ...document,
    status: analysis.generatedPaths.length ? 'analyzed' : 'draft',
    summary: analysis.summary,
    coverageAreas: analysis.coverageAreas,
    generatedPaths: analysis.generatedPaths,
  };
}

export function createTestCaseFromGeneratedPath({
  path,
  groupId,
  environmentId,
  url,
  seed,
}: {
  path: GeneratedTestPath;
  groupId: string;
  environmentId: string;
  url: string;
  seed: number;
}): TestCaseDraft {
  return {
    id: `case-prd-${Date.now()}-${seed}`,
    kind: 'scenario',
    groupId,
    environmentId,
    source: 'prd',
    name: path.title,
    category: path.groupName,
    lastEdited: '刚刚',
    url,
    notes: `${path.priority} · ${path.rationale}`,
    steps: path.steps.map((step, index) => ({
      ...step,
      id: `step-prd-${Date.now()}-${seed}-${index}`,
    })),
  };
}

export function createRecordingFromGeneratedPath({
  path,
  groupId,
  environmentId,
  startUrl,
  seed,
}: {
  path: GeneratedTestPath;
  groupId: string;
  environmentId: string;
  startUrl: string;
  seed: number;
}): RecordingAsset {
  const now = new Date().toISOString();
  return {
    id: `recording-prd-${Date.now()}-${seed}`,
    name: `${path.title} 回放草稿`,
    summary: `由 PRD 路径生成：${path.rationale}`,
    source: 'imported',
    groupId,
    environmentId,
    startUrl,
    comparisonGoal: `回放完成后验证：${path.rationale}`,
    tags: ['PRD', path.priority, path.groupName],
    createdAt: now,
    updatedAt: now,
    steps: path.steps.map((step, index) => ({
      id: `recording-prd-step-${Date.now()}-${seed}-${index}`,
      kind: step.type === 'aiAssert' ? 'assert' : step.type === 'aiQuery' ? 'snapshot' : 'click',
      title: step.title,
      detail: step.body,
    })),
  };
}

export function createEmptyGroup(seed: number): ProjectGroup {
  return {
    id: `group-${Date.now()}-${seed}`,
    name: `业务分组 ${seed}`,
    description: '按模块、页面或核心流程组织测试用例。',
    createdAt: new Date().toISOString(),
  };
}

export function createRecordingStep(
  seed: number,
  kind: RecordingStepKind = 'click',
): RecordingStepDraft {
  const titleMap: Record<RecordingStepKind, string> = {
    navigate: '页面跳转',
    click: '点击控件',
    input: '输入内容',
    wait: '等待页面稳定',
    assert: '核对结果状态',
    snapshot: '捕获页面快照',
  };

  const detailMap: Record<RecordingStepKind, string> = {
    navigate: '打开目标页面并等待首屏内容可见。',
    click: '点击一个关键控件，观察页面状态变化。',
    input: '在输入区域填写有效值并提交。',
    wait: '等待异步请求、图表刷新或表格稳定。',
    assert: '检查当前页面状态是否与录制基线一致。',
    snapshot: '在关键节点捕获快照，供后续回放对比使用。',
  };

  return {
    id: `recording-step-${Date.now()}-${seed}`,
    kind,
    title: titleMap[kind],
    detail: detailMap[kind],
  };
}

export function createEmptyRecordingAsset({
  seed,
  source,
  groupId,
  environmentId,
  startUrl,
}: {
  seed: number;
  source: RecordingSource;
  groupId: string;
  environmentId: string;
  startUrl: string;
}): RecordingAsset {
  const now = new Date().toISOString();
  return {
    id: `recording-${Date.now()}-${seed}`,
    name: source === 'imported' ? `导入回放片段 ${seed}` : `录制片段 ${seed}`,
    summary:
      source === 'imported'
        ? '由外部回放资产导入，可在这里补充上下文、筛选条件和预期结果。'
        : '由项目内录制生成的回放草稿，用于承接真实操作路径与基线对比。',
    source,
    groupId,
    environmentId,
    startUrl,
    comparisonGoal: '回放结束后，断言页面视觉状态、图表数据或表格结果与预期一致。',
    tags: source === 'imported' ? ['导入资产', '待校准'] : ['录制资产', '待回放'],
    createdAt: now,
    updatedAt: now,
    steps:
      source === 'live'
        ? []
        : [
            createRecordingStep(seed, 'navigate'),
            createRecordingStep(seed + 1, 'click'),
            createRecordingStep(seed + 2, 'assert'),
          ],
  };
}

function formatRecordingReplayBody(recording: RecordingAsset): string {
  const kindLabel: Record<RecordingStepKind, string> = {
    navigate: '跳转',
    click: '点击',
    input: '输入',
    wait: '等待',
    assert: '核对',
    snapshot: '快照',
  };

  return [
    `按录制片段「${recording.name}」的时间线执行回放，并对比关键节点结果。`,
    `起始页面：${recording.startUrl}`,
    `对比目标：${recording.comparisonGoal}`,
    '',
    ...recording.steps.map(
      (step, index) =>
        `${index + 1}. [${kindLabel[step.kind]}] ${step.title} - ${step.detail}${step.pageUrl ? ` (URL: ${step.pageUrl})` : ''}${step.screenshotPath ? ` [截图已记录]` : ''}`,
    ),
  ].join('\n');
}

export function createTestCaseFromRecording({
  recording,
  seed,
}: {
  recording: RecordingAsset;
  seed: number;
}): TestCaseDraft {
  return {
    id: `case-recording-${Date.now()}-${seed}`,
    kind: 'recording',
    groupId: recording.groupId,
    environmentId: recording.environmentId,
    source: 'recording',
    name: `${recording.name} 回放校验`,
    category: '录制回放',
    lastEdited: '刚刚',
    url: recording.startUrl,
    notes: recording.summary,
    steps: [
      {
        id: `step-recording-${Date.now()}-${seed}-replay`,
        type: 'recordingReplay',
        title: '回放录制片段',
        body: formatRecordingReplayBody(recording),
        recordingId: recording.id,
      },
      {
        id: `step-recording-${Date.now()}-${seed}-assert`,
        type: 'aiAssert',
        title: '断言回放结果',
        body: recording.comparisonGoal,
      },
    ],
  };
}

export function findDefaultRecordingForCaseStep(
  recordings: RecordingAsset[],
  groupId: string,
  environmentId: string,
): RecordingAsset | undefined {
  return (
    recordings.find((recording) => recording.groupId === groupId && recording.environmentId === environmentId) ??
    recordings.find((recording) => recording.environmentId === environmentId) ??
    recordings.find((recording) => recording.groupId === groupId) ??
    recordings[0]
  );
}

export function detachRecordingFromTestCases(
  testCases: TestCaseDraft[],
  recordingId: string,
): { testCases: TestCaseDraft[]; affectedSteps: number } {
  let affectedSteps = 0;
  const nextTestCases = testCases.map((testCase) => ({
    ...testCase,
    steps: testCase.steps.map((step) => {
      if (step.type !== 'recordingReplay' || step.recordingId !== recordingId) {
        return step;
      }

      affectedSteps += 1;
      return {
        ...step,
        recordingId: undefined,
        body: '原绑定录制资产已删除，请重新选择录制资产后再执行回放。',
      };
    }),
  }));

  return { testCases: nextTestCases, affectedSteps };
}

export function createEmptyTestCase(
  seed: number,
  groupId: string,
  environmentId: string,
): TestCaseDraft {
  return {
    id: `case-${Date.now()}-${seed}`,
    kind: 'scenario',
    groupId,
    environmentId,
    source: 'manual',
    name: `新的测试用例 ${seed}`,
    category: '核心链路',
    lastEdited: '刚刚',
    url: 'https://your-app.example.com',
    notes: '描述这个用例覆盖的业务意图、前置条件和关键断言。',
    steps: [createStep('ai', seed)],
  };
}

export function createStep(type: StepType, seed: number): WorkflowStepDraft {
  const titleMap: Record<StepType, string> = {
    ai: '自然语言动作',
    aiAssert: '自然语言断言',
    aiQuery: '自然语言提取',
  };

  return {
    id: `step-${Date.now()}-${seed}`,
    type,
    title: titleMap[type],
    body:
      type === 'ai'
        ? '描述页面动作，例如：点击主 CTA 并等待下一屏稳定。'
        : type === 'aiAssert'
          ? '描述你希望成立的页面状态。'
          : '描述你希望从页面提取的信息。',
  };
}

export function createTestStep(
  type: TestStepType,
  seed: number,
  recording?: Pick<RecordingAsset, 'id' | 'name' | 'steps'>,
): TestStepDraft {
  if (type === 'ai' || type === 'aiAssert' || type === 'aiQuery') {
    return createStep(type, seed);
  }

  return {
    id: `step-${Date.now()}-${seed}`,
    type,
    title: type === 'recordingReplay' ? '录制回放步骤' : '人工检查步骤',
    body:
      type === 'recordingReplay'
        ? recording
          ? `回放录制资产「${recording.name}」，共 ${recording.steps.length} 个节点。`
          : '选择一段录制资产并按顺序回放。'
        : '记录需要人工确认的状态。',
    ...(type === 'recordingReplay' && recording ? { recordingId: recording.id } : {}),
  };
}

export function insertTestStep(steps: TestStepDraft[], step: TestStepDraft, index: number): TestStepDraft[] {
  const insertionIndex = Math.max(0, Math.min(index, steps.length));
  return [...steps.slice(0, insertionIndex), step, ...steps.slice(insertionIndex)];
}

export function moveTestStep(steps: TestStepDraft[], stepId: string, index: number): TestStepDraft[] {
  const sourceIndex = steps.findIndex((step) => step.id === stepId);
  if (sourceIndex < 0) {
    return steps;
  }

  const nextSteps = [...steps];
  const [step] = nextSteps.splice(sourceIndex, 1);
  const requestedIndex = Math.max(0, Math.min(index, steps.length));
  const insertionIndex = sourceIndex < requestedIndex ? requestedIndex - 1 : requestedIndex;
  nextSteps.splice(insertionIndex, 0, step);
  return nextSteps;
}

export function copyTestStep(steps: TestStepDraft[], stepId: string, copyId: string): TestStepDraft[] {
  const sourceIndex = steps.findIndex((step) => step.id === stepId);
  if (sourceIndex < 0) {
    return steps;
  }

  return insertTestStep(steps, { ...steps[sourceIndex], id: copyId }, sourceIndex + 1);
}

export function removeTestStep(steps: TestStepDraft[], stepId: string): TestStepDraft[] {
  return steps.filter((step) => step.id !== stepId);
}

export function getTestCaseRunBlocker(
  testCase: TestCaseDraft,
  recordings: RecordingAsset[],
): TestCaseRunBlocker | undefined {
  if (!testCase.steps.length) {
    return 'emptySteps';
  }

  for (const step of testCase.steps) {
    if (!step.title.trim()) {
      return 'emptyTitle';
    }

    if (step.type === 'recordingReplay') {
      if (!step.recordingId || !recordings.some((recording) => recording.id === step.recordingId)) {
        return 'missingRecording';
      }
    } else if (!step.body.trim()) {
      return 'emptyInstruction';
    }
  }

  return undefined;
}

function normalizePrdDocument(rawDocument: PrdDocumentAsset): PrdDocumentAsset {
  return {
    ...rawDocument,
    status: rawDocument.status ?? 'draft',
    sourceText: rawDocument.sourceText ?? '',
    summary: rawDocument.summary ?? '尚未分析',
    coverageAreas: Array.isArray(rawDocument.coverageAreas) ? rawDocument.coverageAreas : [],
    generatedPaths: Array.isArray(rawDocument.generatedPaths)
      ? rawDocument.generatedPaths
      : [],
  };
}

function analyzePrdText(sourceText: string, documentName: string) {
  const text = sourceText.trim();
  if (!text || text.length < 20) {
    return {
      summary: '文档内容不足。请粘贴 PRD 关键需求，或上传可读取的文本/Markdown 文件。',
      coverageAreas: [],
      generatedPaths: [],
    };
  }

  const lower = text.toLowerCase();
  const has = (keywords: string[]) => keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  const generatedPaths: GeneratedTestPath[] = [];
  const coverageAreas: string[] = [];
  const addPath = (path: Omit<GeneratedTestPath, 'id'>) => {
    generatedPaths.push({
      ...path,
      id: `path-${generatedPaths.length + 1}-${Date.now()}`,
    });
    coverageAreas.push(path.groupName);
  };

  if (has(['登录', '账号', '密码', '权限', 'login', 'auth'])) {
    addPath({
      title: '登录与权限前置校验',
      priority: 'P0',
      groupName: '账号权限',
      rationale: 'PRD 涉及账号、登录或权限，自动生成进入业务页面前的前置链路。',
      steps: [
        {
          id: 'draft-login-open',
          type: 'ai',
          title: '打开登录入口',
          body: '打开应用登录页，输入项目环境配置中的测试账号和密码并提交。',
        },
        {
          id: 'draft-login-assert',
          type: 'aiAssert',
          title: '验证登录成功',
          body: '断言页面进入工作台或目标业务页面，并且没有出现登录错误提示。',
        },
      ],
    });
  }

  if (has(['图表', '趋势', '看板', 'dashboard', 'chart', '报表'])) {
    addPath({
      title: '图表看板核心展示校验',
      priority: 'P0',
      groupName: '图表看板',
      rationale: '目标系统以图表展示为主，需要校验图表加载、筛选联动和关键指标。',
      steps: [
        {
          id: 'draft-chart-open',
          type: 'ai',
          title: '进入图表页面',
          body: '打开 PRD 描述的图表或看板页面，等待主要图表区域稳定。',
        },
        {
          id: 'draft-chart-assert',
          type: 'aiAssert',
          title: '断言图表可见',
          body: '断言页面至少展示一个主要图表，坐标轴、图例或指标卡片不是空状态。',
        },
        {
          id: 'draft-chart-query',
          type: 'aiQuery',
          title: '提取关键指标',
          body: '提取首屏核心指标名称和当前数值，保存为 chartMetricSnapshot。',
        },
      ],
    });
  }

  if (has(['表格', '列表', '排序', '分页', 'table', 'grid'])) {
    addPath({
      title: '表格列表筛选与排序校验',
      priority: 'P0',
      groupName: '表格列表',
      rationale: 'PRD 涉及表格/列表操作，需要覆盖数据加载、排序、分页和空状态。',
      steps: [
        {
          id: 'draft-table-open',
          type: 'ai',
          title: '进入列表页面',
          body: '打开目标列表或表格页面，等待表格数据加载完成。',
        },
        {
          id: 'draft-table-assert',
          type: 'aiAssert',
          title: '断言表格结构',
          body: '断言表格存在表头和至少一行数据，或在无数据时展示明确空状态。',
        },
        {
          id: 'draft-table-sort',
          type: 'ai',
          title: '触发排序或分页',
          body: '点击一个可排序列或分页控件，等待表格内容刷新。',
        },
      ],
    });
  }

  if (has(['筛选', '过滤', '查询', '搜索', 'filter', 'search'])) {
    addPath({
      title: '搜索筛选条件联动校验',
      priority: 'P1',
      groupName: '查询筛选',
      rationale: 'PRD 提到查询/筛选能力，需要验证条件输入、结果刷新和清空条件。',
      steps: [
        {
          id: 'draft-filter-input',
          type: 'ai',
          title: '输入筛选条件',
          body: '在筛选区域输入一个有效查询条件并提交搜索。',
        },
        {
          id: 'draft-filter-assert',
          type: 'aiAssert',
          title: '断言筛选生效',
          body: '断言结果区域刷新，并且列表或图表内容与筛选条件相关。',
        },
        {
          id: 'draft-filter-reset',
          type: 'ai',
          title: '清空筛选条件',
          body: '点击重置或清空条件，等待页面恢复默认查询状态。',
        },
      ],
    });
  }

  if (has(['导出', '下载', 'excel', 'csv', 'download', 'export'])) {
    addPath({
      title: '数据导出入口校验',
      priority: 'P1',
      groupName: '导出下载',
      rationale: 'PRD 涉及导出/下载，需要确认按钮状态、权限和触发反馈。',
      steps: [
        {
          id: 'draft-export-open',
          type: 'ai',
          title: '定位导出入口',
          body: '在当前列表或报表页面找到导出、下载或 Excel 按钮。',
        },
        {
          id: 'draft-export-assert',
          type: 'aiAssert',
          title: '断言导出可用',
          body: '断言导出入口可点击，或在无权限时展示明确禁用/提示状态。',
        },
      ],
    });
  }

  if (has(['新增', '创建', '编辑', '修改', '删除', '保存', '提交', 'create', 'edit', 'delete', 'save', 'submit'])) {
    addPath({
      title: '数据维护增删改校验',
      priority: 'P1',
      groupName: '数据维护',
      rationale: 'PRD 涉及新增、编辑、删除或保存提交，需要覆盖表单输入、校验反馈和数据变更结果。',
      steps: [
        {
          id: 'draft-crud-open',
          type: 'ai',
          title: '进入维护页面',
          body: '打开 PRD 对应的数据维护页面，等待表单、列表或操作按钮可用。',
        },
        {
          id: 'draft-crud-action',
          type: 'ai',
          title: '执行数据变更',
          body: '按 PRD 描述完成新增、编辑、删除或保存提交操作，并观察页面反馈。',
        },
        {
          id: 'draft-crud-assert',
          type: 'aiAssert',
          title: '断言变更结果',
          body: '断言页面出现成功提示，列表或详情数据与刚才的操作结果一致。',
        },
      ],
    });
  }

  if (has(['审批', '审核', '流转', '状态', '驳回', 'approve', 'review', 'workflow', 'status'])) {
    addPath({
      title: '流程状态流转校验',
      priority: 'P1',
      groupName: '流程状态',
      rationale: 'PRD 涉及审批或状态流转，需要验证角色动作、状态变化和异常分支。',
      steps: [
        {
          id: 'draft-status-open',
          type: 'ai',
          title: '进入流程详情',
          body: '打开一个满足前置条件的流程或审批详情页面。',
        },
        {
          id: 'draft-status-action',
          type: 'ai',
          title: '执行流转动作',
          body: '点击审批、驳回、提交或流转按钮，填写必要意见并提交。',
        },
        {
          id: 'draft-status-assert',
          type: 'aiAssert',
          title: '验证状态变化',
          body: '断言流程状态、操作按钮和提示信息符合 PRD 对该节点的预期。',
        },
      ],
    });
  }

  if (has(['告警', '异常', '错误', '提示', '校验', 'alert', 'warning', 'error', 'validation'])) {
    addPath({
      title: '异常提示与校验校验',
      priority: 'P2',
      groupName: '异常校验',
      rationale: 'PRD 提到异常、告警或输入校验，需要覆盖无效输入、边界状态和提示文案。',
      steps: [
        {
          id: 'draft-validation-input',
          type: 'ai',
          title: '构造异常输入',
          body: '在目标页面输入无效、缺失或边界条件数据并触发提交或查询。',
        },
        {
          id: 'draft-validation-assert',
          type: 'aiAssert',
          title: '断言错误提示',
          body: '断言页面展示明确错误提示、告警或禁用状态，且不会产生错误数据。',
        },
      ],
    });
  }

  if (!generatedPaths.length) {
    addPath({
      title: `${documentName.replace(/\.[^.]+$/, '')} 需求主路径`,
      priority: 'P1',
      groupName: 'PRD 主路径',
      rationale: '未识别到特定控件关键词，先生成覆盖页面进入、主操作和结果断言的通用路径。',
      steps: [
        {
          id: 'draft-generic-open',
          type: 'ai',
          title: '进入需求页面',
          body: '打开 PRD 对应的业务页面，等待页面主要内容稳定。',
        },
        {
          id: 'draft-generic-action',
          type: 'ai',
          title: '执行主操作',
          body: '按照 PRD 描述完成该页面的主要用户操作。',
        },
        {
          id: 'draft-generic-assert',
          type: 'aiAssert',
          title: '验证操作结果',
          body: '断言页面展示符合 PRD 预期的成功状态、数据变化或提示文案。',
        },
      ],
    });
  }

  return {
    summary: `已从文档中生成 ${generatedPaths.length} 条测试路径，覆盖 ${Array.from(new Set(coverageAreas)).join('、')}。`,
    coverageAreas: Array.from(new Set(coverageAreas)),
    generatedPaths,
  };
}
