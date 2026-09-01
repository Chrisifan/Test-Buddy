import { describe, expect, it, vi } from 'vitest';

import { createEmptyProject, createEmptyTestCase, type SuiteAsset } from '../../shared/studio.js';
import { BrowserPool } from './browser-pool.js';
import { deriveSuiteCaseResourceLocks, SuiteRunner, type SuiteCaseExecutor } from './suite-runner.js';

describe('SuiteRunner', () => {
  it('acquires a fresh pool worker for every Suite Case and returns it after execution', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 1 });
    const contexts = Array.from({ length: 3 }, () => ({ close: vi.fn().mockResolvedValue(undefined) }));
    const newContext = vi.fn(async () => contexts.shift()!);
    const browserPool = new BrowserPool({ createBrowser: async () => ({ newContext }) });
    const receivedPools: BrowserPool[] = [];
    const runner = new SuiteRunner({
      execute: async ({ browserPool: receivedPool }) => {
        if (receivedPool) {
          receivedPools.push(receivedPool);
        }
        return { status: 'passed', summary: 'passed' };
      },
    }, { browserPool });

    const result = await runner.run(project, suite);

    expect(result.effectiveConcurrency).toBe(1);
    expect(receivedPools).toEqual([browserPool, browserPool, browserPool]);
    expect(newContext).toHaveBeenCalledTimes(3);
    expect(browserPool.activeLeaseCount).toBe(0);
    await browserPool.close();
  });

  it('caps qualified pool execution at capacity and returns every worker lease once', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 8 });
    const contexts = Array.from({ length: 3 }, () => ({ close: vi.fn().mockResolvedValue(undefined) }));
    const availableContexts = [...contexts];
    const newContext = vi.fn(async () => availableContexts.shift()!);
    const browserPool = new BrowserPool({
      capacity: 2,
      createBrowser: async () => ({ newContext }),
    });
    const firstTwoStarted = createDeferred<void>();
    const releaseExecutions = createDeferred<void>();
    let started = 0;
    const runner = new SuiteRunner({
      execute: async () => {
        started += 1;
        if (started === 2) firstTwoStarted.resolve();
        await releaseExecutions.promise;
        return { status: 'passed', summary: 'passed' };
      },
    }, { maxConcurrency: 10, browserPool });

    const running = runner.run(project, suite);

    await firstTwoStarted.promise;
    expect(started).toBe(2);
    expect(newContext).toHaveBeenCalledTimes(2);
    expect(browserPool.activeLeaseCount).toBe(2);

    releaseExecutions.resolve();
    const result = await running;

    expect(result.effectiveConcurrency).toBe(2);
    expect(newContext).toHaveBeenCalledTimes(3);
    expect(browserPool.activeLeaseCount).toBe(0);
    contexts.forEach((context) => expect(context.close).toHaveBeenCalledOnce());
    await browserPool.close();
  });

  it('keeps declared order as a tie-breaker while waiting for exact Case dependencies', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 2 });
    const checkout = project.testCases[0]!;
    const invoice = project.testCases[1]!;
    const summary = project.testCases[2]!;
    suite.caseReferences = [
      { id: invoice.id, version: invoice.version!, dependsOn: [{ id: checkout.id, version: checkout.version! }] },
      { id: checkout.id, version: checkout.version!, dependsOn: [] },
      { id: summary.id, version: summary.version!, dependsOn: [] },
    ];
    const calls: string[] = [];
    const runner = new SuiteRunner({
      execute: async ({ testCase }) => {
        calls.push(testCase.id);
        return { status: 'passed', summary: `${testCase.name} passed` };
      },
    }, { maxConcurrency: 2 });

    const result = await runner.run(project, suite);

    expect(result).toMatchObject({ status: 'passed', effectiveConcurrency: 2, issues: [] });
    expect(calls).toEqual([checkout.id, summary.id, invoice.id]);
    expect(result.results.map((entry) => entry.testCaseId)).toEqual([checkout.id, invoice.id, summary.id]);
  });

  it('does not concurrently run Cases that declare the same Fixture resource lock', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 2 });
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-seed',
      version: 1,
      name: '准备共享账户',
      description: '',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [suite.environmentId],
      setup: { mode: 'http' as const, summary: '准备账户' },
      concurrency: 'parallel' as const,
      resourceLocks: ['account:buyer-a'],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    project.fixtures = [fixture];
    project.testCases = project.testCases.slice(0, 2).map((testCase) => ({
      ...testCase,
      assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] },
    }));
    suite.caseReferences = project.testCases.map((testCase) => ({ id: testCase.id, version: testCase.version!, dependsOn: [] }));
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    const calls: string[] = [];
    const executor: SuiteCaseExecutor = {
      execute: async ({ testCase }) => {
        calls.push(testCase.id);
        if (calls.length === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        return { status: 'passed', summary: 'passed' };
      },
    };
    const runner = new SuiteRunner(executor, { maxConcurrency: 2 });
    const running = runner.run(project, suite);

    await firstStarted.promise;
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(deriveSuiteCaseResourceLocks(project, project.testCases[0]!, suite.environmentId)).toEqual([
      `resource:${project.id}:account:buyer-a`,
    ]);
    releaseFirst.resolve();

    await expect(running).resolves.toMatchObject({ status: 'passed', effectiveConcurrency: 2 });
    expect(calls).toHaveLength(2);
  });

  it('retries only failed Cases, marks a recovered Case flaky, and retains fail-fast skipped results', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 1, retryLimit: 1, failurePolicy: 'continue' });
    const attempts = new Map<string, number>();
    const retryRunner = new SuiteRunner({
      execute: async ({ testCase }) => {
        const attempt = (attempts.get(testCase.id) ?? 0) + 1;
        attempts.set(testCase.id, attempt);
        return { status: attempt === 1 ? 'failed' : 'passed', summary: `attempt ${attempt}` };
      },
    });

    const recovered = await retryRunner.run(project, suite);

    expect(recovered).toMatchObject({ status: 'passed' });
    expect(recovered.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempts: 2, status: 'passed', flaky: true }),
    ]));

    const failFastSuite = { ...suite, execution: { concurrency: 1, failurePolicy: 'failFast' as const, retryLimit: 0 } };
    const failFastCalls: string[] = [];
    const failFastRunner = new SuiteRunner({
      execute: async ({ testCase }) => {
        failFastCalls.push(testCase.id);
        return { status: 'failed', summary: 'business assertion failed' };
      },
    });

    const stopped = await failFastRunner.run(project, failFastSuite);

    expect(stopped.status).toBe('failed');
    expect(failFastCalls).toHaveLength(1);
    expect(stopped.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', attempts: 1 }),
      expect.objectContaining({ status: 'skipped', attempts: 0, reason: expect.objectContaining({ code: 'dependencyFailed' }) }),
    ]));
  });

  it('lets already-started parallel fail-fast members finish while skipping pending locked and dependent members', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 2, failurePolicy: 'failFast' });
    const [failing, allowed, locked] = project.testCases;
    const dependent = { ...createEmptyTestCase(4, project.groups[0]!.id, suite.environmentId), id: 'case-dependent', version: 1 };
    const later = { ...createEmptyTestCase(5, project.groups[0]!.id, suite.environmentId), id: 'case-later', version: 1 };
    const fixture = {
      schemaVersion: 1 as const,
      id: 'fixture-shared-lock',
      version: 1,
      name: 'Shared lock',
      description: '',
      inputs: [],
      outputs: [],
      credentialIds: [],
      environmentIds: [suite.environmentId],
      setup: { mode: 'http' as const, summary: 'Set up.' },
      concurrency: 'parallel' as const,
      resourceLocks: ['account:shared'],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    project.fixtures = [fixture];
    project.testCases = [
      failing!,
      { ...allowed!, assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] } },
      { ...locked!, assetReferences: { fixtures: [{ id: fixture.id, version: fixture.version }], reusableFlows: [] } },
      dependent!,
      later!,
    ];
    suite.caseReferences = [
      { id: failing!.id, version: failing!.version!, dependsOn: [] },
      { id: allowed!.id, version: allowed!.version!, dependsOn: [] },
      { id: locked!.id, version: locked!.version!, dependsOn: [] },
      { id: dependent!.id, version: dependent!.version!, dependsOn: [{ id: failing!.id, version: failing!.version! }] },
      { id: later!.id, version: later!.version!, dependsOn: [] },
    ];
    const failureGate = createDeferred<void>();
    const allowedStarted = createDeferred<void>();
    const finishAllowed = createDeferred<void>();
    const calls: string[] = [];
    const runner = new SuiteRunner({
      execute: async ({ testCase }) => {
        calls.push(testCase.id);
        if (testCase.id === failing!.id) {
          await failureGate.promise;
          return { status: 'failed', summary: 'First parallel Case failed.' };
        }
        if (testCase.id === allowed!.id) {
          allowedStarted.resolve();
          await finishAllowed.promise;
          return { status: 'passed', summary: 'Already-started Case completed.' };
        }
        throw new Error(`Unexpected dispatch: ${testCase.id}`);
      },
    }, { maxConcurrency: 2 });

    const running = runner.run(project, suite);
    await allowedStarted.promise;
    failureGate.resolve();
    await Promise.resolve();
    finishAllowed.resolve();
    const result = await running;

    expect(calls).toEqual([failing!.id, allowed!.id]);
    expect(result.results).toMatchObject([
      { testCaseId: failing!.id, status: 'failed', attempts: 1 },
      { testCaseId: allowed!.id, status: 'passed', attempts: 1 },
      { testCaseId: locked!.id, status: 'skipped', attempts: 0, reason: { code: 'dependencyFailed', message: 'Suite stopped after a prior Case did not pass.' } },
      { testCaseId: dependent!.id, status: 'skipped', attempts: 0, reason: { code: 'dependencyFailed', message: 'Suite stopped after a prior Case did not pass.' } },
      { testCaseId: later!.id, status: 'skipped', attempts: 0, reason: { code: 'dependencyFailed', message: 'Suite stopped after a prior Case did not pass.' } },
    ]);
  });

  it('does not dispatch Cases after a cancellation request', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 2 });
    const controller = new AbortController();
    controller.abort();
    const executor = { execute: async () => ({ status: 'passed' as const, summary: 'passed' }) };
    const runner = new SuiteRunner(executor);

    const result = await runner.run(project, suite, controller.signal);

    expect(result.status).toBe('cancelled');
    expect(result.reason).toMatchObject({ code: 'userCancelled' });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'cancelled', attempts: 0, reason: expect.objectContaining({ code: 'userCancelled' }) }),
    ]));
  });

  it('ignores a Case result that arrives after cancellation and leaves later Cases unstarted', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 1 });
    const started = createDeferred<void>();
    const finish = createDeferred<void>();
    const controller = new AbortController();
    const calls: string[] = [];
    const runner = new SuiteRunner({
      execute: async ({ testCase }) => {
        calls.push(testCase.id);
        started.resolve();
        await finish.promise;
        return { status: 'passed', summary: 'late success', runId: `run-${testCase.id}` };
      },
    });
    const running = runner.run(project, suite, controller.signal);

    await started.promise;
    controller.abort();
    finish.resolve();
    const result = await running;

    expect(result.status).toBe('cancelled');
    expect(result.reason).toMatchObject({ code: 'userCancelled' });
    expect(calls).toHaveLength(1);
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ testCaseId: project.testCases[0]!.id, status: 'cancelled', runId: `run-${project.testCases[0]!.id}`, reason: expect.objectContaining({ code: 'userCancelled' }) }),
      expect.objectContaining({ testCaseId: project.testCases[1]!.id, status: 'cancelled', attempts: 0, reason: expect.objectContaining({ code: 'userCancelled' }) }),
    ]));
  });

  it('cancels unstarted pooled Cases with stable reasons and releases in-flight leases once', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 3 });
    const contexts = Array.from({ length: 2 }, () => ({ close: vi.fn().mockResolvedValue(undefined) }));
    const availableContexts = [...contexts];
    const browserPool = new BrowserPool({
      capacity: 2,
      createBrowser: async () => ({ newContext: vi.fn(async () => availableContexts.shift()!) }),
    });
    const controller = new AbortController();
    const firstTwoStarted = createDeferred<void>();
    const finish = createDeferred<void>();
    let starts = 0;
    const runner = new SuiteRunner({
      execute: async () => {
        starts += 1;
        if (starts === 2) firstTwoStarted.resolve();
        await finish.promise;
        return { status: 'passed', summary: 'late pass' };
      },
    }, { maxConcurrency: 3, browserPool });

    const running = runner.run(project, suite, controller.signal);
    await firstTwoStarted.promise;
    controller.abort();
    finish.resolve();
    const result = await running;

    expect(starts).toBe(2);
    expect(result).toMatchObject({ status: 'cancelled', reason: { code: 'userCancelled' } });
    expect(result.results).toMatchObject([
      { testCaseId: project.testCases[0]!.id, status: 'cancelled', reason: { code: 'userCancelled' } },
      { testCaseId: project.testCases[1]!.id, status: 'cancelled', reason: { code: 'userCancelled' } },
      { testCaseId: project.testCases[2]!.id, status: 'cancelled', attempts: 0, reason: { code: 'userCancelled' } },
    ]);
    contexts.forEach((context) => expect(context.close).toHaveBeenCalledOnce());
    expect(browserPool.activeLeaseCount).toBe(0);
    await browserPool.close();
  });

  it('adds action-failed evidence to an external failed Case result without a reason', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 1 });
    const runner = new SuiteRunner({
      execute: async () => ({ status: 'failed', summary: 'external executor failed' }),
    });

    const result = await runner.run(project, suite);

    expect(result.results[0]).toMatchObject({
      status: 'failed',
      reason: { code: 'actionFailed' },
    });
  });

  it('preserves an external cancelled Case result as cancelled evidence without a parent signal', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 1 });
    const runner = new SuiteRunner({
      execute: async () => ({ status: 'cancelled', summary: 'external executor cancelled' }),
    });

    const result = await runner.run(project, suite);

    expect(result.results[0]).toMatchObject({
      status: 'cancelled',
      reason: { code: 'userCancelled' },
    });
    expect(result).toMatchObject({
      status: 'cancelled',
      reason: { code: 'userCancelled' },
    });
  });

  it('retains an external cancellation when a dependent Case is skipped', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 1 });
    const [checkout, invoice] = project.testCases;
    project.testCases = [checkout!, invoice!];
    suite.caseReferences = [
      { id: checkout!.id, version: checkout!.version!, dependsOn: [] },
      { id: invoice!.id, version: invoice!.version!, dependsOn: [{ id: checkout!.id, version: checkout!.version! }] },
    ];
    const calls: string[] = [];
    const runner = new SuiteRunner({
      execute: async ({ testCase }) => {
        calls.push(testCase.id);
        return { status: 'cancelled', summary: 'external executor cancelled' };
      },
    });

    const result = await runner.run(project, suite);

    expect(calls).toEqual([checkout!.id]);
    expect(result.results).toMatchObject([
      { testCaseId: checkout!.id, status: 'cancelled', reason: { code: 'userCancelled' } },
      { testCaseId: invoice!.id, status: 'skipped', reason: { code: 'dependencyFailed' } },
    ]);
    expect(result).toMatchObject({ status: 'cancelled', reason: { code: 'userCancelled' } });
  });

  it.each([
    ['blocked', 'unsupportedAction'],
    ['skipped', 'dependencyFailed'],
    ['error', 'executorError'],
  ] as const)('adds %s evidence to an external %s Case result without a reason', async (status, reasonCode) => {
    const { project, suite } = createSuiteProject({ concurrency: 1 });
    const runner = new SuiteRunner({
      execute: async () => ({ status, summary: `external ${status}` }),
    });

    const result = await runner.run(project, suite);

    expect(result.results[0]).toMatchObject({ status, reason: { code: reasonCode } });
  });
});

