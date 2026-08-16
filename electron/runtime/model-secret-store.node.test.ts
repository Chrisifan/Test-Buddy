import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: undefined }));

import { ModelSecretStore } from './model-secret-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ModelSecretStore without Electron safeStorage', () => {
  it('reports unavailable secure storage without persisting a raw key', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new ModelSecretStore(rootDirectory);

    await expect(store.save({ scope: 'midscene', value: 'sk-live-midscene' })).rejects.toThrow(
      '本机安全存储不可用，无法保存模型密钥。',
    );
    await expect(fs.stat(store.storagePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-model-secret-node-'));
  temporaryDirectories.push(directory);
  return directory;
}
