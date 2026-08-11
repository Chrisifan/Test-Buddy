import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { safeStorage } from 'electron';

import type { StorageStateAvailability, StorageStateRef } from '../../shared/studio.js';

const maxStorageStateBytes = 5 * 1024 * 1024;

interface StoredStorageState extends StorageStateRef {
  schemaVersion: 1;
  projectId: string;
  encryptedState: string;
}

interface StorageStatePayload {
  cookies: unknown[];
  origins: unknown[];
}

export interface StorageStateInspection {
  availability: StorageStateAvailability;
  expiresAt?: string;
}

export interface StorageStateProtection {
  encrypt: (serializedState: string) => string;
  decrypt: (encryptedState: string) => string;
}

export class StorageStateStore {
  private readonly storageStateDirectory: string;
  private readonly storageStatePath: string;

  constructor(
    rootDir: string,
    private readonly protection: StorageStateProtection = electronStorageStateProtection,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.storageStateDirectory = path.join(rootDir, 'studio-data', 'credentials');
    this.storageStatePath = path.join(this.storageStateDirectory, 'storage-states.json');
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.storageStateDirectory, { recursive: true });
  }

  async save(projectId: string, label: string, serializedState: string): Promise<StorageStateRef> {
    const normalizedProjectId = requiredString(projectId, '项目 ID');
    const normalizedLabel = requiredString(label, '认证状态名称');
    if (Buffer.byteLength(serializedState, 'utf8') > maxStorageStateBytes) {
      throw new Error('认证状态文件超过 5 MB，无法安全导入。');
    }
    const inspection = inspectStorageState(serializedState, this.now());
    const timestamp = this.now().toISOString();
    const record: StoredStorageState = {
      schemaVersion: 1,
      id: `storage-state-${randomUUID()}`,
      projectId: normalizedProjectId,
      label: normalizedLabel,
      createdAt: timestamp,
      updatedAt: timestamp,
      availability: inspection.availability,
      ...(inspection.expiresAt ? { expiresAt: inspection.expiresAt } : {}),
      encryptedState: this.protection.encrypt(serializedState),
    };
    const records = await this.load();
    await this.saveRecords([...records, record]);
    return toStorageStateRef(record, this.now());
  }

  async importFile(projectId: string, label: string, filePath: string): Promise<StorageStateRef> {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('所选认证状态不是文件。');
    }
    if (stats.size > maxStorageStateBytes) {
      throw new Error('认证状态文件超过 5 MB，无法安全导入。');
    }
    return this.save(projectId, label, await fs.readFile(filePath, 'utf8'));
  }

  /** Replaces encrypted content while keeping the project-visible logical ID stable. */
  async replace(projectId: string, storageStateId: string, serializedState: string): Promise<StorageStateRef> {
    const normalizedProjectId = requiredString(projectId, '项目 ID');
    const normalizedStorageStateId = requiredString(storageStateId, '认证状态 ID');
    if (Buffer.byteLength(serializedState, 'utf8') > maxStorageStateBytes) {
      throw new Error('认证状态文件超过 5 MB，无法安全保存。');
    }
    const inspection = inspectStorageState(serializedState, this.now());
    const records = await this.load();
    const current = records.find((candidate) => (
      candidate.projectId === normalizedProjectId && candidate.id === normalizedStorageStateId
    ));
    if (!current) {
      throw new Error('认证状态引用不存在或不属于当前项目。');
    }
    const replacement: StoredStorageState = {
      ...current,
      updatedAt: this.now().toISOString(),
      availability: inspection.availability,
      ...(inspection.expiresAt ? { expiresAt: inspection.expiresAt } : {}),
      encryptedState: this.protection.encrypt(serializedState),
    };
    if (!inspection.expiresAt) {
      delete replacement.expiresAt;
    }
    await this.saveRecords(records.map((candidate) => candidate.id === current.id ? replacement : candidate));
    return toStorageStateRef(replacement, this.now());
  }

  async revoke(projectId: string, storageStateId: string): Promise<void> {
    const normalizedProjectId = requiredString(projectId, '项目 ID');
    const normalizedStorageStateId = requiredString(storageStateId, '认证状态 ID');
    const records = await this.load();
    const next = records.filter((candidate) => !(
      candidate.projectId === normalizedProjectId && candidate.id === normalizedStorageStateId
    ));
    if (next.length === records.length) {
      throw new Error('认证状态引用不存在或不属于当前项目。');
    }
    await this.saveRecords(next);
  }

  async list(projectId: string): Promise<StorageStateRef[]> {
    const normalizedProjectId = requiredString(projectId, '项目 ID');
    return (await this.load())
      .filter((record) => record.projectId === normalizedProjectId)
      .map((record) => toStorageStateRef(record, this.now()));
  }

  /**
   * Main-process-only access for Playwright context construction. Renderer and
   * report code can only consume StorageStateRef metadata through list().
   */
  async resolve(projectId: string, storageStateId: string): Promise<{ reference: StorageStateRef; serializedState: string }> {
    const normalizedProjectId = requiredString(projectId, '项目 ID');
    const normalizedStorageStateId = requiredString(storageStateId, '认证状态 ID');
    const record = (await this.load()).find((candidate) => (
      candidate.projectId === normalizedProjectId && candidate.id === normalizedStorageStateId
    ));
    if (!record) {
      throw new Error('认证状态引用不存在或不属于当前项目。');
    }

    const serializedState = this.protection.decrypt(record.encryptedState);
    const inspection = inspectStorageState(serializedState, this.now());
    if (inspection.availability === 'expired') {
      throw new Error('认证状态已过期，请重新导入后再启动浏览器。');
    }
    return { reference: toStorageStateRef(record, this.now()), serializedState };
  }

  private async load(): Promise<StoredStorageState[]> {
    try {
      const content = await fs.readFile(this.storageStatePath, 'utf8');
      const raw = JSON.parse(content);
      return Array.isArray(raw) ? raw.filter(isStoredStorageState) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error('本地认证状态存储无法读取，请检查 studio-data 后重试。');
    }
  }

  private async saveRecords(records: StoredStorageState[]): Promise<void> {
    await this.ensureReady();
    const stagingPath = path.join(this.storageStateDirectory, `.storage-state-staging-${randomUUID()}.json`);
    try {
      await fs.writeFile(stagingPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
      await fs.rename(stagingPath, this.storageStatePath);
    } catch (error) {
      await fs.rm(stagingPath, { force: true });
      throw error;
    }
  }
}

