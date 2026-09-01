import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: undefined }));

import { createInitialStudioState, type ModelSecretRef, type StudioState } from '../shared/studio.js';
import { ModelConfigResolver } from './runtime/model-config-resolver.js';
import { ModelSecretStore, type ModelSecretProtection } from './runtime/model-secret-store.js';
import { StudioStateUpdateQueue, type StudioStatePersistence } from './studio-state-update-queue.js';
import { StudioStore } from './studioStore.js';

const temporaryDirectories: string[] = [];
const protection: ModelSecretProtection = {
  encrypt: (value) => `safe:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.slice('safe:'.length), 'base64').toString('utf8'),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ModelSecretTransactionCoordinator', () => {
  it('syncs staged secret and journal files plus their parent directory before publishing', async () => {
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    const syncedPaths: string[] = [];
    const originalOpen = fs.open.bind(fs);
    const open = vi.spyOn(fs, 'open');
    open.mockImplementation(async (target, flags, mode) => {
      const handle = await originalOpen(target, flags, mode);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        syncedPaths.push(String(target));
        await sync();
      });
      return handle;
    });

    try {
      const next = await secrets.save({ scope: 'midscene', value: 'sk-durable-secret' });
      await journal.stage({ scope: 'midscene', previous: undefined, next });
    } finally {
      open.mockRestore();
    }

    const credentialsDirectory = path.join(rootDirectory, 'studio-data', 'credentials');
    expect(syncedPaths).toEqual(expect.arrayContaining([
      expect.stringMatching(/\.model-secret-staging-.*\.json$/),
      expect.stringMatching(/\.model-secret-transaction-.*\.json$/),
    ]));
    expect(syncedPaths.filter((candidate) => candidate === credentialsDirectory)).toHaveLength(2);
  });

  it('syncs the credentials directory after clearing the transaction journal', async () => {
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    await journal.stage({
      scope: 'midscene',
      previous: undefined,
      next: { id: 'midscene', hasKey: true, updatedAt: '2026-08-20T00:00:00.000Z' },
    });
    const syncedPaths: string[] = [];
    const originalOpen = fs.open.bind(fs);
    const open = vi.spyOn(fs, 'open');
    open.mockImplementation(async (target, flags, mode) => {
      const handle = await originalOpen(target, flags, mode);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        syncedPaths.push(String(target));
        await sync();
      });
      return handle;
    });

    try {
      await journal.clear();
    } finally {
      open.mockRestore();
    }

    expect(syncedPaths).toEqual([
      path.join(rootDirectory, 'studio-data', 'credentials'),
    ]);
  });

  it('restores an absent secret when saving its StudioState reference fails', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const persistence = new FailingStudioStatePersistence(createInitialStudioState());
    const updates = new StudioStateUpdateQueue(persistence);
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      (scope: 'midscene', ref: ModelSecretRef) => updates.saveModelSecretRef(scope, ref).then(() => undefined),
      new ModelSecretTransactionJournal(rootDirectory),
    );

    await expect(coordinator.save({ scope: 'midscene', value: 'sk-transaction-new' })).rejects.toThrow(
      '模型密钥状态同步失败，已恢复原有设置。',
    );

    expect(persistence.state.midsceneConfig.modelSecret.hasKey).toBe(false);
    await expect(secrets.resolve({ scope: 'midscene' })).rejects.toThrow('模型密钥引用不存在，请重新保存后再试。');
  });

  it('keeps the journal and new secret when the durable state commit result is uncertain', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const studioStore = new StudioStore(rootDirectory);
    await studioStore.save(createInitialStudioState());
    const updates = new StudioStateUpdateQueue(studioStore);
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      (scope, reference) => updates.saveModelSecretRef(scope, reference).then(() => undefined),
      journal,
    );
    const originalOpen = fs.open.bind(fs);
    const stateDirectory = path.dirname(studioStore.storagePath);
    const open = vi.spyOn(fs, 'open');
    open.mockImplementation(async (target, flags, mode) => {
      if (String(target) === stateDirectory) {
        throw new Error('injected state directory sync failure');
      }
      return originalOpen(target, flags, mode);
    });

    let next: ModelSecretRef | undefined;
    try {
      await expect(coordinator.save({ scope: 'midscene', value: 'sk-uncertain-state-commit' })).rejects.toThrow(
        '模型密钥状态提交结果不确定，需在下次启动时恢复。',
      );
      next = (await journal.load())?.next;
    } finally {
      open.mockRestore();
    }

    expect(next).toMatchObject({ id: 'midscene', hasKey: true });
    await expect(secrets.resolve({ scope: 'midscene' })).resolves.toBe('sk-uncertain-state-commit');
    expect((await studioStore.loadExisting()).midsceneConfig.modelSecret).toEqual(next);
  });

  it('retains the journal and restores the previous reference when saving a secret fails after rename durability', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const studioStore = new StudioStore(rootDirectory);
    const initialState = createInitialStudioState();
    await studioStore.save(initialState);
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    const updates = new StudioStateUpdateQueue(studioStore);
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      (scope, reference) => updates.saveModelSecretRef(scope, reference).then(() => undefined),
      journal,
    );
    const credentialsDirectory = path.join(rootDirectory, 'studio-data', 'credentials');
    const originalOpen = fs.open.bind(fs);
    let credentialsDirectorySyncs = 0;
    const open = vi.spyOn(fs, 'open');
    open.mockImplementation(async (target, flags, mode) => {
      if (String(target) === credentialsDirectory && ++credentialsDirectorySyncs === 2) {
        throw new Error('injected secret directory sync failure');
      }
      return originalOpen(target, flags, mode);
    });

    try {
      await expect(coordinator.save({ scope: 'midscene', value: 'sk-save-after-rename' })).rejects.toThrow(
        '模型密钥持久化提交结果不确定，需在下次启动时恢复。',
      );
    } finally {
      open.mockRestore();
    }

    expect(await journal.load()).toMatchObject({ scope: 'midscene', next: { hasKey: true } });
    await expect(secrets.resolve({ scope: 'midscene' })).resolves.toBe('sk-save-after-rename');
    expect((await studioStore.load()).midsceneConfig.modelSecret).toEqual(initialState.midsceneConfig.modelSecret);

    const restarted = new ModelSecretTransactionCoordinator(
      secrets,
      (scope, reference) => updates.saveModelSecretRef(scope, reference).then(() => undefined),
      journal,
    );
    await restarted.reconcile(async (scope) => modelSecretReference(await studioStore.load(), scope));

    expect((await studioStore.load()).midsceneConfig.modelSecret).toEqual(initialState.midsceneConfig.modelSecret);
    await expect(secrets.resolve({ scope: 'midscene' })).rejects.toThrow('模型密钥引用不存在，请重新保存后再试。');
    await expect(journal.load()).resolves.toBeUndefined();
  });

  it('retains the journal and restores the previous snapshot when clearing a secret fails after rename durability', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const existingReference = await secrets.save({ scope: 'midscene', value: 'sk-clear-after-rename' });
    const state = createInitialStudioState();
    state.midsceneConfig.modelSecret = existingReference;
    const studioStore = new StudioStore(rootDirectory);
    await studioStore.save(state);
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    const updates = new StudioStateUpdateQueue(studioStore);
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      (scope, reference) => updates.saveModelSecretRef(scope, reference).then(() => undefined),
      journal,
    );
    const credentialsDirectory = path.join(rootDirectory, 'studio-data', 'credentials');
    const originalOpen = fs.open.bind(fs);
    let credentialsDirectorySyncs = 0;
    const open = vi.spyOn(fs, 'open');
    open.mockImplementation(async (target, flags, mode) => {
      if (String(target) === credentialsDirectory && ++credentialsDirectorySyncs === 2) {
        throw new Error('injected secret directory sync failure');
      }
      return originalOpen(target, flags, mode);
    });

    try {
      await expect(coordinator.clear({ scope: 'midscene' })).rejects.toThrow(
        '模型密钥持久化提交结果不确定，需在下次启动时恢复。',
      );
    } finally {
      open.mockRestore();
    }

    expect(await journal.load()).toMatchObject({ scope: 'midscene', next: { hasKey: false } });
    await expect(secrets.resolve({ scope: 'midscene' })).rejects.toThrow('模型密钥引用不存在，请重新保存后再试。');
    expect((await studioStore.load()).midsceneConfig.modelSecret).toEqual(existingReference);

    const restarted = new ModelSecretTransactionCoordinator(
      secrets,
      (scope, reference) => updates.saveModelSecretRef(scope, reference).then(() => undefined),
      journal,
    );
    await restarted.reconcile(async (scope) => modelSecretReference(await studioStore.load(), scope));

    expect((await studioStore.load()).midsceneConfig.modelSecret).toEqual(existingReference);
    await expect(secrets.resolve({ scope: 'midscene' })).resolves.toBe('sk-clear-after-rename');
    await expect(journal.load()).resolves.toBeUndefined();
  });

  it('restores an existing encrypted secret when clearing its StudioState reference fails', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const existingRef = await secrets.save({ scope: 'midscene', value: 'sk-transaction-existing' });
    const state = createInitialStudioState();
    state.midsceneConfig.modelSecret = existingRef;
    const persistence = new FailingStudioStatePersistence(state);
    const updates = new StudioStateUpdateQueue(persistence);
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      (scope: 'midscene', ref: ModelSecretRef) => updates.saveModelSecretRef(scope, ref).then(() => undefined),
      new ModelSecretTransactionJournal(rootDirectory),
    );

    await expect(coordinator.clear({ scope: 'midscene' })).rejects.toThrow(
      '模型密钥状态同步失败，已恢复原有设置。',
    );

    expect(persistence.state.midsceneConfig.modelSecret).toEqual(existingRef);
    await expect(secrets.resolve({ scope: 'midscene' })).resolves.toBe('sk-transaction-existing');
  });

  it('reports a stable failure when reference persistence and compensation both fail', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = {
      snapshot: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue({ id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' }),
      clear: vi.fn(),
      restore: vi.fn().mockRejectedValue(new Error('disk unavailable')),
    };
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      vi.fn().mockRejectedValue(new Error('state write unavailable')),
      new ModelSecretTransactionJournal(rootDirectory),
    );

    await expect(coordinator.save({ scope: 'midscene', value: 'sk-transaction-new' })).rejects.toThrow(
      '模型密钥状态同步失败，且无法自动恢复。',
    );
  });

  it('reconciles an interrupted save after restart when reference persistence and immediate compensation fail', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const studioStore = new StudioStore(rootDirectory);
    await studioStore.save(createInitialStudioState());
    const updates = new StudioStateUpdateQueue(studioStore);
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    vi.spyOn(secrets, 'restore').mockRejectedValueOnce(new Error('disk unavailable'));
    const persistReference = vi.fn().mockRejectedValueOnce(new Error('state write unavailable'));
    const coordinator = new ModelSecretTransactionCoordinator(secrets, persistReference, journal);

    await expect(coordinator.save({ scope: 'midscene', value: 'sk-recover-after-restart' })).rejects.toThrow(
      '模型密钥状态同步失败，且无法自动恢复。',
    );
    const interruptedEntry = await journal.load();
    expect(interruptedEntry).toMatchObject({
      scope: 'midscene',
      next: { id: 'midscene', hasKey: true },
    });
    expect(interruptedEntry?.previous).toBeUndefined();

    const restarted = new ModelSecretTransactionCoordinator(secrets, (scope, ref) =>
      updates.saveModelSecretRef(scope, ref).then(() => undefined), journal);
    await restarted.reconcile(async (scope) => modelSecretReference(await studioStore.load(), scope));

    expect((await studioStore.load()).midsceneConfig.modelSecret.hasKey).toBe(false);
    await expect(secrets.resolve({ scope: 'midscene' })).rejects.toThrow('模型密钥引用不存在，请重新保存后再试。');
    await expect(journal.load()).resolves.toBeUndefined();
  });

  it('keeps a committed secret when startup finds an uncleared transaction journal', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const studioStore = new StudioStore(rootDirectory);
    const state = createInitialStudioState();
    await studioStore.save(state);
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    const previous = await secrets.snapshot('midscene');
    const next = await secrets.save({ scope: 'midscene', value: 'sk-committed-before-crash' });
    await new StudioStateUpdateQueue(studioStore).saveModelSecretRef('midscene', next);
    await journal.stage({ scope: 'midscene', previous, next });

    const restarted = new ModelSecretTransactionCoordinator(
      secrets,
      async () => undefined,
      journal,
    );
    await restarted.reconcile(async (scope) => modelSecretReference(await studioStore.load(), scope));

    await expect(secrets.resolve({ scope: 'midscene' })).resolves.toBe('sk-committed-before-crash');
    expect((await studioStore.load()).midsceneConfig.modelSecret).toEqual(next);
    await expect(journal.load()).resolves.toBeUndefined();
  });

  it('never serializes a submitted model key into the durable transaction journal', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const journal = new ModelSecretTransactionJournal(rootDirectory);
    vi.spyOn(secrets, 'restore').mockRejectedValueOnce(new Error('disk unavailable'));
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      vi.fn().mockRejectedValue(new Error('state write unavailable')),
      journal,
    );
    const submittedKey = 'sk-never-write-this-raw-value';

    await expect(coordinator.save({ scope: 'midscene', value: submittedKey })).rejects.toThrow(
      '模型密钥状态同步失败，且无法自动恢复。',
    );

    await expect(fs.readFile(journal.storagePath, 'utf8')).resolves.not.toContain(submittedKey);
  });

  it('waits for a clear transaction before loading state and resolving model configuration', async () => {
    const { ModelSecretTransactionCoordinator } = await import('./model-secret-transaction.js');
    const { ModelSecretTransactionJournal } = await import('./model-secret-transaction-journal.js');
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const studioStore = new StudioStore(rootDirectory);
    const current = createInitialStudioState();
    current.midsceneConfig.modelSecret = await secrets.save({ scope: 'midscene', value: 'sk-before-clear' });
    await studioStore.save(current);
    const referencePersistenceStarted = deferred<void>();
    const releaseReferencePersistence = deferred<void>();
    const updates = new StudioStateUpdateQueue(studioStore);
    const coordinator = new ModelSecretTransactionCoordinator(
      secrets,
      async (scope, reference) => {
        referencePersistenceStarted.resolve();
        await releaseReferencePersistence.promise;
        await updates.saveModelSecretRef(scope, reference);
      },
      new ModelSecretTransactionJournal(rootDirectory),
    );
    const resolvingConfigs = vi.fn(async (state: StudioState) =>
      new ModelConfigResolver(secrets).resolve({
        midsceneConfig: state.midsceneConfig,
        agentModelConfig: state.agentModelConfig,
      }),
    );
    const resolveSecret = vi.spyOn(secrets, 'resolve');

    const clearing = coordinator.clear({ scope: 'midscene' });
    await referencePersistenceStarted.promise;
    const configuration = coordinator.withConsistentState(
      () => studioStore.load(),
      resolvingConfigs,
    );
    await Promise.resolve();

    expect(resolvingConfigs).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();

    releaseReferencePersistence.resolve();
    await clearing;
    await expect(configuration).resolves.toMatchObject({
      midsceneConfig: { modelApiKey: '' },
    });
    expect(resolveSecret).not.toHaveBeenCalled();
    expect((await studioStore.load()).midsceneConfig.modelSecret.hasKey).toBe(false);
  });
});

class FailingStudioStatePersistence implements StudioStatePersistence {
  constructor(readonly state: StudioState) {}

  async load(): Promise<StudioState> {
    return structuredClone(this.state);
  }

  async save(): Promise<StudioState> {
    throw new Error('state write unavailable');
  }
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'test-buddy-model-secret-transaction-'));
  temporaryDirectories.push(directory);
  return directory;
}

function modelSecretReference(state: StudioState, scope: 'midscene'): ModelSecretRef;
function modelSecretReference(state: StudioState, scope: `agent:${'planner' | 'executor' | 'verifier' | 'reporter'}`): ModelSecretRef;
function modelSecretReference(state: StudioState, scope: 'midscene' | `agent:${'planner' | 'executor' | 'verifier' | 'reporter'}`): ModelSecretRef {
  if (scope === 'midscene') {
    return state.midsceneConfig.modelSecret;
  }
  return state.agentModelConfig[scope.slice('agent:'.length) as 'planner' | 'executor' | 'verifier' | 'reporter'].modelSecret;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
