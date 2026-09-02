import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const preloadPath = path.join(process.cwd(), 'electron', 'preload.cts');

const loadPreloadWithElectronMock = () => {
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
    throw new Error(`Unexpected preload dependency: ${moduleId}`);
  };

  new Function('require', 'module', 'exports', compiled)(require, preloadModule, preloadModule.exports);

  return source;
};

const loadRuntimeIpcChannels = () => {
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
};

describe('desktop preload runtime IPC contract', () => {
  it('loads in the Electron sandbox without relative preload dependencies', () => {
    expect(() => loadPreloadWithElectronMock()).not.toThrow();
  });

  it('invokes each exposed runtime API through the shared channel names', () => {
    const { runtimeIpcChannels } = loadRuntimeIpcChannels();
    const source = loadPreloadWithElectronMock();
    const desktopApi = exposeInMainWorld.mock.calls[0]![1] as Record<string, (...args: unknown[]) => unknown>;
    invoke.mockResolvedValue(undefined);

    desktopApi.getRuntimeInfo();
    desktopApi.runSuite({ projectId: 'project-1', suite: { id: 'suite-1', version: 3 }, expectedProjectRevision: 'a'.repeat(64) });
    desktopApi.runTestCase({ projectId: 'project-1', testCase: { id: 'case-1', version: 2 }, runId: 'run-case-1' });
    desktopApi.cancelRun('suite-1');
    desktopApi.loadRunDetail('run-1');
    desktopApi.planArtifactRetention();
    desktopApi.confirmArtifactRetention('retention-1');
    desktopApi.planHistoricalRerun('run-history-1');
    desktopApi.runHistoricalRerun('run-history-1');
    desktopApi.listMaintenanceDrafts();
    desktopApi.createMaintenanceDraft({
      runId: 'run-1',
      target: { kind: 'case', id: 'case-1', version: 2 },
      proposedCase: { id: 'case-1', version: 1 },
      citations: [{ artifactId: 'artifact-1', contentHash: 'a'.repeat(64) }],
    });
    desktopApi.acceptMaintenanceDraft({ draftId: 'maintenance-1', expectedRevision: 'b'.repeat(64) });
    desktopApi.rejectMaintenanceDraft({
      draftId: 'maintenance-1',
      rationale: 'The cited failure does not reproduce in the pinned environment.',
    });
    desktopApi.openMaintenanceEvidence({
      draftId: 'maintenance-1',
      citation: { runId: 'run-1', artifactId: 'artifact-1', contentHash: 'c'.repeat(64) },
    });
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
    expect(invoke).toHaveBeenNthCalledWith(6, runtimeIpcChannels.planArtifactRetention);
    expect(invoke).toHaveBeenNthCalledWith(7, runtimeIpcChannels.confirmArtifactRetention, 'retention-1');
    expect(invoke).toHaveBeenNthCalledWith(8, runtimeIpcChannels.planHistoricalRerun, 'run-history-1');
    expect(invoke).toHaveBeenNthCalledWith(9, runtimeIpcChannels.runHistoricalRerun, 'run-history-1');
    expect(invoke).toHaveBeenNthCalledWith(10, runtimeIpcChannels.listMaintenanceDrafts);
    expect(invoke).toHaveBeenNthCalledWith(11, runtimeIpcChannels.createMaintenanceDraft, {
      runId: 'run-1',
      target: { kind: 'case', id: 'case-1', version: 2 },
      proposedCase: { id: 'case-1', version: 1 },
      citations: [{ artifactId: 'artifact-1', contentHash: 'a'.repeat(64) }],
    });
    expect(invoke).toHaveBeenNthCalledWith(12, runtimeIpcChannels.acceptMaintenanceDraft, {
      draftId: 'maintenance-1',
      expectedRevision: 'b'.repeat(64),
    });
    expect(invoke).toHaveBeenNthCalledWith(13, runtimeIpcChannels.rejectMaintenanceDraft, {
      draftId: 'maintenance-1',
      rationale: 'The cited failure does not reproduce in the pinned environment.',
    });
    expect(invoke).toHaveBeenNthCalledWith(14, runtimeIpcChannels.openMaintenanceEvidence, {
      draftId: 'maintenance-1',
      citation: { runId: 'run-1', artifactId: 'artifact-1', contentHash: 'c'.repeat(64) },
    });
    expect(invoke).toHaveBeenNthCalledWith(15, runtimeIpcChannels.openArtifact, '/artifacts/run.html');
    expect(invoke).toHaveBeenNthCalledWith(16, runtimeIpcChannels.exportArtifact, '/artifacts/run.html');
    expect(invoke).toHaveBeenNthCalledWith(17, runtimeIpcChannels.attachManualEvidence);

    expect(source).not.toContain("require('./ipc/runtime-ipc-channels.cjs')");
  });

  it('restores serialized project revision errors with their code', async () => {
    const { runtimeIpcChannels } = loadRuntimeIpcChannels();
    loadPreloadWithElectronMock();
    const desktopApi = exposeInMainWorld.mock.calls[0]![1] as Record<string, (...args: unknown[]) => Promise<unknown>>;
    invoke.mockResolvedValueOnce({
      type: 'testBuddy.runtimeError',
      code: 'projectRevisionChanged',
      message: 'Project snapshot changed.',
    });

    await expect(desktopApi.runTestCase({
      projectId: 'project-1',
      testCase: { id: 'case-1', version: 2 },
      expectedProjectRevision: 'a'.repeat(64),
    })).rejects.toMatchObject({
      code: 'projectRevisionChanged',
      message: 'Project snapshot changed.',
    });

    expect(invoke).toHaveBeenCalledWith(runtimeIpcChannels.runTestCase, {
      projectId: 'project-1',
      testCase: { id: 'case-1', version: 2 },
      expectedProjectRevision: 'a'.repeat(64),
    });
  });

  it('restores serialized missing exact asset errors with their code', async () => {
    loadPreloadWithElectronMock();
    const desktopApi = exposeInMainWorld.mock.calls[0]![1] as Record<string, (...args: unknown[]) => Promise<unknown>>;
    invoke.mockResolvedValueOnce({
      type: 'testBuddy.runtimeError',
      code: 'missingAssetVersion',
      message: 'Case revision is unavailable.',
    });

    await expect(desktopApi.runTestCase({
      projectId: 'project-1',
      testCase: { id: 'case-1', version: 1 },
      expectedProjectRevision: 'a'.repeat(64),
    })).rejects.toMatchObject({
      code: 'missingAssetVersion',
      message: 'Case revision is unavailable.',
    });
  });

  it('uses narrow maintenance review request types at the preload boundary', () => {
    const source = fs.readFileSync(preloadPath, 'utf8');

    expect(source).toContain('MaintenanceDraftCreationRequest');
    expect(source).toContain('MaintenanceDraftAcceptanceRequest');
    expect(source).toContain('MaintenanceDraftRejectionRequest');
    expect(source).toContain('MaintenanceEvidenceOpenRequest');
    expect(source).toContain('createMaintenanceDraft: (request: MaintenanceDraftCreationRequest)');
    expect(source).toContain('acceptMaintenanceDraft: (request: MaintenanceDraftAcceptanceRequest)');
    expect(source).toContain('rejectMaintenanceDraft: (request: MaintenanceDraftRejectionRequest)');
    expect(source).toContain('openMaintenanceEvidence: (request: MaintenanceEvidenceOpenRequest)');
    expect(source).not.toContain('createMaintenanceDraft: (request: unknown)');
    expect(source).not.toContain('acceptMaintenanceDraft: (request: unknown)');
    expect(source).not.toContain('rejectMaintenanceDraft: (request: unknown)');
    expect(source).not.toContain('openMaintenanceEvidence: (request: unknown)');
  });

  it('sends model secret save and clear requests only through the desktop bridge', async () => {
    loadPreloadWithElectronMock();
    const desktopApi = exposeInMainWorld.mock.calls[0]![1] as Record<string, (...args: unknown[]) => Promise<unknown>>;
    invoke.mockResolvedValue({ id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' });

    await desktopApi.saveModelSecret({ scope: 'midscene', value: 'sk-preload-only' });
    await desktopApi.clearModelSecret({ scope: 'midscene' });

    expect(invoke).toHaveBeenNthCalledWith(1, 'runtime:save-model-secret', {
      scope: 'midscene',
      value: 'sk-preload-only',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'runtime:clear-model-secret', { scope: 'midscene' });
  });
});
