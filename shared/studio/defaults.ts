import type {
  AgentModelConfig,
  AgentModelRole,
  AgentRoleModelConfig,
  AppearanceConfig,
  BrowserSessionState,
  ChatEntry,
  MidsceneConfig,
  ModelSecretRef,
  RunSummary,
  RuntimeProfile,
  StudioState,
  WorkflowDraft,
} from '../studio.js';

export const defaultRuntimeProfile: RuntimeProfile = {
  browser: 'chromium',
  baseUrl: '',
  viewport: 'desktop',
  locale: 'zh-CN',
  headless: true,
};

const createEmptyModelSecretRef = (id: string): ModelSecretRef => {
  return {
    id,
    hasKey: false,
    updatedAt: new Date(0).toISOString(),
  };
};

export const defaultMidsceneConfig: MidsceneConfig = {
  modelBaseUrl: '',
  modelSecret: createEmptyModelSecretRef('midscene'),
  modelName: '',
  modelFamily: '',
  preferredLanguage: 'Chinese',
  replanningCycleLimit: '10',
  openaiHttpProxy: '',
  defaultContext: '',
};

const defaultAgentRoleModelConfig = (role: AgentModelRole): AgentRoleModelConfig => ({
  provider: 'reuseMidscene',
  modelBaseUrl: '',
  modelSecret: createEmptyModelSecretRef(`agent:${role}`),
  modelName: '',
  modelFamily: '',
  temperature: '0.2',
  enabled: true,
});

export const defaultAgentModelConfig: AgentModelConfig = {
  planner: defaultAgentRoleModelConfig('planner'),
  executor: defaultAgentRoleModelConfig('executor'),
  verifier: defaultAgentRoleModelConfig('verifier'),
  reporter: defaultAgentRoleModelConfig('reporter'),
};

export const defaultAppearanceConfig: AppearanceConfig = {
  themeMode: 'light',
  localeMode: 'zh-CN',
};

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

export const initialRunLog: string[] = [];

export const createInitialStudioState = (): StudioState => {
  return {
    selectedProjectId: '',
    selectedGroupId: '',
    selectedTestCaseId: '',
    selectedRecordingId: '',
    projects: [],
    projectAssetBindings: [],
    runDetails: [],
    suiteRunRecords: [],
    maintenanceDrafts: [],
    recentRuns: [],
    chatEntries: [],
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
    selectedWorkflowId: '',
    workflows: [],
  };
};
