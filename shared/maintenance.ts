import { hasValidTestStepExecution, type ProjectDraft, type TestCaseDraft } from './studio.js';

export type MaintenanceDraftStatus = 'draft' | 'accepted' | 'rejected' | 'stale';

export interface MaintenanceCaseTarget {
  kind: 'case';
  id: string;
  version: number;
}

export interface MaintenanceEvidenceReference {
  runId: string;
  artifactId: string;
  contentHash: string;
}

export interface MaintenanceImpactReference {
  kind: 'suite';
  id: string;
  version: number;
}

export interface MaintenanceCandidateDiff {
  before: string;
  after: string;
}

export type MaintenanceAuditEntry =
  | {
    action: 'created' | 'accepted' | 'stale';
    at: string;
  }
  | {
    action: 'rejected';
    at: string;
    rationale: string;
  };

/** A review-only proposal. Publishing the candidate belongs to the main process. */
export interface MaintenanceDraft {
  schemaVersion: 1;
  id: string;
  projectId: string;
  projectRevision: string;
  target: MaintenanceCaseTarget;
  baseAssetHash: string;
  candidate: TestCaseDraft;
  diff: MaintenanceCandidateDiff;
  evidence: MaintenanceEvidenceReference[];
  impact: MaintenanceImpactReference[];
  status: MaintenanceDraftStatus;
  createdAt: string;
  audit: MaintenanceAuditEntry[];
}

export interface CreateMaintenanceDraftInput {
  id?: string;
  createdAt?: string;
  projectId: string;
  projectRevision: string;
  target: MaintenanceCaseTarget;
  baseAssetHash: string;
  /** Exact published Case used to calculate a reviewable, material diff. */
  sourceCase: TestCaseDraft;
  /** Complete replacement content that remains pinned to the source version. */
  proposedCase: TestCaseDraft;
  evidence: MaintenanceEvidenceReference[];
  impact: MaintenanceImpactReference[];
}

export interface MaintenanceValidationIssue {
  code:
    | 'invalidIdentity'
    | 'invalidTarget'
    | 'invalidRevision'
    | 'invalidCandidate'
    | 'emptyDiff'
    | 'invalidEvidence'
    | 'invalidImpact'
    | 'invalidAudit';
  message: string;
}

export function createMaintenanceDraft(input: CreateMaintenanceDraftInput): MaintenanceDraft {
  if (!isCandidateForTarget(input.sourceCase, input.target)) {
    throw new Error('Maintenance draft source must be the exact complete target Case version.');
  }
  if (!isCandidateForTarget(input.proposedCase, input.target)) {
    throw new Error('Invalid maintenance draft: Maintenance draft candidate must be the exact complete target Case version.');
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const before = canonicalJson(input.sourceCase);
  const after = canonicalJson(input.proposedCase);
  if (before === after) {
    throw new Error('Maintenance draft requires a material candidate diff.');
  }

  const draft: MaintenanceDraft = {
    schemaVersion: 1,
    id: input.id ?? `maintenance-${input.projectId}-${input.target.id}@${input.target.version}-${createdAt}`,
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    target: structuredClone(input.target),
    baseAssetHash: input.baseAssetHash,
    candidate: structuredClone(input.proposedCase),
    diff: { before, after },
    evidence: structuredClone(input.evidence),
    impact: structuredClone(input.impact),
    status: 'draft',
    createdAt,
    audit: [{ action: 'created', at: createdAt }],
  };
  const issues = validateDraft(draft, { expectedBefore: before });
  if (issues.length) {
    throw new Error(`Invalid maintenance draft: ${issues.map((issue) => issue.message).join(' ')}`);
  }
  return deepFreeze(draft);
}

export function validateMaintenanceDraft(draft: MaintenanceDraft): MaintenanceValidationIssue[] {
  return validateDraft(draft);
}

export function isMaintenanceDraft(value: unknown): value is MaintenanceDraft {
  return isRecord(value) && validateDraft(value as unknown as MaintenanceDraft).length === 0;
}

/** Drops malformed and duplicate persisted queue entries instead of reviving unsafe work. */
export function normalizeMaintenanceDrafts(value: unknown): MaintenanceDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = new Set<string>();
  return value.flatMap((candidate) => {
    if (!isMaintenanceDraft(candidate) || ids.has(candidate.id)) {
      return [];
    }
    ids.add(candidate.id);
    return [deepFreeze(structuredClone(candidate))];
  });
}

