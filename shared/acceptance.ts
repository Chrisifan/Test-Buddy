export type AcceptanceTargetKind = 'localFixture' | 'staging' | 'model';
export type AcceptanceTerminalStatus = 'passed' | 'failed' | 'blocked' | 'error' | 'cancelled' | 'skipped';

export interface AcceptanceTarget {
  id: string;
  kind: AcceptanceTargetKind;
  /** A content hash of main/CI-owned target configuration, never an endpoint or secret reference. */
  configFingerprint: string;
  /** External lanes become release gates only when explicitly marked required. */
  requiredForRelease: boolean;
}

export interface AcceptanceMatrix {
  schemaVersion: 1;
  targets: readonly AcceptanceTarget[];
}

export interface AcceptanceChildRun {
  status: AcceptanceTerminalStatus;
  provenanceHash: string;
  manifestHashes: readonly string[];
}

export interface AcceptancePair {
  testCase: { id: string; version: number };
  desktop: AcceptanceChildRun;
  cli: AcceptanceChildRun;
}

export interface AcceptanceTerminalSummary {
  passed: number;
  failed: number;
  blocked: number;
  error: number;
  cancelled: number;
  skipped: number;
}

export interface AcceptanceAttempt {
  schemaVersion: 1;
  targetId: string;
  targetKind: AcceptanceTargetKind;
  targetConfigFingerprint: string;
  suite: { id: string; version: number };
  projectRevision: string;
  attempt: number;
  pairs: readonly AcceptancePair[];
  terminalSummary: AcceptanceTerminalSummary;
  retries: number;
  flaky: boolean;
  /** Human conclusion is deliberate and does not identify a person or include free-form incident text. */
  humanConclusion: 'accepted' | 'rejected' | 'notClaimed';
}

export type AcceptanceAttemptInput = Omit<AcceptanceAttempt, 'schemaVersion'>;

export interface AcceptanceLaneState {
  targetId: string;
  kind: AcceptanceTargetKind;
  status: 'passed' | 'failed' | 'incomplete' | 'notRun';
}

export interface ReleaseGateDecision {
  status: 'blocked' | 'readyForLocalReleaseClaim' | 'readyForReleaseClaim';
  reasons: readonly string[];
  passedPairs: number;
  stableAttempts: number;
  laneStates: readonly AcceptanceLaneState[];
}

const acceptanceStatuses: readonly AcceptanceTerminalStatus[] = ['passed', 'failed', 'blocked', 'error', 'cancelled', 'skipped'];
const hashPattern = /^[a-f0-9]{64}$/;
const unsafeTextPattern = /(?:\bsk-[a-z0-9_-]+|\bapi[_-]?key\b|\bauthorization\b|\bstorage\s*state\b|\braw\s*prompt\b|(?:^|[\s:=])\/[\w./-]+)/i;

/** Creates a frozen, redacted acceptance record only after enforcing the complete pair contract. */
export const createAcceptanceAttempt = (input: AcceptanceAttemptInput): AcceptanceAttempt => {
  validateAttemptInput(input);
  return deepFreeze({
    schemaVersion: 1 as const,
    targetId: input.targetId,
    targetKind: input.targetKind,
    targetConfigFingerprint: input.targetConfigFingerprint,
    suite: { id: input.suite.id, version: input.suite.version },
    projectRevision: input.projectRevision,
    attempt: input.attempt,
    pairs: input.pairs.map((pair) => ({
      testCase: { id: pair.testCase.id, version: pair.testCase.version },
      desktop: cloneChildRun(pair.desktop),
      cli: cloneChildRun(pair.cli),
    })),
    terminalSummary: { ...input.terminalSummary },
    retries: input.retries,
    flaky: input.flaky,
    humanConclusion: input.humanConclusion,
  });
};

