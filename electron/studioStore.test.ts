import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createInitialStudioState } from '../shared/studio.js';
import { StudioStore } from './studioStore.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('StudioStore', () => {
  it('publishes state by renaming a sibling staging file', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const renameCalls: Array<{ source: string; destination: string }> = [];
    const store = new StudioStore(rootDirectory, {
      rename: async (source, destination) => {
        renameCalls.push({ source, destination });
        await fs.rename(source, destination);
      },
    });
    const state = createInitialStudioState();

    await store.save(state);

    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0]?.destination).toBe(store.storagePath);
    expect(path.dirname(renameCalls[0]?.source ?? '')).toBe(path.dirname(store.storagePath));
    await expect(store.loadExisting()).resolves.toEqual(state);
  });

  it('keeps the previous state file when publishing a replacement fails', async () => {
    const rootDirectory = await createTemporaryDirectory();
    const stableStore = new StudioStore(rootDirectory);
    const originalState = createInitialStudioState();
    await stableStore.save(originalState);
    const failingStore = new StudioStore(rootDirectory, {
      rename: async () => {
        throw new Error('injected publish failure');
      },
    });

    await expect(failingStore.save({ ...originalState, selectedProjectId: 'project-new' })).rejects.toThrow(
      'injected publish failure',
    );

    await expect(stableStore.loadExisting()).resolves.toEqual(originalState);
    await expect(fs.readdir(path.dirname(stableStore.storagePath))).resolves.not.toContain(
      expect.stringContaining('.state-staging-'),
    );
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-studio-store-'));
  temporaryDirectories.push(directory);
  return directory;
}
