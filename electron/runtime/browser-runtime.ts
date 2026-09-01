import fs from 'node:fs/promises';

import type { AgentChartObservation, AgentDomInspection, AgentTableObservation } from '../../shared/agent.js';
import type {
  BrowserClickRequest,
  BrowserInputRequest,
  BrowserNavigateRequest,
  BrowserScrollRequest,
  BrowserSelectRequest,
  BrowserSessionRequest,
  BrowserSessionState,
  BrowserWaitForChartStableRequest,
  BrowserWaitForDataReadyRequest,
  BrowserWaitForNetworkIdleRequest,
  BrowserWaitForResponseRequest,
  BrowserWaitForSelectorRequest,
  BrowserWaitRequest,
  ProjectEnvironment,
  RecordingCapturedEvent,
  RecordingStepDraft,
  RecordingStepKind,
  RunArtifact,
  DeterministicFileReference,
  DeterministicTestAction,
} from '../../shared/studio.js';
import { awaitWithRunCancellation, isRunCancelled, throwIfRunCancelled } from './run-cancellation.js';
import { ArtifactManager } from './artifact-manager.js';
import { DurableAtomicFileCommitError } from '../durable-atomic-file.js';
import type { BrowserPoolLease } from './browser-pool.js';

type PlaywrightPage = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  title: () => Promise<string>;
  url: () => string;
  screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown>;
  on: {
    (event: 'console', callback: (message: PlaywrightConsoleMessage) => void): unknown;
    (event: 'requestfailed', callback: (request: PlaywrightRequest) => void): unknown;
  };
  exposeFunction: (name: string, callback: (...args: unknown[]) => unknown) => Promise<unknown>;
  addInitScript: (script: string | { content: string }) => Promise<unknown>;
  evaluate: <TArg = unknown>(script: string | ((arg: TArg) => unknown), arg?: TArg) => Promise<unknown>;
  click: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  fill: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
  selectOption: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
  waitForLoadState: (state: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }) => Promise<unknown>;
  waitForResponse: (
    predicate: string | RegExp | ((response: PlaywrightResponse) => boolean),
    options?: { timeout?: number },
  ) => Promise<unknown>;
  waitForSelector: (selector: string, options?: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' }) => Promise<unknown>;
  waitForTimeout: (timeout: number) => Promise<unknown>;
  waitForEvent: {
    (event: 'popup'): Promise<PlaywrightPage>;
    (event: 'download'): Promise<PlaywrightDownload>;
  };
  frameLocator: (selector: string) => PlaywrightFrameLocator;
  hover: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  locator: (selector: string) => PlaywrightLocator;
  setInputFiles: (selector: string, files: string, options?: { timeout?: number }) => Promise<unknown>;
  route: (url: string, handler: (route: PlaywrightRoute) => Promise<void>) => Promise<unknown>;
  unroute: (url: string, handler?: (route: PlaywrightRoute) => Promise<void>) => Promise<unknown>;
  close?: () => Promise<unknown>;
};

type PlaywrightLocator = {
  click: (options?: { timeout?: number }) => Promise<unknown>;
  dragTo: (
    target: PlaywrightLocator,
    options?: { sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number } },
  ) => Promise<unknown>;
};

type PlaywrightFrameLocator = {
  locator: (selector: string) => PlaywrightLocator;
};

type PlaywrightDownload = {
  suggestedFilename: () => string;
  saveAs: (path: string) => Promise<void>;
  delete?: () => Promise<void>;
};

type PlaywrightRoute = {
  request: () => { method: () => string };
  fulfill: (options: { status: number; contentType: string; body: string }) => Promise<void>;
  continue: () => Promise<void>;
};

type PlaywrightConsoleMessage = {
  type: () => string;
  text: () => string;
};

type PlaywrightRequest = {
  method: () => string;
  url: () => string;
  failure: () => { errorText: string } | null;
};

type PlaywrightResponse = {
  url: () => string;
  status: () => number;
  request?: () => { method: () => string };
};

export interface RecordingReplayResult {
  step: RecordingStepDraft;
  status: 'passed' | 'failed';
  message: string;
  screenshotPath?: string;
  artifact?: RunArtifact;
}

export interface BrowserObservationSnapshot {
  textSummary: string;
  domSummary: string;
  interactiveElements: string[];
  consoleMessages: string[];
  networkHints: string[];
  tables: AgentTableObservation[];
  charts: AgentChartObservation[];
}

/** Main-process-only resolver. Serialized authentication state never crosses renderer IPC. */
export interface BrowserStorageStateResolver {
  resolve: (projectId: string, storageStateId: string) => Promise<{ serializedState: string }>;
}

type PlaywrightContext = {
  newPage: () => Promise<PlaywrightPage>;
  grantPermissions?: (permissions: string[], options?: { origin?: string }) => Promise<unknown>;
  storageState: () => Promise<unknown>;
  tracing: {
    start: (options?: { screenshots?: boolean; snapshots?: boolean; sources?: boolean }) => Promise<unknown>;
    stop: (options?: { path?: string }) => Promise<unknown>;
  };
};

type PlaywrightBrowser = {
  newContext: (options?: Record<string, unknown>) => Promise<PlaywrightContext>;
  close: () => Promise<unknown>;
};

type PlaywrightModule = {
  chromium?: { launch: (options?: Record<string, unknown>) => Promise<PlaywrightBrowser> };
  firefox?: { launch: (options?: Record<string, unknown>) => Promise<PlaywrightBrowser> };
  webkit?: { launch: (options?: Record<string, unknown>) => Promise<PlaywrightBrowser> };
};

type RunScreenshotCheckpoint = 'preStep' | 'postStep' | 'failure';

type ControlledDeterministicAction = Extract<
  DeterministicTestAction,
  { kind: 'iframe' | 'tab' | 'upload' | 'download' | 'hover' | 'drag' | 'clipboard' | 'networkObserve' | 'networkMock' }
>;

export interface ControlledDeterministicActionRequest {
  runId: string;
  action: ControlledDeterministicAction;
  /** Main-only resolver; a project asset never contains or receives a local path. */
  resolveUploadPath?: (reference: DeterministicFileReference) => Promise<string>;
  cancellationSignal?: AbortSignal;
}

export interface ControlledDeterministicActionResult {
  message: string;
  artifacts: RunArtifact[];
}

const describeBrowserLaunchFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/executable doesn't exist|playwright install/i.test(message)) {
    return '未检测到 Playwright 浏览器内核。请安装 Chromium 后重新启动受控浏览器会话。';
  }

  return '浏览器启动失败，请检查浏览器运行环境后重试。';
};

const screenshotCheckpointLabel = (checkpoint: RunScreenshotCheckpoint): string => {
  if (checkpoint === 'postStep') {
    return '步骤后页面截图';
  }
  if (checkpoint === 'failure') {
    return '失败页面截图';
  }
  return '运行起始截图';
};

/** Query strings can contain tokens; diagnostic evidence retains origin and path only. */
const redactDiagnosticUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
};

export class BrowserRuntime {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;
  private page: PlaywrightPage | null = null;
  private pendingTraceRunId: string | null = null;
  private trace: { runId: string; path: string } | null = null;
  private recordingEnabled = true;
  private consoleMessages: string[] = [];
  private networkHints: string[] = [];
  private readonly activeRouteMocks: Array<{ runId: string; url: string; handler: (route: PlaywrightRoute) => Promise<void> }> = [];
  private state: BrowserSessionState;
  private workerClosePromise: Promise<void> | undefined;

  constructor(
    private readonly rootDir: string,
    private readonly artifacts: ArtifactManager,
    private readonly emitRecordingEvent?: (event: RecordingCapturedEvent) => void,
    private readonly storageStateResolver?: BrowserStorageStateResolver,
    /** A Suite-only lease. Worker runtimes never own or update interactive browser state. */
    private readonly workerLease?: BrowserPoolLease,
  ) {
    this.state = {
      id: 'session-idle',
      status: 'idle',
      currentUrl: '',
      pageTitle: '尚未启动浏览器',
      message: '选择项目环境后启动受控浏览器会话。',
      updatedAt: new Date().toISOString(),
    };
  }

  getPage(): PlaywrightPage | null {
    return this.page;
  }

  hasRealPage(): boolean {
    return Boolean(this.page);
  }