export function transitionMaintenanceDraft(
  draft: MaintenanceDraft,
  nextStatus: MaintenanceDraftStatus,
  at = new Date().toISOString(),
  rationale?: string,
): MaintenanceDraft {
  const issues = validateMaintenanceDraft(draft);
  if (issues.length) {
    throw new Error(`Invalid maintenance draft: ${issues.map((issue) => issue.message).join(' ')}`);
  }
  if (draft.status !== 'draft') {
    throw new Error(`Maintenance draft ${draft.id} is terminal and cannot transition again.`);
  }
  if (nextStatus === 'draft') {
    throw new Error('Maintenance draft must transition to a terminal status.');
  }
  if (nextStatus === 'rejected' && !isSafeMaintenanceRationale(rationale)) {
    throw new Error('Maintenance draft rejection requires a non-empty redacted rationale.');
  }
  return deepFreeze({
    ...structuredClone(draft),
    status: nextStatus,
    audit: [
      ...structuredClone(draft.audit),
      nextStatus === 'rejected'
        ? { action: nextStatus, at, rationale: rationale!.trim() }
        : { action: nextStatus, at },
    ],
  });
}

/** Rejects empty or obviously secret-bearing reviewer prose before it reaches durable audit history. */
export function isSafeMaintenanceRationale(value: unknown): value is string {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 1_000 &&
    !sensitiveRationalePattern.test(value);
}

