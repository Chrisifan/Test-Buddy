import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createEmptyProject,
  createEmptyTestCase,
  createInitialStudioState,
  type ArtifactManifestEntry,
  type RunDetail,
  type StudioState,
} from '../../shared/studio.js';
import { MaintenanceService } from './maintenance-service.js';

describe('MaintenanceService', () => {
  it('creates an evidence-backed review draft without writing project assets', async () => {
    const harness = createHarness();

    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Wait for the account menu before asserting.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });

    expect(draft).toMatchObject({
      projectId: harness.project.id,
      projectRevision: harness.revision,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      evidence: [{ runId: harness.run.id, artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
      status: 'draft',
    });
    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(harness.state.maintenanceDrafts).toEqual([draft]);
  });

  it.each([
    ['a non-enumerable filePath', 'nonEnumerable'],
    ['an accessor getter', 'accessor'],
    ['an Object.create(null) prototype', 'nullPrototype'],
    ['a non-standard prototype', 'nonStandardPrototype'],
  ] as const)('does not create a durable draft from a raw proposed Case network mock body containing %s', async (_label, bodyVariant) => {
    const harness = createHarness();
    const { action, getterWasRead } = malformedNetworkMockObjectAction(bodyVariant);

    await expect(harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: {
        ...harness.source,
        notes: 'Candidate must be structurally valid before it can become a draft.',
        steps: [{
          id: 'step-raw-malformed-network-mock-object',
          type: 'ai' as const,
          title: 'Malformed network mock',
          body: 'Do not persist this action.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Do not persist this action.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action: action as never,
          },
        }],
      } as never,
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    })).rejects.toThrow(/candidate/i);

    expect(getterWasRead()).toBe(false);
    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(harness.state.maintenanceDrafts).toEqual([]);
  });

  it('blocks an unsafe raw proposed Case before known-secret scanning can read its network mock accessor', async () => {
    const harness = createHarness(['resolved-secret-value']);
    const { action, getterWasRead } = malformedNetworkMockObjectAction('accessor');

    await expect(harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: {
        ...harness.source,
        notes: 'The generic persistence scan must not evaluate arbitrary properties.',
        steps: [{
          id: 'step-secret-scan-malformed-network-mock-object',
          type: 'ai' as const,
          title: 'Malformed network mock',
          body: 'Do not read this action.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Do not read this action.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action: action as never,
          },
        }],
      } as never,
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    })).rejects.toThrow(/secret/i);

    expect(getterWasRead()).toBe(false);
    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(harness.state.maintenanceDrafts).toEqual([]);
  });

  it('creates a durable draft from a well-formed raw network mock candidate', async () => {
    const harness = createHarness();
    const action = {
      kind: 'networkMock' as const,
      url: 'https://your-app.example.com/api/orders',
      method: 'GET' as const,
      response: { status: 200, body: { approved: true } },
    };

    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: {
        ...harness.source,
        notes: 'Use the reviewed deterministic response.',
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
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });

    expect(draft.candidate.steps[0]!.execution?.action).toEqual(action);
    expect(harness.state.maintenanceDrafts).toEqual([draft]);
  });

  it('rejects a main-known secret before a maintenance candidate can enter durable draft state', async () => {
    const secret = 'resolved-maintenance-secret';
    const harness = createHarness([secret]);

    await expect(harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: `candidate includes ${secret}` },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    })).rejects.toThrow(/secret/i);

    expect(harness.state.maintenanceDrafts).toEqual([]);
    expect(JSON.stringify(harness.state)).not.toContain(secret);
  });

  it('accepts an exact unchanged-base draft by publishing only Case@2 and appending an audit', async () => {
    const harness = createHarness();
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Wait for the account menu before asserting.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });

    const result = await harness.service.accept({ draftId: draft.id, expectedRevision: harness.revision });

    expect(result).toMatchObject({ status: 'accepted', published: { id: harness.source.id, version: 2 } });
    expect(harness.assetStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        testCases: [
          expect.objectContaining({ id: harness.source.id, version: 1 }),
          expect.objectContaining({ id: harness.source.id, version: 2, notes: 'Wait for the account menu before asserting.' }),
        ],
      }),
      harness.revision,
    );
    expect(harness.state.maintenanceDrafts).toEqual([
      expect.objectContaining({ status: 'accepted', audit: [
        expect.objectContaining({ action: 'created' }),
        expect.objectContaining({ action: 'accepted' }),
      ] }),
    ]);
  });

  it.each([
    ['candidate', (harness: ReturnType<typeof createHarness>, draftId: string, secret: string) => {
      harness.replaceDraft(draftId, (draft) => ({
        ...draft,
        candidate: { ...draft.candidate, notes: `candidate ${secret}` },
      }));
    }],
    ['audit rationale', (harness: ReturnType<typeof createHarness>, draftId: string, secret: string) => {
      harness.replaceDraft(draftId, (draft) => ({
        ...draft,
        audit: draft.audit.map((entry, index) => index === 0 ? { ...entry, rationale: `rationale ${secret}` } as never : entry),
      }));
    }],
    ['frozen source Case', (harness: ReturnType<typeof createHarness>, _draftId: string, secret: string) => {
      harness.snapshot.project.testCases[0]!.notes = `source ${secret}`;
    }],
  ] as const)('does not publish a pre-remediation persisted draft with a secret in its %s', async (_label, corrupt) => {
    const secret = 'resolved-persisted-maintenance-secret';
    const harness = createHarness([secret]);
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Safe candidate before persistence corruption.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });
    corrupt(harness, draft.id, secret);

    await expect(harness.service.accept({ draftId: draft.id, expectedRevision: harness.revision })).rejects.toThrow(/secret/i);

    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(harness.state.maintenanceDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'draft' })]);
  });

  it('does not publish a persisted draft with undeclared controlled action fields', async () => {
    const harness = createHarness();
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Safe candidate before structural corruption.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });
    const candidate = {
      ...draft.candidate,
      steps: [{
        id: 'step-malformed-maintenance-action',
        type: 'ai' as const,
        title: 'Malformed upload',
        body: 'Do not publish this.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Do not publish this.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action: {
            kind: 'upload',
            filePath: '/private/maintenance-action-field',
            locator: { selector: '#avatar', quality: 'acceptable', filePath: '/private/maintenance-locator-field' },
            fileRef: { kind: 'attachment', id: 'attachment-approved', filePath: '/private/maintenance-file-ref-field' },
          },
        },
      }],
    };
    harness.replaceDraft(draft.id, (persisted) => ({
      ...persisted,
      candidate,
      diff: { ...persisted.diff, after: JSON.stringify(sortObject(candidate)) },
    }));

    await expect(harness.service.accept({ draftId: draft.id, expectedRevision: harness.revision })).rejects.toThrow(/invalid/i);

    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.assetStore.save.mock.calls)).not.toContain('/private/maintenance-action-field');
    expect(harness.state.maintenanceDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'draft' })]);
  });

  it.each([
    ['a sparse array body', 'sparse'],
    ['an array body with an own filePath', 'ownProperty'],
    ['an array body with a symbol property', 'symbol'],
    ['an array body with a non-standard prototype', 'nonStandardPrototype'],
  ] as const)('does not publish a persisted draft with a network mock body containing %s', async (_label, bodyVariant) => {
    const harness = createHarness();
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Safe candidate before structural corruption.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });
    const { action, hiddenValue } = malformedNetworkMockAction(bodyVariant);
    const candidate = {
      ...draft.candidate,
      steps: [{
        id: 'step-malformed-network-mock-array',
        type: 'ai' as const,
        title: 'Malformed network mock',
        body: 'Do not publish this.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Do not publish this.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action,
        },
      }],
    };
    harness.replaceDraft(draft.id, (persisted) => ({
      ...persisted,
      candidate,
      diff: { ...persisted.diff, after: JSON.stringify(sortObject(candidate)) },
    }));
    harness.loadState.mockImplementation(async () => harness.state);

    await expect(harness.service.accept({ draftId: draft.id, expectedRevision: harness.revision })).rejects.toThrow(/invalid/i);

    expect(harness.assetStore.save).not.toHaveBeenCalled();
    if (hiddenValue) {
      expect(JSON.stringify(harness.assetStore.save.mock.calls)).not.toContain(hiddenValue);
    }
    expect(harness.state.maintenanceDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'draft' })]);
  });

  it.each([
    ['a non-enumerable filePath', 'nonEnumerable'],
    ['an accessor getter', 'accessor'],
    ['an Object.create(null) prototype', 'nullPrototype'],
    ['a non-standard prototype', 'nonStandardPrototype'],
  ] as const)('does not publish a persisted draft with a network mock body containing %s without reading it', async (_label, bodyVariant) => {
    const harness = createHarness();
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Safe candidate before structural corruption.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });
    const { action, hiddenValue, getterWasRead } = malformedNetworkMockObjectAction(bodyVariant);
    const candidate = {
      ...draft.candidate,
      steps: [{
        id: 'step-malformed-network-mock-object',
        type: 'ai' as const,
        title: 'Malformed network mock',
        body: 'Do not publish this.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Do not publish this.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action,
        },
      }],
    };
    harness.replaceDraft(draft.id, (persisted) => ({
      ...persisted,
      candidate,
      diff: {
        ...persisted.diff,
        after: bodyVariant === 'accessor'
          ? 'invalid-network-mock-object-candidate'
          : JSON.stringify(sortObject(candidate)),
      },
    }));
    harness.loadState.mockImplementation(async () => harness.state);

    await expect(harness.service.accept({ draftId: draft.id, expectedRevision: harness.revision })).rejects.toThrow(/invalid/i);

    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(getterWasRead()).toBe(false);
    if (hiddenValue) {
      expect(JSON.stringify(harness.assetStore.save.mock.calls)).not.toContain(hiddenValue);
    }
    expect(harness.state.maintenanceDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'draft' })]);
  });

  it.each([
    ['revision drift', (harness: ReturnType<typeof createHarness>) => {
      harness.repository.loadBound.mockRejectedValueOnce(new Error('project revision changed'));
    }],
    ['base asset change', (harness: ReturnType<typeof createHarness>) => {
      harness.repository.loadBound.mockResolvedValueOnce({
        ...harness.snapshot,
        project: {
          ...harness.project,
          testCases: [{ ...harness.source, notes: 'Asset was edited after analysis.' }],
        },
      });
    }],
  ])('marks a draft stale without writing assets after %s', async (_label, prepare) => {
    const harness = createHarness();
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Wait for the account menu before asserting.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });
    prepare(harness);

    const result = await harness.service.accept({ draftId: draft.id, expectedRevision: harness.revision });

    expect(result).toMatchObject({ status: 'stale' });
    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(harness.state.maintenanceDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'stale' })]);
  });

  it('rejects a draft with an explicit authorless rationale without writing a Case version', async () => {
    const harness = createHarness();
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Wait for the account menu before asserting.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });

    await expect(harness.service.reject({ draftId: draft.id, rationale: '   ' } as never)).rejects.toThrow(/rationale/i);
    const rejected = await harness.service.reject({
      draftId: draft.id,
      rationale: 'The cited failure does not reproduce in the pinned environment.',
    } as never);

    expect(rejected).toMatchObject({ status: 'rejected', audit: [
      expect.objectContaining({ action: 'created' }),
      {
        action: 'rejected',
        at: '2026-08-25T00:02:00.000Z',
        rationale: 'The cited failure does not reproduce in the pinned environment.',
      },
    ] });
    expect(harness.assetStore.save).not.toHaveBeenCalled();
    expect(harness.state.maintenanceDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'rejected' })]);
    expect(harness.state.maintenanceDrafts[0]!.audit[1]).not.toHaveProperty('author');
  });

  it('resolves only a draft citation that matches its exact retained manifest identity and a verified absolute path', async () => {
    const harness = createHarness();
    const draft = await harness.service.createFromRun({
      runId: harness.run.id,
      target: { kind: 'case', id: harness.source.id, version: 1 },
      proposedCase: { ...harness.source, notes: 'Wait for the account menu before asserting.' },
      citations: [{ artifactId: harness.artifact.id, contentHash: harness.artifact.contentHash }],
    });

    await expect(harness.service.openEvidence({
      draftId: draft.id,
      citation: {
        runId: harness.run.id,
        artifactId: harness.artifact.id,
        contentHash: harness.artifact.contentHash,
      },
    } as never)).resolves.toBe(harness.resolvedArtifactPath);
    expect(harness.resolveManifestEntryPath).toHaveBeenCalledWith(harness.artifact);
    await expect(harness.service.openEvidence({
      draftId: draft.id,
      citation: {
        runId: harness.run.id,
        artifactId: harness.artifact.id,
        contentHash: 'f'.repeat(64),
      },
    } as never)).rejects.toThrow(/citation/i);

    harness.resolveManifestEntryPath.mockResolvedValueOnce(undefined);
    await expect(harness.service.openEvidence({
      draftId: draft.id,
      citation: {
        runId: harness.run.id,
        artifactId: harness.artifact.id,
        contentHash: harness.artifact.contentHash,
      },
    } as never)).rejects.toThrow(/retained/i);
  });
});

