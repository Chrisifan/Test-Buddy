import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAcceptanceAttempt, evaluateReleaseGate } from '../shared/acceptance.js';
import { createAcceptanceReportHash, verifyAcceptanceReport } from './verify-acceptance-report.js';

const directories: string[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const reportContents = () => {
  const target = { id: 'local-fixture', kind: 'localFixture' as const, configFingerprint: hash('local'), requiredForRelease: true };
  const attempts = Array.from({ length: 10 }, (_, attemptIndex) => createAcceptanceAttempt({
    targetId: target.id, targetKind: target.kind, targetConfigFingerprint: target.configFingerprint,
    suite: { id: 'acceptance-suite-local', version: 1 }, projectRevision: hash('project'), attempt: attemptIndex + 1,
    pairs: Array.from({ length: 20 }, (_, index) => ({
      testCase: { id: `acceptance-case-${String(index + 1).padStart(2, '0')}`, version: 1 },
      desktop: { status: 'passed' as const, provenanceHash: hash(`case-${index}`), manifestHashes: [hash(`manifest-${index}`)] },
      cli: { status: 'passed' as const, provenanceHash: hash(`case-${index}`), manifestHashes: [hash(`manifest-${index}`)] },
    })),
    terminalSummary: { passed: 20, failed: 0, blocked: 0, error: 0, cancelled: 0, skipped: 0 }, retries: 0, flaky: false, humanConclusion: 'accepted',
  }));
  return { schemaVersion: 1, lane: 'localFixture', matrix: { schemaVersion: 1, targets: [target] }, attempts };
};

describe('acceptance report verifier', () => {
  it('recomputes the canonical report hash and rejects tampering or unsafe report text', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-verify-'));
    directories.push(directory);
    const content = reportContents();
    const payload = { ...content, decision: evaluateReleaseGate(content.matrix, content.attempts) };
    const report = { ...payload, reportHash: createAcceptanceReportHash(payload) };
    const reportPath = path.join(directory, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(report), 'utf8');

    await expect(verifyAcceptanceReport(reportPath)).resolves.toMatchObject({ status: 'readyForLocalReleaseClaim' });

    await fs.writeFile(reportPath, JSON.stringify({ ...report, unsafe: 'apiKey=sk-live /private/report.json' }), 'utf8');
    await expect(verifyAcceptanceReport(reportPath)).rejects.toThrow(/unsafe|redacted/i);
  });

  it('rejects an unknown benign-looking field even when its report hash is recomputed', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-acceptance-verify-'));
    directories.push(directory);
    const content = reportContents();
    const payload = {
      ...content,
      matrix: { ...content.matrix, annotation: 'internal-only' },
      decision: evaluateReleaseGate(content.matrix, content.attempts),
    };
    const report = { ...payload, reportHash: createAcceptanceReportHash(payload as never) };
    const reportPath = path.join(directory, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(report), 'utf8');

    await expect(verifyAcceptanceReport(reportPath)).rejects.toThrow(/matrix|shape|schema|unknown/i);
  });
});