function createSuiteProject(options: Partial<SuiteAsset['execution']> = {}): { project: ReturnType<typeof createEmptyProject>; suite: SuiteAsset } {
  const project = createEmptyProject(1);
  const environment = project.environments[0]!;
  const group = project.groups[0]!;
  const checkout = { ...createEmptyTestCase(1, group.id, environment.id), id: 'case-checkout', version: 1 };
  const invoice = { ...createEmptyTestCase(2, group.id, environment.id), id: 'case-invoice', version: 1 };
  const summary = { ...createEmptyTestCase(3, group.id, environment.id), id: 'case-summary', version: 1 };
  project.testCases = [checkout, invoice, summary];
  const suite: SuiteAsset = {
    schemaVersion: 1,
    id: 'suite-release',
    version: 1,
    name: '发布回归',
    description: '',
    tags: ['release'],
    environmentId: environment.id,
    caseReferences: project.testCases.map((testCase) => ({ id: testCase.id, version: testCase.version!, dependsOn: [] })),
    execution: { concurrency: options.concurrency ?? 1, failurePolicy: options.failurePolicy ?? 'continue', retryLimit: options.retryLimit ?? 0 },
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };
  return { project, suite };
}

function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((nextResolve) => {
      resolve = nextResolve;
    }),
    resolve,
  };
}
