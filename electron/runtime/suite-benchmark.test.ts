import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import * as crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  createEmptyProject,
  createEmptySuiteAsset,
  createEmptyTestCase,
  createInitialStudioState,
  findSuiteAsset,
  findTestCaseVersion,
  isAgentRunnableTestCase,
  type FixtureAsset,
  type RunSuiteResponse,
  type SuiteRunRecord,
  type StudioState,
} from '../../shared/studio.js';
import { isSafeMaintenanceRationale } from '../../shared/maintenance.js';
import { deepFreeze } from '../../shared/deep-freeze.js';
import { ProjectRepository, ProjectRepositoryError } from '../projectRepository.js';
import { ProjectAssetStore } from '../projectAssetStore.js';
import { RunCancelledError, isRunCancelled } from './run-cancellation.js';
import { BrowserPool } from './browser-pool.js';
import { createRuntimeBundle, type RuntimeBundle } from './runtime-bundle.js';
import { StudioStore } from '../studioStore.js';
import { StudioStateUpdateQueue } from '../studio-state-update-queue.js';

const SAFETY_TIMEOUT_MS = 60_000;
const MAX_ARTIFACT_BYTES_PER_CASE = 2 * 1024 * 1024;
const MAX_HEAP_GROWTH_BYTES = 128 * 1024 * 1024;
let registerRuntimeIpcHandlers: ReturnType<typeof loadRuntimeIpcHandlers>['registerRuntimeIpcHandlers'];
let runtimeIpcChannels: ReturnType<typeof loadRuntimeIpcHandlers>['runtimeIpcChannels'];

describe('versioned BrowserPool Suite acceptance', () => {
  // The 100-Case memory gate must start before smaller benchmarks leave their
  // own short-lived allocations for this Vitest worker to collect.
  for (const caseCount of [100, 2, 10, 20]) {
    it(`runs a pooled versioned ${caseCount}-Case Suite with bounded resources`, async () => {
      let benchmark: PooledSuiteBenchmark | undefined;
      try {
        benchmark = await runPooledSuiteBenchmark({ caseCount });
        reportPooledMetrics(benchmark);
        expectPooledCompletedSuite(benchmark, caseCount);
        expect(benchmark.response.detail.suite.effectiveConcurrency).toBe(benchmark.poolCapacity);
        expect(benchmark.metrics.wallTimeMs).toBeLessThan(SAFETY_TIMEOUT_MS);
        expect(benchmark.metrics.heapGrowthBytes).toBeLessThanOrEqual(MAX_HEAP_GROWTH_BYTES);
        expect(benchmark.metrics.artifactBytes).toBeLessThanOrEqual(caseCount * MAX_ARTIFACT_BYTES_PER_CASE);
        expect(benchmark.fixtureStats).toEqual({ activeResources: 0, cleanups: caseCount, setups: caseCount });
        expect(benchmark.metrics.poolLifecycle).toEqual({
          created: caseCount,
          closed: caseCount,
          active: 0,
          peak: benchmark.poolCapacity,
          browserClosed: false,
        });
        expect(benchmark.poolActiveLeaseCount).toBe(0);
        await assertManifestHasNoOrphanArtifacts(benchmark.rootDir);
      } finally {
        await benchmark?.dispose();
      }
      expect(benchmark!.metrics.poolLifecycle.browserClosed).toBe(true);
    }, SAFETY_TIMEOUT_MS);
  }
});

