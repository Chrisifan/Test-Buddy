import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { evaluateReleaseGate, type AcceptanceTarget } from '../../shared/acceptance.js';
import { AcceptanceHarness } from './acceptance-harness.js';
import * as acceptanceHarnessModule from './acceptance-harness.js';
import { createLocalAcceptanceFixture } from './acceptance-fixtures.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('AcceptanceHarness', () => {
  it('runs ten local desktop/CLI attempts against the same immutable suite and emits only canonical evidence', async () => {
    const fixture = createLocalAcceptanceFixture('http://127.0.0.1:43123');
    const target: AcceptanceTarget = {
      id: 'local-fixture',
      kind: 'localFixture',
      configFingerprint: hash('local-fixture-v1'),
      requiredForRelease: true,
    };
    const adapterRun = vi.fn(async ({ adapter, attempt }: { adapter: 'desktop' | 'cli'; attempt: number }) => ({
      projectRevision: fixture.revision,
      reproducibility: 'versioned' as const,
      suite: { id: fixture.suite.id, version: fixture.suite.version },
      members: fixture.project.testCases.map((testCase) => ({
        testCase: { id: testCase.id, version: testCase.version! },
        status: 'passed' as const,
        provenance: {
          projectRevision: fixture.revision,
          testCase: { id: testCase.id, version: testCase.version },
          adapter,
          attempt,
        },
        manifestHashes: [hash(`manifest-${testCase.id}`)],
      })),
    }));
    const harness = new AcceptanceHarness({
      runDesktop: (request) => adapterRun({ adapter: 'desktop', attempt: request.attempt }),
      runCli: (request) => adapterRun({ adapter: 'cli', attempt: request.attempt }),
    });

    const report = await harness.runLocalFixture({ target, fixture, repetitions: 10 });

    expect(adapterRun).toHaveBeenCalledTimes(20);
    expect(report.attempts).toHaveLength(10);
    expect(evaluateReleaseGate(report.matrix, report.attempts)).toMatchObject({
      status: 'readyForLocalReleaseClaim',
      passedPairs: 20,
      stableAttempts: 10,
    });
    expect(JSON.stringify(report)).not.toContain('127.0.0.1');
    expect(JSON.stringify(report)).not.toContain('/Users/');
  });

  it('rejects a legacy or adapter-mismatched execution before it becomes acceptance evidence', async () => {
    const fixture = createLocalAcceptanceFixture('http://127.0.0.1:43123');
    const target: AcceptanceTarget = {
      id: 'local-fixture', kind: 'localFixture', configFingerprint: hash('local-fixture-v1'), requiredForRelease: true,
    };
    const legacy = {
      projectRevision: fixture.revision,
      reproducibility: 'legacy' as const,
      suite: { id: fixture.suite.id, version: fixture.suite.version },
      members: [],
    };
    const harness = new AcceptanceHarness({ runDesktop: async () => legacy, runCli: async () => legacy });

    await expect(harness.runLocalFixture({ target, fixture, repetitions: 10 })).rejects.toThrow(/versioned/i);
  });

  it('does not start the desktop adapter until the CLI adapter settles for the same attempt', async () => {
    const fixture = createLocalAcceptanceFixture('http://127.0.0.1:43123');
    const target: AcceptanceTarget = {
      id: 'local-fixture', kind: 'localFixture', configFingerprint: hash('local-fixture-v1'), requiredForRelease: true,
    };
    const adapterRun = (adapter: 'desktop' | 'cli', attempt: number) => ({
      projectRevision: fixture.revision,
      reproducibility: 'versioned' as const,
      suite: { id: fixture.suite.id, version: fixture.suite.version },
      members: fixture.project.testCases.map((testCase) => ({
        testCase: { id: testCase.id, version: testCase.version! },
        status: 'passed' as const,
        provenance: { projectRevision: fixture.revision, testCase: { id: testCase.id, version: testCase.version }, adapter, attempt },
        manifestHashes: [hash(`manifest-${testCase.id}`)],
      })),
    });
    let releaseFirstCli: (() => void) | undefined;
    const firstCli = new Promise<void>((resolve) => { releaseFirstCli = resolve; });
    const cliStarted = vi.fn();
    const runCli = vi.fn(async ({ attempt }: { attempt: number }) => {
      cliStarted(attempt);
      if (attempt === 1) {
        await firstCli;
      }
      return adapterRun('cli', attempt);
    });
    const runDesktop = vi.fn(async ({ attempt }: { attempt: number }) => adapterRun('desktop', attempt));
    const harness = new AcceptanceHarness({ runDesktop, runCli });

    const pending = harness.runLocalFixture({ target, fixture, repetitions: 10 });
    await vi.waitFor(() => expect(cliStarted).toHaveBeenCalledWith(1));
    expect(runDesktop).not.toHaveBeenCalled();

    releaseFirstCli?.();
    await pending;
    expect(runDesktop).toHaveBeenCalledTimes(10);
  });

  it('treats provider metadata as equivalent when neither adapter configured a model key', async () => {
    const fixture = createLocalAcceptanceFixture('http://127.0.0.1:43123');
    const target: AcceptanceTarget = {
      id: 'local-fixture', kind: 'localFixture', configFingerprint: hash('local-fixture-v1'), requiredForRelease: true,
    };
    const adapterRun = (adapter: 'desktop' | 'cli', attempt: number) => ({
      projectRevision: fixture.revision,
      reproducibility: 'versioned' as const,
      suite: { id: fixture.suite.id, version: fixture.suite.version },
      members: fixture.project.testCases.map((testCase) => ({
        testCase: { id: testCase.id, version: testCase.version! },
        status: 'passed' as const,
        provenance: {
          projectRevision: fixture.revision,
          testCase: { id: testCase.id, version: testCase.version },
          executor: { appVersion: `test-buddy-${adapter}` },
          model: adapter === 'cli' ? { provider: 'midscene', hasKey: false } : { hasKey: false },
          attempt,
        },
        manifestHashes: [hash(`manifest-${testCase.id}`)],
      })),
    });
    const harness = new AcceptanceHarness({
      runDesktop: async ({ attempt }) => adapterRun('desktop', attempt),
      runCli: async ({ attempt }) => adapterRun('cli', attempt),
    });

    await expect(harness.runLocalFixture({ target, fixture, repetitions: 10 })).resolves.toMatchObject({
      attempts: expect.arrayContaining([expect.objectContaining({ attempt: 1 })]),
    });
  });

  it('runs the desktop adapter through the public desktop-main Suite boundary', async () => {
    const runDesktopAcceptanceAdapter = (acceptanceHarnessModule as unknown as {
      runDesktopAcceptanceAdapter?: (
        rootDir: string,
        fixture: ReturnType<typeof createLocalAcceptanceFixture>,
        attempt: number,
        executeSuite: (...args: never[]) => Promise<unknown>,
      ) => Promise<unknown>;
    }).runDesktopAcceptanceAdapter;
    expect(typeof runDesktopAcceptanceAdapter).toBe('function');
    if (!runDesktopAcceptanceAdapter) {
      return;
    }
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-desktop-boundary-'));
    const fixture = createLocalAcceptanceFixture('http://127.0.0.1:43123');
    const executeSuite = vi.fn(async () => ({
      detail: {
        caseDetails: fixture.suite.caseReferences.map((reference, index) => ({
          id: `desktop-run-${index}`,
          projectId: fixture.project.id,
          testCaseId: reference.id,
          testCaseVersion: reference.version,
          environmentId: fixture.environment.id,
          title: reference.id,
          status: 'passed',
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
          duration: '00:00:00',
          summary: 'Passed',
          logs: [],
          steps: [],
          artifacts: [{ manifest: { contentHash: hash(`manifest-${reference.id}`) } }],
          provenance: { projectRevision: fixture.revision, testCase: reference },
        })),
      },
    }));

    try {
      const result = await runDesktopAcceptanceAdapter(rootDir, fixture, 1, executeSuite as never) as {
        projectRevision: string;
        members: readonly unknown[];
      };

      expect(result).toMatchObject({ projectRevision: fixture.revision });
      expect(result.members).toHaveLength(20);
      expect(executeSuite).toHaveBeenCalledWith(expect.objectContaining({
        projectRepository: expect.any(Object),
      }), expect.objectContaining({
        projectId: fixture.project.id,
        expectedProjectRevision: fixture.revision,
        suite: { id: fixture.suite.id, version: fixture.suite.version },
      }));
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