  /** Executes one preflight-approved structured interaction against the active real page. */
  async executeControlledDeterministicAction(
    request: ControlledDeterministicActionRequest,
  ): Promise<ControlledDeterministicActionResult> {
    const page = this.page;
    if (!page) {
      throw new Error('A controlled deterministic interaction requires a real BrowserRuntime page.');
    }
    throwIfRunCancelled(request.cancellationSignal);
    const action = request.action;

    switch (action.kind) {
      case 'iframe':
        await awaitWithRunCancellation(
          page.frameLocator(action.frame.locator.selector).locator(action.locator.selector).click({ timeout: 10_000 }),
          request.cancellationSignal,
        );
        return { message: 'Completed approved same-origin iframe interaction.', artifacts: [] };
      case 'tab': {
        const popup = page.waitForEvent('popup');
        await awaitWithRunCancellation(
          page.evaluate((url) => window.open(url, '_blank', 'noopener,noreferrer'), action.url),
          request.cancellationSignal,
        );
        await awaitWithRunCancellation(popup, request.cancellationSignal);
        return { message: 'Opened approved tab.', artifacts: [] };
      }
      case 'upload': {
        if (!request.resolveUploadPath) {
          throw new Error('The approved upload reference could not be resolved in the main process.');
        }
        const uploadPath = await request.resolveUploadPath(action.fileRef);
        throwIfRunCancelled(request.cancellationSignal);
        await awaitWithRunCancellation(
          page.setInputFiles(action.locator.selector, uploadPath, { timeout: 10_000 }),
          request.cancellationSignal,
        );
        return { message: 'Completed approved main-owned file upload.', artifacts: [] };
      }
      case 'download':
        return this.executeDownload(page, { ...request, action });
      case 'hover':
        await awaitWithRunCancellation(page.hover(action.locator.selector, { timeout: 10_000 }), request.cancellationSignal);
        return { message: 'Completed approved hover interaction.', artifacts: [] };
      case 'drag': {
        const options = {
          ...(action.sourcePosition ? { sourcePosition: action.sourcePosition } : {}),
          ...(action.targetPosition ? { targetPosition: action.targetPosition } : {}),
        };
        await awaitWithRunCancellation(
          page.locator(action.source.selector).dragTo(page.locator(action.target.selector), options),
          request.cancellationSignal,
        );
        return { message: 'Completed approved drag interaction.', artifacts: [] };
      }
      case 'clipboard':
        await this.grantCurrentPageClipboardPermission();
        await awaitWithRunCancellation(
          page.evaluate(async ({ locator, value }) => {
            if (locator && !document.querySelector(locator)) {
              throw new Error('Clipboard target is no longer present.');
            }
            if (!navigator.clipboard?.writeText) {
              throw new Error('Clipboard access is unavailable in the controlled browser context.');
            }
            await navigator.clipboard.writeText(value);
          }, { locator: action.locator?.selector, value: action.value }),
          request.cancellationSignal,
        );
        return { message: 'Completed approved clipboard write.', artifacts: [] };
      case 'networkObserve': {
        const response = await awaitWithRunCancellation(
          page.waitForResponse((candidate) =>
            candidate.url() === action.url &&
            (!action.method || candidate.request?.().method() === action.method),
          ),
          request.cancellationSignal,
        ) as PlaywrightResponse;
        const artifact = await this.artifacts.createDiagnosticArtifact(request.runId, 'Observed network response', {
          kind: 'networkObserve',
          url: redactDiagnosticUrl(response.url()),
          method: action.method,
          status: response.status(),
        });
        return { message: 'Recorded approved network response metadata.', artifacts: [artifact] };
      }
      case 'networkMock': {
        const handler = async (route: PlaywrightRoute) => {
          if (route.request().method() !== action.method) {
            await route.continue();
            return;
          }
          await route.fulfill({
            status: action.response.status,
            contentType: action.response.contentType ?? 'application/json',
            body: JSON.stringify(action.response.body),
          });
        };
        const registration = page.route(action.url, handler);
        try {
          await awaitWithRunCancellation(registration, request.cancellationSignal);
        } catch (error) {
          if (isRunCancelled(error)) {
            await registration.then(
              async () => { await page.unroute(action.url, handler); },
              () => undefined,
            );
          }
          throw error;
        }
        this.activeRouteMocks.push({ runId: request.runId, url: action.url, handler });
        const artifact = await this.artifacts.createDiagnosticArtifact(request.runId, 'Registered network mock', {
          kind: 'networkMock',
          url: redactDiagnosticUrl(action.url),
          method: action.method,
          status: action.response.status,
          contentType: action.response.contentType ?? 'application/json',
        });
        return { message: 'Registered approved network mock.', artifacts: [artifact] };
      }
    }
  }

  /** Creates a private BrowserRuntime over an already-isolated worker context. */
  createWorker(workerLease: BrowserPoolLease): BrowserRuntime {
    return new BrowserRuntime(this.rootDir, this.artifacts, undefined, undefined, workerLease);
  }

