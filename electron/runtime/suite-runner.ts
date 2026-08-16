import type {
  ProjectDraft,
  ProjectEnvironment,
  RunReason,
  RunStatus,
  RunTone,
  SuiteAsset,
  SuiteCaseReference,
  TestCaseDraft,
  SuiteCaseRunResult,
  SuiteRunResult,
} from '../../shared/studio.js';
import { resolveSuiteTestCases, resolveTestCaseFixtures } from '../../shared/studio.js';

export interface SuiteCaseExecutionRequest {
  suite: SuiteAsset;
  testCase: TestCaseDraft;
  environment: ProjectEnvironment;
  attempt: number;
  cancellationSignal?: AbortSignal;
}

export interface SuiteCaseExecutionResult {
  /** Executor lifecycle state; SuiteRunner projects it into a terminal result. */
  status: Exclude<RunTone, 'running'>;
  summary: string;
  reason?: RunReason;
  runId?: string;
}

export interface SuiteCaseExecutor {
  execute(request: SuiteCaseExecutionRequest): Promise<SuiteCaseExecutionResult>;
}

export interface SuiteRunnerOptions {
  /** BrowserRuntime currently supplies one active session, so adapters cap this at one until they provide an isolated pool. */
  maxConcurrency?: number;
  now?: () => Date;
}

export type { SuiteCaseRunResult, SuiteRunResult } from '../../shared/studio.js';

interface PendingSuiteCase {
  reference: SuiteCaseReference;
  testCase: TestCaseDraft;
  resourceLocks: string[];
}

/**
 * Shared, side-effect-free scheduling policy for desktop and CLI adapters.
 * It only invokes the supplied case executor; it never opens a browser or
 * persists a run by itself.
 */
export class SuiteRunner {
  private readonly maxConcurrency: number;
  private readonly now: () => Date;

  constructor(
    private readonly executor: SuiteCaseExecutor,
    options: SuiteRunnerOptions = {},
  ) {
    this.maxConcurrency = clampConcurrency(options.maxConcurrency ?? 1);
    this.now = options.now ?? (() => new Date());
  }

  async run(
    project: Pick<ProjectDraft, 'id' | 'environments' | 'fixtures' | 'testCases'>,
    suite: SuiteAsset,
    cancellationSignal?: AbortSignal,
  ): Promise<SuiteRunResult> {
    const startedAt = this.now().toISOString();
    const resolution = resolveSuiteTestCases(project, suite);
    const issues = resolution.issues.map((issue) => issue.message);
    const effectiveConcurrency = Math.min(clampConcurrency(suite.execution.concurrency), this.maxConcurrency);
    if (!resolution.environment || resolution.issues.length) {
      return this.createResult(suite, startedAt, effectiveConcurrency, [], issues, Boolean(cancellationSignal?.aborted));
    }

    const pending = resolution.orderedCases.map(({ reference, testCase }) => ({
      reference,
      testCase,
      resourceLocks: deriveSuiteCaseResourceLocks(project, testCase, resolution.environment!.id),
    }));
    const results = new Map<string, SuiteCaseRunResult>();
    const running = new Map<string, { candidate: PendingSuiteCase; promise: Promise<void> }>();
    const heldLocks = new Set<string>();
    let failFastTriggered = false;

    while (pending.length || running.size) {
      if (cancellationSignal?.aborted) {
        pending.splice(0).forEach((candidate) => {
          results.set(referenceKey(candidate.reference), cancelledResult(candidate, 'Suite run was cancelled before this Case started.'));
        });
      } else if (failFastTriggered) {
        pending.splice(0).forEach((candidate) => {
          results.set(referenceKey(candidate.reference), skippedResult(candidate, 'Suite stopped after a prior Case did not pass.'));
        });
      } else {
        this.markBlockedDependencies(pending, results);
        while (running.size < effectiveConcurrency) {
          const index = pending.findIndex((candidate) => this.isRunnable(candidate, results, heldLocks));
          if (index < 0) {
            break;
          }
          const [candidate] = pending.splice(index, 1);
          if (!candidate) {
            break;
          }
          candidate.resourceLocks.forEach((lock) => heldLocks.add(lock));
          const key = referenceKey(candidate.reference);
          const promise = this.executeCandidate(suite, candidate, resolution.environment, cancellationSignal)
            .then((result) => {
              results.set(key, result);
              if (suite.execution.failurePolicy === 'failFast' && result.status !== 'passed') {
                failFastTriggered = true;
              }
            })
            .catch((error) => {
              results.set(
                key,
                cancellationSignal?.aborted
                  ? cancelledResult(candidate, 'Suite run was cancelled.')
                  : executorErrorResult(candidate, errorMessage(error)),
              );
              if (suite.execution.failurePolicy === 'failFast') {
                failFastTriggered = true;
              }
            })
            .finally(() => {
              candidate.resourceLocks.forEach((lock) => heldLocks.delete(lock));
              running.delete(key);
            });
          running.set(key, { candidate, promise });
        }
      }

      if (running.size) {
        await Promise.race(Array.from(running.values(), ({ promise }) => promise));
        continue;
      }

      if (pending.length) {
        // No in-flight work and no runnable member means a dependency is not
        // satisfiable. It never invokes the executor.
        pending.splice(0).forEach((candidate) => {
          results.set(referenceKey(candidate.reference), skippedResult(candidate, 'Suite dependency did not pass.'));
        });
      }
    }

    const orderedResults = resolution.orderedCases
      .map(({ reference }) => results.get(referenceKey(reference)))
      .filter((result): result is SuiteCaseRunResult => Boolean(result));
    return this.createResult(suite, startedAt, effectiveConcurrency, orderedResults, issues, Boolean(cancellationSignal?.aborted));
  }

