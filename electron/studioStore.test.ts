import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInitialStudioState, hydrateStudioState } from '../shared/studio.js';
import { ModelSecretStore, type ModelSecretProtection } from './runtime/model-secret-store.js';
import { StudioStore } from './studioStore.js';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

const temporaryDirectories: string[] = [];
const protection: ModelSecretProtection = {
  encrypt: (value) => `safe:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.slice('safe:'.length), 'base64').toString('utf8'),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('StudioStore', () => {
  it('publishes state by renaming a sibling staging file', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const renameCalls: Array<{ source: string; destination: string }> = [];
    const store = new StudioStore(rootDirectory, {
      rename: async (source, destination) => {
        renameCalls.push({ source, destination });
        await fs.rename(source, destination);
      },
    });
    const state = createInitialStudioState();

    await store.save(state);

    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0]?.destination).toBe(store.storagePath);
    expect(path.dirname(renameCalls[0]?.source ?? '')).toBe(path.dirname(store.storagePath));
    await expect(store.loadExisting()).resolves.toEqual(state);
  });

  it('returns key-free supplied state without cloning or mutating it', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StudioStore(rootDirectory);
    const state = createInitialStudioState();
    const beforeSave = structuredClone(state);

    const saved = await store.save(state);

    expect(saved).toBe(state);
    expect(state).toEqual(beforeSave);
  });

  it('syncs the staged state file and state directory before publishing', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StudioStore(rootDirectory);
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
      await store.save(createInitialStudioState());
    } finally {
      open.mockRestore();
    }

    expect(syncedPaths).toEqual(expect.arrayContaining([
      expect.stringMatching(/\.state-staging-.*\.json$/),
      path.dirname(store.storagePath),
    ]));
  });

  it('keeps the previous state file when publishing a replacement fails', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const stableStore = new StudioStore(rootDirectory);
    const originalState = createInitialStudioState();
    await stableStore.save(originalState);
    const failingStore = new StudioStore(rootDirectory, {
      rename: async () => {
        throw new Error('injected publish failure');
      },
    });

    await expect(failingStore.save({ ...originalState, selectedProjectId: 'project-new' })).rejects.toThrow(
      'injected publish failure',
    );

    await expect(stableStore.loadExisting()).resolves.toEqual(originalState);
    await expect(fs.readdir(path.dirname(stableStore.storagePath))).resolves.not.toContain(
      expect.stringContaining('.state-staging-'),
    );
  });

  it('migrates legacy Midscene and role model keys into secret references before returning state', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const state = createInitialStudioState();
    const legacyState = state as typeof state & {
      midsceneConfig: typeof state.midsceneConfig & { modelApiKey: string };
      agentModelConfig: typeof state.agentModelConfig & {
        planner: typeof state.agentModelConfig.planner & { modelApiKey: string };
      };
    };
    legacyState.midsceneConfig.modelApiKey = 'sk-live-midscene';
    legacyState.agentModelConfig.planner.modelApiKey = 'sk-live-planner';
    const saveSecret = vi.fn(async ({ scope }: { scope: string }) => ({
      id: scope,
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    }));
    const store = new StudioStore(rootDirectory, fs, { save: saveSecret });

    await store.ensureReady();
    await fs.writeFile(store.storagePath, `${JSON.stringify(legacyState)}\n`, 'utf8');
    const loaded = await store.load();
    const persisted = await fs.readFile(store.storagePath, 'utf8');

    expect(saveSecret).toHaveBeenCalledWith({ scope: 'midscene', value: 'sk-live-midscene' });
    expect(saveSecret).toHaveBeenCalledWith({ scope: 'agent:planner', value: 'sk-live-planner' });
    expect(loaded.midsceneConfig).toMatchObject({
      modelSecret: { id: 'midscene', hasKey: true },
    });
    expect(loaded.agentModelConfig.planner).toMatchObject({
      modelSecret: { id: 'agent:planner', hasKey: true },
    });
    expect(JSON.stringify(loaded)).not.toContain('sk-live-midscene');
    expect(JSON.stringify(loaded)).not.toContain('sk-live-planner');
    expect(persisted).not.toContain('sk-live-midscene');
    expect(persisted).not.toContain('sk-live-planner');
  });

  it('keeps the legacy state unchanged when model-key encryption fails', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const state = createInitialStudioState() as ReturnType<typeof createInitialStudioState> & {
      midsceneConfig: ReturnType<typeof createInitialStudioState>['midsceneConfig'] & { modelApiKey: string };
    };
    state.midsceneConfig.modelApiKey = 'sk-live-midscene';
    const store = new StudioStore(rootDirectory, fs, {
      save: async () => {
        throw new Error('safeStorage unavailable');
      },
    });

    await store.ensureReady();
    await fs.writeFile(store.storagePath, `${JSON.stringify(state)}\n`, 'utf8');

    await expect(store.load()).rejects.toThrow('safeStorage unavailable');
    await expect(fs.readFile(store.storagePath, 'utf8')).resolves.toContain('sk-live-midscene');
  });

  it('cleans empty legacy model keys without disabling existing model secret references', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const state = createInitialStudioState() as ReturnType<typeof createInitialStudioState> & {
      midsceneConfig: ReturnType<typeof createInitialStudioState>['midsceneConfig'] & { modelApiKey: string };
      agentModelConfig: ReturnType<typeof createInitialStudioState>['agentModelConfig'] & {
        planner: ReturnType<typeof createInitialStudioState>['agentModelConfig']['planner'] & { modelApiKey: string };
      };
    };
    const midsceneSecret = { id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' };
    const plannerSecret = { id: 'agent:planner', hasKey: true, updatedAt: '2026-08-17T00:00:01.000Z' };
    state.midsceneConfig.modelSecret = midsceneSecret;
    state.midsceneConfig.modelApiKey = '';
    state.agentModelConfig.planner.modelSecret = plannerSecret;
    state.agentModelConfig.planner.modelApiKey = '';
    const saveSecret = vi.fn();
    const store = new StudioStore(rootDirectory, fs, { save: saveSecret });

    await store.ensureReady();
    await fs.writeFile(store.storagePath, `${JSON.stringify(state)}\n`, 'utf8');
    const loaded = await store.load();
    const persisted = await fs.readFile(store.storagePath, 'utf8');

    expect(saveSecret).not.toHaveBeenCalled();
    expect(loaded.midsceneConfig.modelSecret).toEqual(midsceneSecret);
    expect(loaded.agentModelConfig.planner.modelSecret).toEqual(plannerSecret);
    expect(JSON.stringify(loaded)).not.toContain('modelApiKey');
    expect(persisted).not.toContain('modelApiKey');
  });

  it('preserves legacy state when a model-key migration failure has an ENOENT code', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const state = legacyMidsceneModelKeyState();
    const originalBytes = `${JSON.stringify(state)}\n`;
    const migrationFailure = Object.assign(new Error('model secret staging directory is missing'), { code: 'ENOENT' });
    const store = new StudioStore(rootDirectory, fs, {
      save: async () => {
        throw migrationFailure;
      },
    });

    await store.ensureReady();
    await fs.writeFile(store.storagePath, originalBytes, 'utf8');

    await expect(store.load()).rejects.toBe(migrationFailure);
    await expect(fs.readFile(store.storagePath, 'utf8')).resolves.toBe(originalBytes);
  });

  it('migrates a legacy Midscene key when historic state has no agent model configuration', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const state = legacyMidsceneModelKeyState() as ReturnType<typeof legacyMidsceneModelKeyState> & {
      agentModelConfig?: unknown;
    };
    delete state.agentModelConfig;
    const saveSecret = vi.fn(async ({ scope }: { scope: string }) => ({
      id: scope,
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    }));
    const store = new StudioStore(rootDirectory, fs, { save: saveSecret });

    await store.ensureReady();
    await fs.writeFile(store.storagePath, `${JSON.stringify(state)}\n`, 'utf8');

    const loaded = await store.load();

    expect(saveSecret).toHaveBeenCalledWith({ scope: 'midscene', value: 'sk-live-midscene' });
    expect(loaded.midsceneConfig).toMatchObject({ modelSecret: { id: 'midscene', hasKey: true } });
    expect(hydrateStudioState(loaded).agentModelConfig.planner.modelSecret).toMatchObject({
      id: 'agent:planner',
      hasKey: false,
    });
  });

  it('migrates raw model keys before saving supplied state and returns only secret references', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const secrets = new ModelSecretStore(rootDirectory, protection);
    const store = new StudioStore(rootDirectory, fs, secrets);
    const state = legacyModelKeyState();

    const saved = await store.save(state);
    const persisted = await fs.readFile(store.storagePath, 'utf8');

    expect(persisted).not.toContain('sk-live-midscene');
    expect(persisted).not.toContain('sk-live-planner');
    expect(JSON.stringify(saved)).not.toContain('sk-live-midscene');
    expect(JSON.stringify(saved)).not.toContain('sk-live-planner');
    expect(saved).toMatchObject({
      midsceneConfig: { modelSecret: { id: 'midscene', hasKey: true } },
      agentModelConfig: { planner: { modelSecret: { id: 'agent:planner', hasKey: true } } },
    });
    await expect(secrets.resolve({ scope: 'midscene' })).resolves.toBe('sk-live-midscene');
    await expect(secrets.resolve({ scope: 'agent:planner' })).resolves.toBe('sk-live-planner');
    expect((state.midsceneConfig as { modelApiKey?: string }).modelApiKey).toBe('sk-live-midscene');
  });

  it('keeps the existing state file when direct-save model-key encryption fails', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const stableStore = new StudioStore(rootDirectory);
    const originalState = createInitialStudioState();
    await stableStore.save(originalState);
    const failingStore = new StudioStore(rootDirectory, fs, {
      save: async () => {
        throw new Error('safeStorage unavailable');
      },
    });

    await expect(failingStore.save(legacyModelKeyState())).rejects.toThrow('safeStorage unavailable');
    await expect(stableStore.loadExisting()).resolves.toEqual(originalState);
  });
});

function legacyModelKeyState() {
  const state = createInitialStudioState() as ReturnType<typeof createInitialStudioState> & {
    midsceneConfig: ReturnType<typeof createInitialStudioState>['midsceneConfig'] & { modelApiKey: string };
    agentModelConfig: ReturnType<typeof createInitialStudioState>['agentModelConfig'] & {
      planner: ReturnType<typeof createInitialStudioState>['agentModelConfig']['planner'] & { modelApiKey: string };
    };
  };
  state.midsceneConfig.modelApiKey = 'sk-live-midscene';
  state.agentModelConfig.planner.modelApiKey = 'sk-live-planner';
  return state;
}

function legacyMidsceneModelKeyState() {
  const state = createInitialStudioState() as ReturnType<typeof createInitialStudioState> & {
    midsceneConfig: ReturnType<typeof createInitialStudioState>['midsceneConfig'] & { modelApiKey: string };
  };
  state.midsceneConfig.modelApiKey = 'sk-live-midscene';
  return state;
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-studio-store-'));
  temporaryDirectories.push(directory);
  return directory;
}
