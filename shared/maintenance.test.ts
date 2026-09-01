import { describe, expect, it } from 'vitest';

import { createEmptyProject, createEmptyTestCase, createInitialStudioState, hydrateStudioState } from './studio.js';
import {
  analyzeMaintenanceImpact,
  createMaintenanceDraft,
  transitionMaintenanceDraft,
  validateMaintenanceDraft,
} from './maintenance.js';

describe('maintenance draft contract', () => {
  it('pins a material Case proposal to its exact source, evidence, and Suite impact', () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
      name: 'Sign in',
      steps: [{ id: 'step-sign-in', type: 'manual' as const, title: 'Sign in', body: 'Open the sign-in form.' }],
    };
    const suite = {
      ...project.suites[0]!,
      id: 'suite-smoke',
      version: 1,
      caseReferences: [{ id: source.id, version: source.version, dependsOn: [] }],
    };
    project.testCases = [source];
    project.suites = [suite];

    const draft = createMaintenanceDraft({
      id: 'maintenance-login-1',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: 1 },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: {
        ...source,
        steps: [{ ...source.steps[0]!, body: 'Click the exact #sign-in control.' }],
      },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: analyzeMaintenanceImpact(project, { kind: 'case', id: source.id, version: 1 }),
    });

    expect(validateMaintenanceDraft(draft)).toEqual([]);
    expect(draft).toMatchObject({
      id: 'maintenance-login-1',
      status: 'draft',
      target: { kind: 'case', id: 'case-login', version: 1 },
      candidate: { id: 'case-login', version: 1 },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [{ kind: 'suite', id: 'suite-smoke', version: 1 }],
      audit: [{ action: 'created', at: '2026-08-25T00:00:00.000Z' }],
    });
    expect(draft.diff.before).toContain('Open the sign-in form.');
    expect(draft.diff.after).toContain('Click the exact #sign-in control.');
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it('rejects empty candidate changes and terminal draft transitions', () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
      steps: [{ id: 'step-sign-in', type: 'manual' as const, title: 'Sign in', body: 'Open the form.' }],
    };

    expect(() => createMaintenanceDraft({
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: 1 },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: source,
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    })).toThrow(/material/i);

    const draft = createMaintenanceDraft({
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: 1 },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Use the verified sign-in route.' },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    });
    const accepted = transitionMaintenanceDraft(draft, 'accepted', '2026-08-25T00:01:00.000Z');

    expect(accepted.status).toBe('accepted');
    expect(accepted.audit).toEqual([
      expect.objectContaining({ action: 'created' }),
      { action: 'accepted', at: '2026-08-25T00:01:00.000Z' },
    ]);
    expect(() => transitionMaintenanceDraft(accepted, 'draft')).toThrow(/terminal/i);
  });

  it('requires an authorless rationale when rejecting a draft and keeps it in the append-only audit', () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
      steps: [{ id: 'step-login', type: 'manual' as const, title: 'Sign in', body: 'Open the form.' }],
    };
    const draft = createMaintenanceDraft({
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: 1 },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Use the verified sign-in route.' },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    });

    expect(() => transitionMaintenanceDraft(draft, 'rejected', '2026-08-25T00:01:00.000Z')).toThrow(/rationale/i);

    const transitionWithRationale = transitionMaintenanceDraft as unknown as (
      candidate: typeof draft,
      status: 'rejected',
      at: string,
      rationale: string,
    ) => typeof draft;
    const rejected = transitionWithRationale(
      draft,
      'rejected',
      '2026-08-25T00:01:00.000Z',
      'The cited failure does not reproduce in the pinned environment.',
    );

    expect(rejected.audit).toEqual([
      expect.objectContaining({ action: 'created' }),
      {
        action: 'rejected',
        at: '2026-08-25T00:01:00.000Z',
        rationale: 'The cited failure does not reproduce in the pinned environment.',
      },
    ]);
    expect(rejected.audit[1]).not.toHaveProperty('author');
  });

  it('rejects a diff whose supplied source is not the exact target Case version', () => {
    const project = createEmptyProject(1);
    const target = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
      steps: [{ id: 'step-login', type: 'manual' as const, title: 'Sign in', body: 'Open the form.' }],
    };
    const unrelatedSource = {
      ...target,
      id: 'case-checkout',
      steps: [{ ...target.steps[0]!, body: 'Open checkout.' }],
    };

    expect(() => createMaintenanceDraft({
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: target.id, version: 1 },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: unrelatedSource,
      proposedCase: { ...target, notes: 'Use the verified sign-in route.' },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    })).toThrow(/source/i);
  });

  it('omits malformed or legacy persisted maintenance entries during hydration', () => {
    const state = createInitialStudioState();
    const hydrated = hydrateStudioState({
      ...state,
      maintenanceDrafts: [
        { id: 'legacy-without-evidence', status: 'accepted' },
        null,
      ] as never,
    });

    expect(hydrated.maintenanceDrafts).toEqual([]);
  });

  it.each([
    ['a path-shaped upload reference', {
      kind: 'upload',
      locator: { selector: '#avatar', quality: 'acceptable' },
      fileRef: { kind: 'attachment', id: '/private/maintenance-upload' },
    }],
    ['an unknown action kind', { kind: 'unknown' }],
  ] as const)('rejects and omits a candidate containing %s', (_label, action) => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-maintenance-structural-validation',
      version: 1,
      steps: [{ id: 'step-source', type: 'manual' as const, title: 'Source', body: 'Open the form.' }],
    };
    const validDraft = createMaintenanceDraft({
      id: 'maintenance-structural-validation',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'A valid material change.' },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    });
    const candidate = {
      ...source,
      notes: 'A malformed action was proposed.',
      steps: [{
        id: 'step-malformed',
        type: 'ai' as const,
        title: 'Malformed action',
        body: 'Do not publish this.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Do not publish this.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action: action as never,
        },
      }],
    };
    const malformedDraft = {
      ...structuredClone(validDraft),
      candidate,
      diff: {
        ...validDraft.diff,
        after: canonicalJsonForTest(candidate),
      },
    };

    expect(validateMaintenanceDraft(malformedDraft)).toEqual([
      expect.objectContaining({ code: 'invalidCandidate' }),
    ]);
    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      maintenanceDrafts: [malformedDraft],
    });
    expect(hydrated.maintenanceDrafts).toEqual([]);
  });

  it.each([
    ['undeclared upload fields', {
      kind: 'upload',
      filePath: '/private/maintenance-action-field',
      locator: { selector: '#avatar', quality: 'acceptable', filePath: '/private/maintenance-locator-field' },
      fileRef: { kind: 'attachment', id: 'attachment-approved', filePath: '/private/maintenance-file-ref-field' },
    }],
    ['an undeclared network mock response field', {
      kind: 'networkMock',
      url: 'https://your-app.example.test/api/orders',
      method: 'GET',
      response: { status: 200, body: { orderId: 'order-1' }, filePath: '/private/maintenance-response-field' },
    }],
  ] as const)('does not create a draft with %s', (_label, action) => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-maintenance-lossless-action',
      version: 1,
      steps: [{ id: 'step-source', type: 'manual' as const, title: 'Source', body: 'Open the form.' }],
    };

    expect(() => createMaintenanceDraft({
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: {
        ...source,
        notes: 'Candidate with undeclared structured fields.',
        steps: [{
          id: 'step-lossless-action',
          type: 'ai' as const,
          title: 'Unsafe action',
          body: 'Do not persist this action.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Do not persist this action.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action: action as never,
          },
        }],
      },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    })).toThrow(/invalid maintenance draft/i);
  });

  it.each([
    ['a non-enumerable filePath', 'nonEnumerable'],
    ['an accessor getter', 'accessor'],
    ['an Object.create(null) prototype', 'nullPrototype'],
    ['a non-standard prototype', 'nonStandardPrototype'],
  ] as const)('rejects a raw proposed Case network mock body with %s before canonicalizing or cloning it', (_label, bodyVariant) => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-maintenance-raw-proposal',
      version: 1,
      steps: [{ id: 'step-source', type: 'manual' as const, title: 'Source', body: 'Open the form.' }],
    };
    const { action, getterReadCount } = malformedNetworkMockObjectAction(bodyVariant);

    expect(() => createMaintenanceDraft({
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: {
        ...source,
        notes: 'Candidate must remain raw until structural validation succeeds.',
        steps: [{
          id: 'step-malformed-network-mock-object',
          type: 'ai' as const,
          title: 'Malformed network mock',
          body: 'Do not serialize this action.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Do not serialize this action.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action: action as never,
          },
        }],
      } as never,
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    })).toThrow(/candidate/i);

    expect(getterReadCount()).toBe(0);
  });

  it('continues to create a draft from a well-formed raw network mock candidate', () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-maintenance-valid-network-mock',
      version: 1,
      steps: [{ id: 'step-source', type: 'manual' as const, title: 'Source', body: 'Open the form.' }],
    };
    const action = {
      kind: 'networkMock' as const,
      url: 'https://your-app.example.test/api/orders',
      method: 'GET' as const,
      response: { status: 200, body: { approved: true } },
    };

    const draft = createMaintenanceDraft({
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: {
        ...source,
        notes: 'Use the deterministic approved response.',
        steps: [{
          id: 'step-valid-network-mock',
          type: 'ai' as const,
          title: 'Mock approved response',
          body: 'Use the reviewed response.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Use the reviewed response.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action,
          },
        }],
      },
      evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'b'.repeat(64) }],
      impact: [],
    });

    expect(draft.candidate.steps[0]!.execution?.action).toEqual(action);
  });
});