  private markBlockedDependencies(
    pending: PendingSuiteCase[],
    results: Map<string, SuiteCaseRunResult>,
  ): void {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const candidate = pending[index]!;
      const dependencyResults = candidate.reference.dependsOn.map((dependency) => results.get(referenceKey(dependency)));
      if (dependencyResults.some((result) => result && result.status !== 'passed')) {
        pending.splice(index, 1);
        results.set(referenceKey(candidate.reference), skippedResult(candidate, 'A required Suite dependency did not pass.'));
      }
    }
  }

  private isRunnable(
    candidate: PendingSuiteCase,
    results: ReadonlyMap<string, SuiteCaseRunResult>,
    heldLocks: ReadonlySet<string>,
  ): boolean {
    return candidate.reference.dependsOn.every((dependency) => results.get(referenceKey(dependency))?.status === 'passed') &&
      candidate.resourceLocks.every((lock) => !heldLocks.has(lock));
  }

  private async executeCandidate(
    suite: SuiteAsset,
    candidate: PendingSuiteCase,
    environment: ProjectEnvironment,
    cancellationSignal?: AbortSignal,
  ): Promise<SuiteCaseRunResult> {
    let attempts = 0;
    let hadFailure = false;
    let lastResult: TerminalSuiteCaseExecutionResult | undefined;
    while (attempts <= suite.execution.retryLimit) {
      if (cancellationSignal?.aborted) {
        return cancelledResult(candidate, 'Suite run was cancelled.');
      }
      attempts += 1;
      lastResult = terminalSuiteCaseResult(await this.executor.execute({
        suite,
        testCase: candidate.testCase,
        environment,
        attempt: attempts,
        cancellationSignal,
      }));
      if (cancellationSignal?.aborted) {
        return {
          ...cancelledResult(candidate, 'Suite run was cancelled.'),
          ...(lastResult.runId ? { runId: lastResult.runId } : {}),
        };
      }
      if (lastResult.status === 'passed') {
        return {
          testCaseId: candidate.testCase.id,
          testCaseVersion: candidate.reference.version,
          status: 'passed',
          summary: lastResult.summary,
          ...(lastResult.reason ? { reason: lastResult.reason } : {}),
          attempts,
          flaky: hadFailure,
          ...(lastResult.runId ? { runId: lastResult.runId } : {}),
        };
      }
      if (lastResult.status !== 'failed') {
        break;
      }
      hadFailure = true;
    }
    const result = lastResult ?? {
      status: 'skipped' as const,
      summary: 'Suite Case did not run.',
      reason: reason('dependencyFailed', 'Suite Case did not run.'),
    };
    return {
      testCaseId: candidate.testCase.id,
      testCaseVersion: candidate.reference.version,
      status: result.status,
      summary: result.summary,
      ...(result.reason ? { reason: result.reason } : {}),
      attempts,
      flaky: false,
      ...(result.runId ? { runId: result.runId } : {}),
    };
  }

  private createResult(
    suite: SuiteAsset,
    startedAt: string,
    effectiveConcurrency: number,
    results: SuiteCaseRunResult[],
    issues: string[],
    cancelled: boolean,
  ): SuiteRunResult {
    return {
      suiteId: suite.id,
      suiteVersion: suite.version,
      environmentId: suite.environmentId,
      ...(suiteResultOutcome(results, issues, cancelled)),
      startedAt,
      endedAt: this.now().toISOString(),
      effectiveConcurrency,
      results,
      issues,
    };
  }
}

/**
 * Maps declared Fixture locks and project-scoped authentication references to
 * scheduler keys. Arbitrary Fixture locks may represent account, tenant, or
 * environment ownership, but no secrets are included in the key.
 */
