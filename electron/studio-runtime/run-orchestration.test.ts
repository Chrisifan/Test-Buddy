import { expect, test, vi } from 'vitest';

import { createAgentRunOrchestrator } from './run-orchestration.js';

test('retries one failed planned step and retains the first attempt evidence', async () => {
  const prepareForAgent = vi
    .fn()
    .mockResolvedValueOnce({ message: 'first attempt' })
    .mockResolvedValueOnce({ message: 'retry passed' });
  const orchestrator = createAgentRunOrchestrator({
    browserSessionCoordinator: { prepareForAgent },
    beginTraceScope: vi.fn().mockResolvedValue(false),
    createAgentPlan: vi.fn().mockResolvedValue({
      result: {
        modelName: 'planner-test',
        metrics: {},
        plan: {
          title: 'Retry one action',
          summary: 'Retry the planned action once.',
          risks: [],
          steps: [{ id: 'step-1', action: 'click', title: 'Click', instruction: 'Click save' }],
        },
      },
      provenance: { source: 'model', modelName: 'planner-test' },
    }),
    resolvePlannerReplanningCycleLimit: () => 0,
    prepareStepExecution: (_step, stepIndex, preparation) => ({
      stepIndex,
      status: preparation.message === 'first attempt' ? 'failed' : 'passed',
      summary: preparation.message,
      evidence: preparation.message,
    }),
    mergeExecutionMetrics: (left, right) => right ?? left,
    withReplanningCycleLimit: (metrics) => metrics,
    shouldRetryFailedExecution: (_step, execution) => execution.status === 'failed',
    waitBeforeRetry: vi.fn().mockResolvedValue(undefined),
    withDynamicWaitAttempt: (metrics) => metrics,
    withRetryAttempt: (metrics) => ({ ...metrics, retryAttempts: (metrics.retryAttempts ?? 0) + 1 }),
    shouldTrySelectorFallback: () => false,
    trySelectorFallbackForStep: vi.fn(),
    withSelectorFallbackAttempt: (metrics) => metrics,
    appendCompletedPlannerSteps: vi.fn(),
    shouldReplanFailedExecution: () => false,
    createReplannedAgentPlan: vi.fn(),
    withReplanningCycle: (metrics) => metrics,
    createPrimaryExecution: vi.fn(),
    finishTraceScope: async (_runId, _ownsTraceScope, agentRun) => agentRun,
    enhanceRunWithReporter: async (_request, agentRun) => agentRun,
    createChatCommandResponse: (_request, agentRun) => ({ agentRun }),
  } as never);

  const response = await orchestrator.runChatCommand({
    mode: 'ai',
    prompt: 'Click save',
    targetEnvironment: 'Staging',
    runtimeProfile: { browser: 'chromium', baseUrl: 'https://example.test', viewport: 'desktop', locale: 'zh-CN', headless: true },
  } as never);

  expect(prepareForAgent).toHaveBeenCalledTimes(2);
  expect(response.agentRun.metrics).toEqual(expect.objectContaining({ retryAttempts: 1 }));
  expect(response.agentRun.events.find((event) => event.type === 'agent:step-retried')?.retryAttempt).toEqual(
    expect.objectContaining({ status: 'failed', evidence: 'first attempt' }),
  );
});
