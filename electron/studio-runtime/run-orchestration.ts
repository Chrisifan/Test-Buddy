import {
  type ChatCommandRequest,
  type ChatCommandResponse,
  defaultMidsceneConfig,
  resolveAgentModelAssignments,
} from '../../shared/studio.js';
import {
  type AgentDynamicWaitAttempt,
  type AgentExecutionMetrics,
  type AgentPlanDraft,
  type AgentPlanProvenance,
  type AgentPlanStepDraft,
  type AgentRunResult,
  type AgentSelectorFallbackAttempt,
} from '../../shared/agent.js';
import {
  createPlannedAgentRun,
  createStubAgentRun,
  type PlannedAgentReplanningRecord,
  type PlannedAgentStepExecution,
} from '../../shared/agentStub.js';
import type { AgentPlannerRequest, AgentPlannerResult } from '../runtime/agent-planner.js';
import type { ResolvedChatCommandRequest } from '../runtime/model-config-resolver.js';
import { throwIfRunCancelled } from '../runtime/run-cancellation.js';
import {
  createPendingSemanticEvaluation,
  type BrowserPreparationResult,
  type BrowserSessionCoordinator,
} from './browser-session.js';
import { isObservationIntent } from './routes.js';

export interface PlanningAttempt {
  result?: AgentPlannerResult;
  provenance: AgentPlanProvenance;
}

type CompletedPlannerStep = NonNullable<AgentPlannerRequest['completedSteps']>[number];

interface SelectorFallbackResult {
  execution: PlannedAgentStepExecution;
  attempts: AgentSelectorFallbackAttempt[];
  executionMetrics?: AgentExecutionMetrics;
}

export interface AgentRunOrchestratorDependencies {
  browserSessionCoordinator: Pick<BrowserSessionCoordinator, 'prepareForAgent'>;
  beginTraceScope: (runId: string) => Promise<boolean>;
  finishTraceScope: (runId: string, ownsTraceScope: boolean, agentRun: AgentRunResult) => Promise<AgentRunResult>;
  createAgentPlan: (request: ResolvedChatCommandRequest) => Promise<PlanningAttempt>;
  resolvePlannerReplanningCycleLimit: (request: ChatCommandRequest) => number;
  prepareStepExecution: (
    step: AgentPlanStepDraft,
    stepIndex: number,
    preparation: BrowserPreparationResult,
  ) => PlannedAgentStepExecution;
  mergeExecutionMetrics: (
    left: AgentExecutionMetrics | undefined,
    right: AgentExecutionMetrics | undefined,
  ) => AgentExecutionMetrics | undefined;
  withReplanningCycleLimit: (metrics: AgentExecutionMetrics, limit: number) => AgentExecutionMetrics;
  shouldRetryFailedExecution: (step: AgentPlanStepDraft, execution: PlannedAgentStepExecution) => boolean;
  waitBeforeRetry: (
    step: AgentPlanStepDraft,
    failedExecution: PlannedAgentStepExecution,
    cancellationSignal?: AbortSignal,
  ) => Promise<AgentDynamicWaitAttempt | undefined>;
  withDynamicWaitAttempt: (metrics: AgentExecutionMetrics) => AgentExecutionMetrics;
  withRetryAttempt: (metrics: AgentExecutionMetrics) => AgentExecutionMetrics;
  shouldTrySelectorFallback: (step: AgentPlanStepDraft, execution: PlannedAgentStepExecution) => boolean;
  trySelectorFallbackForStep: (
    request: ResolvedChatCommandRequest,
    step: AgentPlanStepDraft,
    stepIndex: number,
    previousExecution: PlannedAgentStepExecution,
    cancellationSignal?: AbortSignal,
  ) => Promise<SelectorFallbackResult | undefined>;
  withSelectorFallbackAttempt: (metrics: AgentExecutionMetrics) => AgentExecutionMetrics;
  appendCompletedPlannerSteps: (
    existing: CompletedPlannerStep[],
    plan: AgentPlanDraft,
    executions: PlannedAgentStepExecution[],
  ) => CompletedPlannerStep[];
  shouldReplanFailedExecution: (step: AgentPlanStepDraft, execution: PlannedAgentStepExecution) => boolean;
  createReplannedAgentPlan: (
    request: ResolvedChatCommandRequest,
    currentPlan: AgentPlanDraft,
    failedStep: AgentPlanStepDraft,
    failedExecution: PlannedAgentStepExecution,
    completedSteps: CompletedPlannerStep[],
  ) => Promise<AgentPlannerResult | undefined>;
  withReplanningCycle: (metrics: AgentExecutionMetrics) => AgentExecutionMetrics;
  createPrimaryExecution: (preparation: BrowserPreparationResult) => Record<string, unknown>;
  enhanceRunWithReporter: (
    request: ResolvedChatCommandRequest,
    agentRun: AgentRunResult,
  ) => Promise<AgentRunResult>;
  createChatCommandResponse: (
    request: ChatCommandRequest,
    agentRun: AgentRunResult,
  ) => ChatCommandResponse;
}