  async start(request: BrowserSessionRequest): Promise<BrowserSessionState> {
    const targetUrl = composeEnvironmentUrl(request.environment);
    this.recordingEnabled = request.record !== false;
    this.state = this.patchState({
      id: `session-${Date.now()}`,
      status: 'starting',
      projectId: request.project.id,
      environmentId: request.environment.id,
      currentUrl: targetUrl,
      pageTitle: request.project.name,
      message: '正在启动受控浏览器会话。',
    });

    let storageState: string | undefined;
    if (!this.workerLease && request.environment.storageStateId) {
      try {
        if (!this.storageStateResolver) {
          throw new Error('认证状态执行器尚未初始化。');
        }
        storageState = (await this.storageStateResolver.resolve(
          request.project.id,
          request.environment.storageStateId,
        )).serializedState;
      } catch (error) {
        return this.patchState({
          status: 'error',
          message: error instanceof Error ? error.message : '认证状态无法解析，未启动浏览器会话。',
        });
      }
    }

    if (this.workerLease) {
      try {
        const context = this.workerLease.context as unknown as PlaywrightContext;
        if (typeof context.newPage !== 'function') {
          throw new Error('Worker browser context cannot create a page.');
        }
        this.context = context;
        this.page = await context.newPage();
        this.installObservationListeners(this.page);
        await this.startPendingTrace();
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const screenshot = await this.captureRunScreenshot(this.state.id, 'postStep');
        if (!screenshot) {
          throw new Error('无法捕获独立 Worker 浏览器会话截图。');
        }
        return this.patchState({
          status: 'ready',
          currentUrl: this.page.url(),
          pageTitle: await this.page.title(),
          screenshotPath: screenshot.path,
          message: 'Playwright Worker 会话已启动。',
        });
      } catch (error) {
        return this.patchState({
          status: 'error',
          message: describeBrowserLaunchFailure(error),
        });
      }
    }

    const loaded = await loadPlaywright();
    const launcher = loaded?.[request.environment.browser] ?? loaded?.chromium;
    if (!launcher) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        'Playwright 未安装，已生成会话占位截图',
        request.project.name,
        targetUrl,
      );
      return this.patchState({
        status: 'ready',
        screenshotPath: artifact.path,
        message: '当前未检测到 Playwright，浏览器会话以可验证 stub 方式运行。',
      });
    }

    try {
      const pendingTraceRunId = this.pendingTraceRunId;
      await this.close();
      this.pendingTraceRunId = pendingTraceRunId;
      this.browser = await launcher.launch({ headless: request.environment.headless });
      this.context = await this.browser.newContext({
        locale: request.environment.locale,
        viewport: viewportFor(request.environment.viewport),
        ...(storageState ? { storageState } : {}),
      });
      await this.startPendingTrace();
      this.page = await this.context.newPage();
      this.installObservationListeners(this.page);
      if (this.recordingEnabled) {
        await this.installRecorder(this.page);
      }
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      if (this.recordingEnabled) {
        await this.emitNavigationEvent(targetUrl);
      }
      const screenshot = await this.captureRunScreenshot(this.state.id, 'postStep');
      if (!screenshot) {
        throw new Error('无法捕获真实浏览器会话截图。');
      }
      return this.patchState({
        status: 'ready',
        currentUrl: this.page.url(),
        pageTitle: await this.page.title(),
        screenshotPath: screenshot.path,
        message: 'Playwright Chromium 会话已启动。',
      });
    } catch (error) {
      return this.patchState({
        status: 'error',
        message: describeBrowserLaunchFailure(error),
      });
    }
  }

  async navigate(request: BrowserNavigateRequest): Promise<BrowserSessionState> {
    if (!this.page) {
      return this.patchState({
        status: 'error',
        currentUrl: request.url,
        message: '尚未启动真实浏览器会话，无法导航；请先启动会话。',
      });
    }

    this.patchState({ status: 'navigating', currentUrl: request.url, message: '正在导航页面。' });
    await this.page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await this.emitNavigationEvent(request.url);
    return this.capture();
  }

  async click(request: BrowserClickRequest): Promise<BrowserSessionState> {
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        `点击 ${request.selector}`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: `当前未连接真实 Playwright 页面，已记录点击意图：${request.selector}`,
      });
    }

    await this.page.click(request.selector, { timeout: 10_000 });
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: `已点击元素：${request.selector}`,
    });
  }

  async input(request: BrowserInputRequest): Promise<BrowserSessionState> {
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        `输入 ${request.selector}`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: `当前未连接真实 Playwright 页面，已记录输入意图：${request.selector}`,
      });
    }

    try {
      await this.page.fill(request.selector, request.value, { timeout: 10_000 });
    } catch (error) {
      await this.page.selectOption(request.selector, request.value, { timeout: 10_000 }).catch(() => {
        throw error;
      });
    }
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: `已在 ${request.selector} 输入内容。`,
    });
  }

  async wait(request: BrowserWaitRequest = {}): Promise<BrowserSessionState> {
    const timeoutMs = normalizeWaitMs(request.timeoutMs);
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        `等待 ${timeoutMs}ms`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: `当前未连接真实 Playwright 页面，已记录等待意图：${timeoutMs}ms`,
      });
    }

    await this.page.waitForTimeout(timeoutMs);
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: `已等待页面稳定：${timeoutMs}ms。`,
    });
  }

  async waitForSelector(request: BrowserWaitForSelectorRequest): Promise<BrowserSessionState> {
    const timeoutMs = normalizeWaitMs(request.timeoutMs);
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        `等待 ${request.selector}`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: `当前未连接真实 Playwright 页面，已记录等待 selector 意图：${request.selector}`,
      });
    }

    await this.page.waitForSelector(request.selector, { timeout: timeoutMs, state: 'visible' });
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: `已等待 selector 可见：${request.selector}`,
    });
  }

  async waitForNetworkIdle(request: BrowserWaitForNetworkIdleRequest = {}): Promise<BrowserSessionState> {
    const timeoutMs = normalizeWaitMs(request.timeoutMs);
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        `等待 networkidle ${timeoutMs}ms`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: `当前未连接真实 Playwright 页面，已记录等待 Network idle 意图：${timeoutMs}ms`,
      });
    }

    await this.page.waitForLoadState('networkidle', { timeout: timeoutMs });
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: `已等待页面网络空闲：${timeoutMs}ms。`,
    });
  }

  async waitForResponse(request: BrowserWaitForResponseRequest): Promise<BrowserSessionState> {
    const timeoutMs = normalizeWaitMs(request.timeoutMs);
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        `等待接口响应 ${request.urlPattern}`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: `当前未连接真实 Playwright 页面，已记录等待接口响应意图：${request.urlPattern}`,
      });
    }

    await this.page.waitForResponse(
      (response) => response.url().includes(request.urlPattern) && response.status() < 500,
      { timeout: timeoutMs },
    );
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: `已等待接口响应：${request.urlPattern}`,
    });
  }

  async waitForChartStable(request: BrowserWaitForChartStableRequest = {}): Promise<BrowserSessionState> {
    const timeoutMs = normalizeWaitMs(request.timeoutMs);
    const stableMs = normalizeStableMs(request.stableMs);
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        request.selector ? `等待图表稳定 ${request.selector}` : '等待页面图表稳定',
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: request.selector
          ? `当前未连接真实 Playwright 页面，已记录等待图表稳定意图：${request.selector}`
          : '当前未连接真实 Playwright 页面，已记录等待页面图表稳定意图。',
      });
    }

    const animationLockId = `testbuddy-chart-stability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.page.evaluate(
      ({ selector, lockId }) => {
        const root = selector ? document.querySelector(selector) : document.body;
        if (!root) {
          return false;
        }

        root.setAttribute('data-testbuddy-chart-stability-lock', lockId);
        const style = document.createElement('style');
        style.id = lockId;
        style.textContent = `[data-testbuddy-chart-stability-lock="${lockId}"], [data-testbuddy-chart-stability-lock="${lockId}"] * { animation-play-state: paused !important; animation-duration: 0s !important; transition-duration: 0s !important; scroll-behavior: auto !important; }`;
        document.head.append(style);
        return true;
      },
      { selector: request.selector, lockId: animationLockId },
    );

    try {
      const startedAt = Date.now();
      let lastSignature: string | undefined;
      let stableStartedAt = Date.now();
      while (Date.now() - startedAt <= timeoutMs) {
        const signature = String(
          await this.page.evaluate(
            ({ selector }) => {
            const root = selector ? document.querySelector(selector) : document.body;
            if (!root) {
              return JSON.stringify({ found: false, selector });
            }

            const chartSelector = [
              'canvas',
              'svg',
              '[data-chart]',
              '[role="img"]',
              '.echarts-for-react',
              '.recharts-wrapper',
              '.highcharts-container',
              '.apexcharts-canvas',
            ].join(',');
            const elements = Array.from(
              new Set([
                ...(root.matches(chartSelector) ? [root] : []),
                ...Array.from(root.querySelectorAll(chartSelector)),
              ]),
            );
            const charts = elements.slice(0, 12).map((element) => {
              const rect = element.getBoundingClientRect();
              const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
              const style = window.getComputedStyle(element);
              let rasterSignature: string | undefined;
              if (element instanceof HTMLCanvasElement && element.width > 0 && element.height > 0) {
                try {
                  const sampleCanvas = document.createElement('canvas');
                  sampleCanvas.width = Math.min(48, element.width);
                  sampleCanvas.height = Math.min(48, element.height);
                  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
                  if (context) {
                    context.drawImage(element, 0, 0, sampleCanvas.width, sampleCanvas.height);
                    const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
                    let hash = 2_166_136_261;
                    const stride = Math.max(4, Math.floor(pixels.length / 384 / 4) * 4);
                    for (let offset = 0; offset < pixels.length; offset += stride) {
                      hash ^= pixels[offset]!;
                      hash = Math.imul(hash, 16_777_619);
                      hash ^= pixels[offset + 1]!;
                      hash = Math.imul(hash, 16_777_619);
                      hash ^= pixels[offset + 2]!;
                      hash = Math.imul(hash, 16_777_619);
                    }
                    rasterSignature = `${sampleCanvas.width}x${sampleCanvas.height}:${hash >>> 0}`;
                  }
                } catch {
                  rasterSignature = 'unavailable';
                }
              }
              return {
                tag: element.tagName.toLowerCase(),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                text,
                ...(rasterSignature ? { rasterSignature } : {}),
                visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
              };
            });

            const rootRect = root.getBoundingClientRect();
            return JSON.stringify({
              found: true,
              selector,
              rootWidth: Math.round(rootRect.width),
              rootHeight: Math.round(rootRect.height),
              chartCount: charts.length,
              charts,
            });
          },
          { selector: request.selector },
          ),
        );

        if (signature === lastSignature) {
          if (Date.now() - stableStartedAt >= stableMs) {
            const nextState = await this.capture();
            return this.patchState({
              ...nextState,
              message: request.selector ? `已等待图表动画稳定：${request.selector}` : '已等待页面图表动画稳定。',
            });
          }
        } else {
          lastSignature = signature;
          stableStartedAt = Date.now();
        }

        if (stableMs === 0) {
          const nextState = await this.capture();
          return this.patchState({
            ...nextState,
            message: request.selector ? `已等待图表动画稳定：${request.selector}` : '已等待页面图表动画稳定。',
          });
        }

        await this.page.waitForTimeout(Math.min(150, Math.max(50, timeoutMs - (Date.now() - startedAt))));
      }

      const nextState = await this.capture();
      return this.patchState({
        ...nextState,
        message: request.selector
          ? `图表动画稳定等待超时，已保留当前页面状态：${request.selector}`
          : '页面图表动画稳定等待超时，已保留当前页面状态。',
      });
    } finally {
      await this.page.evaluate(
        ({ selector, lockId }) => {
          const root = selector ? document.querySelector(selector) : document.body;
          if (root?.getAttribute('data-testbuddy-chart-stability-lock') === lockId) {
            root.removeAttribute('data-testbuddy-chart-stability-lock');
          }
          document.getElementById(lockId)?.remove();
        },
        { selector: request.selector, lockId: animationLockId },
      ).catch(() => undefined);
    }
  }

  async waitForDataReady(request: BrowserWaitForDataReadyRequest = {}): Promise<BrowserSessionState> {
    const timeoutMs = normalizeWaitMs(request.timeoutMs);
    const stableMs = normalizeStableMs(request.stableMs);
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        request.selector ? `等待数据就绪 ${request.selector}` : '等待页面数据就绪',
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: request.selector
          ? `当前未连接真实 Playwright 页面，已记录等待数据就绪意图：${request.selector}`
          : '当前未连接真实 Playwright 页面，已记录等待页面数据就绪意图。',
      });
    }

    const startedAt = Date.now();
    let lastReadySignature: string | undefined;
    let stableStartedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const readiness = (await this.page.evaluate(
        ({ selector }) => {
          const root = selector ? document.querySelector(selector) : document.body;
          if (!root) {
            return { ready: false, signature: JSON.stringify({ found: false, selector }) };
          }

          const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
          const hasPendingText = /(?:loading|加载中|载入中|请稍候|暂无数据|无数据|empty|no data|error|错误|失败)/i.test(text);
          const tableRows = Array.from(root.querySelectorAll('tbody tr')).filter(
            (row) => (row.textContent ?? '').trim().length > 0,
          ).length;
          const listItems = Array.from(root.querySelectorAll('[role="row"], [role="listitem"], li')).filter(
            (item) => (item.textContent ?? '').trim().length > 0,
          ).length;
          const chartNodes = root.querySelectorAll('canvas, svg, [data-chart], .echarts-for-react, .recharts-wrapper').length;
          const dataCells = Array.from(root.querySelectorAll('td, [data-value], [data-testid*="value"]')).filter(
            (cell) => (cell.textContent ?? '').trim().length > 0,
          ).length;
          const textSample = text.slice(0, 240);
          const hasData = tableRows > 0 || listItems > 0 || chartNodes > 0 || dataCells > 0 || textSample.length > 0;

          return {
            ready: hasData && !hasPendingText,
            signature: JSON.stringify({
              found: true,
              selector,
              tableRows,
              listItems,
              chartNodes,
              dataCells,
              textSample,
            }),
          };
        },
        { selector: request.selector },
      )) as { ready: boolean; signature: string };

      if (readiness.ready && readiness.signature === lastReadySignature) {
        if (Date.now() - stableStartedAt >= stableMs) {
          const nextState = await this.capture();
          return this.patchState({
            ...nextState,
            message: request.selector ? `已等待数据就绪：${request.selector}` : '已等待页面数据就绪。',
          });
        }
      } else {
        lastReadySignature = readiness.ready ? readiness.signature : undefined;
        stableStartedAt = Date.now();
      }

      if (readiness.ready && stableMs === 0) {
        const nextState = await this.capture();
        return this.patchState({
          ...nextState,
          message: request.selector ? `已等待数据就绪：${request.selector}` : '已等待页面数据就绪。',
        });
      }

      await this.page.waitForTimeout(Math.min(150, Math.max(50, timeoutMs - (Date.now() - startedAt))));
    }

    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: request.selector
        ? `数据就绪等待超时，已保留当前页面状态：${request.selector}`
        : '页面数据就绪等待超时，已保留当前页面状态。',
    });
  }

  async scroll(request: BrowserScrollRequest = {}): Promise<BrowserSessionState> {
    const x = request.x ?? 0;
    const y = request.y ?? 800;
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        request.selector ? `滚动到 ${request.selector}` : `滚动页面 ${y}px`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: request.selector
          ? `当前未连接真实 Playwright 页面，已记录滚动到 selector 的意图：${request.selector}`
          : `当前未连接真实 Playwright 页面，已记录滚动意图：${y}px`,
      });
    }

    await this.page.evaluate(
      ({ selector, x: deltaX, y: deltaY }) => {
        if (selector) {
          const element = document.querySelector(selector);
          if (!element) {
            throw new Error(`未找到滚动目标：${selector}`);
          }
          element.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
        window.scrollBy(deltaX ?? 0, deltaY ?? 0);
      },
      { selector: request.selector, x, y },
    );
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: request.selector ? `已滚动到元素：${request.selector}` : `已滚动页面：${y}px。`,
    });
  }

  async select(request: BrowserSelectRequest): Promise<BrowserSessionState> {
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        `选择 ${request.selector}`,
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: `当前未连接真实 Playwright 页面，已记录下拉选择意图：${request.selector}`,
      });
    }

    await this.page.selectOption(request.selector, request.value, { timeout: 10_000 });
    const nextState = await this.capture();
    return this.patchState({
      ...nextState,
      message: `已在 ${request.selector} 选择 ${request.value}。`,
    });
  }

  async capture(): Promise<BrowserSessionState> {
    if (!this.page) {
      const artifact = await this.artifacts.createSnapshot(
        this.state.id,
        '当前会话快照',
        this.state.pageTitle,
        this.state.currentUrl,
      );
      return this.patchState({
        status: this.state.status === 'idle' ? 'idle' : 'ready',
        screenshotPath: artifact.path,
        message: '已生成当前会话快照。',
      });
    }

    const screenshot = await this.captureRunScreenshot(this.state.id, 'postStep');
    if (!screenshot) {
      throw new Error('无法捕获当前真实页面截图。');
    }
    return this.patchState({
      status: 'ready',
      currentUrl: this.page.url(),
      pageTitle: await this.page.title(),
      screenshotPath: screenshot.path,
      message: '已捕获当前页面截图。',
    });
  }

  /** Main-process-only run evidence; renderer callers receive only its artifact metadata. */
  async captureRunScreenshot(
    runId: string,
    checkpoint: RunScreenshotCheckpoint = 'preStep',
  ): Promise<RunArtifact | null> {
    if (!this.page) {
      return null;
    }

    let screenshotPath: string;
    try {
      screenshotPath = await this.captureScreenshotPath();
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      return null;
    }

    try {
      return await this.artifacts.registerExisting({
        path: screenshotPath,
        type: 'screenshot',
        label: screenshotCheckpointLabel(checkpoint),
        evidenceKind: 'pageScreenshot',
        ownerRunId: runId,
        retentionClass: 'standard',
        protectedBy: checkpoint === 'failure' ? ['failureInvestigation'] : [],
      });
    } catch (error) {
      if (!(error instanceof DurableAtomicFileCommitError)) {
        await fs.rm(screenshotPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Main-process-only snapshot of the authenticated context, never sent to the renderer. */
  async captureStorageState(projectId: string): Promise<string> {
    if (!this.context || this.state.status !== 'ready' || this.state.projectId !== projectId) {
      throw new Error('当前没有属于此项目的真实浏览器会话，无法捕获认证状态。');
    }
    try {
      return JSON.stringify(await this.context.storageState());
    } catch {
      throw new Error('无法从当前浏览器会话捕获认证状态。');
    }
  }

  async getPageText(): Promise<string> {
    if (!this.page) {
      return [this.state.pageTitle, this.state.currentUrl, this.state.message].filter(Boolean).join('\n');
    }

    const text = await this.page.evaluate(() => document.body?.innerText ?? document.documentElement?.textContent ?? '');
    return typeof text === 'string' ? text : '';
  }

  async inspectDom(selector: string, attributeName?: string): Promise<AgentDomInspection> {
    if (!this.page) {
      return { selector, found: false, visible: false, ...(attributeName ? { attribute: { name: attributeName } } : {}) };
    }

    try {
      const inspection = (await this.page.evaluate(
        ({ selector: targetSelector, attributeName: requestedAttribute }) => {
          const element = document.querySelector(targetSelector);
          if (!element) return { found: false, visible: false };
          const style = window.getComputedStyle(element);
          const visible =
            !element.hasAttribute('hidden') &&
            element.getAttribute('aria-hidden') !== 'true' &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0';
          const attributeValue =
            requestedAttribute === 'value' &&
            (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
              ? element.value
              : requestedAttribute === 'checked' && element instanceof HTMLInputElement
                ? String(element.checked)
                : requestedAttribute === 'disabled' &&
                  (element instanceof HTMLButtonElement ||
                    element instanceof HTMLInputElement ||
                    element instanceof HTMLSelectElement ||
                    element instanceof HTMLTextAreaElement)
                  ? String(element.disabled)
                  : requestedAttribute
                    ? element.getAttribute(requestedAttribute) ?? undefined
                    : undefined;
          return {
            found: true,
            visible,
            text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
            ...(requestedAttribute ? { attributeValue } : {}),
          };
        },
        { selector, attributeName },
      )) as { found?: boolean; visible?: boolean; text?: string; attributeValue?: string } | undefined;
      return {
        selector,
        found: Boolean(inspection?.found),
        visible: Boolean(inspection?.visible),
        ...(typeof inspection?.text === 'string' && inspection.text ? { text: inspection.text } : {}),
        ...(attributeName
          ? {
              attribute: {
                name: attributeName,
                ...(typeof inspection?.attributeValue === 'string' ? { value: inspection.attributeValue } : {}),
              },
            }
          : {}),
      };
    } catch {
      return { selector, found: false, visible: false, ...(attributeName ? { attribute: { name: attributeName } } : {}) };
    }
  }

  async captureObservation(): Promise<BrowserObservationSnapshot> {
    if (!this.page) {
      const fallbackSummary = [this.state.pageTitle, this.state.currentUrl, this.state.message]
        .filter(Boolean)
        .join(' / ');
      return {
        textSummary: fallbackSummary,
        domSummary: `未连接真实 Playwright 页面；当前会话状态：${this.state.status}。`,
        interactiveElements: [],
        consoleMessages: [...this.consoleMessages],
        networkHints: [...this.networkHints],
        tables: [],
        charts: [],
      };
    }

    const raw = await this.page.evaluate(() => {
      const text = (document.body?.innerText ?? document.documentElement?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const nodes = Array.from(
        document.querySelectorAll(
          'button,a,input,select,textarea,[role="button"],[role="link"],[data-testid],[data-test],[data-cy]',
        ),
      ).slice(0, 16);
      const labelOf = (element: Element) => {
        const aria = element.getAttribute('aria-label');
        const placeholder = element.getAttribute('placeholder');
        const testId =
          element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy');
        const elementText =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value || placeholder || element.name
            : element.textContent;
        return (aria || placeholder || testId || elementText || element.id || element.tagName)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
      };
      const selectorHintOf = (element: Element) => {
        const testId =
          element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy');
        if (testId) return `[data-testid="${testId}"]`;
        if (element.id) return `#${element.id}`;
        const name = element.getAttribute('name');
        if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
        return element.tagName.toLowerCase();
      };
      const cleanText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const numberAttribute = (element: Element, name: string) => {
        const rawValue = element.getAttribute(name);
        const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      };
      const firstPositiveNumber = (...values: Array<string | null | undefined>) => {
        for (const value of values) {
          const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
          if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return undefined;
      };
      const sizeOf = (element: Element) => {
        const width = numberAttribute(element, 'width') ?? Math.round(element.getBoundingClientRect().width);
        const height = numberAttribute(element, 'height') ?? Math.round(element.getBoundingClientRect().height);
        return {
          ...(width > 0 ? { width } : {}),
          ...(height > 0 ? { height } : {}),
        };
      };
      const parseChartValue = (value: string | null | undefined) => {
        const normalized = (value ?? '').replace(/,/g, '').trim();
        if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      const inferChartTrend = (values: number[]) => {
        if (values.length < 2) return undefined;
        if (values.every((value) => value === values[0])) return 'flat' as const;
        const rising = values.every((value, index) => index === 0 || value >= values[index - 1]!);
        const falling = values.every((value, index) => index === 0 || value <= values[index - 1]!);
        return rising ? ('rising' as const) : falling ? ('falling' as const) : ('mixed' as const);
      };
      const normalizeChartTrend = (value: string) => {
        const normalized = value.toLowerCase();
        if (normalized === 'rising' || normalized === 'up' || normalized === 'increasing') return 'rising' as const;
        if (normalized === 'falling' || normalized === 'down' || normalized === 'decreasing') return 'falling' as const;
        if (normalized === 'flat' || normalized === 'stable') return 'flat' as const;
        return normalized === 'mixed' ? ('mixed' as const) : undefined;
      };
      const tables = Array.from(document.querySelectorAll('table, [role="grid"], [role="table"], [data-grid], [data-table]'))
        .filter(
          (table) =>
            !(
              table.matches('[data-grid], [data-table]') &&
              table.querySelector('table, [role="grid"], [role="table"]')
            ),
        )
        .filter(
          (table, index, allTables) =>
            !allTables.some(
              (candidate, candidateIndex) =>
                candidateIndex !== index && candidate.matches('[role="grid"], [role="table"]') && candidate.contains(table),
            ),
        )
        .slice(0, 6)
        .map((table, index) => {
          const isNativeTable = table.matches('table');
          const isDataGrid = !isNativeTable && !table.matches('[role="grid"], [role="table"]');
          const headerCells = Array.from(
            table.querySelectorAll(isNativeTable ? 'thead th' : isDataGrid ? '[data-column-header]' : '[role="columnheader"]'),
          );
          const fallbackHeaderCells = headerCells.length
            ? []
            : isNativeTable
              ? Array.from(table.querySelectorAll('tr:first-child th, tr:first-child td'))
              : isDataGrid
                ? Array.from(table.querySelector('[data-row]')?.querySelectorAll('[data-column-header], [data-cell]') ?? [])
                : Array.from(
                    table
                      .querySelector('[role="row"]')
                      ?.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]') ?? [],
                  );
          const headers = (headerCells.length ? headerCells : fallbackHeaderCells).map((cell) => cleanText(cell.textContent));
          const sortStates = (headerCells.length ? headerCells : fallbackHeaderCells)
            .map((cell) => {
              const direction = cleanText(cell.getAttribute('aria-sort') || cell.getAttribute('data-sort')).toLowerCase();
              if (!direction) {
                return null;
              }
              const normalizedDirection =
                direction === 'ascending' || direction === 'asc'
                  ? 'ascending'
                  : direction === 'descending' || direction === 'desc'
                    ? 'descending'
                    : direction === 'none'
                      ? 'none'
                      : 'other';
              return {
                column: cleanText(cell.textContent),
                direction: normalizedDirection,
              };
            })
            .filter(Boolean);
          const bodyRows = isNativeTable ? Array.from(table.querySelectorAll('tbody tr')) : [];
          const allRows = isNativeTable ? Array.from(table.querySelectorAll('tr')) : [];
          const ariaRows = isNativeTable
            ? []
            : Array.from(table.querySelectorAll('[role="row"]')).filter((row) =>
                Boolean(row.querySelector('[role="gridcell"], [role="rowheader"], [role="cell"]')),
              );
          const markedRows = isNativeTable
            ? []
            : Array.from(table.querySelectorAll('[data-row]')).filter((row) => Boolean(row.querySelector('[data-cell]')));
          const dataRows = isNativeTable
            ? bodyRows.length
              ? bodyRows
              : allRows.slice(headers.length ? 1 : 0)
            : isDataGrid
              ? markedRows
              : ariaRows;
          const sampleRows = dataRows.slice(0, 3).map((row) =>
            Array.from(
              row.querySelectorAll(
                isNativeTable ? 'th,td' : isDataGrid ? '[data-cell]' : '[role="gridcell"], [role="rowheader"], [role="cell"]',
              ),
            )
              .slice(0, 6)
              .map((cell) => cleanText(cell.textContent)),
          );
          const columnCount = Math.max(headers.length, ...sampleRows.map((row) => row.length), 0);
          const tableScope =
            table.closest('[data-grid], [data-table], [data-table-container], [data-testid*="table" i], [role="region"], section, article') ??
            table.parentElement;
          const filterStates = tableScope
            ? Array.from(tableScope.querySelectorAll('select[data-filter], input[data-filter], [data-filter]'))
                .map((element) => {
                  const control = element as HTMLInputElement | HTMLSelectElement;
                  const label =
                    cleanText(element.getAttribute('data-filter')) ||
                    cleanText(element.getAttribute('aria-label')) ||
                    cleanText(element.getAttribute('name'));
                  const value =
                    cleanText(element.getAttribute('data-filter-value')) ||
                    cleanText('value' in control ? control.value : element.textContent);
                  return label && value ? { label, value } : null;
                })
                .filter((state): state is { label: string; value: string } => Boolean(state))
                .slice(0, 8)
            : [];
          const paginationRoot = tableScope?.querySelector(
            [
              '[data-pagination]',
              '[role="navigation"][aria-label*="page" i]',
              '[role="navigation"][aria-label*="分页"]',
              '[aria-label*="pagination" i]',
              '[aria-label*="分页"]',
              '.ag-paging-panel',
              '[class*="TablePagination"]',
              '.ant-pagination',
              '.el-pagination',
            ].join(', '),
          );
          const paginationText = cleanText(paginationRoot?.textContent);
          const currentPageNode = paginationRoot?.querySelector('[aria-current="page"]');
          const rangePaginationMatch = paginationText.match(/(\d+)\s*(?:to|-|–|~|至)\s*(\d+)\s*(?:of|\/|共)\s*(\d+)/i);
          const rangeStart = rangePaginationMatch?.[1] ? Number.parseInt(rangePaginationMatch[1], 10) : Number.NaN;
          const rangeEnd = rangePaginationMatch?.[2] ? Number.parseInt(rangePaginationMatch[2], 10) : Number.NaN;
          const rangeTotal = rangePaginationMatch?.[3] ? Number.parseInt(rangePaginationMatch[3], 10) : Number.NaN;
          // A terminal range can contain fewer rows than the configured page size, so only a non-terminal range is definitive.
          const rangePageSize =
            Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && Number.isFinite(rangeTotal) && rangeEnd >= rangeStart && rangeEnd < rangeTotal
              ? rangeEnd - rangeStart + 1
              : undefined;
          const rangeCurrentPage = rangePageSize && Number.isFinite(rangeStart) ? Math.floor((rangeStart - 1) / rangePageSize) + 1 : undefined;
          const rangeTotalPages = rangePageSize && Number.isFinite(rangeTotal) ? Math.ceil(rangeTotal / rangePageSize) : undefined;
          const currentPageMatch = rangePaginationMatch ? undefined : paginationText.match(/(?:page\s*)?(\d+)\s*(?:of|\/|共)\s*\d+/i);
          const totalPagesMatch = rangePaginationMatch ? undefined : paginationText.match(/(?:of|\/|共)\s*(\d+)\s*(?:pages?|页)?/i);
          const pagination = {
            currentPage: firstPositiveNumber(
              table.getAttribute('data-current-page'),
              paginationRoot?.getAttribute('data-current-page'),
              currentPageNode?.getAttribute('data-page'),
              currentPageNode?.textContent,
              currentPageMatch?.[1],
              rangeCurrentPage ? String(rangeCurrentPage) : undefined,
            ),
            totalPages: firstPositiveNumber(
              table.getAttribute('data-total-pages'),
              paginationRoot?.getAttribute('data-total-pages'),
              totalPagesMatch?.[1],
              rangeTotalPages ? String(rangeTotalPages) : undefined,
            ),
            totalItems: firstPositiveNumber(
              table.getAttribute('data-total-items'),
              table.getAttribute('aria-rowcount'),
              paginationRoot?.getAttribute('data-total-items'),
              Number.isFinite(rangeTotal) ? String(rangeTotal) : undefined,
            ),
            pageSize: firstPositiveNumber(
              table.getAttribute('data-page-size'),
              paginationRoot?.getAttribute('data-page-size'),
              rangePageSize ? String(rangePageSize) : undefined,
            ),
          };
          const aggregates = (isNativeTable ? Array.from(table.querySelectorAll('tfoot tr')) : [])
            .flatMap((row) =>
              Array.from(row.querySelectorAll('th,td')).map((cell, cellIndex) => {
                const label = cleanText(cell.getAttribute('data-aggregate') || headers[cellIndex]);
                const value = cleanText(cell.getAttribute('data-aggregate-value') || cell.textContent);
                return label && value ? { label, value } : null;
              }),
            )
            .concat(
              isDataGrid
                ? Array.from(table.querySelectorAll('[data-aggregate]')).map((cell) => {
                    const label = cleanText(cell.getAttribute('data-aggregate'));
                    const value = cleanText(cell.getAttribute('data-aggregate-value') || cell.textContent);
                    return label && value ? { label, value } : null;
                  })
                : [],
            )
            .filter((aggregate): aggregate is { label: string; value: string } => Boolean(aggregate))
            .slice(0, 12);
          const explicitCompleteness = cleanText(
            table.getAttribute('data-evidence-completeness') || table.getAttribute('data-completeness'),
          ).toLowerCase();
          const isLoading =
            table.getAttribute('aria-busy') === 'true' ||
            table.getAttribute('data-loading') === 'true' ||
            table.getAttribute('data-state') === 'loading';
          const isVirtualized =
            table.getAttribute('data-virtualized') === 'true' ||
            table.getAttribute('data-virtualization') === 'true';
          const totalItems = pagination.totalItems;
          const evidenceCompleteness = isLoading
            ? 'unknown' as const
            : isVirtualized || explicitCompleteness === 'partial'
              ? 'partial' as const
              : explicitCompleteness === 'complete'
                ? 'complete' as const
                : explicitCompleteness === 'unknown'
                  ? 'unknown' as const
                  : totalItems !== undefined
                    ? totalItems === dataRows.length
                      ? 'complete' as const
                      : 'partial' as const
                    : isNativeTable && !pagination.totalPages
                      ? 'complete' as const
                      : 'unknown' as const;
          return {
            index: index + 1,
            evidenceCompleteness,
            ...(cleanText(table.querySelector('caption')?.textContent) ||
            cleanText(table.getAttribute('aria-label')) ||
            cleanText(table.getAttribute('data-label')) ||
            cleanText(table.getAttribute('data-testid'))
              ? {
                  caption:
                    cleanText(table.querySelector('caption')?.textContent) ||
                    cleanText(table.getAttribute('aria-label')) ||
                    cleanText(table.getAttribute('data-label')) ||
                    cleanText(table.getAttribute('data-testid')),
                }
              : {}),
            rowCount: dataRows.length,
            columnCount,
            headers,
            ...(filterStates.length ? { filters: filterStates } : {}),
            ...(Object.values(pagination).some((value) => value !== undefined) ? { pagination } : {}),
            ...(aggregates.length ? { aggregates } : {}),
            ...(sortStates.length ? { sortStates } : {}),
            sampleRows,
          };
        });
      const chartRootSelector = '[data-chart], .echarts-for-react, .recharts-wrapper, .highcharts-container, .apexcharts-canvas';
      const chartRoots = Array.from(document.querySelectorAll(chartRootSelector)).filter(
        (element, index, roots) => !roots.some((root, rootIndex) => rootIndex !== index && root.contains(element)),
      );
      const directChartVisuals = Array.from(
        document.querySelectorAll('[role="img"], canvas, svg[aria-label], svg[data-chart], img[alt*="图"], img[alt*="chart" i]'),
      ).filter((element) => !chartRoots.some((root) => root !== element && root.contains(element)));
      const chartContainers = Array.from(new Set([...chartRoots, ...directChartVisuals])).slice(0, 8);
      const tooltipSelector = [
        '[role="tooltip"]',
        '[data-chart-tooltip]',
        '[data-tooltip]',
        '.chart-tooltip',
        '.echarts-tooltip',
        '.recharts-tooltip-wrapper',
        '.highcharts-tooltip',
        '.apexcharts-tooltip',
      ].join(', ');
      const tooltipIsVisible = (candidate: Element) => {
        const style = window.getComputedStyle(candidate);
        return (
          !candidate.hasAttribute('hidden') &&
          candidate.getAttribute('aria-hidden') !== 'true' &&
          candidate.getAttribute('data-state') !== 'closed' &&
          candidate.getAttribute('data-visible') !== 'false' &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      };
      const visibleTooltips = Array.from(document.querySelectorAll(tooltipSelector)).filter(tooltipIsVisible);
      const charts = chartContainers.map((element, index) => {
        const canvas = element.matches('canvas') ? element : element.querySelector('canvas');
        const svg = element.matches('svg') ? element : element.querySelector('svg');
        const image = element.matches('img') ? element : element.querySelector('img');
        const visual = canvas ?? svg ?? image ?? element;
        const kind = canvas ? 'canvas' : svg ? 'svg' : image ? 'image' : 'container';
        const chartScope =
          element.closest('[data-chart], [data-chart-container], [data-testid*="chart" i], section, article, [role="region"]') ?? element;
        const title =
          cleanText(element.getAttribute('aria-label')) ||
          cleanText(chartScope.getAttribute('aria-label')) ||
          cleanText(element.querySelector('h1,h2,h3,[data-chart-title]')?.textContent) ||
          cleanText(chartScope.querySelector('h1,h2,h3,[data-chart-title]')?.textContent) ||
          cleanText(image?.getAttribute('alt')) ||
          cleanText(element.getAttribute('data-testid')) ||
          cleanText(element.id);
        const legendSelector = [
          '[data-legend]',
          '.recharts-legend-item-text',
          '.highcharts-legend-item text',
          '.apexcharts-legend-text',
          '.echarts-legend-item',
          '.legend',
          '[class*="legend"]',
        ].join(', ');
        const legends = Array.from(chartScope.querySelectorAll(legendSelector))
          .filter(
            (legend, legendIndex, candidates) =>
              !candidates.some((candidate, candidateIndex) => candidateIndex !== legendIndex && legend.contains(candidate)),
          )
          .map((legend) => cleanText(legend.textContent || legend.getAttribute('aria-label')))
          .filter(Boolean)
          .filter((legend, legendIndex, values) => values.indexOf(legend) === legendIndex)
          .slice(0, 6);
        const chartKeys = [element, chartScope]
          .flatMap((candidate) => [candidate.getAttribute('id'), candidate.getAttribute('data-chart'), candidate.getAttribute('data-testid')])
          .map((value) => cleanText(value))
          .filter(Boolean);
        const tooltipIds = [element, chartScope]
          .flatMap((candidate) => (candidate.getAttribute('aria-describedby') ?? '').split(/\s+/))
          .filter(Boolean);
        const tooltipCandidates = visibleTooltips.filter((tooltip) => {
          const tooltipFor =
            tooltip.getAttribute('data-chart-for') ||
            tooltip.getAttribute('data-tooltip-for') ||
            tooltip.getAttribute('data-for') ||
            tooltip.getAttribute('data-owner');
          const isThirdPartyTooltip = tooltip.matches(
            '.echarts-tooltip, .recharts-tooltip-wrapper, .highcharts-tooltip, .apexcharts-tooltip',
          );
          return (
            element.contains(tooltip) ||
            chartScope.contains(tooltip) ||
            tooltipIds.includes(tooltip.id) ||
            Boolean(tooltipFor && chartKeys.includes(tooltipFor)) ||
            (chartContainers.length === 1 && isThirdPartyTooltip)
          );
        });
        const tooltip = tooltipCandidates
          .map((candidate) => cleanText(candidate.getAttribute('data-tooltip') || candidate.textContent))
          .filter(Boolean)
          .slice(0, 3)
          .join(' / ');
        const dataPoints = Array.from(
          element.querySelectorAll('[data-chart-value], [data-point][data-value], [data-series][data-value], [data-series-name][data-value]'),
        )
          .map((point) => {
            const value = parseChartValue(point.getAttribute('data-chart-value') || point.getAttribute('data-value'));
            const label = cleanText(point.getAttribute('data-point') || point.getAttribute('data-label') || point.getAttribute('aria-label'));
            const series = cleanText(point.getAttribute('data-series') || point.getAttribute('data-series-name'));
            return value === undefined ? null : { ...(series ? { series } : {}), ...(label ? { label } : {}), value };
          })
          .filter((point): point is { series?: string; label?: string; value: number } => Boolean(point))
          .slice(0, 24);
        const explicitTrend = cleanText(element.getAttribute('data-trend')).toLowerCase();
        const hasMultipleSeries = new Set(dataPoints.map((point) => point.series).filter(Boolean)).size > 1;
        const seriesTrendsByName = new Map<string, 'rising' | 'falling' | 'flat' | 'mixed'>();
        Array.from(
          dataPoints.reduce((seriesValues, point) => {
            if (point.series) {
              seriesValues.set(point.series, [...(seriesValues.get(point.series) ?? []), point.value]);
            }
            return seriesValues;
          }, new Map<string, number[]>()),
        )
          .map(([series, values]) => {
            const trend = inferChartTrend(values);
            return trend ? { series, trend } : null;
          })
          .filter((seriesTrend): seriesTrend is { series: string; trend: 'rising' | 'falling' | 'flat' | 'mixed' } => Boolean(seriesTrend))
          .forEach((seriesTrend) => seriesTrendsByName.set(seriesTrend.series, seriesTrend.trend));
        Array.from(element.querySelectorAll('[data-series][data-series-trend], [data-series-name][data-series-trend]')).forEach(
          (seriesElement) => {
            const series = cleanText(seriesElement.getAttribute('data-series') || seriesElement.getAttribute('data-series-name'));
            const trend = normalizeChartTrend(cleanText(seriesElement.getAttribute('data-series-trend')));
            if (series && trend) {
              seriesTrendsByName.set(series, trend);
            }
          },
        );
        const seriesTrends = Array.from(seriesTrendsByName, ([series, trend]) => ({ series, trend }));
        const trend =
          explicitTrend === 'rising' || explicitTrend === 'up' || explicitTrend === 'increasing'
            ? 'rising'
            : explicitTrend === 'falling' || explicitTrend === 'down' || explicitTrend === 'decreasing'
              ? 'falling'
              : explicitTrend === 'flat' || explicitTrend === 'stable'
                ? 'flat'
                : explicitTrend === 'mixed'
                  ? 'mixed'
                  : hasMultipleSeries
                    ? undefined
                    : inferChartTrend(dataPoints.map((point) => point.value));
        const visualSize = sizeOf(visual);
        const explicitCompleteness = cleanText(
          element.getAttribute('data-evidence-completeness') ||
          element.getAttribute('data-chart-completeness') ||
          chartScope.getAttribute('data-evidence-completeness') ||
          chartScope.getAttribute('data-chart-completeness'),
        ).toLowerCase();
        const declaredPointCount = firstPositiveNumber(
          element.getAttribute('data-point-count'),
          chartScope.getAttribute('data-point-count'),
        );
        const isLoading =
          element.getAttribute('aria-busy') === 'true' ||
          element.getAttribute('data-loading') === 'true' ||
          chartScope.getAttribute('aria-busy') === 'true' ||
          chartScope.getAttribute('data-loading') === 'true';
        const isVirtualized =
          element.getAttribute('data-virtualized') === 'true' ||
          chartScope.getAttribute('data-virtualized') === 'true';
        const evidenceCompleteness = isLoading
          ? 'unknown' as const
          : isVirtualized || explicitCompleteness === 'partial'
            ? 'partial' as const
            : explicitCompleteness === 'complete' || (declaredPointCount !== undefined && declaredPointCount === dataPoints.length)
              ? 'complete' as const
              : 'unknown' as const;
        return {
          index: index + 1,
          evidenceCompleteness,
          ...(title ? { title } : {}),
          kind,
          ...visualSize,
          rendered: Boolean(visualSize.width && visualSize.height),
          legends,
          ...(tooltip ? { tooltip } : {}),
          ...(dataPoints.length ? { dataPoints } : {}),
          ...(seriesTrends.length ? { seriesTrends } : {}),
          ...(trend ? { trend } : {}),
          selectorHint: selectorHintOf(element),
        };
      });
      return {
        textSummary: text.slice(0, 600),
        interactiveElements: nodes
          .map((element) => `${element.tagName.toLowerCase()} "${labelOf(element)}" ${selectorHintOf(element)}`)
          .filter(Boolean),
        tables,
        charts,
      };
    });
    const snapshot =
      raw && typeof raw === 'object'
        ? (raw as {
            textSummary?: string;
            interactiveElements?: string[];
            tables?: AgentTableObservation[];
            charts?: AgentChartObservation[];
          })
        : {};
    const interactiveElements = Array.isArray(snapshot.interactiveElements) ? snapshot.interactiveElements : [];
    const tables = Array.isArray(snapshot.tables) ? snapshot.tables : [];
    const charts = Array.isArray(snapshot.charts) ? snapshot.charts : [];
    return {
      textSummary: snapshot.textSummary ?? '',
      domSummary: `页面文本约 ${snapshot.textSummary?.length ?? 0} 字符；发现 ${interactiveElements.length} 个关键可交互元素、${tables.length} 个表格、${charts.length} 个图表；console ${this.consoleMessages.length} 条；失败请求 ${this.networkHints.length} 条。`,
      interactiveElements,
      consoleMessages: [...this.consoleMessages],
      networkHints: [...this.networkHints],
      tables,
      charts,
    };
  }

  async replayRecordingSteps(
    steps: RecordingStepDraft[],
    sessionId: string,
    cancellationSignal?: AbortSignal,
  ): Promise<RecordingReplayResult[]> {
    const results: RecordingReplayResult[] = [];
    throwIfRunCancelled(cancellationSignal);
    if (!this.page) {
      return steps.map((step) => ({
        step,
        status: 'failed',
        message: '尚未启动真实浏览器会话，无法执行录制回放。',
      }));
    }

    for (const step of steps) {
      throwIfRunCancelled(cancellationSignal);
      try {
        await awaitWithRunCancellation(this.replayStep(step), cancellationSignal);
        const screenshot = await awaitWithRunCancellation(
          this.captureRunScreenshot(sessionId, 'postStep'),
          cancellationSignal,
        );
        if (!screenshot) {
          throw new Error('无法捕获回放后的真实页面截图。');
        }
        results.push({
          step,
          status: 'passed',
          message: `已回放：${step.title}`,
          screenshotPath: screenshot.path,
          artifact: screenshot,
        });
      } catch (error) {
        throwIfRunCancelled(cancellationSignal);
        const screenshot = await this.captureRunScreenshot(sessionId, 'failure');
        results.push({
          step,
          status: 'failed',
          message: `回放失败：${(error as Error).message}`,
          ...(screenshot ? { screenshotPath: screenshot.path } : {}),
          ...(screenshot ? { artifact: screenshot } : {}),
        });
        break;
      }
    }

    return results;
  }

  async beginTrace(runId: string): Promise<boolean> {
    if (this.trace || this.pendingTraceRunId) {
      return false;
    }

    if (!this.context) {
      this.pendingTraceRunId = runId;
      return false;
    }

    return this.startTrace(runId);
  }

  async finishTrace(): Promise<RunArtifact | undefined> {
    const trace = this.trace;
    this.trace = null;
    this.pendingTraceRunId = null;
    if (!trace || !this.context) {
      return undefined;
    }

    try {
      await this.context.tracing.stop({ path: trace.path });
    } catch {
      return undefined;
    }

    try {
      return await this.artifacts.registerExisting({
        path: trace.path,
        type: 'trace',
        label: 'Playwright Trace',
        evidenceKind: 'trace',
        ownerRunId: trace.runId,
        retentionClass: 'standard',
        protectedBy: [],
      });
    } catch (error) {
      if (!(error instanceof DurableAtomicFileCommitError)) {
        await fs.rm(trace.path, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.workerLease) {
      if (!this.workerClosePromise) {
        this.workerClosePromise = (async () => {
          const page = this.page;
          this.browser = null;
          this.context = null;
          this.page = null;
          try {
            await this.finishTrace();
            await page?.close?.();
          } finally {
            await this.workerLease!.release();
          }
        })();
      }
      return this.workerClosePromise;
    }
    await this.finishTrace();
    const page = this.page;
    await Promise.allSettled(this.activeRouteMocks.splice(0).map(({ url, handler }) => page?.unroute(url, handler)));
    await this.browser?.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  getState(): BrowserSessionState {
    return this.state;
  }

  /** Removes mocks registered by one completed Case without changing another active run. */
  async releaseControlledRouteMocks(runId: string): Promise<void> {
    const page = this.page;
    const owned = this.activeRouteMocks.filter((mock) => mock.runId === runId);
    if (!owned.length) {
      return;
    }
    const retained = this.activeRouteMocks.filter((mock) => mock.runId !== runId);
    this.activeRouteMocks.splice(0, this.activeRouteMocks.length, ...retained);
    await Promise.allSettled(owned.map(({ url, handler }) => page?.unroute(url, handler)));
  }

  private patchState(patch: Partial<BrowserSessionState>): BrowserSessionState {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return this.state;
  }

  private async captureScreenshotPath(): Promise<string> {
    return this.artifacts.createPageScreenshotPath();
  }

  /** Clipboard permission is scoped to the active approved page origin inside this main-owned context. */
  private async grantCurrentPageClipboardPermission(): Promise<void> {
    if (!this.context?.grantPermissions || !this.page) {
      return;
    }
    let origin: string;
    try {
      origin = new URL(this.page.url()).origin;
    } catch {
      return;
    }
    if (origin === 'null') {
      return;
    }
    await this.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  }

  private async executeDownload(
    page: PlaywrightPage,
    request: ControlledDeterministicActionRequest & { action: Extract<ControlledDeterministicAction, { kind: 'download' }> },
  ): Promise<ControlledDeterministicActionResult> {
    const downloadPromise = page.waitForEvent('download');
    // A cancellation can win before Playwright resolves the event. Keep the
    // eventual browser-owned Download only long enough to delete it.
    void downloadPromise.then(
      async (download) => {
        if (request.cancellationSignal?.aborted) {
          await download.delete?.().catch(() => undefined);
        }
      },
      () => undefined,
    );
    await awaitWithRunCancellation(page.click(request.action.locator.selector, { timeout: 10_000 }), request.cancellationSignal);
    const download = await awaitWithRunCancellation(downloadPromise, request.cancellationSignal);
    const downloadPath = await this.artifacts.createDownloadPath(download.suggestedFilename());
    const save = download.saveAs(downloadPath);
    try {
      await awaitWithRunCancellation(save, request.cancellationSignal);
      throwIfRunCancelled(request.cancellationSignal);
      const artifact = await this.artifacts.registerExisting({
        path: downloadPath,
        type: 'attachment',
        label: 'Approved browser download',
        evidenceKind: 'attachment',
        ownerRunId: request.runId,
        retentionClass: 'standard',
        protectedBy: [],
      });
      return { message: 'Downloaded and registered approved browser artifact.', artifacts: [artifact] };
    } catch (error) {
      await download.delete?.().catch(() => undefined);
      await save.catch(() => undefined);
      if (!(error instanceof DurableAtomicFileCommitError)) {
        await fs.rm(downloadPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async startPendingTrace(): Promise<void> {
    const runId = this.pendingTraceRunId;
    this.pendingTraceRunId = null;
    if (runId) {
      await this.startTrace(runId);
    }
  }

  private async startTrace(runId: string): Promise<boolean> {
    if (!this.context || this.trace) {
      return false;
    }

    try {
      const tracePath = await this.artifacts.createTracePath(runId);
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      this.trace = { runId, path: tracePath };
      return true;
    } catch {
      return false;
    }
  }

  private installObservationListeners(page: PlaywrightPage): void {
    this.consoleMessages = [];
    this.networkHints = [];
    page.on('console', (message) => {
      const type = message.type();
      if (!['error', 'warning'].includes(type)) {
        return;
      }
      this.consoleMessages = [...this.consoleMessages, `${type}: ${message.text()}`].slice(-20);
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown error';
      this.networkHints = [...this.networkHints, `${request.method()} ${request.url()} -> ${failure}`].slice(-20);
    });
  }

  private async installRecorder(page: PlaywrightPage): Promise<void> {
    await page.exposeFunction('__playtestRecordEvent', (event: unknown) => {
      const captured = normalizeRecordingEvent(event, this.page?.url() ?? this.state.currentUrl);
      if (captured) {
        this.emitRecordingEvent?.(captured);
      }
    });
    await page.addInitScript({ content: recorderScript });
    await page.evaluate(recorderScript);
  }

  private async emitNavigationEvent(url: string): Promise<void> {
    if (!this.recordingEnabled) {
      return;
    }

    this.emitRecordingEvent?.({
      id: `captured-${Date.now()}-navigate`,
      kind: 'navigate',
      title: '页面跳转',
      detail: `打开页面：${url}`,
      pageUrl: url,
      capturedAt: new Date().toISOString(),
    });
  }

  private async replayStep(step: RecordingStepDraft): Promise<void> {
    if (!this.page) {
      throw new Error('浏览器页面未启动。');
    }

    if (step.kind === 'navigate') {
      const targetUrl = step.pageUrl || extractUrlFromDetail(step.detail);
      if (!targetUrl) {
        throw new Error('录制跳转步骤缺少 URL。');
      }
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      return;
    }

    if (step.kind === 'click') {
      if (!step.selector) {
        throw new Error('点击步骤缺少 selector。');
      }
      await this.page.click(step.selector, { timeout: 10_000 });
      return;
    }

    if (step.kind === 'input') {
      if (!step.selector) {
        throw new Error('输入步骤缺少 selector。');
      }
      if (step.value === undefined) {
        throw new Error('输入步骤缺少 value。');
      }
      try {
        await this.page.fill(step.selector, step.value, { timeout: 10_000 });
      } catch (error) {
        await this.page.selectOption(step.selector, step.value, { timeout: 10_000 }).catch(() => {
          throw error;
        });
      }
      return;
    }

    if (step.kind === 'wait') {
      await this.page.waitForTimeout(1_000);
      return;
    }

    if (step.kind === 'snapshot' || step.kind === 'assert') {
      await this.page.waitForTimeout(300);
    }
  }
}

const extractUrlFromDetail = (detail: string): string => {
  return detail.match(/https?:\/\/\S+/)?.[0] ?? '';
};

const normalizeWaitMs = (timeoutMs: number | undefined): number => {
  if (!Number.isFinite(timeoutMs)) {
    return 1_000;
  }
  return Math.min(Math.max(Math.round(timeoutMs ?? 1_000), 0), 30_000);
};

const normalizeStableMs = (stableMs: number | undefined): number => {
  if (!Number.isFinite(stableMs)) {
    return 500;
  }
  return Math.min(Math.max(Math.round(stableMs ?? 500), 0), 5_000);
};

const normalizeRecordingEvent = (event: unknown, fallbackUrl: string): RecordingCapturedEvent | null => {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const payload = event as Partial<RecordingCapturedEvent> & {
    kind?: string;
    selector?: string;
    value?: string;
    tagName?: string;
    label?: string;
  };
  if (!payload.kind || !['click', 'input', 'wait', 'assert', 'snapshot', 'navigate'].includes(payload.kind)) {
    return null;
  }

  const kind = payload.kind as RecordingStepKind;
  const selector = payload.selector ? ` @ ${payload.selector}` : '';
  const value = payload.value ? `，值：${payload.value}` : '';
  const label = payload.label ? `「${payload.label}」` : '页面元素';
  const titleMap: Record<RecordingStepKind, string> = {
    navigate: '页面跳转',
    click: `点击${label}`,
    input: `输入${label}`,
    wait: '等待页面稳定',
    assert: '核对结果状态',
    snapshot: '捕获页面快照',
  };
  const detailMap: Record<RecordingStepKind, string> = {
    navigate: `打开页面：${payload.pageUrl ?? fallbackUrl}`,
    click: `点击${label}${selector}`,
    input: `在${label}中输入内容${value}${selector}`,
    wait: '等待异步请求、图表刷新或表格稳定。',
    assert: '检查当前页面状态是否与录制基线一致。',
    snapshot: '在关键节点捕获快照，供后续回放对比使用。',
  };

  return {
    id: payload.id ?? `captured-${Date.now()}-${kind}`,
    kind,
    title: payload.title ?? titleMap[kind],
    detail: payload.detail ?? detailMap[kind],
    pageUrl: payload.pageUrl ?? fallbackUrl,
    capturedAt: payload.capturedAt ?? new Date().toISOString(),
    selector: payload.selector,
    value: payload.value,
  };
};

const recorderScript = String.raw`
(() => {
  if (window.__playtestRecorderInstalled) {
    return;
  }
  window.__playtestRecorderInstalled = true;

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\#.:,[\]>+~*]/g, '\\$&');
  };

  const textOf = (element) => {
    const aria = element.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 80);
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder.trim().slice(0, 80);
    const text = element.innerText || element.textContent || element.getAttribute('name') || element.id || element.tagName;
    return String(text).trim().replace(/\s+/g, ' ').slice(0, 80);
  };

  const selectorOf = (element) => {
    if (!(element instanceof Element)) {
      return '';
    }
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy');
    if (testId) return '[data-testid="' + cssEscape(testId) + '"]';
    if (element.id) return '#' + cssEscape(element.id);
    const name = element.getAttribute('name');
    if (name) return element.tagName.toLowerCase() + '[name="' + cssEscape(name) + '"]';

    const segments = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && segments.length < 4) {
      let segment = current.tagName.toLowerCase();
      const className = String(current.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
      if (className) {
        segment += '.' + cssEscape(className);
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName);
        if (siblings.length > 1) {
          segment += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
      }
      segments.unshift(segment);
      current = parent;
    }
    return segments.join(' > ');
  };

  const emit = (payload) => {
    if (typeof window.__playtestRecordEvent === 'function') {
      window.__playtestRecordEvent({
        id: 'captured-' + Date.now() + '-' + Math.random().toString(16).slice(2),
        pageUrl: location.href,
        capturedAt: new Date().toISOString(),
        ...payload,
      });
    }
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button,a,input,select,textarea,[role="button"],[data-testid],[data-test],[data-cy]') || event.target : null;
    if (!target) return;
    const tagName = target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return;
    }
    emit({
      kind: 'click',
      selector: selectorOf(target),
      label: textOf(target),
    });
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    emit({
      kind: 'input',
      selector: selectorOf(target),
      label: textOf(target),
      value: target instanceof HTMLInputElement && target.type === 'password' ? '********' : target.value,
    });
  }, true);
})();
`;

const loadPlaywright = async (): Promise<PlaywrightModule | null> => {
  try {
    return (await import('playwright')) as unknown as PlaywrightModule;
  } catch {
    return null;
  }
};

const composeEnvironmentUrl = (environment: ProjectEnvironment): string => {
  const base = environment.url.replace(/\/$/, '');
  const pathPart = environment.entryPath.startsWith('/')
    ? environment.entryPath
    : `/${environment.entryPath}`;
  return `${base}${pathPart}`;
};

const viewportFor = (viewport: ProjectEnvironment['viewport']) => {
  if (viewport === 'mobile') {
    return { width: 390, height: 844 };
  }
  if (viewport === 'laptop') {
    return { width: 1440, height: 900 };
  }
  return { width: 1600, height: 1000 };
};