describe('serial Suite correctness baseline', () => {
  it('releases every acquired resource after later setup failure without hiding the setup error', async () => {
    const setupError = new Error('project construction failed');
    const bundleCloseError = new Error('bundle close failed');
    const fixtureCloseError = new Error('fixture close failed');
    const rootRemovalError = new Error('root removal failed');
    const calls: string[] = [];

    await expect(runSerialSuiteBenchmark({ caseCount: 10 }, {
      startFixture: async () => ({
        url: 'http://fixture.test',
        stats: () => ({ activeResources: 0, setups: 0, cleanups: 0 }),
        close: async () => {
          calls.push('fixture.close');
          throw fixtureCloseError;
        },
      }),
      createRootDir: async () => '/tmp/testbuddy-benchmark-cleanup-seam',
      createRuntimeBundle: () => ({
        close: async () => {
          calls.push('bundle.close');
          throw bundleCloseError;
        },
      }) as RuntimeBundle,
      createProject: () => {
        throw setupError;
      },
      removeRoot: async () => {
        calls.push('root.remove');
        throw rootRemovalError;
      },
    })).rejects.toBe(setupError);

    expect(calls).toEqual(['bundle.close', 'fixture.close', 'root.remove']);
    expect(cleanupErrorsFor(setupError)).toEqual([bundleCloseError, fixtureCloseError, rootRemovalError]);
  });

  it('records actual browser context creation, closure, and peak overlap', async () => {
    let currentContext: object | null = null;
    const firstContext = {};
    const secondContext = {};
    const browserRuntime = {
      start: async () => ({ status: 'ready' }),
      close: async () => {
        currentContext = null;
      },
    };
    const bundle = {
      browserRuntime,
    } as RuntimeBundle;
    const internals = bundle.browserRuntime as unknown as { browser: unknown; context: unknown; page: unknown };
    const lifecycle = instrumentBrowserContextLifecycle(bundle);

    currentContext = firstContext;
    internals.context = currentContext;
    await bundle.browserRuntime.start({} as never);
    await bundle.browserRuntime.close();

    currentContext = secondContext;
    internals.context = currentContext;
    await bundle.browserRuntime.start({} as never);
    await bundle.browserRuntime.close();

    expect(lifecycle).toEqual({ created: 2, closed: 2, active: 0, peak: 1 });
  });

  it('persists an exact 10-Case serial Suite with a controlled retry and bounded artifacts', async () => {
    const benchmark = await runSerialSuiteBenchmark({ caseCount: 10, retryCaseNumber: 4 });
    try {
      reportMetrics('complete', benchmark);
      expectCompletedSuite(benchmark, 10, 4);
      expect(benchmark.metrics.wallTimeMs).toBeLessThan(SAFETY_TIMEOUT_MS);
      expect(benchmark.metrics.heapGrowthBytes).toBeLessThanOrEqual(MAX_HEAP_GROWTH_BYTES);
      expect(benchmark.metrics.peakActiveContexts).toBe(1);
      expectContextLifecycleAtSuiteCompletion(benchmark);
      expect(benchmark.metrics.artifactBytes).toBeLessThanOrEqual(10 * MAX_ARTIFACT_BYTES_PER_CASE);
      expect(benchmark.fixtureStats).toEqual({ activeResources: 0, cleanups: 13, setups: 13 });
      const reloaded = await new StudioStore(benchmark.rootDir).load();
      expect(reloaded.suiteRunRecords).toHaveLength(1);
      await assertManifestHasNoOrphanArtifacts(benchmark.rootDir);
    } finally {
      await benchmark.dispose();
    }
  }, SAFETY_TIMEOUT_MS);

  it('persists an exact 20-Case serial Suite with bounded linear artifact growth', async () => {
    const benchmark = await runSerialSuiteBenchmark({ caseCount: 20, retryCaseNumber: 8 });
    try {
      reportMetrics('complete', benchmark);
      expectCompletedSuite(benchmark, 20, 8);
      expect(benchmark.metrics.wallTimeMs).toBeLessThan(SAFETY_TIMEOUT_MS);
      expect(benchmark.metrics.heapGrowthBytes).toBeLessThanOrEqual(MAX_HEAP_GROWTH_BYTES);
      expect(benchmark.metrics.peakActiveContexts).toBe(1);
      expectContextLifecycleAtSuiteCompletion(benchmark);
      expect(benchmark.metrics.artifactBytes).toBeLessThanOrEqual(20 * MAX_ARTIFACT_BYTES_PER_CASE);
      expect(benchmark.fixtureStats).toEqual({ activeResources: 0, setups: 23, cleanups: 23 });
      expectDurableProgress(benchmark, 'passed');
      await assertManifestHasNoOrphanArtifacts(benchmark.rootDir);
    } finally {
      await benchmark.dispose();
    }
  }, SAFETY_TIMEOUT_MS);

  it('cancels a serial 20-Case Suite at Case 8 and durably marks every unstarted member', async () => {
    const benchmark = await runSerialSuiteBenchmark({ caseCount: 20, cancelAtCaseNumber: 8 });
    try {
      reportMetrics('cancelled-at-case-8', benchmark);
      const { response, persistedState, starts } = benchmark;
      const parent = persistedState.suiteRunRecords[0]!;
      const expectedCaseIds = Array.from({ length: 20 }, (_, offset) => `case-benchmark-${String(offset + 1).padStart(2, '0')}`);
      const expectedResults = expectedCaseIds.map((testCaseId, index) => ({
        testCaseId,
        testCaseVersion: 1,
        status: index < 7 ? 'passed' : 'cancelled',
        attempts: index < 7 ? 1 : 0,
        flaky: false,
        reasonCode: index < 7 ? undefined : 'userCancelled',
      }));

      expect(starts).toBe(8);
      expect(response.detail.suite).toMatchObject({
        status: 'cancelled',
        effectiveConcurrency: 1,
        reason: { code: 'userCancelled' },
      });
      expect(response.detail.caseDetails).toHaveLength(8);
      expect(response.detail.suite.results).toHaveLength(20);
      expect(response.detail.suite.results.map((result) => ({
        testCaseId: result.testCaseId,
        testCaseVersion: result.testCaseVersion,
        status: result.status,
        attempts: result.attempts,
        flaky: result.flaky,
        reasonCode: result.reason?.code,
      }))).toEqual(expectedResults);

      expect(persistedState.suiteRunRecords).toHaveLength(1);
      expect(parent).toMatchObject({
        id: benchmark.runId,
        status: 'cancelled',
        reasonCode: 'userCancelled',
        memberRunIds: response.detail.caseDetails.map((detail) => detail.id),
        summary: { passed: 7, failed: 0, blocked: 0, skipped: 0, cancelled: 13, error: 0 },
      });
      expect(parent.members).toHaveLength(20);
      expect(parent.members!.map((member) => ({
        testCaseId: member.testCaseId,
        testCaseVersion: member.testCaseVersion,
        status: member.status,
        attempts: member.attempts,
        flaky: member.flaky,
        reasonCode: member.reason?.code,
      }))).toEqual(expectedResults);
      expect(persistedState.runDetails).toHaveLength(8);
      expectDurableProgress(benchmark, 'cancelled');
      expect(benchmark.metrics.wallTimeMs).toBeLessThan(SAFETY_TIMEOUT_MS);
      expect(benchmark.metrics.heapGrowthBytes).toBeLessThanOrEqual(MAX_HEAP_GROWTH_BYTES);
      expect(benchmark.metrics.peakActiveContexts).toBe(1);
      expectContextLifecycleAtSuiteCompletion(benchmark);
      expect(benchmark.metrics.artifactBytes).toBeLessThanOrEqual(20 * MAX_ARTIFACT_BYTES_PER_CASE);
      expect(benchmark.fixtureStats).toEqual({ activeResources: 0, cleanups: 8, setups: 8 });
      await assertManifestHasNoOrphanArtifacts(benchmark.rootDir);
    } finally {
      await benchmark.dispose();
    }
  }, SAFETY_TIMEOUT_MS);
});

describe('pooled Suite benchmark fixture policy', () => {
  it.each([10, 20, 100])('keeps %i members while bounding requested concurrency', (caseCount) => {
    const project = createPooledBenchmarkProject('http://fixture.test', { caseCount });

    expect(project.suites[0]!.caseReferences).toHaveLength(caseCount);
    expect(project.suites[0]!.execution.concurrency).toBe(Math.min(caseCount, 10));
  });
});

describe('durable Suite progress observer', () => {
  it('retains one running and one terminal parent evidence across repeated durable saves', () => {
    const observer = createDurableSuiteProgressObserver('pooled-suite-run');

    observer.observe({ suiteRunRecords: [
      { id: 'pooled-suite-run', status: 'running' },
      { id: 'another-suite-run', status: 'passed' },
    ] as SuiteRunRecord[] });
    observer.observe({ suiteRunRecords: [{ id: 'pooled-suite-run', status: 'running' }] as SuiteRunRecord[] });
    observer.observe({ suiteRunRecords: [{ id: 'pooled-suite-run', status: 'passed' }] as SuiteRunRecord[] });
    observer.observe({ suiteRunRecords: [{ id: 'pooled-suite-run', status: 'passed' }] as SuiteRunRecord[] });

    expect(observer.snapshots).toEqual([
      { id: 'pooled-suite-run', status: 'running' },
      { id: 'pooled-suite-run', status: 'passed' },
    ]);
  });

  it('only requests hydration for a new parent-status boundary', () => {
    const observer = createDurableSuiteProgressObserver('pooled-suite-run');
    const running = { suiteRunRecords: [{ id: 'pooled-suite-run', status: 'running' }] as SuiteRunRecord[] };
    const passed = { suiteRunRecords: [{ id: 'pooled-suite-run', status: 'passed' }] as SuiteRunRecord[] };

    expect(shouldHydrateDurableSuiteProgress(observer, running)).toBe(true);
    observer.observe(running);
    expect(shouldHydrateDurableSuiteProgress(observer, running)).toBe(false);
    expect(shouldHydrateDurableSuiteProgress(observer, passed)).toBe(true);
    observer.observe(passed);
    expect(shouldHydrateDurableSuiteProgress(observer, passed)).toBe(false);
  });
});

