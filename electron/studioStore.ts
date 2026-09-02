import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createInitialStudioState,
  type AgentModelRole,
  type ModelSecretRef,
  type StudioState,
} from '../shared/studio.js';
import {
  DurableAtomicFileCommitError,
  type DurableAtomicFileFileSystem,
  writeDurableAtomicFile,
} from './durable-atomic-file.js';
import { ModelSecretStore, type ModelSecretScope } from './runtime/model-secret-store.js';

export interface StudioStoreFileSystem extends Partial<DurableAtomicFileFileSystem> {
  rename: DurableAtomicFileFileSystem['rename'];
}

/** The state replacement might be visible but could not be durably committed. */
export class DurableStudioStateCommitError extends Error {
  constructor(cause: unknown) {
    super('StudioState 持久化提交结果不确定。', { cause });
    this.name = 'DurableStudioStateCommitError';
  }
}

export interface ModelSecretWriter {
  save(request: { scope: ModelSecretScope; value: string }): Promise<ModelSecretRef>;
}

export class StudioStore {
  private readonly dataDir: string;
  private readonly statePath: string;

  constructor(
    rootDir: string,
    private readonly fileSystem: StudioStoreFileSystem = fs,
    private readonly modelSecrets: ModelSecretWriter = new ModelSecretStore(rootDir),
  ) {
    this.dataDir = path.join(rootDir, 'studio-data');
    this.statePath = path.join(this.dataDir, 'state.json');
  }

  get storagePath(): string {
    return this.statePath;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async load(): Promise<StudioState> {
    await this.ensureReady();

    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      return this.migrateAndSaveLegacyModelKeys(JSON.parse(content) as StudioState);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const initialState = createInitialStudioState();
        await this.save(initialState);
        return initialState;
      }

      throw error;
    }
  }

  async loadExisting(): Promise<StudioState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      return this.migrateAndSaveLegacyModelKeys(JSON.parse(content) as StudioState);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`未找到 TestBuddy 状态文件：${this.statePath}`);
      }

      throw error;
    }
  }

  async save(state: StudioState): Promise<StudioState> {
    const sanitized = await this.sanitizeLegacyModelKeys(state);
    await this.writeState(sanitized.state);
    return sanitized.state;
  }

  private async writeState(state: StudioState): Promise<void> {
    await this.ensureReady();
    const stagingPath = path.join(this.dataDir, `.state-staging-${randomUUID()}.json`);
    try {
      await writeDurableAtomicFile({
        directory: this.dataDir,
        stagingPath,
        destinationPath: this.statePath,
        content: `${JSON.stringify(state, null, 2)}\n`,
        fileSystem: this.fileSystem,
      });
    } catch (error) {
      if (error instanceof DurableAtomicFileCommitError) {
        throw new DurableStudioStateCommitError(error);
      }
      throw error;
    }
  }

  private async migrateAndSaveLegacyModelKeys(state: StudioState): Promise<StudioState> {
    const sanitized = await this.sanitizeLegacyModelKeys(state);
    if (sanitized.migrated) {
      await this.writeState(sanitized.state);
    }
    return sanitized.state;
  }

  private async sanitizeLegacyModelKeys(state: StudioState): Promise<{ state: StudioState; migrated: boolean }> {
    const migrations = collectLegacyModelKeyMigrations(state);
    if (!migrations.length) {
      return { state, migrated: false };
    }

    const clonedState = structuredClone(state);

    const refs = new Map<ModelSecretScope, ModelSecretRef>();
    for (const migration of migrations) {
      refs.set(
        migration.scope,
        migration.value.trim()
          ? await this.modelSecrets.save({ scope: migration.scope, value: migration.value })
          : migration.existingRef ?? emptyModelSecretRef(migration.scope),
      );
    }

    const midsceneRef = refs.get('midscene');
    const agentRefs = new Map(
      (['planner', 'executor', 'verifier', 'reporter'] as AgentModelRole[])
        .map((role) => [role, refs.get(`agent:${role}`)] as const)
        .filter((entry): entry is readonly [AgentModelRole, ModelSecretRef] => Boolean(entry[1])),
    );
    const nextState: StudioState = {
      ...clonedState,
      midsceneConfig: midsceneRef
        ? replaceLegacyModelKey(clonedState.midsceneConfig, midsceneRef)
        : clonedState.midsceneConfig,
      agentModelConfig: agentRefs.size
        ? Object.fromEntries(
            (Object.keys(clonedState.agentModelConfig) as AgentModelRole[]).map((role) => [
              role,
              agentRefs.has(role)
                ? replaceLegacyModelKey(clonedState.agentModelConfig[role], agentRefs.get(role)!)
                : clonedState.agentModelConfig[role],
            ]),
          ) as StudioState['agentModelConfig']
        : clonedState.agentModelConfig,
    };
    return { state: nextState, migrated: true };
  }
}

interface LegacyModelKeyMigration {
  scope: ModelSecretScope;
  value: string;
  existingRef?: ModelSecretRef;
}

const collectLegacyModelKeyMigrations = (state: StudioState): LegacyModelKeyMigration[] => {
  const migrations: LegacyModelKeyMigration[] = [];
  const midsceneKey = legacyModelKey(state.midsceneConfig);
  if (midsceneKey !== undefined) {
    migrations.push({
      scope: 'midscene',
      value: midsceneKey,
      existingRef: existingModelSecretRef(state.midsceneConfig, 'midscene'),
    });
  }
  (['planner', 'executor', 'verifier', 'reporter'] as AgentModelRole[]).forEach((role) => {
    const roleConfig = state.agentModelConfig?.[role];
    const roleKey = legacyModelKey(roleConfig);
    if (roleKey !== undefined) {
      migrations.push({
        scope: `agent:${role}`,
        value: roleKey,
        existingRef: existingModelSecretRef(roleConfig, `agent:${role}`),
      });
    }
  });
  return migrations;
};

const legacyModelKey = (config: unknown): string | undefined => {
  if (!config || typeof config !== 'object') {
    return undefined;
  }
  const { modelApiKey, apiKey } = config as { apiKey?: unknown; modelApiKey?: unknown };
  return typeof modelApiKey === 'string'
    ? modelApiKey
    : typeof apiKey === 'string'
      ? apiKey
      : undefined;
};

const existingModelSecretRef = (config: unknown, scope: ModelSecretScope): ModelSecretRef | undefined => {
  if (!config || typeof config !== 'object') {
    return undefined;
  }
  const candidate = (config as { modelSecret?: unknown }).modelSecret;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  const ref = candidate as Partial<ModelSecretRef>;
  if (ref.id !== scope || typeof ref.hasKey !== 'boolean' || typeof ref.updatedAt !== 'string' || Number.isNaN(Date.parse(ref.updatedAt))) {
    return undefined;
  }
  return { id: scope, hasKey: ref.hasKey, updatedAt: ref.updatedAt };
};

const replaceLegacyModelKey = <T extends object>(config: T, modelSecret: ModelSecretRef): T & { modelSecret: ModelSecretRef } => {
  const {
    apiKey: _legacyApiKey,
    modelApiKey: _legacyModelApiKey,
    ...keyFreeConfig
  } = config as T & { apiKey?: unknown; modelApiKey?: unknown };
  return { ...keyFreeConfig, modelSecret } as T & { modelSecret: ModelSecretRef };
};

const emptyModelSecretRef = (scope: ModelSecretScope): ModelSecretRef => {
  return {
    id: scope,
    hasKey: false,
    updatedAt: new Date(0).toISOString(),
  };
};
