import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('StorageStateStore without Electron safeStorage', () => {
  it('loads in a pure Node process before secure storage is needed', async () => {
    const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-storage-state-node-'));
    temporaryDirectories.push(rootDirectory);
    const runtimeDirectory = path.join(rootDirectory, 'runtime');
    await fs.mkdir(runtimeDirectory, { recursive: true });
    await fs.mkdir(path.join(rootDirectory, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(rootDirectory, 'package.json'), '{"type":"module"}\n', 'utf8');
    await fs.writeFile(
      path.join(runtimeDirectory, 'storage-state-store.js'),
      ts.transpileModule(await fs.readFile(path.join(process.cwd(), 'electron', 'runtime', 'storage-state-store.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      'utf8',
    );
    await fs.symlink(path.join(process.cwd(), 'node_modules', 'electron'), path.join(rootDirectory, 'node_modules', 'electron'), 'dir');

    await expect(execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', `import(${JSON.stringify(pathToFileURL(path.join(runtimeDirectory, 'storage-state-store.js')).href)})`],
    )).resolves.toBeDefined();
  });
});
