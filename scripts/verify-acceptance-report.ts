import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import {
  createAcceptanceAttempt,
  evaluateReleaseGate,
  type AcceptanceAttempt,
  type AcceptanceLaneState,
  type AcceptanceMatrix,
  type ReleaseGateDecision,
} from '../shared/acceptance.js';

export interface AcceptanceReportPayload {
  schemaVersion: 1;
  lane: 'localFixture' | 'staging' | 'model';
  matrix: AcceptanceMatrix;
  attempts: readonly AcceptanceAttempt[];
  decision: ReleaseGateDecision;
}

export interface AcceptanceReport extends AcceptanceReportPayload {
  reportHash: string;
}

const unsafeText = /(?:\bsk-[a-z0-9_-]+|\bapi[_-]?key\b|\bauthorization\b|\bstorage\s*state\b|\braw\s*prompt\b|(?:^|[\s:=])\/[\w./-]+)/i;
const hashPattern = /^[a-f0-9]{64}$/;

/** Hashes only canonically ordered, portable acceptance content. */
export const createAcceptanceReportHash = (payload: AcceptanceReportPayload): string => {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
};

/** Revalidates the contract, canonical content hash, and release decision before publication. */
export const verifyAcceptanceReport = async (reportPath: string): Promise<ReleaseGateDecision> => {
  const parsed = JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown;
  if (containsUnsafeText(parsed)) {
    throw new Error('Acceptance report contains unsafe or unredacted text.');
  }
  if (!hasExactKeys(parsed, ['schemaVersion', 'lane', 'matrix', 'attempts', 'decision', 'reportHash'])) {
    throw new Error('Acceptance report shape is invalid.');
  }
  const report = parsed as unknown as AcceptanceReport;
  if (report.schemaVersion !== 1 || !['localFixture', 'staging', 'model'].includes(report.lane) ||
    !report.matrix || !Array.isArray(report.attempts) || !isHash(report.reportHash)) {
    throw new Error('Acceptance report shape is invalid.');
  }
  const attempts = report.attempts.map((attempt) => {
    const candidate = attempt as unknown as AcceptanceAttempt;
    if (!hasExactKeys(candidate, [
      'schemaVersion', 'targetId', 'targetKind', 'targetConfigFingerprint', 'suite', 'projectRevision', 'attempt',
      'pairs', 'terminalSummary', 'retries', 'flaky', 'humanConclusion',
    ]) || candidate.schemaVersion !== 1) {
      throw new Error('Acceptance attempt shape is invalid.');
    }
    const { schemaVersion: _schemaVersion, ...input } = candidate;
    return createAcceptanceAttempt(input);
  });
  const payload: AcceptanceReportPayload = {
    schemaVersion: 1,
    lane: report.lane,
    matrix: report.matrix,
    attempts,
    decision: evaluateReleaseGate(report.matrix, attempts),
  };
  if (report.reportHash !== createAcceptanceReportHash(payload)) {
    throw new Error('Acceptance report hash does not match its canonical contents.');
  }
  validateDecisionShape(report.decision);
  if (JSON.stringify(report.decision) !== JSON.stringify(payload.decision)) {
    throw new Error('Acceptance report release decision does not match its validated attempts.');
  }
  return payload.decision;
};

const validateDecisionShape: (value: unknown) => asserts value is ReleaseGateDecision = (value) => {
  if (!hasExactKeys(value, ['status', 'reasons', 'passedPairs', 'stableAttempts', 'laneStates'])) {
    throw new Error('Acceptance report decision shape is invalid.');
  }
  const decision = value as unknown as ReleaseGateDecision;
  if (!['blocked', 'readyForLocalReleaseClaim', 'readyForReleaseClaim'].includes(decision.status) ||
    !Array.isArray(decision.reasons) || !decision.reasons.every((reason) => typeof reason === 'string') ||
    !validCount(decision.passedPairs) || !validCount(decision.stableAttempts) || !Array.isArray(decision.laneStates) ||
    !decision.laneStates.every((lane) => {
      if (!hasExactKeys(lane, ['targetId', 'kind', 'status'])) {
        return false;
      }
      const candidate = lane as unknown as AcceptanceLaneState;
      return typeof candidate.targetId === 'string' &&
        ['localFixture', 'staging', 'model'].includes(candidate.kind) &&
        ['passed', 'failed', 'incomplete', 'notRun'].includes(candidate.status);
    })) {
    throw new Error('Acceptance report decision shape is invalid.');
  }
};

const validCount = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
};

const isHash = (value: unknown): value is string => {
  return typeof value === 'string' && hashPattern.test(value);
};

const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getOwnPropertyNames(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

const canonicalJson = (value: unknown): string => {
  return JSON.stringify(canonicalize(value));
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

const containsUnsafeText = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (typeof value === 'string') {
    return unsafeText.test(value);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  return Object.values(value as Record<string, unknown>).some((child) => containsUnsafeText(child, seen));
};

const main = async (): Promise<void> => {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error('Usage: verify-acceptance-report <report.json>');
  }
  const decision = await verifyAcceptanceReport(reportPath);
  if (decision.status === 'blocked') {
    process.exitCode = 1;
  }
};

if (process.argv[1]?.endsWith('verify-acceptance-report.js')) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
