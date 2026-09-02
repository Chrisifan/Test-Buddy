import { describe, expect, it } from 'vitest';

import type { TestStepDraft } from '../../shared/studio.js';
import {
  validateDeterministicPersistenceSurfaces,
  validateDeterministicStep,
  type DeterministicInteractionPreflightContext,
} from './deterministic-step-contract.js';

const locator = (selector: string) => ({ selector, quality: 'acceptable' as const });

const context: DeterministicInteractionPreflightContext = {
  baseUrl: 'https://app.example.test/workbench',
  allowedTabOrigins: ['https://app.example.test', 'https://docs.example.test'],
  allowedNetworkHosts: ['app.example.test', 'api.example.test'],
  allowedNetworkMethods: ['GET', 'POST'],
  uploadReferences: [
    { kind: 'attachment', id: 'attachment-avatar', byteCount: 512 },
    { kind: 'fixture', id: 'fixture-avatar', version: 2, byteCount: 1024 },
  ],
  knownSecrets: ['resolved-secret-value'],
};

const step = (action: NonNullable<TestStepDraft['execution']>['action']): TestStepDraft => {
  return {
    id: `step-${action.kind}`,
    type: 'ai',
    title: action.kind,
    body: 'Only the structured action is executable.',
    execution: {
      schemaVersion: 2,
      intent: 'Perform the reviewed deterministic interaction.',
      reviewStatus: 'confirmed',
      actionRisk: 'low',
      action,
    },
  };
};

describe('deterministic interaction preflight contract', () => {
  it.each([
    ['same-origin iframe', {
      kind: 'iframe',
      frame: { locator: locator('#payment-frame'), url: 'https://app.example.test/frames/payment' },
      locator: locator('#confirm'),
    }],
    ['allowlisted new tab', { kind: 'tab', url: 'https://docs.example.test/help' }],
    ['main-owned attachment upload', {
      kind: 'upload', locator: locator('#avatar'), fileRef: { kind: 'attachment', id: 'attachment-avatar' },
    }],
    ['managed download request', {
      kind: 'download', locator: locator('#download-report'), url: 'https://app.example.test/reports/latest.csv',
    }],
    ['hover', { kind: 'hover', locator: locator('#account-menu') }],
    ['drag', {
      kind: 'drag', source: locator('#card-a'), target: locator('#column-done'),
      sourcePosition: { x: 8, y: 8 }, targetPosition: { x: 16, y: 16 },
    }],
    ['clipboard sentinel', { kind: 'clipboard', locator: locator('#clipboard-target'), value: 'TEST_BUDDY_CLIPBOARD_SENTINEL' }],
    ['response observation', { kind: 'networkObserve', url: 'https://api.example.test/orders', method: 'GET' }],
    ['network mock', {
      kind: 'networkMock', url: 'https://api.example.test/orders', method: 'POST',
      response: { status: 201, contentType: 'application/json', body: { id: 'order-1', accepted: true } },
    }],
  ] as const)('allows %s with only structured payload fields', (_label, action) => {
    expect(validateDeterministicStep(step(action), context)).toEqual([]);
  });

  it.each([
    ['crossOriginIframe', {
      kind: 'iframe',
      frame: { locator: locator('#remote-frame'), url: 'https://outside.example.test/frame' },
      locator: locator('#confirm'),
    }],
    ['unapprovedUploadReference', {
      kind: 'upload', locator: locator('#avatar'), fileRef: { kind: 'attachment', id: 'attachment-not-selected' },
    }],
    ['untrustedDownload', {
      kind: 'download', locator: locator('#download'), url: 'https://outside.example.test/export.csv',
    }],
    ['unsupportedNetworkHost', {
      kind: 'networkMock', url: 'https://other.example.test/orders', method: 'POST', response: { status: 200, body: {} },
    }],
    ['unsupportedNetworkMethod', {
      kind: 'networkMock', url: 'https://api.example.test/orders', method: 'DELETE', response: { status: 200, body: {} },
    }],
    ['coordinateOutOfBounds', {
      kind: 'drag', source: locator('#card-a'), target: locator('#column-done'), sourcePosition: { x: -1, y: 8 },
    }],
    ['resolvedSecret', { kind: 'clipboard', locator: locator('#clipboard-target'), value: 'prefix-resolved-secret-value-suffix' }],
  ] as const)('blocks %s with the stable unsupported-action reason', (reason, action) => {
    expect(validateDeterministicStep(step(action), context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupportedAction', reason, message: expect.any(String) }),
    ]));
  });

  it('rejects a resolved secret before it reaches persisted step, log, artifact, maintenance, or report content', () => {
    expect(validateDeterministicPersistenceSurfaces({
      steps: [step({ kind: 'clipboard', locator: locator('#clipboard-target'), value: 'safe' })],
      logs: ['resolved-secret-value'],
      artifactLabels: ['proof: resolved-secret-value'],
      maintenance: [{ rationale: 'resolved-secret-value' }],
      reports: [{ summary: 'resolved-secret-value' }],
    }, context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupportedAction', reason: 'resolvedSecret', surface: 'log' }),
      expect.objectContaining({ code: 'unsupportedAction', reason: 'resolvedSecret', surface: 'artifactLabel' }),
      expect.objectContaining({ code: 'unsupportedAction', reason: 'resolvedSecret', surface: 'maintenance' }),
      expect.objectContaining({ code: 'unsupportedAction', reason: 'resolvedSecret', surface: 'report' }),
    ]));
  });

  it.each([
    ['an enumerable accessor', () => {
      let getterReads = 0;
      const value = { approved: true };
      Object.defineProperty(value, 'filePath', {
        enumerable: true,
        get() {
          getterReads += 1;
          throw new Error('persistence scanner must not evaluate accessors');
        },
      });
      return { value, getterReadCount: () => getterReads };
    }],
    ['a non-enumerable property', () => {
      const value = { approved: true };
      Object.defineProperty(value, 'filePath', { value: '/private/non-enumerable', enumerable: false });
      return { value, getterReadCount: () => 0 };
    }],
    ['a symbol property', () => {
      const value = { approved: true };
      Object.defineProperty(value, Symbol('persistence'), { value: '/private/symbol', enumerable: true });
      return { value, getterReadCount: () => 0 };
    }],
    ['a non-standard prototype', () => {
      class NonStandardValue { approved = true; }
      return { value: new NonStandardValue(), getterReadCount: () => 0 };
    }],
    ['a sparse array', () => {
      const value: string[] = ['approved'];
      value.length = 2;
      return { value, getterReadCount: () => 0 };
    }],
  ] as const)('blocks %s in a persistence surface without reading it', (_label, createUnsafeValue) => {
    const { value, getterReadCount } = createUnsafeValue();

    expect(validateDeterministicPersistenceSurfaces({ maintenance: [value] }, context)).toEqual([
      expect.objectContaining({ code: 'unsupportedAction', reason: 'resolvedSecret', surface: 'maintenance' }),
    ]);
    expect(getterReadCount()).toBe(0);
  });

  it('continues to detect known secrets in valid nested plain objects and arrays', () => {
    expect(validateDeterministicPersistenceSurfaces({
      maintenance: [{ nested: ['safe', { value: 'prefix-resolved-secret-value-suffix' }] }],
    }, context)).toEqual([
      expect.objectContaining({ code: 'unsupportedAction', reason: 'resolvedSecret', surface: 'maintenance' }),
    ]);
  });
});