function createHarness(knownSecrets: readonly string[] = []) {
  const project = createEmptyProject(1);
  const source = {
    ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
    id: 'case-login',
    version: 1,
    name: 'Sign in',
    steps: [{ id: 'step-sign-in', type: 'manual' as const, title: 'Sign in', body: 'Open the sign-in form.' }],
  };
  project.testCases = [source];
  const revision = 'c'.repeat(64);
  const snapshot = { project, revision, source: 'projectDirectory' as const, reproducibility: 'versioned' as const };
  const artifact: ArtifactManifestEntry = {
    id: 'artifact-sign-in',
    path: 'page-screenshots/sign-in.png',
    contentHash: 'a'.repeat(64),
    byteCount: 128,
    createdAt: '2026-08-25T00:00:00.000Z',
    ownerRunId: 'run-sign-in',
    evidenceKind: 'pageScreenshot',
    retentionClass: 'standard',
    protectedBy: [],
  };
  const run: RunDetail = {
    id: 'run-sign-in',
    projectId: project.id,
    testCaseId: source.id,
    environmentId: project.environments[0]!.id,
    title: source.name,
    status: 'failed',
    startedAt: '2026-08-25T00:00:00.000Z',
    endedAt: '2026-08-25T00:00:01.000Z',
    duration: '00:00:01',
    summary: 'Account menu did not appear.',
    logs: [],
    steps: [],
    artifacts: [],
    provenance: {
      schemaVersion: 1,
      projectId: project.id,
      projectRevision: revision,
      source: 'projectDirectory',
      reproducibility: 'versioned',
      testCase: { id: source.id, version: 1 },
      fixtures: [],
      reusableFlows: [],
      baselines: [],
      environment: { id: project.environments[0]!.id, name: project.environments[0]!.name, baseUrl: project.environments[0]!.url },
      browserProfile: { engine: 'chromium', headless: true },
      executor: { appVersion: 'test', runnerVersion: 'test' },
      model: { hasKey: false },
      createdAt: '2026-08-25T00:00:00.000Z',
    },
  };
  let state: StudioState = { ...createInitialStudioState(), projects: [project], runDetails: [run] };
  const repository = { loadBound: vi.fn(async () => structuredClone(snapshot)) };
  const assetStore = { save: vi.fn(async () => undefined) };
  const loadState = vi.fn(async () => structuredClone(state));
  const resolvedArtifactPath = '/managed-artifacts/page-screenshots/sign-in.png';
  const resolveManifestEntryPath = vi.fn(async (entry: ArtifactManifestEntry) => (
    entry.id === artifact.id ? resolvedArtifactPath : undefined
  ));
  const service = new MaintenanceService({
    projectRepository: repository,
    artifactManager: {
      findManifestEntry: vi.fn(async (id: string) => id === artifact.id ? structuredClone(artifact) : undefined),
      resolveManifestEntryPath,
    },
    assetStoreForProject: () => assetStore,
    loadState,
    updateState: async (updater) => {
      state = await updater(state);
      return structuredClone(state);
    },
    createId: () => 'maintenance-sign-in-1',
    now: () => new Date('2026-08-25T00:02:00.000Z'),
    hashCase: (testCase) => createHash('sha256').update(JSON.stringify(sortObject(testCase))).digest('hex'),
    getKnownSecrets: async () => knownSecrets,
  });

  return {
    service,
    project,
    source,
    revision,
    snapshot,
    artifact,
    resolvedArtifactPath,
    resolveManifestEntryPath,
    run,
    repository,
    assetStore,
    loadState,
    replaceDraft: (draftId: string, update: (draft: StudioState['maintenanceDrafts'][number]) => StudioState['maintenanceDrafts'][number]) => {
      state = {
        ...state,
        maintenanceDrafts: state.maintenanceDrafts.map((draft) => draft.id === draftId ? update(structuredClone(draft)) : draft),
      };
    },
    get state() { return state; },
  };
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      const candidate = (value as Record<string, unknown>)[key];
      if (candidate !== undefined) result[key] = sortObject(candidate);
      return result;
    }, {});
  }
  return value;
}