/** Converts immutable acceptance attempts into a release assertion without inferring missing external work. */
export const evaluateReleaseGate = (
  matrix: AcceptanceMatrix,
  attempts: readonly AcceptanceAttempt[],
): ReleaseGateDecision => {
  validateMatrix(matrix);
  const reasons: string[] = [];
  const laneStates = matrix.targets.map((target) => {
    const targetAttempts = attempts.filter((attempt) => attempt.targetId === target.id);
    const lane = assessLane(target, targetAttempts);
    if (target.kind === 'localFixture' && lane.status !== 'passed') {
      reasons.push(laneReason(target.kind, lane.status));
    } else if (target.requiredForRelease && lane.status !== 'passed') {
      reasons.push(laneReason(target.kind, lane.status));
    }
    return lane;
  });
  const local = laneStates.find((lane) => lane.kind === 'localFixture');
  const hasRequiredExternalLane = matrix.targets.some((target) => target.kind !== 'localFixture' && target.requiredForRelease);
  const status: ReleaseGateDecision['status'] = reasons.length
    ? 'blocked'
    : hasRequiredExternalLane
      ? 'readyForReleaseClaim'
      : 'readyForLocalReleaseClaim';
  return deepFreeze({
    status,
    reasons: [...new Set(reasons)].sort(),
    passedPairs: local?.status === 'passed' ? 20 : 0,
    stableAttempts: local?.status === 'passed' ? 10 : 0,
    laneStates,
  });
};

const assessLane = (target: AcceptanceTarget, attempts: readonly AcceptanceAttempt[]): AcceptanceLaneState => {
  const base = { targetId: target.id, kind: target.kind } as const;
  if (!attempts.length) {
    return { ...base, status: 'notRun' };
  }
  if (attempts.some((attempt) => (
    attempt.targetKind !== target.kind ||
    attempt.targetConfigFingerprint !== target.configFingerprint
  ))) {
    return { ...base, status: 'failed' };
  }
  const requiredAttempts = new Set(attempts.map((attempt) => attempt.attempt));
  if (attempts.length !== 10 || requiredAttempts.size !== 10 || !Array.from({ length: 10 }, (_, index) => requiredAttempts.has(index + 1)).every(Boolean)) {
    return { ...base, status: 'incomplete' };
  }
  if (attempts.some((attempt) => !isPassingStableAttempt(attempt))) {
    return { ...base, status: 'failed' };
  }
  return { ...base, status: 'passed' };
};

const isPassingStableAttempt = (attempt: AcceptanceAttempt): boolean => {
  return attempt.pairs.length === 20 &&
    attempt.pairs.every(pairPassedAndMatched) &&
    attempt.terminalSummary.passed === 20 &&
    attempt.terminalSummary.failed === 0 &&
    attempt.terminalSummary.blocked === 0 &&
    attempt.terminalSummary.error === 0 &&
    attempt.terminalSummary.cancelled === 0 &&
    attempt.terminalSummary.skipped === 0 &&
    attempt.retries === 0 &&
    !attempt.flaky &&
    attempt.humanConclusion === 'accepted';
};

const laneReason = (kind: AcceptanceTargetKind, status: AcceptanceLaneState['status']): string => {
  const prefix = kind === 'localFixture' ? 'localFixture' : kind;
  if (status === 'notRun') {
    return `${prefix}AcceptanceNotRun`;
  }
  if (status === 'incomplete') {
    return `${prefix}AcceptanceIncomplete`;
  }
  return `${prefix}AcceptanceFailed`;
};

const validateMatrix = (matrix: AcceptanceMatrix): void => {
  if (!hasExactKeys(matrix, ['schemaVersion', 'targets']) || matrix.schemaVersion !== 1 || !Array.isArray(matrix.targets) || !matrix.targets.length) {
    throw new Error('Acceptance matrix is invalid.');
  }
  const ids = new Set<string>();
  let localTargets = 0;
  for (const target of matrix.targets) {
    validateTarget(target);
    if (ids.has(target.id)) {
      throw new Error('Acceptance matrix target IDs must be unique.');
    }
    ids.add(target.id);
    if (target.kind === 'localFixture') {
      localTargets += 1;
    }
  }
  if (localTargets !== 1) {
    throw new Error('Acceptance matrix requires exactly one local fixture target.');
  }
};