export interface AgentRunOrchestrator {
  runChatCommand: (request: ResolvedChatCommandRequest) => Promise<ChatCommandResponse>;
}

const runChatCommand = async (
  dependencies: AgentRunOrchestratorDependencies,
  request: ResolvedChatCommandRequest,
): Promise<ChatCommandResponse> => {
  throwIfRunCancelled(request.cancellationSignal);
  const traceScopeId = `agent-trace-${Date.now()}`;
  const ownsTraceScope = await dependencies.beginTraceScope(traceScopeId);
  const planningAttempt = await dependencies.createAgentPlan(request);
  throwIfRunCancelled(request.cancellationSignal);
  const modelAssignments = resolveAgentModelAssignments({
    midsceneConfig: request.midsceneConfig ?? defaultMidsceneConfig,
    ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
  });

  if (planningAttempt.result) {
    const executions: PlannedAgentStepExecution[] = [];
    const replanningHistory: PlannedAgentReplanningRecord[] = [];
    const replanningCycleLimit = dependencies.resolvePlannerReplanningCycleLimit(request);
    let executionMetrics = dependencies.withReplanningCycleLimit(
      planningAttempt.result.metrics,
      replanningCycleLimit,
    );
    let plannedPlan = planningAttempt.result.plan;
    let replanningCycles = 0;
    let completedSteps: CompletedPlannerStep[] = [];
    for (let stepIndex = 0; stepIndex < plannedPlan.steps.length; stepIndex += 1) {
      throwIfRunCancelled(request.cancellationSignal);
      const step = plannedPlan.steps[stepIndex]!;
      const preparation = await dependencies.browserSessionCoordinator.prepareForAgent(request, step);
      let execution = dependencies.prepareStepExecution(step, stepIndex, preparation);
      executionMetrics = dependencies.mergeExecutionMetrics(executionMetrics, preparation.executionMetrics) ?? executionMetrics;
      if (execution.status !== 'passed' && dependencies.shouldRetryFailedExecution(step, execution)) {
        const failedAttempt = execution;
        const dynamicWaitAttempt = await dependencies.waitBeforeRetry(step, failedAttempt, request.cancellationSignal);
        if (dynamicWaitAttempt) {
          executionMetrics = dependencies.withDynamicWaitAttempt(executionMetrics);
        }
        if (dynamicWaitAttempt?.status === 'failed') {
          execution = {
            ...failedAttempt,
            dynamicWaitAttempts: [...(failedAttempt.dynamicWaitAttempts ?? []), dynamicWaitAttempt],
          };
        } else {
          const retryPreparation = await dependencies.browserSessionCoordinator.prepareForAgent(request, step);
          execution = {
            ...dependencies.prepareStepExecution(step, stepIndex, retryPreparation),
            ...(dynamicWaitAttempt ? { dynamicWaitAttempts: [dynamicWaitAttempt] } : {}),
            retryAttempts: [
              {
                status: failedAttempt.status,
                summary: failedAttempt.summary,
                evidence: failedAttempt.evidence,
                ...(failedAttempt.failureReason ? { failureReason: failedAttempt.failureReason } : {}),
                ...(failedAttempt.failureCategory ? { failureCategory: failedAttempt.failureCategory } : {}),
                ...(failedAttempt.recoveryStrategy ? { recoveryStrategy: failedAttempt.recoveryStrategy } : {}),
              },
            ],
          };
          executionMetrics = dependencies.withRetryAttempt(
            dependencies.mergeExecutionMetrics(executionMetrics, retryPreparation.executionMetrics) ?? executionMetrics,
          );
        }
      }
      if (execution.status !== 'passed' && dependencies.shouldTrySelectorFallback(step, execution)) {
        const selectorFallback = await dependencies.trySelectorFallbackForStep(
          request,
          step,
          stepIndex,
          execution,
          request.cancellationSignal,
        );
        if (selectorFallback) {
          execution = selectorFallback.execution;
          executionMetrics =
            dependencies.mergeExecutionMetrics(executionMetrics, selectorFallback.executionMetrics) ?? executionMetrics;
          selectorFallback.attempts.forEach(() => {
            executionMetrics = dependencies.withSelectorFallbackAttempt(executionMetrics);
          });
        }
      }
      if (execution.status !== 'passed') {
        const completedStepsForReplan = dependencies.appendCompletedPlannerSteps(completedSteps, plannedPlan, executions);
        const revisedPlan = replanningCycles >= replanningCycleLimit || !dependencies.shouldReplanFailedExecution(step, execution)
          ? undefined
          : await dependencies.createReplannedAgentPlan(request, plannedPlan, step, execution, completedStepsForReplan);
        if (revisedPlan) {
          const previousPlan = plannedPlan;
          executions.push(execution);
          completedSteps = completedStepsForReplan;
          const completedStepCount = completedSteps.length;
          replanningCycles += 1;
          const nextPlan = {
            ...revisedPlan.plan,
            risks: [
              ...revisedPlan.plan.risks,
              `已在步骤「${step.title}」${execution.status === 'failed' ? '失败' : '未完成'}后触发第 ${replanningCycles} 次重规划。`,
            ],
          };
          replanningHistory.push({
            cycle: replanningCycles,
            previousPlan,
            revisedPlan: nextPlan,
            executions: [...executions],
            failedStepIndex: stepIndex,
            ...(completedStepCount ? { completedStepCount } : {}),
            ...(revisedPlan.metrics ? { planningMetrics: revisedPlan.metrics } : {}),
          });
          plannedPlan = nextPlan;
          executionMetrics = dependencies.mergeExecutionMetrics(
            executionMetrics,
            dependencies.withReplanningCycle(revisedPlan.metrics),
          ) ?? executionMetrics;
          executions.length = 0;
          stepIndex = -1;
          continue;
        }
        executions.push(execution);
        break;
      }
      executions.push(execution);
    }
    const tracedAgentRun = await dependencies.finishTraceScope(traceScopeId, ownsTraceScope, createPlannedAgentRun({
      mode: request.mode,
      prompt: request.prompt,
      runtimeDescription: `${request.runtimeProfile.browser} / ${request.runtimeProfile.viewport} / ${request.runtimeProfile.headless ? 'headless' : 'headed'} / ${request.runtimeProfile.baseUrl}`,
      targetEnvironment: request.targetEnvironment,
      targetUrl: request.runtimeProfile.baseUrl,
      plannedPlan,
      planner: planningAttempt.provenance,
      executions,
      ...(replanningHistory.length ? { replanningHistory } : {}),
      ...(planningAttempt.result.metrics ? { planningMetrics: planningAttempt.result.metrics } : {}),
      executionMetrics,
      modelAssignments,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.groupId ? { groupId: request.groupId } : {}),
      ...(request.environmentId ? { environmentId: request.environmentId } : {}),
      ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
      ...(request.documentId ? { documentId: request.documentId } : {}),
    }));
    const agentRun = await dependencies.enhanceRunWithReporter(request, tracedAgentRun);
    return dependencies.createChatCommandResponse(request, agentRun);
  }

  const browserPreparation = await dependencies.browserSessionCoordinator.prepareForAgent(request);
  throwIfRunCancelled(request.cancellationSignal);
  const observedSession = browserPreparation.session;
  const primaryExecution = dependencies.createPrimaryExecution(browserPreparation);
  const unresolvedEvaluation =
    !browserPreparation.assertionEvaluation &&
    (request.mode === 'aiQuery' ||
      (!('primaryAction' in primaryExecution) && request.mode === 'ai' && !isObservationIntent(request.prompt)))
      ? createPendingSemanticEvaluation(
          request.mode === 'aiQuery'
            ? '结构化提取能力尚未执行，该步骤保持等待态。'
            : '当前指令尚未解析为可执行浏览器动作，该步骤保持等待态。',
        )
      : undefined;
  const verificationEvaluation = browserPreparation.assertionEvaluation ?? unresolvedEvaluation;
  const executionMetrics = browserPreparation.executionMetrics;
  const tracedAgentRun = await dependencies.finishTraceScope(traceScopeId, ownsTraceScope, createStubAgentRun({
    mode: request.mode,
    prompt: request.prompt,
    runtimeDescription: `${request.runtimeProfile.browser} / ${request.runtimeProfile.viewport} / ${request.runtimeProfile.headless ? 'headless' : 'headed'} / ${request.runtimeProfile.baseUrl}`,
    targetEnvironment: request.targetEnvironment,
    targetUrl: browserPreparation.navigatedUrl ?? request.runtimeProfile.baseUrl,
    browserActionMessage: browserPreparation.message,
    ...primaryExecution,
    planner: planningAttempt.provenance,
    ...(browserPreparation.observation ? { observation: browserPreparation.observation } : {}),
    ...(verificationEvaluation
      ? {
          verificationStatus: verificationEvaluation.status,
          verificationSummary: verificationEvaluation.summary,
          verificationEvidence: verificationEvaluation.evidence,
          ...(verificationEvaluation.failureReason
            ? { verificationFailureReason: verificationEvaluation.failureReason }
            : {}),
        }
      : {}),
    ...(browserPreparation.reportArtifactPath ? { reportArtifactPath: browserPreparation.reportArtifactPath } : {}),
    ...(executionMetrics ? { executionMetrics } : {}),
    modelAssignments,
    ...(observedSession
      ? {
          browserSession: {
            status: observedSession.status,
            currentUrl: observedSession.currentUrl,
            pageTitle: observedSession.pageTitle,
            ...(observedSession.screenshotPath ? { screenshotPath: observedSession.screenshotPath } : {}),
          },
        }
      : {}),
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.groupId ? { groupId: request.groupId } : {}),
    ...(request.environmentId ? { environmentId: request.environmentId } : {}),
    ...(request.testCaseId ? { testCaseId: request.testCaseId } : {}),
    ...(request.documentId ? { documentId: request.documentId } : {}),
  } as never));
  const agentRun = await dependencies.enhanceRunWithReporter(request, tracedAgentRun);
  return dependencies.createChatCommandResponse(request, agentRun);
};

export const createAgentRunOrchestrator = (
  dependencies: AgentRunOrchestratorDependencies,
): AgentRunOrchestrator => {
  return {
    runChatCommand: (request) => runChatCommand(dependencies, request),
  };
};