interface BenchmarkOptions {
  caseCount: number;
  retryCaseNumber?: number;
  cancelAtCaseNumber?: number;
}

interface BenchmarkMetrics {
  wallTimeMs: number;
  heapGrowthBytes: number;
  peakActiveContexts: number;
  contextLifecycle: BrowserContextLifecycle;
  artifactBytes: number;
}

interface BrowserContextLifecycle {
  created: number;
  closed: number;
  active: number;
  peak: number;
}

interface SerialSuiteBenchmark {
  rootDir: string;
  runId: string;
  response: RunSuiteResponse;
  persistedState: StudioState;
  starts: number;
  durableSnapshots: DurableSuiteParentSnapshot[];
  fixtureStats: { activeResources: number; setups: number; cleanups: number };
  metrics: BenchmarkMetrics;
  dispose: () => Promise<void>;
}

interface PooledBrowserContextLifecycle extends BrowserContextLifecycle {
  browserClosed: boolean;
}

interface PooledSuiteBenchmark extends Omit<SerialSuiteBenchmark, 'metrics'> {
  projectId: string;
  projectRevision: string;
  poolCapacity: number;
  poolActiveLeaseCount: number;
  metrics: BenchmarkMetrics & { poolLifecycle: PooledBrowserContextLifecycle };
}

type DurableSuiteParentSnapshot = Pick<SuiteRunRecord, 'id' | 'status'>;

const createDurableSuiteProgressObserver = (runId: string): {
  runId: string;
  snapshots: DurableSuiteParentSnapshot[];
  observe: (state: Pick<StudioState, 'suiteRunRecords'>) => void;
} => {
  const snapshots: DurableSuiteParentSnapshot[] = [];

  return {
    runId,
    snapshots,
    observe: (state) => {
      const parent = state.suiteRunRecords.find((record) => record.id === runId);
      if (!parent) return;

      const boundary = parent.status === 'running' ? 'running' : 'terminal';
      if (snapshots.some((snapshot) => (snapshot.status === 'running' ? 'running' : 'terminal') === boundary)) {
        return;
      }
      snapshots.push({ id: parent.id, status: parent.status });
    },
  };
};

const shouldHydrateDurableSuiteProgress = (
  observer: ReturnType<typeof createDurableSuiteProgressObserver>,
  state: Pick<StudioState, 'suiteRunRecords'>,
): boolean => {
  const parent = state.suiteRunRecords.find((record) => record.id === observer.runId);
  if (!parent) {
    return false;
  }
  const boundary = parent.status === 'running' ? 'running' : 'terminal';
  return !observer.snapshots.some((snapshot) =>
    (snapshot.status === 'running' ? 'running' : 'terminal') === boundary,
  );
};

const reportPooledMetrics = (benchmark: PooledSuiteBenchmark): void => {
  if (process.env.TEST_BUDDY_BENCHMARK_REPORT !== '1') {
    return;
  }
  console.info(JSON.stringify({
    benchmark: 'pooled-versioned-suite-correctness',
    cases: benchmark.response.detail.suite.results.length,
    wallTimeMs: Math.round(benchmark.metrics.wallTimeMs),
    effectiveConcurrency: benchmark.response.detail.suite.effectiveConcurrency,
    poolCapacity: benchmark.poolCapacity,
    heapGrowthBytes: benchmark.metrics.heapGrowthBytes,
    poolLifecycle: benchmark.metrics.poolLifecycle,
    artifactBytes: benchmark.metrics.artifactBytes,
    fixtureCleanup: benchmark.fixtureStats.activeResources === 0,
  }));
};

