import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAcceptanceAttempt, type AcceptanceTarget } from '../shared/acceptance.js';
import { createLocalAcceptanceRunDirectory, runAcceptance, withLocalFixtureServer } from './run-acceptance.js';
import { verifyLatestAcceptanceReport } from './verify-latest-acceptance-report.js';

const directories: string[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const localReport = (target: AcceptanceTarget) => {
  const attempts = Array.from({ length: 10 }, (_, attemptIndex) => createAcceptanceAttempt({
    targetId: target.id,
    targetKind: target.kind,
    targetConfigFingerprint: target.configFingerprint,
    suite: { id: 'acceptance-suite-local', version: 1 },
    projectRevision: hash('project'),
    attempt: attemptIndex + 1,
    pairs: Array.from({ length: 20 }, (_, caseIndex) => ({
      testCase: { id: `acceptance-case-${String(caseIndex + 1).padStart(2, '0')}`, version: 1 },
      desktop: { status: 'passed' as const, provenanceHash: hash(`case-${caseIndex}`), manifestHashes: [hash(`manifest-${caseIndex}`)] },
      cli: { status: 'passed' as const, provenanceHash: hash(`case-${caseIndex}`), manifestHashes: [hash(`manifest-${caseIndex}`)] },
    })),
    terminalSummary: { passed: 20, failed: 0, blocked: 0, error: 0, cancelled: 0, skipped: 0 },
    retries: 0,
    flaky: false,
    humanConclusion: 'accepted',
  }));
  return { matrix: { schemaVersion: 1 as const, targets: [target] }, attempts };
};

describe('acceptance command', () => {
  it('keeps the local fixture server open until its adapters have settled', async () => {
    const close = vi.fn(async () => undefined);
    let finishAdapters: (() => void) | undefined;
    const adapters = new Promise<void>((resolve) => { finishAdapters = resolve; });
    const adapterStarted = vi.fn();

    const pending = withLocalFixtureServer(
      async () => ({ url: 'http://127.0.0.1:43123', close }),
      async () => {
        adapterStarted();
        await adapters;
        expect(close).not.toHaveBeenCalled();
        return 'complete';
      },
    );

    await vi.waitFor(() => expect(adapterStarted).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
    finishAdapters?.();
    await expect(pending).resolves.toBe('complete');
    expect(close).toHaveBeenCalledOnce();
  });

  it('creates isolated local run roots without deleting prior output', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-runs-'));
    directories.push(outputDir);
    const priorEvidence = path.join(outputDir, 'prior-evidence.txt');
    await fs.writeFile(priorEvidence, 'retain', 'utf8');

    const first = await createLocalAcceptanceRunDirectory(outputDir);
    const second = await createLocalAcceptanceRunDirectory(outputDir);

    expect(first).not.toBe(second);
    await expect(fs.readFile(priorEvidence, 'utf8')).resolves.toBe('retain');
    expect((await fs.stat(first)).isDirectory()).toBe(true);
    expect((await fs.stat(second)).isDirectory()).toBe(true);
    await expect(fs.readdir(first)).resolves.toEqual([]);
    await expect(fs.readdir(second)).resolves.toEqual([]);
  });

  it('writes a hash-verified local report without endpoints, paths, or secret values', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-report-'));
    directories.push(outputDir);
    const secret = 'sk-live-acceptance-must-not-persist';

    const result = await runAcceptance(['--lane', 'localFixture', '--output-dir', outputDir], { TEST_SECRET: secret }, {
      runLocalFixture: async (target) => localReport(target),
    });

    expect(result.decision).toMatchObject({ status: 'readyForLocalReleaseClaim', passedPairs: 20, stableAttempts: 10 });
    const report = await fs.readFile(result.files.json, 'utf8');
    expect(report).not.toContain(secret);
    expect(report).not.toContain(outputDir);
    expect(report).not.toContain('http://');
    await expect(fs.readFile(result.files.junit, 'utf8')).resolves.toContain('tests="200"');
  });

  it('retains each local acceptance report when the command is run repeatedly', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-report-retention-'));
    directories.push(outputDir);

    const first = await runAcceptance(['--lane', 'localFixture', '--output-dir', outputDir], {}, {
      runLocalFixture: async (target) => localReport(target),
    });
    const firstBytes = await fs.readFile(first.files.json);
    const second = await runAcceptance(['--lane', 'localFixture', '--output-dir', outputDir], {}, {
      runLocalFixture: async (target) => localReport(target),
    });

    expect(second.files.json).not.toBe(first.files.json);
    await expect(fs.readFile(first.files.json)).resolves.toEqual(firstBytes);
    await expect(fs.readFile(second.files.json)).resolves.toBeDefined();
  });

  it('verifies the newest complete retained report without using a fixed filename', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-verify-latest-'));
    directories.push(outputDir);
    const first = await runAcceptance(['--lane', 'localFixture', '--output-dir', outputDir], {}, {
      runLocalFixture: async (target) => localReport(target),
    });
    const second = await runAcceptance(['--lane', 'localFixture', '--output-dir', outputDir], {}, {
      runLocalFixture: async (target) => localReport(target),
    });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await fs.utimes(first.files.json, yesterday, yesterday);

    await expect(verifyLatestAcceptanceReport(outputDir)).resolves.toMatchObject({
      reportPath: second.files.json,
      decision: { status: 'readyForLocalReleaseClaim' },
    });
  });

  it('fails closed when no complete retained acceptance report exists', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-verify-empty-'));
    directories.push(outputDir);
    await fs.mkdir(path.join(outputDir, 'runs-incomplete'));

    await expect(verifyLatestAcceptanceReport(outputDir)).rejects.toThrow(/no complete/i);
  });

  it('refuses external lanes without explicit consent and an exact main-owned allowlist', async () => {
    await expect(runAcceptance(['--lane', 'model'], {}, {})).rejects.toThrow(/explicit consent/i);
    await expect(runAcceptance(['--lane', 'staging'], { TESTBUDDY_ACCEPTANCE_CONSENT: '1' }, {})).rejects.toThrow(/allowlist/i);
  });
});
