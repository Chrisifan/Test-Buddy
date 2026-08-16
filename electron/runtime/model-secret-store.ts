import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { safeStorage } from 'electron';

import type { AgentModelRole, ModelSecretRef } from '../../shared/studio.js';

export type ModelSecretScope = 'midscene' | `agent:${AgentModelRole}`;

interface StoredModelSecret extends ModelSecretRef {
  encryptedValue: string;
}

export interface SaveModelSecretRequest {
  scope: ModelSecretScope;
  value: string;
}

export interface ResolveModelSecretRequest {
  scope: ModelSecretScope;
}

export interface ModelSecretProtection {
  encrypt(value: string): string;
  decrypt(value: string): string;
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

  async save(request: SaveModelSecretRequest): Promise<ModelSecretRef> {
    assertModelSecretScope(request.scope);
    const value = requiredSecretValue(request.value);
    const record: StoredModelSecret = {
      id: request.scope,
      hasKey: true,
      updatedAt: new Date().toISOString(),
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
    try {
      await fs.writeFile(stagingPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
      await fs.rename(stagingPath, this.secretsPath);
    } catch (error) {
      await fs.rm(stagingPath, { force: true });
      throw error;
    }
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

function requiredSecretValue(value: string): string {
  if (!value.trim()) {
    throw new Error('模型密钥不能为空。');
  }
  return value;
}

function isStoredModelSecret(value: unknown): value is StoredModelSecret {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<StoredModelSecret>;
  return isModelSecretScope(record.id) &&
    record.hasKey === true &&
    typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt)) &&
    typeof record.encryptedValue === 'string' && record.encryptedValue.startsWith('safe:');
}

function isModelSecretScope(value: unknown): value is ModelSecretScope {
  return value === 'midscene' || value === 'agent:planner' || value === 'agent:executor' ||
    value === 'agent:verifier' || value === 'agent:reporter';
}

function assertModelSecretScope(scope: unknown): asserts scope is ModelSecretScope {
  if (!isModelSecretScope(scope)) {
    throw new Error('模型密钥范围无效。');
  }
}

function toModelSecretRef(record: StoredModelSecret): ModelSecretRef {
  return {
    id: record.id,
    hasKey: record.hasKey,
    updatedAt: record.updatedAt,
  };
}

const electronModelSecretProtection: ModelSecretProtection = {
  encrypt(value) {
    if (!safeStorage?.isEncryptionAvailable()) {
      throw new Error('本机安全存储不可用，无法保存模型密钥。');
    }
    return `safe:${safeStorage.encryptString(value).toString('base64')}`;
  },
  decrypt(value) {
    if (!value.startsWith('safe:') || !safeStorage?.isEncryptionAvailable()) {
      throw new Error('模型密钥无法通过本机安全存储解析。');
    }
    try {
      return safeStorage.decryptString(Buffer.from(value.slice('safe:'.length), 'base64'));
    } catch {
      throw new Error('模型密钥已损坏或无法解密。');
    }
  },
};
