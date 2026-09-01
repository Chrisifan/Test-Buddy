import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

vi.mock('electron', () => ({ safeStorage: undefined }));

import { ModelSecretStore } from './model-secret-store.js';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ModelSecretStore without Electron safeStorage', () => {
  it('loads its module in a pure Node process before secure storage is used', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const runtimeDirectory = path.join(rootDirectory, 'runtime');
    await fs.mkdir(runtimeDirectory, { recursive: true });
    await fs.mkdir(path.join(rootDirectory, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(rootDirectory, 'package.json'), '{"type":"module"}\n', 'utf8');
    await fs.writeFile(
      path.join(rootDirectory, 'durable-atomic-file.js'),
      transpileModule(await fs.readFile(path.join(process.cwd(), 'electron', 'durable-atomic-file.ts'), 'utf8')),
      'utf8',
    );
    await fs.writeFile(
      path.join(runtimeDirectory, 'model-secret-store.js'),
      transpileModule(await fs.readFile(path.join(process.cwd(), 'electron', 'runtime', 'model-secret-store.ts'), 'utf8')),
      'utf8',
    );
    await fs.symlink(
      path.join(process.cwd(), 'node_modules', 'electron'),
      path.join(rootDirectory, 'node_modules', 'electron'),
      'dir',
    );

    await expect(execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', `import(${JSON.stringify(pathToFileURL(path.join(runtimeDirectory, 'model-secret-store.js')).href)})`],
    )).resolves.toBeDefined();
  });

  it('reports unavailable secure storage without persisting a raw key', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new ModelSecretStore(rootDirectory);

    await expect(store.save({ scope: 'midscene', value: 'sk-live-midscene' })).rejects.toThrow(
      '本机安全存储不可用，无法保存模型密钥。',
    );
    await expect(fs.stat(store.storagePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function transpileModule(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-model-secret-node-'));
  temporaryDirectories.push(directory);
  return directory;
}