export function deriveSuiteCaseResourceLocks(
  project: Pick<ProjectDraft, 'id' | 'fixtures'>,
  testCase: Pick<TestCaseDraft, 'assetReferences'>,
  environmentId: string,
): string[] {
  const locks = new Set<string>();
  const resolution = resolveTestCaseFixtures(project, testCase.assetReferences?.fixtures ?? [], environmentId);
  resolution.fixtures.forEach((fixture) => {
    if (fixture.concurrency === 'exclusive') {
      locks.add(`fixture:${fixture.id}@${fixture.version}`);
    }
    fixture.credentialIds.forEach((credentialId) => locks.add(`credential:${credentialId}`));
    fixture.resourceLocks.forEach((resource) => locks.add(`resource:${project.id}:${resource}`));
  });
  return Array.from(locks).sort();
}

function skippedResult(candidate: PendingSuiteCase, summary: string): SuiteCaseRunResult {
  return {
    testCaseId: candidate.testCase.id,
    testCaseVersion: candidate.reference.version,
    status: 'skipped',
    summary,
    reason: reason('dependencyFailed', summary),
    attempts: 0,
    flaky: false,
  };
}

function cancelledResult(candidate: PendingSuiteCase, summary: string): SuiteCaseRunResult {
  return {
    testCaseId: candidate.testCase.id,
    testCaseVersion: candidate.reference.version,
    status: 'cancelled',
    summary,
    reason: reason('userCancelled', summary),
    attempts: 0,
    flaky: false,
  };
}

function executorErrorResult(candidate: PendingSuiteCase, summary: string): SuiteCaseRunResult {
  return {
    testCaseId: candidate.testCase.id,
    testCaseVersion: candidate.reference.version,
    status: 'error',
    summary,
    reason: reason('executorError', summary),
    attempts: 0,
    flaky: false,
  };
}

interface TerminalSuiteCaseExecutionResult {
  status: Exclude<RunStatus, 'running'>;
  summary: string;
  reason?: RunReason;
  runId?: string;
}

function terminalSuiteCaseResult(result: SuiteCaseExecutionResult): TerminalSuiteCaseExecutionResult {
  switch (result.status) {
    case 'passed':
      return { status: result.status, summary: result.summary, ...(result.runId ? { runId: result.runId } : {}) };
    case 'failed':
      return withSuiteReason(result, 'failed', 'actionFailed');
    case 'blocked':
      return withSuiteReason(result, 'blocked', 'unsupportedAction');
    case 'skipped':
      return withSuiteReason(result, 'skipped', 'dependencyFailed');
    case 'cancelled':
      return withSuiteReason(result, 'cancelled', 'userCancelled');
    case 'error':
      return withSuiteReason(result, 'error', 'executorError');
    case 'neutral':
      return withSuiteReason(result, 'blocked', 'unsupportedAction');
  }
}

function withSuiteReason(
  result: Omit<SuiteCaseExecutionResult, 'status'>,
  status: Exclude<RunStatus, 'running' | 'passed'>,
  defaultCode: RunReason['code'],
): TerminalSuiteCaseExecutionResult {
  return {
    status,
    summary: result.summary,
    reason: result.reason ?? reason(defaultCode, result.summary),
    ...(result.runId ? { runId: result.runId } : {}),
  };
}

function suiteResultOutcome(
  results: SuiteCaseRunResult[],
  issues: string[],
  cancelled: boolean,
): Pick<SuiteRunResult, 'status' | 'reason'> {
  if (cancelled) {
    return { status: 'cancelled', reason: reason('userCancelled', 'Suite run was cancelled.') };
  }
  if (issues.length) {
    return { status: 'blocked', reason: reason('missingAssetVersion', issues[0]!) };
  }
  const first = (status: SuiteCaseRunResult['status']) => results.find((result) => result.status === status);
  const errored = first('error');
  if (errored) {
    return { status: 'error', reason: errored.reason ?? reason('executorError', errored.summary) };
  }
  const failed = first('failed');
  if (failed) {
    return { status: 'failed', reason: failed.reason ?? reason('actionFailed', failed.summary) };
  }
  const memberCancelled = first('cancelled');
  if (memberCancelled) {
    return { status: 'cancelled', reason: memberCancelled.reason ?? reason('userCancelled', memberCancelled.summary) };
  }
  const blocked = first('blocked');
  if (blocked) {
    return { status: 'blocked', reason: blocked.reason ?? reason('unsupportedAction', blocked.summary) };
  }
  const skipped = first('skipped');
  if (skipped) {
    return { status: 'skipped', reason: skipped.reason ?? reason('dependencyFailed', skipped.summary) };
  }
  return { status: 'passed' };
}

function reason(code: RunReason['code'], message: string): RunReason {
  return { code, message };
}

function clampConcurrency(value: number): number {
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(10, value)) : 1;
}

function referenceKey(reference: Pick<SuiteCaseReference, 'id' | 'version'>): string {
  return `${reference.id}@${reference.version}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? `Suite Case execution failed: ${error.message}` : 'Suite Case execution failed.';
}