const runPooledSuiteBenchmark = async (
  options: Pick<BenchmarkOptions, 'caseCount'>,
): Promise<PooledSuiteBenchmark> => {
  const poolCapacity = 2;
  const removeRoot = (directory: string) => fs.rm(directory, { recursive: true, force: true });
  let fixture: BenchmarkFixture | undefined;
  let rootDir: string | undefined;
  let bundle: RuntimeBundle | undefined;
  let browserPool: BrowserPool | undefined;
  try {
    reportBenchmarkDebug('pooled fixture:start');
    fixture = await startBenchmarkFixture();
    reportBenchmarkDebug('pooled fixture:ready');
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-pooled-suite-benchmark-'));
    const project = createPooledBenchmarkProject(fixture.url, options);
    const projectDirectory = path.join(rootDir, 'bound-project');
    const assetStore = new ProjectAssetStore(projectDirectory);
    reportBenchmarkDebug('pooled asset:save-initial');
    await assetStore.saveInitial(project);
    const snapshot = await assetStore.loadWithRevision();
    reportBenchmarkDebug('pooled asset:loaded');
    const store = new StudioStore(rootDir);
    await store.save({
      ...createInitialStudioState(),
      projects: [structuredClone(snapshot.project)],
      projectAssetBindings: [{
        projectId: snapshot.project.id,
        projectDirectory,
        revision: snapshot.revision,
        boundAt: new Date().toISOString(),
      }],
    });

    reportBenchmarkDebug('pooled browser-pool:create');
    const instrumentedPool = await createInstrumentedBrowserPool(poolCapacity);
    browserPool = instrumentedPool.pool;
    bundle = createRuntimeBundle({
      rootDir,
      browserPool,
      visualDiffImageAdapter: { read: async () => Buffer.alloc(0), write: async () => undefined },
      emitRunEvent: (event) => {
        if (event.type === 'status' || event.type === 'complete') {
          reportBenchmarkDebug(`pooled run:${event.runId} ${event.type}:${event.status} ${event.summary}`);
        }
      },
    });
    instrumentPooledArtifactRegistration(bundle);
    reportBenchmarkDebug('pooled runtime:ready');
    const stateUpdates = new StudioStateUpdateQueue(store);
    const durableProgress = createDurableSuiteProgressObserver(`pooled-suite-benchmark-${options.caseCount}`);
    const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
    registerRuntimeIpcHandlers({
      handle: (channel, listener) => {
        handlers.set(channel, listener as (event: unknown, request: unknown) => Promise<unknown>);
      },
      loadState: () => store.load(),
      saveState: async (state) => {
        await stateUpdates.saveRuntimeState(state);
        if (shouldHydrateDurableSuiteProgress(durableProgress, state)) {
          durableProgress.observe(await new StudioStore(rootDir!).load());
        }
      },
      createLazyModelConfigResolver: () => ({
        resolveMidsceneConfig: async () => {
          throw new Error('Deterministic benchmark Cases must not resolve model configuration.');
        },
        resolveAgentProviderConfig: async () => ({ fallbackReason: 'not used by deterministic benchmark Cases' }),
      }),
      getRuntimeBundle: () => bundle!,
      projectRepository: new ProjectRepository({ studioStore: store }),
      getFixtureScriptTrustContext: async () => ({ records: [] }),
      openPath: async () => '',
      showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
      getDownloadsPath: () => rootDir!,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      getRuntimeInfo: () => ({ platform: 'benchmark', persistence: 'file' }),
    } as never);

    const runSuite = handlers.get(runtimeIpcChannels.runSuite);
    if (!runSuite) {
      throw new Error('Suite IPC handler was not registered.');
    }
    const runId = `pooled-suite-benchmark-${options.caseCount}`;
    const startedAt = performance.now();
    const startedHeapBytes = process.memoryUsage().heapUsed;
    const poolWatchdog = setTimeout(() => {
      const internals = browserPool as unknown as { active?: Set<unknown>; queued?: unknown[] };
      reportBenchmarkDebug(
        `pooled watchdog leases=${browserPool!.activeLeaseCount} active=${internals.active?.size ?? 'unknown'} queued=${internals.queued?.length ?? 'unknown'}`,
      );
    }, 10_000);
    reportBenchmarkDebug('pooled suite:invoke');
    let response: RunSuiteResponse;
    try {
      response = await runSuite({}, {
        runId,
        projectId: snapshot.project.id,
        suite: { id: snapshot.project.suites[0]!.id, version: snapshot.project.suites[0]!.version },
        expectedProjectRevision: snapshot.revision,
      }) as RunSuiteResponse;
    } finally {
      clearTimeout(poolWatchdog);
    }
    reportBenchmarkDebug(`pooled suite:result ${JSON.stringify(response.detail.suite.results.map((result) => ({
      id: result.testCaseId,
      status: result.status,
      summary: result.summary,
    })))}`);
    reportBenchmarkDebug('pooled suite:returned');
    const persistedState = await new StudioStore(rootDir).load();
    const metrics = {
      wallTimeMs: performance.now() - startedAt,
      heapGrowthBytes: Math.max(0, process.memoryUsage().heapUsed - startedHeapBytes),
      peakActiveContexts: instrumentedPool.lifecycle.peak,
      contextLifecycle: {
        created: 0,
        closed: 0,
        active: 0,
        peak: 0,
      },
      poolLifecycle: instrumentedPool.lifecycle,
      artifactBytes: await managedArtifactBytes(rootDir),
    };
    reportBenchmarkDebug('pooled metrics:collected');

    return {
      rootDir,
      runId,
      projectId: snapshot.project.id,
      projectRevision: snapshot.revision,
      response,
      persistedState,
      starts: 0,
      durableSnapshots: durableProgress.snapshots,
      fixtureStats: fixture.stats(),
      poolCapacity,
      poolActiveLeaseCount: browserPool.activeLeaseCount,
      metrics,
      dispose: async () => {
        reportBenchmarkDebug('pooled dispose:start');
        const cleanupErrors = await cleanupBenchmarkResources({ bundle, fixture, rootDir, removeRoot });
        reportBenchmarkDebug('pooled dispose:finished');
        throwCleanupErrors(cleanupErrors);
      },
    };
  } catch (error) {
    reportBenchmarkDebug(`pooled failed:${error instanceof Error ? error.message : String(error)}`);
    const cleanupErrors = await cleanupBenchmarkResources({ bundle, fixture, rootDir, removeRoot });
    if (!bundle && browserPool) {
      try {
        await browserPool.close();
      } catch (closeError) {
        cleanupErrors.push(closeError);
      }
    }
    throwWithCleanupErrors(error, cleanupErrors);
  }
};

const instrumentPooledArtifactRegistration = (bundle: RuntimeBundle): void => {
  const artifacts = bundle.artifactManager;
  const registerExisting = artifacts.registerExisting.bind(artifacts);
  artifacts.registerExisting = async (registration) => {
    reportBenchmarkDebug(`pooled artifact:register ${registration.ownerRunId ?? 'session'}:start`);
    const artifact = await registerExisting(registration);
    reportBenchmarkDebug(`pooled artifact:register ${registration.ownerRunId ?? 'session'}:done`);
    return artifact;
  };
};

const createInstrumentedBrowserPool = async (capacity: number): Promise<{
  pool: BrowserPool;
  lifecycle: PooledBrowserContextLifecycle;
}> => {
  const lifecycle: PooledBrowserContextLifecycle = {
    created: 0,
    closed: 0,
    active: 0,
    peak: 0,
    browserClosed: false,
  };
  const browser = await chromium.launch({ headless: true });
  reportBenchmarkDebug('pooled browser:launched');
  const pool = new BrowserPool({
    capacity,
    browser: {
      newContext: async (options) => {
        reportBenchmarkDebug('pooled context:create');
        const context = await browser.newContext(options as never);
        let closed = false;
        lifecycle.created += 1;
        lifecycle.active += 1;
        lifecycle.peak = Math.max(lifecycle.peak, lifecycle.active);
        context.once('close', () => {
          if (!closed) {
            closed = true;
            lifecycle.closed += 1;
            lifecycle.active -= 1;
            reportBenchmarkDebug('pooled context:closed');
          }
        });
        instrumentPooledWorkerContext(context);
        return context;
      },
      close: async () => {
        reportBenchmarkDebug('pooled browser:close');
        try {
          await browser.close();
        } finally {
          lifecycle.browserClosed = true;
        }
      },
    },
  });
  instrumentPooledLeaseReleases(pool);
  return { pool, lifecycle };
};

const instrumentPooledLeaseReleases = (pool: BrowserPool): void => {
  const internals = pool as unknown as {
    closeActive: (active: unknown) => Promise<void>;
  };
  const closeActive = internals.closeActive.bind(pool);
  internals.closeActive = async (active) => {
    const caller = new Error().stack?.split('\n').slice(1, 5).map((line) => line.trim()).join(' <- ');
    reportBenchmarkDebug(`pooled lease:release ${caller ?? 'unknown caller'}`);
    return closeActive(active);
  };
};

