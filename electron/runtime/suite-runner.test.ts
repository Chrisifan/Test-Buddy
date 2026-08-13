import { describe, expect, it } from 'vitest';

import { createEmptyProject, createEmptyTestCase, type SuiteAsset } from '../../shared/studio.js';
import { deriveSuiteCaseResourceLocks, SuiteRunner, type SuiteCaseExecutor } from './suite-runner.js';

describe('SuiteRunner', () => {
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
      expect.objectContaining({ status: 'neutral', attempts: 0 }),
    ]));
  });

  it('does not dispatch Cases after a cancellation request', async () => {
    const { project, suite } = createSuiteProject({ concurrency: 2 });
    const controller = new AbortController();
    controller.abort();
    const executor = { execute: async () => ({ status: 'passed' as const, summary: 'passed' }) };
    const runner = new SuiteRunner(executor);

    const result = await runner.run(project, suite, controller.signal);

    expect(result.status).toBe('neutral');
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'neutral', attempts: 0 }),
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

    expect(result.status).toBe('neutral');
    expect(calls).toHaveLength(1);
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ testCaseId: project.testCases[0]!.id, status: 'neutral', runId: `run-${project.testCases[0]!.id}` }),
      expect.objectContaining({ testCaseId: project.testCases[1]!.id, status: 'neutral', attempts: 0 }),
    ]));
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