/** Finds immutable Suite versions that directly pin the exact Case under review. */
export function analyzeMaintenanceImpact(
  project: Pick<ProjectDraft, 'suites'>,
  target: MaintenanceCaseTarget,
): MaintenanceImpactReference[] {
  const seen = new Set<string>();
  return project.suites.flatMap((suite) => {
    if (!suite.caseReferences.some((reference) => reference.id === target.id && reference.version === target.version)) {
      return [];
    }
    const key = `${suite.id}@${suite.version}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ kind: 'suite' as const, id: suite.id, version: suite.version }];
  });
}

function validateDraft(
  draft: MaintenanceDraft,
  options: { expectedBefore?: string } = {},
): MaintenanceValidationIssue[] {
  const issues: MaintenanceValidationIssue[] = [];
  if (!isRecord(draft) || draft.schemaVersion !== 1 || !nonEmptyString(draft.id) || !nonEmptyString(draft.projectId)) {
    issues.push({ code: 'invalidIdentity', message: 'Maintenance draft identity is invalid.' });
  }
  if (!nonEmptyString(draft?.projectRevision) || !isHash(draft.projectRevision)) {
    issues.push({ code: 'invalidRevision', message: 'Maintenance draft project revision is invalid.' });
  }
  if (!isCaseTarget(draft?.target) || !isHash(draft?.baseAssetHash)) {
    issues.push({ code: 'invalidTarget', message: 'Maintenance draft target or base asset hash is invalid.' });
  }
  if (!isCandidateForTarget(draft?.candidate, draft?.target)) {
    issues.push({ code: 'invalidCandidate', message: 'Maintenance draft candidate must be a complete replacement of the exact Case version.' });
  }
  if (
    !isRecord(draft?.diff) ||
    !nonEmptyString(draft.diff.before) ||
    !nonEmptyString(draft.diff.after) ||
    draft.diff.before === draft.diff.after ||
    (isCandidateForTarget(draft?.candidate, draft?.target) && draft.diff.after !== canonicalJson(draft.candidate)) ||
    (options.expectedBefore !== undefined && draft.diff.before !== options.expectedBefore)
  ) {
    issues.push({ code: 'emptyDiff', message: 'Maintenance draft diff must describe a material complete candidate change.' });
  }
  if (!Array.isArray(draft?.evidence) || !draft.evidence.length || !draft.evidence.every(isEvidenceReference)) {
    issues.push({ code: 'invalidEvidence', message: 'Maintenance draft must cite retained hash-verified evidence.' });
  }
  if (!Array.isArray(draft?.impact) || !draft.impact.every(isImpactReference) || hasDuplicateReferences(draft?.impact ?? [])) {
    issues.push({ code: 'invalidImpact', message: 'Maintenance draft impact references are invalid.' });
  }
  if (!isMaintenanceStatus(draft?.status) || !nonEmptyString(draft?.createdAt) || !isAuditForStatus(draft?.audit, draft?.status)) {
    issues.push({ code: 'invalidAudit', message: 'Maintenance draft audit history is invalid.' });
  }
  return issues;
}

function isCandidateForTarget(candidate: unknown, target: unknown): candidate is TestCaseDraft {
  if (!isRecord(candidate) || !isCaseTarget(target)) {
    return false;
  }
  if (candidate.id !== target.id || candidate.version !== target.version || candidate.schemaVersion !== 2) {
    return false;
  }
  if (!nonEmptyString(candidate.name) || !nonEmptyString(candidate.groupId) || !nonEmptyString(candidate.environmentId)) {
    return false;
  }
  if (!Array.isArray(candidate.steps) || !candidate.steps.length) {
    return false;
  }
  return candidate.steps.every((step) => (
    isRecord(step) &&
    nonEmptyString(step.id) &&
    nonEmptyString(step.title) &&
    nonEmptyString(step.body) &&
    isStepType(step.type) &&
    !Object.prototype.hasOwnProperty.call(step, 'preflightBlockReason') &&
    (step.execution === undefined || hasValidTestStepExecution(step.execution))
  ));
}

function isCaseTarget(value: unknown): value is MaintenanceCaseTarget {
  return isRecord(value) && value.kind === 'case' && nonEmptyString(value.id) && positiveInteger(value.version);
}

function isEvidenceReference(value: unknown): value is MaintenanceEvidenceReference {
  return isRecord(value) && nonEmptyString(value.runId) && nonEmptyString(value.artifactId) && isHash(value.contentHash);
}

function isImpactReference(value: unknown): value is MaintenanceImpactReference {
  return isRecord(value) && value.kind === 'suite' && nonEmptyString(value.id) && positiveInteger(value.version);
}

function isAuditForStatus(value: unknown, status: unknown): value is MaintenanceAuditEntry[] {
  if (!Array.isArray(value) || !value.length || !isMaintenanceStatus(status)) {
    return false;
  }
  if (!value.every(isAuditEntry)) {
    return false;
  }
  const actions = value.map((entry) => entry.action);
  if (actions[0] !== 'created') {
    return false;
  }
  if (status === 'draft') {
    return actions.length === 1;
  }
  return actions.length === 2 && actions[1] === status;
}

function isMaintenanceStatus(value: unknown): value is MaintenanceDraftStatus {
  return value === 'draft' || value === 'accepted' || value === 'rejected' || value === 'stale';
}

function isAuditAction(value: unknown): value is MaintenanceAuditEntry['action'] {
  return value === 'created' || value === 'accepted' || value === 'rejected' || value === 'stale';
}

function isAuditEntry(value: unknown): value is MaintenanceAuditEntry {
  if (!isRecord(value) || !nonEmptyString(value.at) || !isAuditAction(value.action)) {
    return false;
  }
  if (value.action === 'rejected') {
    return hasExactKeys(value, ['action', 'at', 'rationale']) && isSafeMaintenanceRationale(value.rationale);
  }
  return hasExactKeys(value, ['action', 'at']);
}

function isStepType(value: unknown): boolean {
  return value === 'ai' || value === 'aiAssert' || value === 'aiQuery' || value === 'recordingReplay' || value === 'manual';
}

function hasDuplicateReferences(references: MaintenanceImpactReference[]): boolean {
  const seen = new Set<string>();
  return references.some((reference) => {
    const key = `${reference.kind}:${reference.id}@${reference.version}`;
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
    return false;
  });
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (value[key] !== undefined) {
          result[key] = canonicalize(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
}

const sensitiveRationalePattern = /(?:\b(?:password|passwd|passcode|passphrase|pwd|pin|secret|token|cookie|authorization|bearer|api[-_ ]?key)\b\s*(?:[:=]|with)\s*\S+)|(?:\bsk-[A-Za-z0-9_-]+\b)|(?:\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/iu;
