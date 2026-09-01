import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { writeDurableAtomicFile } from '../durable-atomic-file.js';
import type {
  ClearModelSecretRequest,
  ModelSecretRef,
  ModelSecretScope,
  SaveModelSecretRequest,
} from '../../shared/studio.js';

export type { ModelSecretScope, SaveModelSecretRequest } from '../../shared/studio.js';

interface StoredModelSecret extends ModelSecretRef {
  encryptedValue: string;
}

/** Encrypted main-process state used only to compensate a failed ref write. */
export interface ModelSecretSnapshot extends ModelSecretRef {
  encryptedValue: string;
}

export interface ResolveModelSecretRequest {
  scope: ModelSecretScope;
}

export interface ModelSecretProtection {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ModelSecretStore {
  private readonly secretsDirectory: string;
  private readonly secretsPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    rootDir: string,
    private readonly protection: ModelSecretProtection = electronModelSecretProtection,
  ) {
    this.secretsDirectory = path.join(rootDir, 'studio-data', 'credentials');
    this.secretsPath = path.join(this.secretsDirectory, 'model-secrets.json');
  }

  get storagePath(): string {
    return this.secretsPath;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.secretsDirectory, { recursive: true });
  }

  async save(request: SaveModelSecretRequest, reference?: ModelSecretRef): Promise<ModelSecretRef> {
    assertModelSecretScope(request.scope);
    const value = requiredSecretValue(request.value);
    const record: StoredModelSecret = {
      ...modelSecretReference(request.scope, true, reference),
      encryptedValue: this.protection.encrypt(value),
    };
    return this.serializeWrite(async () => {
      const records = await this.loadRecords();
      await this.saveRecords([
        ...records.filter((candidate) => candidate.id !== request.scope),
        record,
      ]);
      return toModelSecretRef(record);
    });
  }

  async resolve(request: ResolveModelSecretRequest): Promise<string> {
    assertModelSecretScope(request.scope);
    const record = (await this.loadRecords()).find((candidate) => candidate.id === request.scope);
    if (!record) {
      throw new Error('模型密钥引用不存在，请重新保存后再试。');
    }
    return this.protection.decrypt(record.encryptedValue);
  }

  async clear(request: ClearModelSecretRequest, reference?: ModelSecretRef): Promise<ModelSecretRef> {
    assertModelSecretScope(request.scope);
    const ref = modelSecretReference(request.scope, false, reference);
    return this.serializeWrite(async () => {
      const records = await this.loadRecords();
      await this.saveRecords(records.filter((candidate) => candidate.id !== request.scope));
      return ref;
    });
  }

  async snapshot(scope: ModelSecretScope): Promise<ModelSecretSnapshot | undefined> {
    assertModelSecretScope(scope);
    return this.serializeWrite(async () => {
      const record = (await this.loadRecords()).find((candidate) => candidate.id === scope);
      return record ? { ...record } : undefined;
    });
  }

  async restore(scope: ModelSecretScope, snapshot: ModelSecretSnapshot | undefined): Promise<void> {
    assertModelSecretScope(scope);
    if (snapshot && (!isStoredModelSecret(snapshot) || snapshot.id !== scope)) {
      throw new Error('模型密钥恢复数据无效。');
    }
    await this.serializeWrite(async () => {
      const records = await this.loadRecords();
      await this.saveRecords([
        ...records.filter((candidate) => candidate.id !== scope),
        ...(snapshot ? [{ ...snapshot }] : []),
      ]);
    });
  }

  private async loadRecords(): Promise<StoredModelSecret[]> {
    try {
      const content = await fs.readFile(this.secretsPath, 'utf8');
      const records = JSON.parse(content);
      return Array.isArray(records) ? records.filter(isStoredModelSecret) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error('本地模型密钥存储无法读取，请检查 studio-data 后重试。');
    }
  }

  private async saveRecords(records: StoredModelSecret[]): Promise<void> {
    await this.ensureReady();
    const stagingPath = path.join(this.secretsDirectory, `.model-secret-staging-${randomUUID()}.json`);
    await writeDurableAtomicFile({
      directory: this.secretsDirectory,
      stagingPath,
      destinationPath: this.secretsPath,
      content: `${JSON.stringify(records, null, 2)}\n`,
    });
  }

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const requiredSecretValue = (value: string): string => {
  if (!value.trim()) {
    throw new Error('模型密钥不能为空。');
  }
  return value;
};

const modelSecretReference = (
  scope: ModelSecretScope,
  hasKey: boolean,
  reference?: ModelSecretRef,
): ModelSecretRef => {
  if (!reference) {
    return { id: scope, hasKey, updatedAt: new Date().toISOString() };
  }
  if (
    reference.id !== scope ||
    reference.hasKey !== hasKey ||
    typeof reference.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(reference.updatedAt))
  ) {
    throw new Error('模型密钥引用无效。');
  }
  return { ...reference };
};

const isStoredModelSecret = (value: unknown): value is StoredModelSecret => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<StoredModelSecret>;
  return isModelSecretScope(record.id) &&
    record.hasKey === true &&
    typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt)) &&
    typeof record.encryptedValue === 'string' && record.encryptedValue.startsWith('safe:');
};

const isModelSecretScope = (value: unknown): value is ModelSecretScope => {
  return value === 'midscene' || value === 'agent:planner' || value === 'agent:executor' ||
    value === 'agent:verifier' || value === 'agent:reporter';
};

const assertModelSecretScope: (scope: unknown) => asserts scope is ModelSecretScope = (scope) => {
  if (!isModelSecretScope(scope)) {
    throw new Error('模型密钥范围无效。');
  }
};

const toModelSecretRef = (record: StoredModelSecret): ModelSecretRef => {
  return {
    id: record.id,
    hasKey: record.hasKey,
    updatedAt: record.updatedAt,
  };
};

const electronModelSecretProtection: ModelSecretProtection = {
  encrypt(value) {
    const safeStorage = loadElectronSafeStorage();
    if (!safeStorage?.isEncryptionAvailable()) {
      throw new Error('本机安全存储不可用，无法保存模型密钥。');
    }
    return `safe:${safeStorage.encryptString(value).toString('base64')}`;
  },
  decrypt(value) {
    const safeStorage = loadElectronSafeStorage();
    if (!value.startsWith('safe:')) {
      throw new Error('模型密钥已损坏或无法解密。');
    }
    if (!safeStorage?.isEncryptionAvailable()) {
      throw new Error('本机安全存储不可用，无法解析模型密钥。');
    }
    try {
      return safeStorage.decryptString(Buffer.from(value.slice('safe:'.length), 'base64'));
    } catch {
      throw new Error('模型密钥已损坏或无法解密。');
    }
  },
};

const requireElectron = createRequire(import.meta.url);

const loadElectronSafeStorage = (): ElectronSafeStorage | undefined => {
  try {
    const electron = requireElectron('electron') as unknown;
    if (!electron || typeof electron !== 'object') {
      return undefined;
    }
    const safeStorage = (electron as { safeStorage?: unknown }).safeStorage;
    return isElectronSafeStorage(safeStorage) ? safeStorage : undefined;
  } catch {
    return undefined;
  }
};

const isElectronSafeStorage = (value: unknown): value is ElectronSafeStorage => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ElectronSafeStorage>;
  return typeof candidate.isEncryptionAvailable === 'function' &&
    typeof candidate.encryptString === 'function' &&
    typeof candidate.decryptString === 'function';
};
