import {
  type BrowserClickRequest,
  type BrowserInputRequest,
  type BrowserNavigateRequest,
  type BrowserScrollRequest,
  type BrowserSelectRequest,
  type BrowserSessionRequest,
  type BrowserSessionState,
  type BrowserWaitForChartStableRequest,
  type BrowserWaitForDataReadyRequest,
  type BrowserWaitForNetworkIdleRequest,
  type BrowserWaitForResponseRequest,
  type BrowserWaitForSelectorRequest,
  type BrowserWaitRequest,
  type ExplicitTestAssertion,
  type RunArtifact,
  type TestInputValueBinding,
  isMidsceneConfigured,
} from '../../shared/studio.js';
import {
  type AgentDomInspection,
  type AgentExecutionMetrics,
  type AgentObservation,
  type AgentPlanStepDraft,
} from '../../shared/agent.js';
import type { AgentVerifier, AgentVerifierModelConfig, AgentVerifierResult } from '../runtime/agent-verifier.js';
import type { ResolvedChatCommandRequest } from '../runtime/model-config-resolver.js';
import type { SemanticActionResult, SemanticActionRuntime } from '../runtime/semantic-action-runtime.js';
import {
  awaitWithRunCancellation,
  isRunCancelled,
  throwIfRunCancelled,
} from '../runtime/run-cancellation.js';
import { createSecretRedactor } from '../runtime/secret-redactor.js';
import { evaluateExplicitAssertion, toExplicitAssertionIntent } from './assertions.js';
import type { AssertionEvaluation } from './assertions.js';
import { resolveExecutionIntent } from './routes.js';
import type { ExplicitAssertionIntent } from './routes.js';
import type { DeterministicInputBindingResolver, RunDeterministicStepRequest } from '../studioRuntime.js';

export interface BrowserObserver {
  hasRealPage?: () => boolean;
  start: (request: BrowserSessionRequest) => Promise<BrowserSessionState>;
  navigate: (request: BrowserNavigateRequest) => Promise<BrowserSessionState>;
  click: (request: BrowserClickRequest) => Promise<BrowserSessionState>;
  input: (request: BrowserInputRequest) => Promise<BrowserSessionState>;
  wait?: (request: BrowserWaitRequest) => Promise<BrowserSessionState>;
  waitForChartStable?: (request: BrowserWaitForChartStableRequest) => Promise<BrowserSessionState>;
  waitForDataReady?: (request: BrowserWaitForDataReadyRequest) => Promise<BrowserSessionState>;
  waitForNetworkIdle?: (request: BrowserWaitForNetworkIdleRequest) => Promise<BrowserSessionState>;
  waitForResponse?: (request: BrowserWaitForResponseRequest) => Promise<BrowserSessionState>;
  waitForSelector?: (request: BrowserWaitForSelectorRequest) => Promise<BrowserSessionState>;
  scroll?: (request: BrowserScrollRequest) => Promise<BrowserSessionState>;
  select?: (request: BrowserSelectRequest) => Promise<BrowserSessionState>;
  capture: () => Promise<BrowserSessionState>;
  beginTrace?: (runId: string) => Promise<boolean>;
  finishTrace?: () => Promise<RunArtifact | undefined>;
  getPageText?: () => Promise<string>;
  inspectDom?: (selector: string, attributeName?: string) => Promise<AgentDomInspection>;
  captureObservation?: () => Promise<BrowserObservation>;
  getState: () => BrowserSessionState;
}

export type BrowserObservation = Partial<
  Pick<
    AgentObservation,
    | 'domSummary'
    | 'textSummary'
    | 'interactiveElements'
    | 'consoleMessages'
    | 'networkHints'
    | 'tables'
    | 'charts'
  >
>;

export interface BrowserPreparationResult {
  session?: BrowserSessionState;
  message: string;
  navigatedUrl?: string;
  clickedSelector?: string;
  clickTarget?: string;
  inputSelector?: string;
  inputTarget?: string;
  inputValue?: string;
  waitedMs?: number;
  scrolledSelector?: string;
  scrolledPage?: boolean;
  selectedSelector?: string;
  selectedValue?: string;
  extracted?: boolean;
  assertion?: ExplicitAssertionIntent;
  semanticAssertion?: string;
  assertionEvaluation?: AssertionEvaluation;
  reportArtifactPath?: string;
  executionMetrics?: AgentExecutionMetrics;
  observation?: BrowserObservation;
}