type MalformedNetworkMockBodyVariant = 'sparse' | 'ownProperty' | 'symbol' | 'nonStandardPrototype';

function malformedNetworkMockAction(variant: MalformedNetworkMockBodyVariant) {
  const body: unknown[] = ['approved'];
  let hiddenValue: string | undefined;
  if (variant === 'sparse') {
    body.length = 2;
  } else if (variant === 'ownProperty') {
    hiddenValue = '/private/network-mock-array-filePath';
    Object.defineProperty(body, 'filePath', { value: hiddenValue, enumerable: true });
  } else if (variant === 'symbol') {
    hiddenValue = 'network-mock-array-symbol-value';
    Object.defineProperty(body, Symbol('network-mock-body'), { value: hiddenValue, enumerable: true });
  } else {
    class NonStandardArray extends Array<unknown> {}
    return {
      action: {
        kind: 'networkMock' as const,
        url: 'https://your-app.example.com/api/orders',
        method: 'GET' as const,
        response: { status: 200, body: new NonStandardArray('approved') },
      },
      hiddenValue,
    };
  }
  return {
    action: {
      kind: 'networkMock' as const,
      url: 'https://your-app.example.com/api/orders',
      method: 'GET' as const,
      response: { status: 200, body },
    },
    hiddenValue,
  };
}

type MalformedNetworkMockObjectVariant = 'nonEnumerable' | 'accessor' | 'nullPrototype' | 'nonStandardPrototype';

function malformedNetworkMockObjectAction(variant: MalformedNetworkMockObjectVariant) {
  let getterRead = false;
  let hiddenValue: string | undefined;
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
      hiddenValue = '/private/network-mock-object-filePath';
      Object.defineProperty(body, 'filePath', { value: hiddenValue, enumerable: false });
    } else {
      Object.defineProperty(body, 'filePath', {
        enumerable: true,
        get() {
          getterRead = true;
          throw new Error('network mock accessor must not be evaluated');
        },
      });
    }
  }
  return {
    action: {
      kind: 'networkMock' as const,
      url: 'https://your-app.example.com/api/orders',
      method: 'GET' as const,
      response: { status: 200, body },
    },
    hiddenValue,
    getterWasRead: () => getterRead,
  };
}