const validateAttemptInput = (input: AcceptanceAttemptInput): void => {
  if (!hasExactKeys(input, [
    'targetId', 'targetKind', 'targetConfigFingerprint', 'suite', 'projectRevision', 'attempt', 'pairs',
    'terminalSummary', 'retries', 'flaky', 'humanConclusion',
  ])) {
    throw new Error('Acceptance attempt is invalid.');
  }
  validateTarget({
    id: input.targetId,
    kind: input.targetKind,
    configFingerprint: input.targetConfigFingerprint,
    requiredForRelease: true,
  });
  if (!hasExactKeys(input.suite, ['id', 'version']) || !validIdentifier(input.suite.id) || !validVersion(input.suite.version) || !isHash(input.projectRevision) || !validVersion(input.attempt)) {
    throw new Error('Acceptance attempt must carry exact versioned Suite and project references.');
  }
  if (!Array.isArray(input.pairs) || input.pairs.length !== 20) {
    throw new Error('Acceptance attempt requires exactly twenty desktop/CLI pairs.');
  }
  const caseReferences = new Set<string>();
  input.pairs.forEach((pair) => {
    if (!hasExactKeys(pair, ['testCase', 'desktop', 'cli']) || !hasExactKeys(pair.testCase, ['id', 'version']) || !validIdentifier(pair.testCase.id) || !validVersion(pair.testCase.version)) {
      throw new Error('Acceptance pair has an invalid Case reference.');
    }
    const validatedPair = pair as unknown as AcceptancePair;
    const caseReference = `${validatedPair.testCase.id}@${validatedPair.testCase.version}`;
    if (caseReferences.has(caseReference)) {
      throw new Error('Acceptance pairs must contain exact distinct Case references.');
    }
    caseReferences.add(caseReference);
    validateChildRun(validatedPair.desktop);
    validateChildRun(validatedPair.cli);
    if (!pairPassedAndMatched(validatedPair) && (validatedPair.desktop.status === 'passed' || validatedPair.cli.status === 'passed')) {
      throw new Error('Acceptance desktop/CLI pair evidence does not match.');
    }
  });
  validateTerminalSummary(input.terminalSummary);
  if (!Number.isSafeInteger(input.retries) || input.retries < 0 || typeof input.flaky !== 'boolean' || !['accepted', 'rejected', 'notClaimed'].includes(input.humanConclusion)) {
    throw new Error('Acceptance retry, flaky, or human conclusion metadata is invalid.');
  }
  if (containsUnsafeText(input)) {
    throw new Error('Acceptance records must be redacted and cannot contain unsafe text.');
  }
};

const validateTarget = (target: AcceptanceTarget): void => {
  if (!hasExactKeys(target, ['id', 'kind', 'configFingerprint', 'requiredForRelease']) || !validIdentifier(target.id) || !['localFixture', 'staging', 'model'].includes(target.kind) || !isHash(target.configFingerprint) || typeof target.requiredForRelease !== 'boolean') {
    throw new Error('Acceptance target is invalid.');
  }
};

const validateChildRun = (run: AcceptanceChildRun): void => {
  if (!hasExactKeys(run, ['status', 'provenanceHash', 'manifestHashes']) || !acceptanceStatuses.includes(run.status) || !isHash(run.provenanceHash) || !Array.isArray(run.manifestHashes) || !run.manifestHashes.length || !run.manifestHashes.every(isHash)) {
    throw new Error('Acceptance child run must include terminal provenance and manifest evidence hashes.');
  }
};

const validateTerminalSummary = (summary: AcceptanceTerminalSummary): void => {
  const names = ['passed', 'failed', 'blocked', 'error', 'cancelled', 'skipped'];
  if (!hasExactKeys(summary, names) || names.some((name) => !Number.isSafeInteger(summary[name as keyof AcceptanceTerminalSummary]) || summary[name as keyof AcceptanceTerminalSummary] < 0)) {
    throw new Error('Acceptance terminal summary is invalid or contains unredacted fields.');
  }
};

const pairPassedAndMatched = (pair: AcceptancePair): boolean => {
  return pair.desktop.status === 'passed' &&
    pair.cli.status === 'passed' &&
    pair.desktop.provenanceHash === pair.cli.provenanceHash &&
    sameHashes(pair.desktop.manifestHashes, pair.cli.manifestHashes);
};

const sameHashes = (left: readonly string[], right: readonly string[]): boolean => {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
};

const cloneChildRun = (run: AcceptanceChildRun): AcceptanceChildRun => {
  return { status: run.status, provenanceHash: run.provenanceHash, manifestHashes: [...run.manifestHashes].sort() };
};

const validIdentifier = (value: unknown): value is string => {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
};

const validVersion = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
};

const isHash = (value: unknown): value is string => {
  return typeof value === 'string' && hashPattern.test(value);
};

const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getOwnPropertyNames(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

const containsUnsafeText = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (typeof value === 'string') {
    return unsafeTextPattern.test(value);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  return Object.values(value as object).some((entry) => containsUnsafeText(entry, seen));
};

const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
};
