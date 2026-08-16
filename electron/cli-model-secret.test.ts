import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: undefined }));

import { createEmptyProject, createInitialStudioState } from '../shared/studio.js';
import { executeCliCommand } from './cli.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('TestBuddy CLI model secrets', () => {
  it('reports unavailable secure storage before it can migrate a legacy raw model key', async () => {
    const directory = await createTemporaryDirectory();
    const project = createEmptyProject(1);
    const state = createInitialStudioState() as ReturnType<typeof createInitialStudioState> & {
      midsceneConfig: ReturnType<typeof createInitialStudioState>['midsceneConfig'] & { modelApiKey: string };
    };
    state.projects = [project];
    state.midsceneConfig.modelApiKey = 'sk-live-cli';
    const statePath = path.join(directory, 'studio-data', 'state.json');
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8');

    await expect(executeCliCommand({
      kind: 'run',
      dataDir: directory,
      projectId: project.id,
      caseReferences: [],
    })).rejects.toThrow('本机安全存储不可用，无法保存模型密钥。');
    await expect(fs.readFile(statePath, 'utf8')).resolves.toContain('sk-live-cli');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-model-secret-'));
  temporaryDirectories.push(directory);
  return directory;
}
