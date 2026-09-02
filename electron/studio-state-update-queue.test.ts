import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createInitialStudioState,
  type ProjectDraft,
  type RunTestCaseResponse,
  type SuiteRunRecord,
  type StudioState,
} from '../shared/studio.js';
import { appendRunToStudioState } from './runtime/run-history.js';
import { StudioStore } from './studioStore.js';
import { mergeRuntimeStudioState, StudioStateUpdateQueue, type StudioStatePersistence } from './studio-state-update-queue.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('StudioStateUpdateQueue', () => {
  it('preserves a newly saved model secret reference when a stale renderer save resumes', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StudioStore(rootDirectory);
    const initialState = createInitialStudioState();
    await store.save(initialState);
    const staleRendererState = await store.load();
    const updates = new StudioStateUpdateQueue(store);
    const pause = deferred<void>();

    const staleRendererSave = (async () => {
      await pause.promise;
      await updates.saveRendererState(staleRendererState);
    })();

    const savedSecret = {
      id: 'midscene' as const,
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    await updates.saveModelSecretRef('midscene', savedSecret);
    pause.resolve();
    await staleRendererSave;

    expect((await store.loadExisting()).midsceneConfig.modelSecret).toEqual(savedSecret);
  });

  it('keeps a main-persisted Suite parent when a stale renderer snapshot is saved', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StudioStore(rootDirectory);
    const staleRendererState = createInitialStudioState();
    const parentRecord: SuiteRunRecord = {
      id: 'suite-main-persisted-run',
      provenance: {
        schemaVersion: 1,
        projectId: 'project-web',
        projectRevision: 'a'.repeat(64),
        source: 'projectDirectory',
        reproducibility: 'versioned',
        suite: { reference: { id: 'suite-release', version: 1 }, parentRunId: 'suite-main-persisted-run' },
        fixtures: [],
        reusableFlows: [],
        baselines: [],
        environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
        browserProfile: { engine: 'chromium', headless: true },
        executor: { appVersion: 'test', runnerVersion: 'test' },
        model: { hasKey: false },
        createdAt: '2026-08-23T00:00:00.000Z',
      },
      startedAt: '2026-08-23T00:00:00.000Z',
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'passed',
      memberRunIds: [],
      members: [],
      summary: { passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
    };
    await store.save({ ...staleRendererState, suiteRunRecords: [parentRecord] });
    const updates = new StudioStateUpdateQueue(store);

    await updates.saveRendererState(staleRendererState);

    expect((await store.loadExisting()).suiteRunRecords).toEqual([
      expect.objectContaining({ id: parentRecord.id, status: 'passed' }),
    ]);
  });

  it.each(['passed', 'cancelled', 'error'] as const)(
    'prefers a terminal %s Suite parent over a stale running record with the same ID',
    (status) => {
      const current = createInitialStudioState();
      const incoming = createInitialStudioState();
      current.suiteRunRecords = [suiteRunRecord({ status: 'running' })];
      incoming.suiteRunRecords = [suiteRunRecord({
        status,
        finishedAt: '2026-08-23T00:00:02.000Z',
        memberRunIds: ['suite-member-1'],
        includeMember: true,
      })];

      const merged = mergeRuntimeStudioState(current, incoming);

      expect(merged.suiteRunRecords).toEqual([
        expect.objectContaining({
          id: 'suite-merge-run',
          status,
          finishedAt: '2026-08-23T00:00:02.000Z',
          memberRunIds: ['suite-member-1'],
          members: [expect.objectContaining({ runId: 'suite-member-1' })],
          summary: expect.objectContaining({ [status]: 1 }),
        }),
      ]);
    },
  );

  it('prefers the newest terminal Suite record, then retains richer linkage at equal completion time', () => {
    const current = createInitialStudioState();
    const incoming = createInitialStudioState();
    current.suiteRunRecords = [suiteRunRecord({
      status: 'passed',
      finishedAt: '2026-08-23T00:00:02.000Z',
      memberRunIds: ['persisted-member'],
      includeMember: true,
    })];
    incoming.suiteRunRecords = [suiteRunRecord({
      status: 'passed',
      finishedAt: '2026-08-23T00:00:03.000Z',
      memberRunIds: ['newer-member'],
      includeMember: true,
    })];

    expect(mergeRuntimeStudioState(current, incoming).suiteRunRecords[0]).toEqual(expect.objectContaining({
      finishedAt: '2026-08-23T00:00:03.000Z',
      memberRunIds: ['newer-member'],
    }));

    incoming.suiteRunRecords = [suiteRunRecord({
      status: 'passed',
      finishedAt: '2026-08-23T00:00:02.000Z',
    })];

    expect(mergeRuntimeStudioState(current, incoming).suiteRunRecords[0]).toEqual(expect.objectContaining({
      finishedAt: '2026-08-23T00:00:02.000Z',
      memberRunIds: ['persisted-member'],
      members: [expect.objectContaining({ runId: 'persisted-member' })],
      summary: { passed: 1, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
    }));
  });

  it('persists trusted main Suite progress and terminal state through the serialized update queue', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StudioStore(rootDirectory);
    const initialState = createInitialStudioState();
    await store.save(initialState);
    const updates = new StudioStateUpdateQueue(store);
    const runningParent = suiteRunRecord({ status: 'running' });
    const progressParent = suiteRunRecord({
      status: 'running',
      memberRunIds: ['main-child-progress'],
      includeMember: true,
    });
    const terminalParent = suiteRunRecord({
      status: 'passed',
      finishedAt: '2026-08-23T00:00:02.000Z',
      memberRunIds: ['main-child-progress'],
      includeMember: true,
    });

    await updates.saveRuntimeState({ ...initialState, suiteRunRecords: [runningParent] });
    await updates.saveRuntimeState({ ...initialState, suiteRunRecords: [progressParent] });

    expect((await store.loadExisting()).suiteRunRecords).toEqual([
      expect.objectContaining({
        status: 'running',
        memberRunIds: ['main-child-progress'],
        members: [expect.objectContaining({ runId: 'main-child-progress' })],
        summary: { passed: 1, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
      }),
    ]);

    await updates.saveRuntimeState({ ...initialState, suiteRunRecords: [terminalParent] });

    expect((await store.loadExisting()).suiteRunRecords).toEqual([
      expect.objectContaining({
        status: 'passed',
        finishedAt: '2026-08-23T00:00:02.000Z',
        memberRunIds: ['main-child-progress'],
      }),
    ]);
  });

  it('rejects a renderer terminal forgery against an active main-owned Suite parent', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StudioStore(rootDirectory);
    const initialState = createInitialStudioState();
    const activeParent = suiteRunRecord({
      status: 'running',
      memberRunIds: ['main-child-progress'],
      includeMember: true,
    });
    await store.save({ ...initialState, suiteRunRecords: [activeParent] });
    const updates = new StudioStateUpdateQueue(store);
    const forgedRendererState = {
      ...initialState,
      suiteRunRecords: [suiteRunRecord({
        status: 'passed',
        finishedAt: '2026-08-23T00:00:09.000Z',
        memberRunIds: ['forged-child'],
        includeMember: true,
      })],
    };

    await updates.saveRendererState(forgedRendererState);

    expect((await store.loadExisting()).suiteRunRecords).toEqual([
      expect.objectContaining({
        status: 'running',
        memberRunIds: ['main-child-progress'],
        members: [expect.objectContaining({ runId: 'main-child-progress' })],
      }),
    ]);
  });

  it('keeps model secret references when a runtime history save is based on stale state', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StudioStore(rootDirectory);
    const initialState = createInitialStudioState();
    await store.save(initialState);
    const staleHistoryState = await store.load();
    const updates = new StudioStateUpdateQueue(store);
    const savedSecret = {
      id: 'midscene' as const,
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    await updates.saveModelSecretRef('midscene', savedSecret);

    const result = runResult();
    const environment = {
      id: result.detail.environmentId,
      name: 'Staging',
      kind: 'staging' as const,
      url: 'https://example.test',
      entryPath: '/',
      browser: 'chromium' as const,
      viewport: 'desktop' as const,
      locale: 'zh-CN',
      headless: true,
    };
    await updates.saveRendererState(
      appendRunToStudioState(staleHistoryState, result, environment, staleHistoryState.browserSession),
    );

    const stored = await store.loadExisting();
    expect(stored.midsceneConfig.modelSecret).toEqual(savedSecret);
    expect(stored.runDetails).toEqual([result.detail]);
  });

  it('rejects a renderer state containing a legacy raw model key before StudioStore can migrate it', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const saveSecret = vi.fn();
    const store = new StudioStore(rootDirectory, fs, { save: saveSecret });
    const initialState = createInitialStudioState();
    await store.save(initialState);
    const updates = new StudioStateUpdateQueue(store);
    const submittedKey = 'sk-renderer-injected-legacy-key';
    const maliciousState = {
      ...initialState,
      midsceneConfig: {
        ...initialState.midsceneConfig,
        modelApiKey: submittedKey,
      },
    } as unknown as typeof initialState;

    const rejection = updates.saveRendererState(maliciousState);

    await expect(rejection).rejects.toThrow('渲染进程状态包含不允许的模型密钥字段。');
    await expect(rejection).rejects.not.toThrow(submittedKey);
    expect(saveSecret).not.toHaveBeenCalled();
    await expect(fs.readFile(store.storagePath, 'utf8')).resolves.not.toContain(submittedKey);
  });

  it('rejects legacy apiKey values in every model scope before writing renderer state to disk', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const saveSecret = vi.fn();
    const store = new StudioStore(rootDirectory, fs, { save: saveSecret });
    const initialState = createInitialStudioState();
    await store.save(initialState);
    const updates = new StudioStateUpdateQueue(store);
    const submittedKeys = {
      midscene: 'sk-renderer-midscene-api-key',
      planner: 'sk-renderer-planner-api-key',
      executor: 'sk-renderer-executor-api-key',
      verifier: 'sk-renderer-verifier-api-key',
      reporter: 'sk-renderer-reporter-api-key',
    };
    const maliciousState = {
      ...initialState,
      midsceneConfig: {
        ...initialState.midsceneConfig,
        apiKey: submittedKeys.midscene,
      },
      agentModelConfig: Object.fromEntries(
        (['planner', 'executor', 'verifier', 'reporter'] as const).map((role) => [role, {
          ...initialState.agentModelConfig[role],
          apiKey: submittedKeys[role],
        }]),
      ),
    } as unknown as typeof initialState;

    const rejection = updates.saveRendererState(maliciousState);

    await expect(rejection).rejects.toThrow('渲染进程状态包含不允许的模型密钥字段。');
    expect(saveSecret).not.toHaveBeenCalled();
    const persisted = await fs.readFile(store.storagePath, 'utf8');
    Object.values(submittedKeys).forEach((submittedKey) => {
      expect(persisted).not.toContain(submittedKey);
    });
    const loaded = await store.loadExisting();
    Object.values(submittedKeys).forEach((submittedKey) => {
      expect(JSON.stringify(loaded)).not.toContain(submittedKey);
    });
  });

  it('rejects a renderer state containing a raw model key nested outside model configuration', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const saveSecret = vi.fn();
    const store = new StudioStore(rootDirectory, fs, { save: saveSecret });
    const initialState = createInitialStudioState();
    await store.save(initialState);
    const persistence = {
      load: vi.fn(store.load.bind(store)),
      save: vi.fn(store.save.bind(store)),
    };
    const updates = new StudioStateUpdateQueue(persistence);
    const submittedKey = 'sk-renderer-injected-nested-key';
    const maliciousState = {
      ...initialState,
      runtimeProfile: {
        ...initialState.runtimeProfile,
        connection: {
          credentials: {
            modelApiKey: submittedKey,
          },
        },
      },
    } as unknown as typeof initialState;

    const rejection = updates.saveRendererState(maliciousState);

    await expect(rejection).rejects.toThrow('渲染进程状态包含不允许的模型密钥字段。');
    await expect(rejection).rejects.not.toThrow(submittedKey);
    expect(persistence.load).not.toHaveBeenCalled();
    expect(persistence.save).not.toHaveBeenCalled();
    expect(saveSecret).not.toHaveBeenCalled();
    await expect(fs.readFile(store.storagePath, 'utf8')).resolves.not.toContain(submittedKey);
  });

  it.each(['create', 'update'] as const)(
    'rejects an unknown nested raw model key before a renderer project %s can persist',
    async (operation) => {
      const initialState = createInitialStudioState();
      const project = createEmptyProject(1);
      if (operation === 'update') {
        initialState.projects = [project];
      }
      const persistence: StudioStatePersistence = {
        load: vi.fn().mockResolvedValue(initialState),
        save: vi.fn().mockResolvedValue(initialState),
      };
      const updates = new StudioStateUpdateQueue(persistence);
      const submittedKey = `sk-renderer-project-${operation}-nested-key`;
      const maliciousProject = {
        ...project,
        untrustedRendererMetadata: {
          deeplyNested: {
            modelApiKey: submittedKey,
          },
        },
      } as unknown as ProjectDraft;
      const rendererProjectUpdates = updates as unknown as {
        createRendererProject(project: ProjectDraft): Promise<StudioState>;
        updateRendererProject(project: ProjectDraft): Promise<StudioState>;
      };
      const rejection = Promise.resolve().then(() => operation === 'create'
        ? rendererProjectUpdates.createRendererProject(maliciousProject)
        : rendererProjectUpdates.updateRendererProject(maliciousProject));

      await expect(rejection).rejects.toThrow('渲染进程状态包含不允许的模型密钥字段。');
      await expect(rejection).rejects.not.toThrow(submittedKey);
      expect(persistence.load).not.toHaveBeenCalled();
      expect(persistence.save).not.toHaveBeenCalled();
    },
  );
});

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'test-buddy-state-update-queue-'));
  temporaryDirectories.push(directory);
  return directory;
};