type MalformedNetworkMockObjectVariant = 'nonEnumerable' | 'accessor' | 'nullPrototype' | 'nonStandardPrototype';

function malformedNetworkMockObjectAction(variant: MalformedNetworkMockObjectVariant) {
  let getterReads = 0;
  let body: object;
  if (variant === 'nullPrototype') {
    const nullPrototypeBody = Object.create(null) as Record<string, unknown>;
    nullPrototypeBody.approved = true;
    body = nullPrototypeBody;
  } else if (variant === 'nonStandardPrototype') {
    class NonStandardBody { approved = true; }
    body = new NonStandardBody();
  } else {
    body = { approved: true };
    if (variant === 'nonEnumerable') {
      Object.defineProperty(body, 'filePath', { value: '/private/raw-maintenance-file-path', enumerable: false });
    } else {
      Object.defineProperty(body, 'filePath', {
        enumerable: true,
        get() {
          getterReads += 1;
          throw new Error('raw maintenance accessor must not be evaluated');
        },
      });
    }
  }
  return {
    action: {
      kind: 'networkMock' as const,
      url: 'https://your-app.example.test/api/orders',
      method: 'GET' as const,
      response: { status: 200, body },
    },
    getterReadCount: () => getterReads,
  };
}

function canonicalJsonForTest(value: unknown): string {
  return JSON.stringify(sortForTest(value));
}

function sortForTest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForTest);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = sortForTest(entry);
      return result;
    }, {});
  }
  return value;
}