export function inspectStorageState(serializedState: string, now = new Date()): StorageStateInspection {
  let raw: unknown;
  try {
    raw = JSON.parse(serializedState);
  } catch {
    throw new Error('认证状态必须是有效的 Playwright storageState JSON。');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('认证状态必须是一个 Playwright storageState 对象。');
  }
  const payload = raw as Partial<StorageStatePayload>;
  if (!Array.isArray(payload.cookies) || !Array.isArray(payload.origins)) {
    throw new Error('认证状态缺少 cookies 或 origins 数组。');
  }
  if (!payload.cookies.length && !payload.origins.length) {
    throw new Error('认证状态不包含可复用的 cookies 或 origin 存储。');
  }
  payload.cookies.forEach(validateStorageStateCookie);
  payload.origins.forEach(validateStorageStateOrigin);

  const cookieExpirations = payload.cookies
    .map((cookie) => (cookie as { expires: number }).expires)
    .filter((expires) => Number.isFinite(expires) && expires >= 0)
    .map((expires) => new Date(expires * 1000));
  const hasSessionCookie = payload.cookies.some((cookie) => (cookie as { expires: number }).expires === -1);
  const futureExpirations = cookieExpirations.filter((expires) => expires.getTime() > now.getTime());
  const latestExpiration = futureExpirations.length
    ? new Date(Math.max(...futureExpirations.map((expires) => expires.getTime())))
    : cookieExpirations.length
      ? new Date(Math.max(...cookieExpirations.map((expires) => expires.getTime())))
      : undefined;

  if (payload.cookies.length && !hasSessionCookie && !futureExpirations.length) {
    return { availability: 'expired', ...(latestExpiration ? { expiresAt: latestExpiration.toISOString() } : {}) };
  }
  if (!payload.cookies.length || hasSessionCookie) {
    return { availability: 'unknown', ...(latestExpiration ? { expiresAt: latestExpiration.toISOString() } : {}) };
  }
  return { availability: 'available', ...(latestExpiration ? { expiresAt: latestExpiration.toISOString() } : {}) };
}

function toStorageStateRef(record: StoredStorageState, now: Date): StorageStateRef {
  const availability = record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()
    ? 'expired'
    : record.availability;
  return {
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    availability,
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
  };
}

function isStoredStorageState(value: unknown): value is StoredStorageState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<StoredStorageState>;
  return record.schemaVersion === 1 &&
    typeof record.projectId === 'string' && Boolean(record.projectId.trim()) &&
    typeof record.id === 'string' && Boolean(record.id.trim()) &&
    typeof record.label === 'string' && Boolean(record.label.trim()) &&
    typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt)) &&
    typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt)) &&
    (record.availability === 'available' || record.availability === 'expired' || record.availability === 'unknown') &&
    (record.expiresAt === undefined || (typeof record.expiresAt === 'string' && !Number.isNaN(Date.parse(record.expiresAt)))) &&
    typeof record.encryptedState === 'string' && Boolean(record.encryptedState);
}

function validateStorageStateCookie(value: unknown): void {
  if (!value || typeof value !== 'object') {
    throw new Error('认证状态包含无效 cookie。');
  }
  const cookie = value as Record<string, unknown>;
  if (
    typeof cookie.name !== 'string' ||
    typeof cookie.value !== 'string' ||
    typeof cookie.domain !== 'string' ||
    typeof cookie.path !== 'string' ||
    typeof cookie.expires !== 'number' ||
    !Number.isFinite(cookie.expires)
  ) {
    throw new Error('认证状态包含无效 cookie。');
  }
}

function validateStorageStateOrigin(value: unknown): void {
  if (!value || typeof value !== 'object' || typeof (value as { origin?: unknown }).origin !== 'string') {
    throw new Error('认证状态包含无效 origin 存储。');
  }
  const localStorage = (value as { localStorage?: unknown }).localStorage;
  if (localStorage !== undefined && (!Array.isArray(localStorage) || localStorage.some((entry) => (
    !entry || typeof entry !== 'object' ||
    typeof (entry as { name?: unknown }).name !== 'string' ||
    typeof (entry as { value?: unknown }).value !== 'string'
  )))) {
    throw new Error('认证状态包含无效 origin 存储。');
  }
}

function requiredString(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`${label}无效。`);
  }
  return value.trim();
}

const electronStorageStateProtection: StorageStateProtection = {
  encrypt(serializedState) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('本机安全存储不可用，无法保存认证状态。');
    }
    return `safe:${safeStorage.encryptString(serializedState).toString('base64')}`;
  },
  decrypt(encryptedState) {
    if (!encryptedState.startsWith('safe:') || !safeStorage.isEncryptionAvailable()) {
      throw new Error('认证状态无法通过本机安全存储解析。');
    }
    try {
      return safeStorage.decryptString(Buffer.from(encryptedState.slice('safe:'.length), 'base64'));
    } catch {
      throw new Error('认证状态已损坏或无法解密。');
    }
  },
};
