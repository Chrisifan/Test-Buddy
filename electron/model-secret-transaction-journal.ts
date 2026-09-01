import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ModelSecretRef, ModelSecretScope } from '../shared/studio.js';
import { syncDurableDirectory, writeDurableAtomicFile } from './durable-atomic-file.js';
import type { ModelSecretSnapshot } from './runtime/model-secret-store.js';

export interface ModelSecretTransactionJournalEntry {
  scope: ModelSecretScope;
  previous: ModelSecretSnapshot | undefined;
  next: ModelSecretRef;
}

/**
 * Private recovery data for the interval between changing an encrypted secret
 * and persisting its public StudioState reference.
 */
export class ModelSecretTransactionJournal {
  private readonly directory: string;
  private readonly journalPath: string;

  constructor(rootDirectory: string) {
    this.directory = path.join(rootDirectory, 'studio-data', 'credentials');
    this.journalPath = path.join(this.directory, 'model-secret-transaction-journal.json');
  }

  get storagePath(): string {
    return this.journalPath;
  }

  async stage(entry: ModelSecretTransactionJournalEntry): Promise<void> {
    assertJournalEntry(entry);
    await fs.mkdir(this.directory, { recursive: true });
    const stagingPath = path.join(this.directory, `.model-secret-transaction-${randomUUID()}.json`);
    await writeDurableAtomicFile({
      directory: this.directory,
      stagingPath,
      destinationPath: this.journalPath,
      content: `${JSON.stringify(entry, null, 2)}\n`,
    });
  }

  async load(): Promise<ModelSecretTransactionJournalEntry | undefined> {
    try {
      const content = await fs.readFile(this.journalPath, 'utf8');
      const value = JSON.parse(content) as unknown;
      if (!isJournalEntry(value)) {
        throw new Error('模型密钥事务恢复日志无效。');
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      if (error instanceof SyntaxError) {
        throw new Error('模型密钥事务恢复日志无效。');
      }
      throw error;
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.journalPath, { force: true });
    await syncDurableDirectory(this.directory);
  }
}

function assertJournalEntry(entry: ModelSecretTransactionJournalEntry): void {
  if (!isJournalEntry(entry)) {
    throw new Error('模型密钥事务恢复日志无效。');
  }
}

function isJournalEntry(value: unknown): value is ModelSecretTransactionJournalEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Partial<ModelSecretTransactionJournalEntry>;
  return isModelSecretScope(entry.scope) &&
    isMatchingReference(entry.next, entry.scope) &&
    (entry.previous === undefined || isMatchingSnapshot(entry.previous, entry.scope));
}

function isMatchingReference(value: unknown, scope: ModelSecretScope): value is ModelSecretRef {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const reference = value as Partial<ModelSecretRef>;
  return reference.id === scope &&
    typeof reference.hasKey === 'boolean' &&
    typeof reference.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(reference.updatedAt));
}

function isMatchingSnapshot(value: unknown, scope: ModelSecretScope): value is ModelSecretSnapshot {
  if (!isMatchingReference(value, scope)) {
    return false;
  }
  const snapshot = value as Partial<ModelSecretSnapshot>;
  return snapshot.hasKey === true &&
    typeof snapshot.encryptedValue === 'string' &&
    snapshot.encryptedValue.startsWith('safe:');
}

function isModelSecretScope(value: unknown): value is ModelSecretScope {
  return value === 'midscene' || value === 'agent:planner' || value === 'agent:executor' ||
    value === 'agent:verifier' || value === 'agent:reporter';
}
