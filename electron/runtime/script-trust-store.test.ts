import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ScriptTrustStore } from './script-trust-store.js';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-script-trust-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ScriptTrustStore', () => {
  it('persists one local approval per project directory, fixture version, and lifecycle', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const projectDirectory = path.join(rootDirectory, 'project-assets');
    const identity = {
      projectId: 'project-orders',
      projectDirectory,
      fixtureId: 'fixture-seed',
      fixtureVersion: 2,
      lifecycle: 'setup' as const,
      relativePath: 'scripts/seed-orders.mjs',
      contentHash: 'a'.repeat(64),
    };
    const store = new ScriptTrustStore(rootDirectory);

    const first = await store.approve(identity);
    const reloaded = new ScriptTrustStore(rootDirectory);
    await expect(reloaded.list({ projectId: identity.projectId, projectDirectory })).resolves.toEqual([first]);
    await expect(reloaded.list({ projectId: identity.projectId, projectDirectory: path.join(rootDirectory, 'other-project') })).resolves.toEqual([]);

    const renewed = await reloaded.approve({ ...identity, contentHash: 'b'.repeat(64) });
    await expect(reloaded.list({ projectId: identity.projectId, projectDirectory })).resolves.toEqual([renewed]);
  });

  it('discards malformed stored records so they cannot grant script trust', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const trustDirectory = path.join(rootDirectory, 'studio-data', 'script-trust');
    await fs.mkdir(trustDirectory, { recursive: true });
    await fs.writeFile(path.join(trustDirectory, 'trusted-scripts.json'), JSON.stringify([
      { projectId: 'project-orders', projectDirectory: '/tmp/project', contentHash: 'not-a-hash' },
    ]));

    await expect(new ScriptTrustStore(rootDirectory).list({
      projectId: 'project-orders',
      projectDirectory: '/tmp/project',
    })).resolves.toEqual([]);
  });

  it('does not approve non-module script paths', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const store = new ScriptTrustStore(rootDirectory);

    await expect(store.approve({
      projectId: 'project-orders',
      projectDirectory: path.join(rootDirectory, 'project-assets'),
      fixtureId: 'fixture-seed',
      fixtureVersion: 1,
      lifecycle: 'setup',
      relativePath: 'scripts/seed-orders.cjs',
      contentHash: 'a'.repeat(64),
    })).rejects.toThrow('脚本信任记录无效');
  });
});