type VerifierConfigResolution = {
  config?: AgentVerifierModelConfig;
  fallbackReason?: string;
};

export interface BrowserSessionCoordinatorDependencies {
  browserObserver?: BrowserObserver;
  semanticActionRuntime?: SemanticActionRuntime;
  agentVerifier?: AgentVerifier;
  deterministicInputBindingResolver?: DeterministicInputBindingResolver;
  resolveVerifierConfigForRequest?: (request: ResolvedChatCommandRequest) => Promise<VerifierConfigResolution>;
}

export interface BrowserSessionCoordinator {
  captureObservation: (cancellationSignal?: AbortSignal) => Promise<BrowserObservation | undefined>;
  prepareDeterministicAssertion: (
    request: RunDeterministicStepRequest & { assertion: ExplicitTestAssertion },
  ) => Promise<BrowserPreparationResult>;
  prepareDeterministicBoundInput: (
    request: RunDeterministicStepRequest & { inputBinding: TestInputValueBinding },
  ) => Promise<BrowserPreparationResult>;
  prepareForAgent: (
    request: ResolvedChatCommandRequest,
    plannedStep?: AgentPlanStepDraft,
  ) => Promise<BrowserPreparationResult>;
}

const toAssertionEvaluation = (result: SemanticActionResult): AssertionEvaluation => {
  return {
    status: result.status,
    summary: result.message,
    evidence: result.evidence ?? result.message,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
  };
};

export const createPendingSemanticEvaluation = (message: string): AssertionEvaluation => {
  return {
    status: 'neutral',
    summary: message,
    evidence: '语义动作未执行，未生成页面判断证据。',
  };
};

const toVerifierAssertionEvaluation = (result: AgentVerifierResult): AssertionEvaluation => {
  return {
    status: result.status,
    summary: result.summary,
    evidence: result.evidence,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
  };
};

const resolveMidsceneConfigForRequest = (request: ResolvedChatCommandRequest) => {
  return request.modelConfigResolver
    ? request.modelConfigResolver.resolveMidsceneConfig()
    : Promise.resolve(request.midsceneConfig);
};

const captureBrowserObservation = async (
  dependencies: BrowserSessionCoordinatorDependencies,
  cancellationSignal?: AbortSignal,
): Promise<BrowserObservation | undefined> => {
  if (!dependencies.browserObserver?.captureObservation) {
    return undefined;
  }

  try {
    return await awaitWithRunCancellation(dependencies.browserObserver.captureObservation(), cancellationSignal);
  } catch (error) {
    if (isRunCancelled(error)) {
      throw error;
    }
    return undefined;
  }
};

