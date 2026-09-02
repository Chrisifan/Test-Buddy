import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { inspectStorageState, StorageStateStore, type StorageStateProtection } from './storage-state-store.js';

const temporaryDirectories: string[] = [];
const protection: StorageStateProtection = {
  encrypt: (value) => `test:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.slice('test:'.length), 'base64').toString('utf8'),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('StorageStateStore', () => {
  it('keeps Playwright authentication data encrypted outside project assets and exposes only metadata', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const now = new Date('2026-08-11T00:00:00.000Z');
    const store = new StorageStateStore(rootDirectory, protection, () => now);
    const serializedState = storageState({ expires: 1_800_000_000, value: 'top-secret-cookie' });

    const reference = await store.save('project-orders', '预发布管理员', serializedState);

    expect(reference).toMatchObject({
      label: '预发布管理员',
      availability: 'available',
      expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    });
    const stored = await fs.readFile(path.join(rootDirectory, 'studio-data', 'credentials', 'storage-states.json'), 'utf8');
    expect(stored).not.toContain('top-secret-cookie');
    expect(stored).not.toContain('https://staging.example.test');
    await expect(store.list('project-orders')).resolves.toEqual([reference]);
    await expect(store.resolve('project-orders', reference.id)).resolves.toEqual({
      reference,
      serializedState,
    });
    await expect(store.resolve('project-other', reference.id)).rejects.toThrow('不属于当前项目');
  });

  it('classifies expired, session, and origin-only state without guessing a valid login', () => {
    const now = new Date('2026-08-11T00:00:00.000Z');

    expect(inspectStorageState(storageState({ expires: 1_700_000_000 }), now)).toMatchObject({
      availability: 'expired',
      expiresAt: '2023-11-14T22:13:20.000Z',
    });
    expect(inspectStorageState(storageState({ expires: -1 }), now)).toMatchObject({ availability: 'unknown' });
    expect(inspectStorageState(JSON.stringify({ cookies: [], origins: [{ origin: 'https://staging.example.test', localStorage: [] }] }), now))
      .toMatchObject({ availability: 'unknown' });
  });

  it('rejects malformed, empty, and expired state before it can be supplied to a browser context', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const now = new Date('2026-08-11T00:00:00.000Z');
    const store = new StorageStateStore(rootDirectory, protection, () => now);

    await expect(store.save('project-orders', '损坏', '{')).rejects.toThrow('Playwright storageState JSON');
    await expect(store.save('project-orders', '空状态', JSON.stringify({ cookies: [], origins: [] }))).rejects.toThrow('不包含可复用');
    const expired = await store.save('project-orders', '过期登录态', storageState({ expires: 1_700_000_000 }));
    await expect(store.resolve('project-orders', expired.id)).rejects.toThrow('已过期');
  });

  it('imports a selected file through the store and ignores malformed persisted records', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new StorageStateStore(rootDirectory, protection);
    const sourcePath = path.join(rootDirectory, 'state.json');
    await fs.writeFile(sourcePath, storageState({ expires: -1 }), 'utf8');

    const reference = await store.importFile('project-orders', '会话登录态', sourcePath);
    expect(reference.availability).toBe('unknown');

    const storageDirectory = path.join(rootDirectory, 'studio-data', 'credentials');
    await fs.writeFile(path.join(storageDirectory, 'storage-states.json'), '[{"schemaVersion":1,"projectId":"project-orders"}]', 'utf8');
    await expect(store.list('project-orders')).resolves.toEqual([]);
  });

  it('refreshes encrypted content in place and revokes only the requested project reference', async () => {
    const rootDirectory = await createTemporaryDirectory();
    let now = new Date('2026-08-11T00:00:00.000Z');
    const store = new StorageStateStore(rootDirectory, protection, () => now);
    const original = await store.save('project-orders', '预发布管理员', storageState({ expires: -1, value: 'old-session' }));
    const otherProject = await store.save('project-other', '另一项目', storageState({ expires: -1, value: 'other-session' }));

    now = new Date('2026-08-12T00:00:00.000Z');
    const refreshed = await store.replace('project-orders', original.id, storageState({ expires: -1, value: 'new-session' }));

    expect(refreshed).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      updatedAt: now.toISOString(),
    });
    await expect(store.resolve('project-orders', original.id)).resolves.toMatchObject({
      serializedState: expect.stringContaining('new-session'),
    });
    await expect(store.replace('project-other', original.id, storageState({ expires: -1 }))).rejects.toThrow('不属于当前项目');

    await store.revoke('project-orders', original.id);
    await expect(store.list('project-orders')).resolves.toEqual([]);
    await expect(store.list('project-other')).resolves.toEqual([otherProject]);
    await expect(store.resolve('project-orders', original.id)).rejects.toThrow('不存在');
  });
});

const storageState = ({ expires, value = 'session-token' }: { expires: number; value?: string }): string => {
  return JSON.stringify({
    cookies: [{
      name: 'session',
      value,
      domain: 'staging.example.test',
      path: '/',
      expires,
    }],
    origins: [{ origin: 'https://staging.example.test', localStorage: [] }],
  });
};

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-storage-state-'));
  temporaryDirectories.push(directory);
  return directory;
};
