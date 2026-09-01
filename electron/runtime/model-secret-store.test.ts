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

import { ModelSecretStore, type ModelSecretProtection, type ModelSecretScope } from './model-secret-store.js';

const temporaryDirectories: string[] = [];
const protection: ModelSecretProtection = {
  encrypt: (value) => `safe:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.slice('safe:'.length), 'base64').toString('utf8'),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ModelSecretStore', () => {
  it('persists Midscene and role keys only as safeStorage ciphertext under stable scopes', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new ModelSecretStore(rootDirectory, protection);

    const midscene = await store.save({ scope: 'midscene', value: 'sk-live-midscene' });
    const planner = await store.save({ scope: 'agent:planner', value: 'sk-live-planner' });

    expect(midscene).toMatchObject({ id: 'midscene', hasKey: true });
    expect(planner).toMatchObject({ id: 'agent:planner', hasKey: true });
    const persisted = await fs.readFile(store.storagePath, 'utf8');
    expect(persisted).toContain('safe:');
    expect(persisted).not.toContain('sk-live-midscene');
    expect(persisted).not.toContain('sk-live-planner');
    await expect(store.resolve({ scope: 'midscene' })).resolves.toBe('sk-live-midscene');
    await expect(store.resolve({ scope: 'agent:planner' })).resolves.toBe('sk-live-planner');
  });

  it('retains each scope when model keys are saved concurrently', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new ModelSecretStore(rootDirectory, protection);

    await Promise.all([
      store.save({ scope: 'midscene', value: 'sk-live-midscene' }),
      store.save({ scope: 'agent:planner', value: 'sk-live-planner' }),
    ]);

    await expect(store.resolve({ scope: 'midscene' })).resolves.toBe('sk-live-midscene');
    await expect(store.resolve({ scope: 'agent:planner' })).resolves.toBe('sk-live-planner');
  });

  it('clears only the requested secret scope and returns a public empty reference', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new ModelSecretStore(rootDirectory, protection);
    await store.save({ scope: 'midscene', value: 'sk-live-midscene' });
    await store.save({ scope: 'agent:planner', value: 'sk-live-planner' });

    await expect(store.clear({ scope: 'midscene' })).resolves.toMatchObject({ id: 'midscene', hasKey: false });
    await expect(store.resolve({ scope: 'midscene' })).rejects.toThrow('模型密钥引用不存在，请重新保存后再试。');
    await expect(store.resolve({ scope: 'agent:planner' })).resolves.toBe('sk-live-planner');
    await expect(fs.readFile(store.storagePath, 'utf8')).resolves.not.toContain('sk-live-midscene');
  });

  it.each(['agent:unknown', 'midscene:secondary', 'model:midscene'])(
    'rejects unsupported scope %s before encrypting or writing a submitted key',
    async (scope) => {
    const rootDirectory = await createTemporaryDirectory();
    const protection: ModelSecretProtection = {
      encrypt: vi.fn((value: string) => `safe:${Buffer.from(value).toString('base64')}`),
      decrypt: vi.fn(),
    };
    const store = new ModelSecretStore(rootDirectory, protection);
    await store.save({ scope: 'midscene', value: 'sk-live-midscene' });
    const before = await fs.readFile(store.storagePath, 'utf8');
    vi.mocked(protection.encrypt).mockClear();

    await expect(store.save({ scope: scope as ModelSecretScope, value: 'sk-live-invalid' })).rejects.toThrow(
      '模型密钥范围无效。',
    );
    expect(protection.encrypt).not.toHaveBeenCalled();
    await expect(fs.readFile(store.storagePath, 'utf8')).resolves.toBe(before);
  });

  it.each(['agent:unknown', 'midscene:secondary', 'model:midscene'])(
    'rejects unsupported scope %s before resolving a stored key',
    async (scope) => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new ModelSecretStore(rootDirectory, protection);
    await store.save({ scope: 'midscene', value: 'sk-live-midscene' });

    await expect(store.resolve({ scope: scope as ModelSecretScope })).rejects.toThrow('模型密钥范围无效。');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-model-secret-'));
  temporaryDirectories.push(directory);
  return directory;
}