const prepareBrowserForAgent = async (
  dependencies: BrowserSessionCoordinatorDependencies,
  request: ResolvedChatCommandRequest,
  plannedStep?: AgentPlanStepDraft,
): Promise<BrowserPreparationResult> => {
  throwIfRunCancelled(request.cancellationSignal);
  const executionIntent = resolveExecutionIntent(request, plannedStep);
  const {
    assertionIntent,
    clickIntent,
    explicitUrl,
    extractIntent,
    inputIntent,
    scrollIntent,
    semanticAssertion,
    selectIntent,
    waitIntent,
  } = executionIntent;
  const browserObserver = dependencies.browserObserver;

  if (!browserObserver) {
    const assertionEvaluation =
      assertionIntent && request.browserSession
        ? evaluateExplicitAssertion(assertionIntent, request.browserSession)
        : undefined;
    return request.browserSession
      ? {
          session: request.browserSession,
          message: assertionEvaluation
            ? `未连接主进程浏览器 runtime，使用前端会话快照；${assertionEvaluation.summary}`
            : '未连接主进程浏览器 runtime，使用前端会话快照。',
          ...(assertionIntent ? { assertion: assertionIntent } : {}),
          ...(assertionEvaluation ? { assertionEvaluation } : {}),
        }
      : {
          message: '未连接主进程浏览器 runtime，等待真实浏览器观察能力。',
          ...(assertionIntent ? { assertion: assertionIntent } : {}),
        };
  }

  let semanticActionRedactor = createSecretRedactor(request.midsceneConfig);

  try {
    const current = browserObserver.getState();
    const shouldStart =
      request.project &&
      request.environment &&
      (!current.currentUrl || current.status === 'idle' || current.status === 'closed' || current.status === 'error');

    let session: BrowserSessionState;
    let message: string;

    if (shouldStart && request.project && request.environment) {
      session = await awaitWithRunCancellation(browserObserver.start({
        project: request.project,
        environment: request.environment,
        record: false,
      }), request.cancellationSignal);
      message = `Agent 已启动受控浏览器：${session.currentUrl || request.environment.url}`;
    } else {
      session = await awaitWithRunCancellation(browserObserver.capture(), request.cancellationSignal);
      message = `Agent 已复用浏览器会话并捕获快照：${session.currentUrl || '当前页面'}`;
    }

    if (explicitUrl && session.currentUrl !== explicitUrl) {
      session = await awaitWithRunCancellation(
        browserObserver.navigate({ url: explicitUrl }),
        request.cancellationSignal,
      );
      message = `${message}；并导航到用户指定 URL：${explicitUrl}`;
    }

    let semanticEvaluation: AssertionEvaluation | undefined;
    let reportArtifactPath: string | undefined;
    let executionMetrics: AgentExecutionMetrics | undefined;

    if (clickIntent?.selector) {
      session = await awaitWithRunCancellation(
        browserObserver.click({ selector: clickIntent.selector }),
        request.cancellationSignal,
      );
      message = `${message}；并点击用户指定 selector：${clickIntent.selector}`;
    } else if (clickIntent?.target) {
      const semanticActionRuntime = dependencies.semanticActionRuntime;
      const midsceneConfig = semanticActionRuntime
        ? await awaitWithRunCancellation(resolveMidsceneConfigForRequest(request), request.cancellationSignal)
        : undefined;
      semanticActionRedactor = createSecretRedactor(midsceneConfig);
      if (semanticActionRuntime && midsceneConfig && isMidsceneConfigured(midsceneConfig)) {
        const result = await awaitWithRunCancellation(semanticActionRuntime.click({
          target: clickIntent.target,
          prompt: plannedStep?.instruction ?? request.prompt,
          config: midsceneConfig,
        }), request.cancellationSignal);
        semanticEvaluation = toAssertionEvaluation(result);
        reportArtifactPath = result.reportPath;
        executionMetrics = result.metrics;
        session = await awaitWithRunCancellation(browserObserver.capture(), request.cancellationSignal);
        message = `${message}；${result.message}`;
      } else {
        const pendingMessage = `已识别点击目标「${clickIntent.target}」，等待 Midscene 语义定位执行。`;
        semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
        message = `${message}；${pendingMessage}`;
      }
    }

    if (inputIntent?.selector) {
      session = await awaitWithRunCancellation(
        browserObserver.input({ selector: inputIntent.selector, value: inputIntent.value }),
        request.cancellationSignal,
      );
      message = `${message}；并在用户指定 selector 输入内容：${inputIntent.selector}`;
    } else if (inputIntent?.target) {
      const semanticActionRuntime = dependencies.semanticActionRuntime;
      const midsceneConfig = semanticActionRuntime
        ? await awaitWithRunCancellation(resolveMidsceneConfigForRequest(request), request.cancellationSignal)
        : undefined;
      semanticActionRedactor = createSecretRedactor(midsceneConfig);
      if (semanticActionRuntime && midsceneConfig && isMidsceneConfigured(midsceneConfig)) {
        const result = await awaitWithRunCancellation(semanticActionRuntime.input({
          target: inputIntent.target,
          value: inputIntent.value,
          prompt: plannedStep?.instruction ?? request.prompt,
          config: midsceneConfig,
        }), request.cancellationSignal);
        semanticEvaluation = toAssertionEvaluation(result);
        reportArtifactPath = result.reportPath;
        executionMetrics = result.metrics;
        session = await awaitWithRunCancellation(browserObserver.capture(), request.cancellationSignal);
        message = `${message}；${result.message}`;
      } else {
        const pendingMessage = `已识别输入目标「${inputIntent.target}」，等待 Midscene 语义定位执行。`;
        semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
        message = `${message}；${pendingMessage}`;
      }
    }

    let waitedMs: number | undefined;
    if (waitIntent) {
      if (waitIntent.strategy === 'chartStable' && browserObserver.waitForChartStable) {
        session = await awaitWithRunCancellation(browserObserver.waitForChartStable({
          ...(waitIntent.selector ? { selector: waitIntent.selector } : {}),
          timeoutMs: waitIntent.timeoutMs,
        }), request.cancellationSignal);
        waitedMs = waitIntent.timeoutMs;
        message = waitIntent.selector
          ? `${message}；并等待图表稳定：${waitIntent.selector}`
          : `${message}；并等待页面图表稳定`;
      } else if (waitIntent.strategy === 'dataReady' && browserObserver.waitForDataReady) {
        session = await awaitWithRunCancellation(browserObserver.waitForDataReady({
          ...(waitIntent.selector ? { selector: waitIntent.selector } : {}),
          timeoutMs: waitIntent.timeoutMs,
        }), request.cancellationSignal);
        waitedMs = waitIntent.timeoutMs;
        message = waitIntent.selector
          ? `${message}；并等待数据就绪：${waitIntent.selector}`
          : `${message}；并等待页面数据就绪`;
      } else if (waitIntent.selector && browserObserver.waitForSelector) {
        session = await awaitWithRunCancellation(browserObserver.waitForSelector({
          selector: waitIntent.selector,
          timeoutMs: waitIntent.timeoutMs,
        }), request.cancellationSignal);
        waitedMs = waitIntent.timeoutMs;
        message = `${message}；并等待 selector 可见：${waitIntent.selector}`;
      } else if (waitIntent.strategy === 'response' && waitIntent.urlPattern && browserObserver.waitForResponse) {
        session = await awaitWithRunCancellation(browserObserver.waitForResponse({
          urlPattern: waitIntent.urlPattern,
          timeoutMs: waitIntent.timeoutMs,
        }), request.cancellationSignal);
        waitedMs = waitIntent.timeoutMs;
        message = `${message}；并等待接口响应：${waitIntent.urlPattern}`;
      } else if (waitIntent.strategy === 'networkIdle' && browserObserver.waitForNetworkIdle) {
        session = await awaitWithRunCancellation(
          browserObserver.waitForNetworkIdle({ timeoutMs: waitIntent.timeoutMs }),
          request.cancellationSignal,
        );
        waitedMs = waitIntent.timeoutMs;
        message = `${message}；并等待页面网络空闲：${waitIntent.timeoutMs}ms`;
      } else if (browserObserver.wait) {
        session = await awaitWithRunCancellation(
          browserObserver.wait({ timeoutMs: waitIntent.timeoutMs }),
          request.cancellationSignal,
        );
        waitedMs = waitIntent.timeoutMs;
        message = `${message}；并等待页面稳定：${waitIntent.timeoutMs}ms`;
      } else {
        const pendingMessage = '已识别等待动作，但当前浏览器 runtime 尚未接入 wait 执行器。';
        semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
        message = `${message}；${pendingMessage}`;
      }
    }

    let scrolledSelector: string | undefined;
    let scrolledPage = false;
    if (scrollIntent) {
      if (browserObserver.scroll) {
        session = await awaitWithRunCancellation(browserObserver.scroll(scrollIntent), request.cancellationSignal);
        scrolledSelector = scrollIntent.selector;
        scrolledPage = !scrollIntent.selector;
        message = scrollIntent.selector
          ? `${message}；并滚动到用户指定 selector：${scrollIntent.selector}`
          : `${message}；并滚动当前页面`;
      } else {
        const pendingMessage = '已识别滚动动作，但当前浏览器 runtime 尚未接入 scroll 执行器。';
        semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
        message = `${message}；${pendingMessage}`;
      }
    }

    let selectedSelector: string | undefined;
    let selectedValue: string | undefined;
    if (selectIntent?.selector) {
      if (browserObserver.select) {
        session = await awaitWithRunCancellation(
          browserObserver.select({ selector: selectIntent.selector, value: selectIntent.value }),
          request.cancellationSignal,
        );
        selectedSelector = selectIntent.selector;
        selectedValue = selectIntent.value;
        message = `${message}；并在用户指定 selector 选择选项：${selectIntent.selector}`;
      } else {
        const pendingMessage = '已识别下拉选择动作，但当前浏览器 runtime 尚未接入 select 执行器。';
        semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
        message = `${message}；${pendingMessage}`;
      }
    } else if (selectIntent?.target) {
      const semanticActionRuntime = dependencies.semanticActionRuntime;
      const midsceneConfig = semanticActionRuntime
        ? await awaitWithRunCancellation(resolveMidsceneConfigForRequest(request), request.cancellationSignal)
        : undefined;
      semanticActionRedactor = createSecretRedactor(midsceneConfig);
      if (semanticActionRuntime && midsceneConfig && isMidsceneConfigured(midsceneConfig)) {
        const result = await awaitWithRunCancellation(semanticActionRuntime.select({
          target: selectIntent.target,
          value: selectIntent.value,
          prompt: plannedStep?.instruction ?? request.prompt,
          config: midsceneConfig,
        }), request.cancellationSignal);
        semanticEvaluation = toAssertionEvaluation(result);
        reportArtifactPath = result.reportPath;
        executionMetrics = result.metrics;
        session = await awaitWithRunCancellation(browserObserver.capture(), request.cancellationSignal);
        message = `${message}；${result.message}`;
      } else {
        const pendingMessage = `已识别下拉选择目标「${selectIntent.target}」，等待 Midscene 语义选择执行。`;
        semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
        message = `${message}；${pendingMessage}`;
      }
    }

    const semanticActionRuntimeForExtraction = dependencies.semanticActionRuntime;
    const midsceneConfigForExtraction = extractIntent?.target && semanticActionRuntimeForExtraction
      ? await awaitWithRunCancellation(resolveMidsceneConfigForRequest(request), request.cancellationSignal)
      : undefined;
    if (midsceneConfigForExtraction) {
      semanticActionRedactor = createSecretRedactor(midsceneConfigForExtraction);
    }
    if (extractIntent?.target && semanticActionRuntimeForExtraction && midsceneConfigForExtraction && isMidsceneConfigured(midsceneConfigForExtraction)) {
      const result = await awaitWithRunCancellation(semanticActionRuntimeForExtraction.extract({
        target: extractIntent.target,
        prompt: plannedStep?.instruction ?? request.prompt,
        config: midsceneConfigForExtraction,
      }), request.cancellationSignal);
      semanticEvaluation = toAssertionEvaluation(result);
      reportArtifactPath = result.reportPath;
      executionMetrics = result.metrics;
      message = `${message}；${result.message}`;
    } else if (extractIntent?.target) {
      const pendingMessage = `已识别提取目标「${extractIntent.target}」，等待 Midscene 语义提取执行。`;
      semanticEvaluation = createPendingSemanticEvaluation(pendingMessage);
      message = `${message}；${pendingMessage}`;
    }

    const observation = await captureBrowserObservation(dependencies, request.cancellationSignal);
    const extracted = Boolean(
      extractIntent && (extractIntent.target ? semanticEvaluation?.status === 'passed' : observation),
    );
    let assertionEvaluation: AssertionEvaluation | undefined;
    if (assertionIntent) {
      const pageText =
        assertionIntent.kind === 'pageContains' && browserObserver.getPageText
          ? await browserObserver.getPageText()
          : undefined;
      const domInspection =
        (assertionIntent.kind === 'domSelectorExists' ||
          assertionIntent.kind === 'domSelectorVisible' ||
          assertionIntent.kind === 'domSelectorTextContains' ||
          assertionIntent.kind === 'domSelectorAttributeEquals') &&
        assertionIntent.domSelector &&
        browserObserver.inspectDom
          ? assertionIntent.domAttributeName
            ? await browserObserver.inspectDom(assertionIntent.domSelector, assertionIntent.domAttributeName)
            : await browserObserver.inspectDom(assertionIntent.domSelector)
          : undefined;
      assertionEvaluation = evaluateExplicitAssertion(assertionIntent, session, pageText, observation, domInspection);
      message = `${message}；${assertionEvaluation.summary}`;
    } else if (semanticAssertion) {
      const verifierConfig = dependencies.agentVerifier && dependencies.resolveVerifierConfigForRequest
        ? await dependencies.resolveVerifierConfigForRequest(request)
        : {};
      if (dependencies.agentVerifier && verifierConfig.config) {
        try {
          const result = await awaitWithRunCancellation(
            dependencies.agentVerifier.verify({
              config: verifierConfig.config,
              ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
              assertion: semanticAssertion,
              prompt: plannedStep?.instruction ?? request.prompt,
              ...(session.currentUrl ? { currentUrl: session.currentUrl } : {}),
              ...(session.pageTitle ? { pageTitle: session.pageTitle } : {}),
              ...(observation ? { observation } : {}),
            }),
            request.cancellationSignal,
          );
          assertionEvaluation = toVerifierAssertionEvaluation(result);
          executionMetrics = result.metrics;
          message = `${message}；${result.summary}`;
        } catch (error) {
          if (isRunCancelled(error)) {
            throw error;
          }
          const pendingMessage = `Verifier 模型判断失败，当前语义断言保持等待态：${createSecretRedactor(verifierConfig.config).redactError(error)}`;
          assertionEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      } else {
        const semanticActionRuntime = dependencies.semanticActionRuntime;
        const midsceneConfig = semanticActionRuntime
          ? await awaitWithRunCancellation(resolveMidsceneConfigForRequest(request), request.cancellationSignal)
          : undefined;
        if (midsceneConfig) {
          semanticActionRedactor = createSecretRedactor(midsceneConfig);
        }
        if (semanticActionRuntime && midsceneConfig && isMidsceneConfigured(midsceneConfig)) {
          const result = await awaitWithRunCancellation(semanticActionRuntime.assert({
            assertion: semanticAssertion,
            prompt: plannedStep?.instruction ?? request.prompt,
            config: midsceneConfig,
          }), request.cancellationSignal);
          assertionEvaluation = toAssertionEvaluation(result);
          reportArtifactPath = result.reportPath;
          executionMetrics = result.metrics;
          message = `${message}；${result.message}`;
        } else {
          const pendingMessage = verifierConfig.fallbackReason
            ? `已识别语义断言，等待 Verifier 配置完成：${verifierConfig.fallbackReason}。`
            : '已识别语义断言，等待 Verifier 或 Midscene 根据页面上下文执行判断。';
          assertionEvaluation = createPendingSemanticEvaluation(pendingMessage);
          message = `${message}；${pendingMessage}`;
        }
      }
    }

    assertionEvaluation ??= semanticEvaluation;

    return {
      session,
      message,
      ...(explicitUrl ? { navigatedUrl: explicitUrl } : {}),
      ...(clickIntent?.selector ? { clickedSelector: clickIntent.selector } : {}),
      ...(clickIntent?.target ? { clickTarget: clickIntent.target } : {}),
      ...(inputIntent?.selector ? { inputSelector: inputIntent.selector } : {}),
      ...(inputIntent?.target ? { inputTarget: inputIntent.target } : {}),
      ...(inputIntent ? { inputValue: inputIntent.value } : {}),
      ...(waitedMs !== undefined ? { waitedMs } : {}),
      ...(scrolledSelector ? { scrolledSelector } : {}),
      ...(scrolledPage ? { scrolledPage } : {}),
      ...(selectedSelector ? { selectedSelector } : {}),
      ...(selectedValue ? { selectedValue } : {}),
      ...(extracted ? { extracted } : {}),
      ...(assertionIntent ? { assertion: assertionIntent } : {}),
      ...(semanticAssertion ? { semanticAssertion } : {}),
      ...(assertionEvaluation ? { assertionEvaluation } : {}),
      ...(reportArtifactPath ? { reportArtifactPath } : {}),
      ...(executionMetrics ? { executionMetrics } : {}),
      ...(observation ? { observation } : {}),
    };
  } catch (error) {
    if (isRunCancelled(error)) {
      throw error;
    }
    const failureReason = semanticActionRedactor.redactError(error) || '未知错误';
    return {
      session: request.browserSession ?? browserObserver.getState(),
      message: `语义动作执行失败，已退回到最近一次会话快照：${failureReason}`,
      ...(clickIntent?.target ? { clickTarget: clickIntent.target } : {}),
      ...(inputIntent?.target ? { inputTarget: inputIntent.target } : {}),
      ...(inputIntent ? { inputValue: inputIntent.value } : {}),
      ...(semanticAssertion ? { semanticAssertion } : {}),
      assertionEvaluation: {
        status: 'failed',
        summary: '语义动作执行失败。',
        evidence: `Runtime error: ${failureReason}`,
        failureReason,
      },
    };
  }
};

const prepareDeterministicAssertion = async (
  dependencies: BrowserSessionCoordinatorDependencies,
  request: RunDeterministicStepRequest & { assertion: ExplicitTestAssertion },
): Promise<BrowserPreparationResult> => {
  const browserObserver = dependencies.browserObserver!;
  const assertion = toExplicitAssertionIntent(request.assertion);
  const session = await awaitWithRunCancellation(browserObserver.capture(), request.cancellationSignal);
  throwIfRunCancelled(request.cancellationSignal);
  const pageText =
    assertion.kind === 'pageContains' && browserObserver.getPageText
      ? await awaitWithRunCancellation(browserObserver.getPageText(), request.cancellationSignal)
      : undefined;
  const domInspection =
    (assertion.kind === 'domSelectorVisible' || assertion.kind === 'domSelectorTextContains') &&
    assertion.domSelector &&
    browserObserver.inspectDom
      ? await awaitWithRunCancellation(browserObserver.inspectDom(assertion.domSelector), request.cancellationSignal)
      : undefined;
  const observation = await captureBrowserObservation(dependencies, request.cancellationSignal);
  const assertionEvaluation = evaluateExplicitAssertion(assertion, session, pageText, observation, domInspection);

  return {
    session,
    message: `已复用浏览器会话执行已确认的显式断言；${assertionEvaluation.summary}`,
    assertion,
    assertionEvaluation,
    ...(observation ? { observation } : {}),
  };
};

const prepareDeterministicBoundInput = async (
  dependencies: BrowserSessionCoordinatorDependencies,
  request: RunDeterministicStepRequest & { inputBinding: TestInputValueBinding },
): Promise<BrowserPreparationResult> => {
  const browserObserver = dependencies.browserObserver;
  const action = request.sourceStep.execution?.action;
  const inputBindingResolver = request.inputBindingResolver ?? dependencies.deterministicInputBindingResolver;
  if (
    !browserObserver ||
    (action?.kind !== 'input' && action?.kind !== 'select') ||
    !request.project?.id ||
    !inputBindingResolver
  ) {
    return {
      message: '输入值绑定不可用，未读取值且未派发浏览器动作。',
      assertionEvaluation: {
        status: 'neutral',
        summary: '输入值绑定不可用。',
        evidence: '当前运行缺少项目上下文或受控凭据解析器。',
      },
    };
  }

  const session = await awaitWithRunCancellation(browserObserver.capture(), request.cancellationSignal);
  let value: string;
  try {
    value = await awaitWithRunCancellation(
      inputBindingResolver.resolve({
        projectId: request.project.id,
        binding: request.inputBinding,
      }),
      request.cancellationSignal,
    );
  } catch (error) {
    if (isRunCancelled(error)) {
      throw error;
    }
    return {
      session,
      message: '输入值绑定无法解析，未派发浏览器动作。',
      assertionEvaluation: {
        status: 'neutral',
        summary: '输入值绑定无法解析。',
        evidence: (error as Error).message || '凭据引用不可用。',
      },
    };
  }

  throwIfRunCancelled(request.cancellationSignal);
  if (action.kind === 'input') {
    const nextSession = await awaitWithRunCancellation(
      browserObserver.input({ selector: action.locator.selector, value }),
      request.cancellationSignal,
    );
    return {
      session: nextSession,
      inputSelector: action.locator.selector,
      message: `已使用已确认的输入值引用填写 selector：${action.locator.selector}`,
    };
  }

  if (!browserObserver.select) {
    return {
      session,
      message: '当前浏览器 runtime 未接入 select 执行器，未派发浏览器动作。',
      assertionEvaluation: {
        status: 'neutral',
        summary: '下拉选择执行器不可用。',
        evidence: '输入值未传递给未接入的浏览器执行器。',
      },
    };
  }
  const nextSession = await awaitWithRunCancellation(
    browserObserver.select({ selector: action.locator.selector, value }),
    request.cancellationSignal,
  );
  return {
    session: nextSession,
    selectedSelector: action.locator.selector,
    message: `已使用已确认的输入值引用选择 selector：${action.locator.selector}`,
  };
};

export const createBrowserSessionCoordinator = (
  dependencies: BrowserSessionCoordinatorDependencies,
): BrowserSessionCoordinator => {
  return {
    captureObservation: (cancellationSignal) => captureBrowserObservation(dependencies, cancellationSignal),
    prepareDeterministicAssertion: (request) => prepareDeterministicAssertion(dependencies, request),
    prepareDeterministicBoundInput: (request) => prepareDeterministicBoundInput(dependencies, request),
    prepareForAgent: (request, plannedStep) => prepareBrowserForAgent(dependencies, request, plannedStep),
  };
};
