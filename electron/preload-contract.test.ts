import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const preloadPath = path.join(process.cwd(), 'electron', 'preload.cts');

function loadPreloadWithElectronMock() {
  exposeInMainWorld.mockReset();
  invoke.mockReset();
  const source = fs.readFileSync(preloadPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const preloadModule = { exports: {} };
  const require = (moduleId: string) => {
    if (moduleId === 'electron') {
      return {
        contextBridge: { exposeInMainWorld },
        ipcRenderer: { invoke },
      };
    }
    if (moduleId === './ipc/runtime-ipc-channels.cjs') {
      return loadRuntimeIpcChannels();
    }
    throw new Error(`Unexpected preload dependency: ${moduleId}`);
  };

  new Function('require', 'module', 'exports', compiled)(require, preloadModule, preloadModule.exports);

  return source;
}

function loadRuntimeIpcChannels() {
  const source = fs.readFileSync(path.join(process.cwd(), 'electron', 'ipc', 'runtime-ipc-channels.cts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const channelModule = { exports: {} as { runtimeIpcChannels?: Record<string, string> } };

  new Function('module', 'exports', compiled)(channelModule, channelModule.exports);

  return channelModule.exports as { runtimeIpcChannels: Record<string, string> };
}

describe('desktop preload runtime IPC contract', () => {
  it('invokes each exposed runtime API through the shared channel names', () => {
    const { runtimeIpcChannels } = loadRuntimeIpcChannels();
    const source = loadPreloadWithElectronMock();
    const desktopApi = exposeInMainWorld.mock.calls[0]![1] as Record<string, (...args: unknown[]) => unknown>;

    desktopApi.getRuntimeInfo();
    desktopApi.runSuite({ projectId: 'project-1', suite: { id: 'suite-1', version: 3 }, expectedProjectRevision: 'a'.repeat(64) });
    desktopApi.runTestCase({ projectId: 'project-1', testCase: { id: 'case-1', version: 2 }, runId: 'run-case-1' });
    desktopApi.cancelRun('suite-1');
    desktopApi.loadRunDetail('run-1');
    desktopApi.openArtifact('/artifacts/run.html');
    desktopApi.exportArtifact('/artifacts/run.html');
    desktopApi.attachManualEvidence();

    expect(invoke).toHaveBeenNthCalledWith(1, runtimeIpcChannels.getInfo);
    expect(invoke).toHaveBeenNthCalledWith(2, runtimeIpcChannels.runSuite, {
      projectId: 'project-1',
      suite: { id: 'suite-1', version: 3 },
      expectedProjectRevision: 'a'.repeat(64),
    });
    expect(invoke).toHaveBeenNthCalledWith(3, runtimeIpcChannels.runTestCase, {
      projectId: 'project-1',
      testCase: { id: 'case-1', version: 2 },
      runId: 'run-case-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(4, runtimeIpcChannels.cancelRun, 'suite-1');
    expect(invoke).toHaveBeenNthCalledWith(5, runtimeIpcChannels.loadRunDetail, 'run-1');
    expect(invoke).toHaveBeenNthCalledWith(6, runtimeIpcChannels.openArtifact, '/artifacts/run.html');
    expect(invoke).toHaveBeenNthCalledWith(7, runtimeIpcChannels.exportArtifact, '/artifacts/run.html');
    expect(invoke).toHaveBeenNthCalledWith(8, runtimeIpcChannels.attachManualEvidence);

    expect(source).toContain("require('./ipc/runtime-ipc-channels.cjs')");
    for (const channel of Object.values(runtimeIpcChannels)) {
      expect(source).not.toContain(`'${channel}'`);
    }
  });
});
