import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { FixtureScriptTrustRecord } from '../../shared/studio.js';

export interface FixtureScriptTrustIdentity {
  projectId: string;
  projectDirectory: string;
  fixtureId: string;
  fixtureVersion: number;
  lifecycle: FixtureScriptTrustRecord['lifecycle'];
  relativePath: string;
  contentHash: string;
}

export class ScriptTrustStore {
  private readonly trustDirectory: string;
  private readonly trustPath: string;

  constructor(rootDir: string) {
    this.trustDirectory = path.join(rootDir, 'studio-data', 'script-trust');
    this.trustPath = path.join(this.trustDirectory, 'trusted-scripts.json');
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.trustDirectory, { recursive: true });
  }

  async list(identity: Pick<FixtureScriptTrustIdentity, 'projectId' | 'projectDirectory'>): Promise<FixtureScriptTrustRecord[]> {
    const records = await this.load();
    return records.filter((record) => (
      record.projectId === identity.projectId && record.projectDirectory === identity.projectDirectory
    ));
  }

  async approve(identity: FixtureScriptTrustIdentity): Promise<FixtureScriptTrustRecord> {
    assertTrustIdentity(identity);
    const record: FixtureScriptTrustRecord = {
      schemaVersion: 1,
      ...identity,
      approvedAt: new Date().toISOString(),
    };
    const existing = await this.load();
    const next = [
      ...existing.filter((candidate) => !isSameTrustTarget(candidate, record)),
      record,
    ];
    await this.save(next);
    return record;
  }

  private async load(): Promise<FixtureScriptTrustRecord[]> {
    try {
      const content = await fs.readFile(this.trustPath, 'utf8');
      const raw = JSON.parse(content);
      return Array.isArray(raw)
        ? raw.filter(isFixtureScriptTrustRecord)
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async save(records: FixtureScriptTrustRecord[]): Promise<void> {
    await this.ensureReady();
    const stagingPath = path.join(this.trustDirectory, `.trust-staging-${randomUUID()}.json`);
    try {
      await fs.writeFile(stagingPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
      await fs.rename(stagingPath, this.trustPath);
    } catch (error) {
      await fs.rm(stagingPath, { force: true });
      throw error;
    }
  }
}

const isSameTrustTarget = (
  candidate: FixtureScriptTrustRecord,
  record: FixtureScriptTrustTrustComparable,
): boolean => {
  return (
    candidate.projectId === record.projectId &&
    candidate.projectDirectory === record.projectDirectory &&
    candidate.fixtureId === record.fixtureId &&
    candidate.fixtureVersion === record.fixtureVersion &&
    candidate.lifecycle === record.lifecycle
  );
};

type FixtureScriptTrustTrustComparable = Pick<
  FixtureScriptTrustRecord,
  'projectId' | 'projectDirectory' | 'fixtureId' | 'fixtureVersion' | 'lifecycle'
>;

const assertTrustIdentity = (value: FixtureScriptTrustIdentity): void => {
  if (
    !isNonEmptyString(value.projectId) ||
    !path.isAbsolute(value.projectDirectory) ||
    !isNonEmptyString(value.fixtureId) ||
    !Number.isInteger(value.fixtureVersion) ||
    value.fixtureVersion < 1 ||
    (value.lifecycle !== 'setup' && value.lifecycle !== 'cleanup') ||
    !isSafeRelativePath(value.relativePath) ||
    path.extname(value.relativePath) !== '.mjs' ||
    !/^[a-f0-9]{64}$/i.test(value.contentHash)
  ) {
    throw new Error('脚本信任记录无效。');
  }
};

const isFixtureScriptTrustRecord = (value: unknown): value is FixtureScriptTrustRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<FixtureScriptTrustRecord>;
  try {
    assertTrustIdentity({
      projectId: record.projectId ?? '',
      projectDirectory: record.projectDirectory ?? '',
      fixtureId: record.fixtureId ?? '',
      fixtureVersion: record.fixtureVersion ?? 0,
      lifecycle: record.lifecycle ?? 'setup',
      relativePath: record.relativePath ?? '',
      contentHash: record.contentHash ?? '',
    });
  } catch {
    return false;
  }
  return record.schemaVersion === 1 && isNonEmptyString(record.approvedAt) && !Number.isNaN(Date.parse(record.approvedAt));
};

const isSafeRelativePath = (value: string): boolean => {
  return isNonEmptyString(value) &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/u).includes('..');
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && Boolean(value.trim());
};