const runResult = (): RunTestCaseResponse => {
  return {
    runId: 'run-history-1',
    title: 'Checkout',
    detail: {
      id: 'run-history-1',
      projectId: 'project-1',
      testCaseId: 'case-1',
      environmentId: 'env-staging',
      title: 'Checkout',
      status: 'passed',
      startedAt: '2026-08-17T00:00:00.000Z',
      endedAt: '2026-08-17T00:00:01.000Z',
      duration: '00:00:01',
      summary: 'Passed',
      logs: [],
      steps: [],
      artifacts: [],
    },
  };
};

const suiteRunRecord = ({
  status,
  finishedAt,
  memberRunIds = [],
  includeMember = false,
}: {
  status: SuiteRunRecord['status'];
  finishedAt?: string;
  memberRunIds?: string[];
  includeMember?: boolean;
}): SuiteRunRecord => {
  const memberStatus = status === 'running' ? 'passed' : status;
  const summary = { passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 };
  if (includeMember) {
    summary[memberStatus] = 1;
  }
  return {
    id: 'suite-merge-run',
    provenance: {
      schemaVersion: 1,
      projectId: 'project-web',
      projectRevision: 'a'.repeat(64),
      source: 'projectDirectory',
      reproducibility: 'versioned',
      suite: { reference: { id: 'suite-release', version: 1 }, parentRunId: 'suite-merge-run' },
      fixtures: [],
      reusableFlows: [],
      baselines: [],
      environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
      browserProfile: { engine: 'chromium', headless: true },
      executor: { appVersion: 'test', runnerVersion: 'test' },
      model: { hasKey: false },
      createdAt: '2026-08-23T00:00:00.000Z',
    },
    startedAt: '2026-08-23T00:00:00.000Z',
    ...(finishedAt ? { finishedAt } : {}),
    status,
    memberRunIds,
    members: includeMember ? [{
      testCaseId: 'case-merge',
      testCaseVersion: 1,
      status: memberStatus,
      summary: `${memberStatus} child`,
      attempts: 1,
      flaky: false,
      runId: memberRunIds[0],
      provenance: {
        schemaVersion: 1,
        projectId: 'project-web',
        projectRevision: 'a'.repeat(64),
        source: 'projectDirectory',
        reproducibility: 'versioned',
        testCase: { id: 'case-merge', version: 1 },
        suite: { reference: { id: 'suite-release', version: 1 }, parentRunId: 'suite-merge-run' },
        fixtures: [],
        reusableFlows: [],
        baselines: [],
        environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
        browserProfile: { engine: 'chromium', headless: true },
        executor: { appVersion: 'test', runnerVersion: 'test' },
        model: { hasKey: false },
        createdAt: '2026-08-23T00:00:00.000Z',
      },
    }] : [],
    summary,
  };
};
