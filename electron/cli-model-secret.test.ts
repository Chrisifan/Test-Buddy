import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: undefined }));

import { createEmptyProject, createInitialStudioState } from '../shared/studio.js';
import { executeCliCommand } from './cli.js';
import * as runtimeBundle from './runtime/runtime-bundle.js';

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

  it('reports unavailable secure storage when an Agent CLI run resolves an encrypted model key', async () => {
    const directory = await createTemporaryDirectory();
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    project.testCases = [{
      id: 'case-agent-secret',
      version: 1,
      kind: 'scenario',
      name: '需要模型密钥的用例',
      category: '回归',
      lastEdited: new Date(0).toISOString(),
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual',
      steps: [{ id: 'step-agent-secret', type: 'ai', title: '执行', body: '点击登录按钮' }],
    }];
    const state = createInitialStudioState();
    state.projects = [project];
    state.midsceneConfig = {
      ...state.midsceneConfig,
      modelBaseUrl: 'https://models.example.test/v1',
      modelSecret: { id: 'midscene', hasKey: true, updatedAt: '2026-08-20T00:00:00.000Z' },
      modelName: 'ui-agent-model',
      modelFamily: 'vlm-ui-tars',
    };
    await fs.mkdir(path.join(directory, 'studio-data', 'credentials'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'studio-data', 'credentials', 'model-secrets.json'),
      `${JSON.stringify([{
        ...state.midsceneConfig.modelSecret,
        encryptedValue: 'safe:ZW5jcnlwdGVkLW1vZGVsLWtleQ==',
      }])}\n`,
      'utf8',
    );
    const statePath = path.join(directory, 'studio-data', 'state.json');
    await fs.writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8');
    const runTestCase = vi.fn(async (request: { modelConfigResolver?: { resolveAgentProviderConfig: (role: 'planner') => Promise<unknown> } }) => {
      await request.modelConfigResolver?.resolveAgentProviderConfig('planner');
      throw new Error('expected model resolver to reject');
    });
    const createRuntimeBundle = vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase,
      browserRuntime: { getState: vi.fn(() => state.browserSession) },
      close: vi.fn(),
    } as never);

    try {
      const summary = await executeCliCommand({
        kind: 'run',
        dataDir: directory,
        projectId: project.id,
        caseReferences: [{ id: 'case-agent-secret', version: 1 }],
      });

      expect(runTestCase).toHaveBeenCalledOnce();
      expect(summary.results).toEqual([
        expect.objectContaining({
          status: 'error',
          failureReason: '本机安全存储不可用，无法解析模型密钥。',
        }),
      ]);
    } finally {
      createRuntimeBundle.mockRestore();
    }
  });
});

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-model-secret-'));
  temporaryDirectories.push(directory);
  return directory;
};