const instrumentPooledWorkerContext = (context: Awaited<ReturnType<typeof chromium.launch>> extends infer Browser
  ? Browser extends { newContext: () => Promise<infer Context> } ? Context : never
  : never): void => {
  const originalNewPage = context.newPage.bind(context);
  context.newPage = async () => {
    try {
      const page = await originalNewPage();
      const originalGoto = page.goto.bind(page);
      page.goto = async (...arguments_) => {
        try {
          return await originalGoto(...arguments_);
        } catch (error) {
          reportBenchmarkDebug(`pooled page:goto failed ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      };
      const originalScreenshot = page.screenshot.bind(page);
      page.screenshot = async (...arguments_) => {
        try {
          return await originalScreenshot(...arguments_);
        } catch (error) {
          reportBenchmarkDebug(`pooled page:screenshot failed ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      };
      return page;
    } catch (error) {
      reportBenchmarkDebug(`pooled context:new-page failed ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };
};

const reportBenchmarkDebug = (message: string): void => {
  if (process.env.TEST_BUDDY_BENCHMARK_DEBUG === '1') {
    console.info(`[suite-benchmark] ${message}`);
  }
};

const expectPooledCompletedSuite = (benchmark: PooledSuiteBenchmark, caseCount: number): void => {
  const expectedCaseIds = Array.from(
    { length: caseCount },
    (_, offset) => `case-pooled-benchmark-${String(offset + 1).padStart(3, '0')}`,
  );
  const parent = benchmark.persistedState.suiteRunRecords[0]!;
  expect(benchmark.response.detail.suite).toMatchObject({
    status: 'passed',
    effectiveConcurrency: benchmark.poolCapacity,
  });
  expect(benchmark.response.detail.suite.results).toEqual(expectedCaseIds.map((testCaseId) => expect.objectContaining({
    testCaseId,
    testCaseVersion: 1,
    status: 'passed',
    attempts: 1,
    flaky: false,
  })));
  expect(benchmark.response.detail.caseDetails).toHaveLength(caseCount);
  expect(benchmark.persistedState.suiteRunRecords).toHaveLength(1);
  expect(parent).toMatchObject({
    id: benchmark.runId,
    status: 'passed',
    memberRunIds: expect.arrayContaining(benchmark.response.detail.caseDetails.map((detail) => detail.id)),
    summary: { passed: caseCount, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
    provenance: {
      projectId: benchmark.projectId,
      projectRevision: benchmark.projectRevision,
      source: 'projectDirectory',
      reproducibility: 'versioned',
      suite: {
        reference: { id: `suite-pooled-benchmark-${caseCount}`, version: 1 },
        parentRunId: benchmark.runId,
      },
    },
  });
  expect(parent.memberRunIds).toHaveLength(caseCount);
  expect(parent.members).toHaveLength(caseCount);
  expect(parent.members).toEqual(expectedCaseIds.map((testCaseId) => expect.objectContaining({
    testCaseId,
    testCaseVersion: 1,
    status: 'passed',
    attempts: 1,
    flaky: false,
    provenance: expect.objectContaining({
      projectId: benchmark.projectId,
      projectRevision: benchmark.projectRevision,
      source: 'projectDirectory',
      reproducibility: 'versioned',
    }),
  })));
  expect(benchmark.persistedState.runDetails).toHaveLength(caseCount);
  expect(benchmark.persistedState.runDetails).toEqual(expect.arrayContaining(expectedCaseIds.map((testCaseId) =>
    expect.objectContaining({
      testCaseId,
      status: 'passed',
      provenance: expect.objectContaining({
        projectId: benchmark.projectId,
        projectRevision: benchmark.projectRevision,
        source: 'projectDirectory',
        reproducibility: 'versioned',
      }),
    }),
  )));
  expectDurableProgress(benchmark, 'passed');
};

interface BenchmarkFixture {
  url: string;
  stats: () => { activeResources: number; setups: number; cleanups: number };
  close: () => Promise<void>;
}

interface BenchmarkHarnessDependencies {
  startFixture: () => Promise<BenchmarkFixture>;
  createRootDir: () => Promise<string>;
  createRuntimeBundle: typeof createRuntimeBundle;
  createProject: typeof createBenchmarkProject;
  removeRoot: (rootDir: string) => Promise<void>;
}

const reportMetrics = (outcome: 'complete' | 'cancelled-at-case-8', benchmark: SerialSuiteBenchmark): void => {
  if (process.env.TEST_BUDDY_BENCHMARK_REPORT !== '1') {
    return;
  }
  console.info(JSON.stringify({
    benchmark: 'serial-suite-correctness',
    cases: benchmark.response.detail.suite.results.length,
    outcome,
    wallTimeMs: Math.round(benchmark.metrics.wallTimeMs),
    heapGrowthBytes: benchmark.metrics.heapGrowthBytes,
    peakActiveContexts: benchmark.metrics.peakActiveContexts,
    contextLifecycle: benchmark.metrics.contextLifecycle,
    artifactBytes: benchmark.metrics.artifactBytes,
    fixtureCleanup: benchmark.fixtureStats.activeResources === 0,
  }));
};

const runSerialSuiteBenchmark = async (
  options: BenchmarkOptions,
  dependencies: Partial<BenchmarkHarnessDependencies> = {},
): Promise<SerialSuiteBenchmark> => {
  const removeRoot = dependencies.removeRoot ?? ((directory: string) => fs.rm(directory, { recursive: true, force: true }));
  let fixture: BenchmarkFixture | undefined;
  let rootDir: string | undefined;
  let bundle: RuntimeBundle | undefined;
  try {
    fixture = await (dependencies.startFixture ?? startBenchmarkFixture)();
    rootDir = await (dependencies.createRootDir ?? (() => fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-suite-benchmark-'))))();
    bundle = (dependencies.createRuntimeBundle ?? createRuntimeBundle)({
      rootDir,
      visualDiffImageAdapter: { read: async () => Buffer.alloc(0), write: async () => undefined },
    });
    const project = (dependencies.createProject ?? createBenchmarkProject)(fixture.url, options);
    const runId = `suite-benchmark-${options.caseCount}-${options.cancelAtCaseNumber ?? 'complete'}`;
    const store = new StudioStore(rootDir);
    await store.save({ ...createInitialStudioState(), projects: [structuredClone(project)] });
    const stateUpdates = new StudioStateUpdateQueue(store);
    const durableProgress = createDurableSuiteProgressObserver(runId);
    const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
    let starts = 0;
    const contextLifecycle = instrumentBrowserContextLifecycle(bundle);
    const originalStart = bundle.browserRuntime.start.bind(bundle.browserRuntime);
    bundle.browserRuntime.start = async (request) => {
      starts += 1;
      const state = await originalStart(request);
      if (starts === options.cancelAtCaseNumber) {
        expect(bundle!.cancelRun(runId)).toBe(true);
      }
      return state;
    };

    registerRuntimeIpcHandlers({
      handle: (channel, listener) => {
        handlers.set(channel, listener as (event: unknown, request: unknown) => Promise<unknown>);
      },
      loadState: () => store.load(),
      saveState: async (state) => {
        await stateUpdates.saveRuntimeState(state);
        // A new store instance forces every captured progression point through
        // disk serialization and hydration before the observer retains boundary evidence.
        durableProgress.observe(await new StudioStore(rootDir!).load());
      },
      createLazyModelConfigResolver: () => ({
        resolveMidsceneConfig: async () => {
          throw new Error('Deterministic benchmark Cases must not resolve model configuration.');
        },
        resolveAgentProviderConfig: async () => ({ fallbackReason: 'not used by deterministic benchmark Cases' }),
      }),
      getRuntimeBundle: () => bundle!,
      projectRepository: new ProjectRepository({ studioStore: store }),
      getFixtureScriptTrustContext: async () => ({ records: [] }),
      openPath: async () => '',
      showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
      getDownloadsPath: () => rootDir!,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      getRuntimeInfo: () => ({ platform: 'benchmark', persistence: 'file' }),
    } as never);

    const startedAt = performance.now();
    const startedHeapBytes = process.memoryUsage().heapUsed;
    const runSuite = handlers.get(runtimeIpcChannels.runSuite);
    if (!runSuite) {
      throw new Error('Suite IPC handler was not registered.');
    }
    const response = await runSuite({}, {
      runId,
      projectId: project.id,
      suite: { id: project.suites[0]!.id, version: project.suites[0]!.version },
    }) as RunSuiteResponse;
    const persistedState = await new StudioStore(rootDir).load();
    const metrics = {
      wallTimeMs: performance.now() - startedAt,
      heapGrowthBytes: Math.max(0, process.memoryUsage().heapUsed - startedHeapBytes),
      peakActiveContexts: contextLifecycle.peak,
      contextLifecycle,
      artifactBytes: await managedArtifactBytes(rootDir),
    };

    return {
      rootDir,
      runId,
      response,
      persistedState,
      starts,
      durableSnapshots: durableProgress.snapshots,
      fixtureStats: fixture.stats(),
      metrics,
      dispose: async () => {
        const cleanupErrors = await cleanupBenchmarkResources({ bundle, fixture, rootDir, removeRoot, contextLifecycle });
        throwCleanupErrors(cleanupErrors);
      },
    };
  } catch (error) {
    const cleanupErrors = await cleanupBenchmarkResources({ bundle, fixture, rootDir, removeRoot });
    throwWithCleanupErrors(error, cleanupErrors);
  }
};

const cleanupBenchmarkResources = async ({
  bundle,
  fixture,
  rootDir,
  removeRoot,
  contextLifecycle,
}: {
  bundle?: RuntimeBundle;
  fixture?: BenchmarkFixture;
  rootDir?: string;
  removeRoot: (rootDir: string) => Promise<void>;
  contextLifecycle?: BrowserContextLifecycle;
}): Promise<unknown[]> => {
  const cleanupErrors: unknown[] = [];
  if (bundle) {
    try {
      await bundle.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (bundle.browserRuntime) {
      try {
        expect(browserRuntimeInternals(bundle)).toEqual({ browser: null, context: null, page: null });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (contextLifecycle?.active) {
    cleanupErrors.push(new Error(`Benchmark left ${contextLifecycle.active} browser context(s) active after close.`));
  }
  if (fixture) {
    try {
      await fixture.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (rootDir) {
    try {
      await removeRoot(rootDir);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  return cleanupErrors;
};

const throwWithCleanupErrors = (error: unknown, cleanupErrors: readonly unknown[]): never => {
  if (error && typeof error === 'object' && cleanupErrors.length) {
    Object.defineProperty(error, 'cleanupErrors', {
      value: [...cleanupErrors],
      enumerable: false,
      configurable: true,
    });
  }
  throw error;
};

const throwCleanupErrors = (cleanupErrors: readonly unknown[]): void => {
  if (!cleanupErrors.length) return;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  throw new AggregateError(cleanupErrors, 'Serial Suite benchmark cleanup failed.');
};

const cleanupErrorsFor = (error: unknown): unknown[] => {
  if (!error || typeof error !== 'object' || !('cleanupErrors' in error)) return [];
  const cleanupErrors = (error as { cleanupErrors?: unknown }).cleanupErrors;
  return Array.isArray(cleanupErrors) ? cleanupErrors : [];
};

const instrumentBrowserContextLifecycle = (bundle: RuntimeBundle): BrowserContextLifecycle => {
  const activeContexts = new Set<object>();
  const lifecycle: BrowserContextLifecycle = { created: 0, closed: 0, active: 0, peak: 0 };
  const runtime = bundle.browserRuntime;
  const originalStart = runtime.start.bind(runtime);
  const originalClose = runtime.close.bind(runtime);

  runtime.start = async (request) => {
    const state = await originalStart(request);
    const context = browserRuntimeInternals(bundle).context;
    if (context && typeof context === 'object' && !activeContexts.has(context)) {
      activeContexts.add(context);
      lifecycle.created += 1;
      lifecycle.active = activeContexts.size;
      lifecycle.peak = Math.max(lifecycle.peak, lifecycle.active);
    }
    return state;
  };
  runtime.close = async () => {
    const closingContext = browserRuntimeInternals(bundle).context;
    try {
      await originalClose();
    } finally {
      if (closingContext && typeof closingContext === 'object' && activeContexts.delete(closingContext)) {
        lifecycle.closed += 1;
        lifecycle.active = activeContexts.size;
      }
    }
  };
  return lifecycle;
};

const createBenchmarkProject = (url: string, options: BenchmarkOptions) => {
  const project = createEmptyProject(1);
  project.id = `project-suite-benchmark-${options.caseCount}`;
  const environment = {
    ...project.environments[0]!,
    url,
    entryPath: '/',
    browser: 'chromium' as const,
    headless: true,
  };
  const sharedFixture = executableFixture(environment.id, 'fixture-benchmark-shared', '/api/test-data/shared');
  const retryFixture = executableFixture(environment.id, 'fixture-benchmark-retry', '/api/test-data/retry');
  const cases = Array.from({ length: options.caseCount }, (_, offset) => {
    const caseNumber = offset + 1;
    const retryCase = caseNumber === options.retryCaseNumber;
    return {
      ...createEmptyTestCase(caseNumber, project.groups[0]!.id, environment.id),
      id: `case-benchmark-${String(caseNumber).padStart(2, '0')}`,
      version: 1,
      name: `Benchmark Case ${caseNumber}`,
      url,
      steps: [{
        id: `step-benchmark-${caseNumber}`,
        type: 'aiAssert' as const,
        title: 'Fixture reports ready',
        body: 'Assert the deterministic local fixture reports ready.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Assert the deterministic local fixture reports ready.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          assertion: {
            id: `assert-benchmark-${caseNumber}`,
            version: 1 as const,
            kind: 'pageContains' as const,
            expected: retryCase ? 'retry-ready' : 'benchmark-ready',
          },
        },
      }],
      assetReferences: {
        fixtures: [
          { id: sharedFixture.id, version: sharedFixture.version },
          ...(retryCase ? [{ id: retryFixture.id, version: retryFixture.version }] : []),
        ],
        reusableFlows: [],
      },
    };
  });
  const suite = {
    ...createEmptySuiteAsset(project, 1),
    id: `suite-benchmark-${options.caseCount}`,
    version: 1,
    name: `Serial ${options.caseCount}-Case benchmark`,
    environmentId: environment.id,
    caseReferences: cases.map((testCase) => ({ id: testCase.id, version: testCase.version!, dependsOn: [] })),
    // The runtime cap must remain one until the isolated BrowserPool exists.
    execution: { concurrency: options.caseCount, failurePolicy: 'continue' as const, retryLimit: options.retryCaseNumber ? 1 : 0 },
  };
  return {
    ...project,
    environments: [environment],
    fixtures: [sharedFixture, retryFixture],
    testCases: cases,
    suites: [suite],
  };
};

const createPooledBenchmarkProject = (url: string, options: Pick<BenchmarkOptions, 'caseCount'>) => {
  const project = createEmptyProject(1);
  project.id = `project-pooled-suite-benchmark-${options.caseCount}`;
  const environment = {
    ...project.environments[0]!,
    url,
    entryPath: '/',
    browser: 'chromium' as const,
    headless: true,
  };
  const fixture: FixtureAsset = {
    ...executableFixture(environment.id, 'fixture-benchmark-parallel', '/api/test-data/parallel'),
    description: 'Independent deterministic fixture for pooled Suite workers.',
    concurrency: 'parallel',
    resourceLocks: [],
    credentialIds: [],
  };
  const cases = Array.from({ length: options.caseCount }, (_, offset) => {
    const caseNumber = offset + 1;
    return {
      ...createEmptyTestCase(caseNumber, project.groups[0]!.id, environment.id),
      id: `case-pooled-benchmark-${String(caseNumber).padStart(3, '0')}`,
      version: 1,
      name: `Pooled Benchmark Case ${caseNumber}`,
      url,
      steps: [{
        id: `step-pooled-benchmark-${caseNumber}`,
        type: 'aiAssert' as const,
        title: 'Fixture reports ready',
        body: 'Assert the deterministic local fixture reports ready.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Assert the deterministic local fixture reports ready.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          assertion: {
            id: `assert-pooled-benchmark-${caseNumber}`,
            version: 1 as const,
            kind: 'pageContains' as const,
            expected: 'benchmark-ready',
          },
        },
      }],
      assetReferences: {
        fixtures: [{ id: fixture.id, version: fixture.version }],
        reusableFlows: [],
      },
    };
  });
  const suite = {
    ...createEmptySuiteAsset(project, 1),
    id: `suite-pooled-benchmark-${options.caseCount}`,
    version: 1,
    name: `Pooled ${options.caseCount}-Case benchmark`,
    environmentId: environment.id,
    caseReferences: cases.map((testCase) => ({ id: testCase.id, version: testCase.version!, dependsOn: [] })),
    execution: { concurrency: Math.min(options.caseCount, 10), failurePolicy: 'continue' as const, retryLimit: 0 },
  };
  return {
    ...project,
    environments: [environment],
    fixtures: [fixture],
    testCases: cases,
    suites: [suite],
  };
};

const executableFixture = (environmentId: string, id: string, endpoint: string): FixtureAsset => {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    name: id,
    description: 'Deterministic local serial-suite fixture.',
    inputs: [],
    outputs: [],
    credentialIds: [],
    environmentIds: [environmentId],
    setup: {
      mode: 'http',
      summary: 'Set up benchmark data.',
      http: { method: 'POST', path: endpoint, expectedStatuses: [201] },
    },
    cleanup: {
      mode: 'http',
      summary: 'Clean up benchmark data.',
      http: { method: 'DELETE', path: endpoint, expectedStatuses: [204] },
    },
    concurrency: 'exclusive',
    resourceLocks: ['benchmark:shared-resource'],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
};

const expectCompletedSuite = (benchmark: SerialSuiteBenchmark, caseCount: number, retryCaseNumber: number): void => {
  const { response, persistedState } = benchmark;
  const parent = persistedState.suiteRunRecords[0]!;
  const expectedCaseIds = Array.from({ length: caseCount }, (_, offset) => `case-benchmark-${String(offset + 1).padStart(2, '0')}`);

  expect(benchmark.starts).toBe(caseCount + 1);
  expect(response.detail.suite).toMatchObject({ status: 'passed', effectiveConcurrency: 1 });
  expect(response.detail.suite.results).toHaveLength(caseCount);
  expect(response.detail.suite.results.map((result) => result.testCaseId)).toEqual(expectedCaseIds);
  expect(response.detail.suite.results).toEqual(expect.arrayContaining([
    expect.objectContaining({
      testCaseId: `case-benchmark-${String(retryCaseNumber).padStart(2, '0')}`,
      status: 'passed',
      attempts: 2,
      flaky: true,
    }),
  ]));
  expect(response.detail.caseDetails).toHaveLength(caseCount + 1);
  expect(persistedState.suiteRunRecords).toHaveLength(1);
  expect(parent).toMatchObject({
    id: benchmark.runId,
    status: 'passed',
    memberRunIds: response.detail.caseDetails.map((detail) => detail.id),
    summary: { passed: caseCount, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
  });
  expect(parent.members).toHaveLength(caseCount);
  expect(parent.members!.map((member) => member.testCaseId)).toEqual(expectedCaseIds);
  expect(parent.members).toEqual(expect.arrayContaining([
    expect.objectContaining({
      testCaseId: `case-benchmark-${String(retryCaseNumber).padStart(2, '0')}`,
      attempts: 2,
      flaky: true,
      status: 'passed',
    }),
  ]));
  expect(persistedState.runDetails).toHaveLength(caseCount + 1);
  expect(persistedState.runDetails.map((detail) => detail.id).sort()).toEqual(
    response.detail.caseDetails.map((detail) => detail.id).sort(),
  );
};

const expectDurableProgress = (
  benchmark: SerialSuiteBenchmark,
  terminalStatus: 'passed' | 'cancelled',
): void => {
  expect(benchmark.durableSnapshots).toEqual(expect.arrayContaining([
    { id: benchmark.runId, status: 'running' },
    { id: benchmark.runId, status: terminalStatus },
  ]));
};

const expectContextLifecycleAtSuiteCompletion = (benchmark: SerialSuiteBenchmark): void => {
  expect(benchmark.metrics.contextLifecycle).toEqual({
    created: benchmark.starts,
    closed: benchmark.starts - 1,
    active: 1,
    peak: 1,
  });
};

const managedArtifactBytes = async (rootDir: string): Promise<number> => {
  const manifest = await readArtifactManifest(rootDir);
  return manifest.entries.reduce((total, entry) => total + entry.byteCount, 0);
};

const assertManifestHasNoOrphanArtifacts = async (rootDir: string): Promise<void> => {
  const artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
  const manifest = await readArtifactManifest(rootDir);
  const manifestPaths = manifest.entries
    .map((entry) => path.resolve(artifactsDir, entry.path))
    .sort();
  const artifactFiles = (await listFiles(artifactsDir))
    .filter((filePath) => path.basename(filePath) !== 'manifest.json')
    .sort();

  expect(artifactFiles).toEqual(manifestPaths);
  expect(await fs.readdir(path.join(artifactsDir, '.deletions')).catch(() => [])).toEqual([]);
};

const readArtifactManifest = async (rootDir: string): Promise<{ entries: Array<{ path: string; byteCount: number }> }> => {
  const manifestPath = path.join(rootDir, 'studio-data', 'artifacts', 'manifest.json');
  return JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { entries: Array<{ path: string; byteCount: number }> };
};

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile()) {
      return [entryPath];
    }
    return entry.isDirectory() ? listFiles(entryPath) : [];
  }));
  return nested.flat();
};

const browserRuntimeInternals = (bundle: RuntimeBundle): { browser: unknown; context: unknown; page: unknown } => {
  const runtime = bundle.browserRuntime as unknown as { browser: unknown; context: unknown; page: unknown };
  return { browser: runtime.browser, context: runtime.context, page: runtime.page };
};

const startBenchmarkFixture = async (): Promise<{
  url: string;
  stats: () => { activeResources: number; setups: number; cleanups: number };
  close: () => Promise<void>;
}> => {
  let activeResources = 0;
  let setups = 0;
  let cleanups = 0;
  let retrySetups = 0;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const isFixtureEndpoint =
      url.pathname === '/api/test-data/shared' ||
      url.pathname === '/api/test-data/retry' ||
      url.pathname === '/api/test-data/parallel';
    if (isFixtureEndpoint && request.method === 'POST') {
      activeResources += 1;
      setups += 1;
      if (url.pathname === '/api/test-data/retry') {
        retrySetups += 1;
      }
      response.writeHead(201).end();
      return;
    }
    if (isFixtureEndpoint && request.method === 'DELETE') {
      activeResources -= 1;
      cleanups += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>Suite benchmark</title></head><body><p>benchmark-ready</p><p>${retrySetups === 1 ? 'retry-pending' : 'retry-ready'}</p></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Benchmark fixture did not bind to TCP.');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    stats: () => ({ activeResources, setups, cleanups }),
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

/**
 * The IPC channel contract is CommonJS for Electron preload compatibility.
 * Vitest cannot transform that `.cts` import directly, so this mirrors the
 * production handler's existing integration-test loader and executes its
 * source with the real run-history/provenance implementation.
 */
const loadRuntimeIpcHandlers = (): {
  registerRuntimeIpcHandlers: (dependencies: unknown) => void;
  runtimeIpcChannels: { runSuite: string };
} => {
  const ipcDirectory = path.join(process.cwd(), 'electron', 'ipc');
  const compile = (sourcePath: string) => ts.transpileModule(fsSync.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const channelModule = { exports: {} as { runtimeIpcChannels?: unknown } };
  new Function('module', 'exports', compile(path.join(ipcDirectory, 'runtime-ipc-channels.cts')))(channelModule, channelModule.exports);

  const runHistoryModule = { exports: {} as { appendRunToStudioState?: unknown; appendSuiteRunToStudioState?: unknown } };
  const runHistoryRequire = (moduleId: string) => {
    if (moduleId === '../../shared/deep-freeze.js') return { deepFreeze };
    throw new Error(`Unexpected run history dependency: ${moduleId}`);
  };
  new Function('require', 'module', 'exports', compile(path.join(process.cwd(), 'electron', 'runtime', 'run-history.ts')))(
    runHistoryRequire,
    runHistoryModule,
    runHistoryModule.exports,
  );

  const runProvenanceModule = { exports: {} as Record<string, unknown> };
  const runProvenanceRequire = (moduleId: string) => {
    if (moduleId === 'node:crypto') return crypto;
    if (moduleId === '../../shared/studio.js') return { findTestCaseVersion };
    if (moduleId === '../projectRepository.js') return { ProjectRepositoryError };
    throw new Error(`Unexpected run provenance dependency: ${moduleId}`);
  };
  new Function('require', 'module', 'exports', compile(path.join(process.cwd(), 'electron', 'runtime', 'run-provenance.ts')))(
    runProvenanceRequire,
    runProvenanceModule,
    runProvenanceModule.exports,
  );

  const handlerModule = { exports: {} as Record<string, unknown> };
  const require = (moduleId: string) => {
    if (moduleId === 'node:crypto') return crypto;
    if (moduleId === 'node:path') return path;
    if (moduleId === './runtime-ipc-channels.cjs') return channelModule.exports;
    if (moduleId === '../runtime/run-history.js') return runHistoryModule.exports;
    if (moduleId === '../runtime/run-provenance.js') return runProvenanceModule.exports;
    if (moduleId === '../runtime/run-cancellation.js') return { RunCancelledError, isRunCancelled };
    if (moduleId === '../../shared/studio.js') return { findSuiteAsset, findTestCaseVersion, isAgentRunnableTestCase };
    if (moduleId === '../../shared/maintenance.js') return { isSafeMaintenanceRationale };
    if (moduleId === '../../shared/deep-freeze.js') return { deepFreeze };
    if (moduleId === '../projectRepository.js') return { ProjectRepositoryError };
    throw new Error(`Unexpected runtime IPC dependency: ${moduleId}`);
  };
  new Function('require', 'module', 'exports', compile(path.join(ipcDirectory, 'runtime-ipc-handlers.ts')))(
    require,
    handlerModule,
    handlerModule.exports,
  );

  return handlerModule.exports as unknown as ReturnType<typeof loadRuntimeIpcHandlers>;
};

({ registerRuntimeIpcHandlers, runtimeIpcChannels } = loadRuntimeIpcHandlers());
