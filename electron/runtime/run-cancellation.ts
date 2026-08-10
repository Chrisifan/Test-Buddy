import type { AgentRunCancellation, AgentRunResult } from '../../shared/agent.js';
import type { RunCancellation } from '../../shared/studio.js';

export const userCancelledRunReason = '用户已取消运行。';

export class RunCancelledError extends Error {
  constructor(message = userCancelledRunReason) {
    super(message);
    this.name = 'RunCancelledError';
  }
}

export function isRunCancelled(error: unknown): error is RunCancelledError {
  return error instanceof RunCancelledError;
}

export function throwIfRunCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RunCancelledError();
  }
}

/**
 * Links a request-scoped cancellation signal to an operation controller while
 * keeping the operation's own timeout lifecycle independent from the run.
 */
export function createLinkedAbortController(cancellationSignal?: AbortSignal): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();

  if (cancellationSignal?.aborted) {
    controller.abort();
  } else {
    cancellationSignal?.addEventListener('abort', abort, { once: true });
  }

  return {
    controller,
    dispose: () => cancellationSignal?.removeEventListener('abort', abort),
  };
}

export function createUserRunCancellation(cancelledAt = new Date().toISOString()): RunCancellation {
  return {
    source: 'user',
    reason: 'userCancelled',
    message: userCancelledRunReason,
    cancelledAt,
  };
}

export function markAgentRunCancelled(
  agentRun: AgentRunResult,
  cancellation: RunCancellation,
): AgentRunResult {
  const agentCancellation: AgentRunCancellation = cancellation;
  const finishedEvent = agentRun.events.find((event) => event.type === 'agent:run-finished');
  const events = agentRun.events.filter((event) => event.type !== 'agent:run-finished');
  events.push({
    id: `${agentRun.runId}-event-cancelled`,
    runId: agentRun.runId,
    type: 'agent:run-cancelled',
    message: cancellation.message,
    status: 'neutral',
    cancellation: agentCancellation,
    createdAt: cancellation.cancelledAt,
  });
  events.push({
    ...(finishedEvent ?? {
      id: `${agentRun.runId}-event-finished`,
      runId: agentRun.runId,
      type: 'agent:run-finished' as const,
      createdAt: cancellation.cancelledAt,
    }),
    message: cancellation.message,
    status: 'neutral',
    createdAt: cancellation.cancelledAt,
  });
  return {
    ...agentRun,
    status: 'neutral',
    summary: cancellation.message,
    events,
    endedAt: cancellation.cancelledAt,
    cancellation: agentCancellation,
  };
}

/**
 * Stops awaiting a browser operation without closing its session. The operation
 * may still settle in Playwright, but its result is intentionally discarded.
 */
export function awaitWithRunCancellation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfRunCancelled(signal);
  if (!signal) {
    return operation;
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RunCancelledError());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
