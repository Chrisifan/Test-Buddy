import { describe, expect, it, vi } from 'vitest';

import type { FixtureAsset, ProjectEnvironment } from '../../shared/studio.js';
import { FixtureHttpExecutor, resolveFixtureHttpTarget } from './fixture-http-executor.js';

const environment: ProjectEnvironment = {
  id: 'env-staging',
  name: 'Staging',
  kind: 'staging',
  url: 'https://app.example.test/orders',
  entryPath: '/orders',
  browser: 'chromium',
  viewport: 'desktop',
  locale: 'zh-CN',
  headless: true,
};

const createFixture = (overrides: Partial<FixtureAsset> = {}): FixtureAsset => {
  return {
    schemaVersion: 1,
    id: 'fixture-orders',
    version: 3,
    name: '准备订单数据',
    description: '',
    inputs: [],
    outputs: [],
    credentialIds: [],
    environmentIds: [environment.id],
    setup: {
      mode: 'http',
      summary: '创建订单。',
      http: {
        method: 'POST',
        path: '/api/test-data/orders',
        expectedStatuses: [201],
        body: { kind: 'fixture' },
      },
    },
    cleanup: {
      mode: 'http',
      summary: '删除订单。',
      http: {
        method: 'DELETE',
        path: '/api/test-data/orders',
        expectedStatuses: [204],
      },
    },
    concurrency: 'exclusive',
    resourceLocks: ['orders'],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
};

describe('FixtureHttpExecutor', () => {
  it('executes only the declared same-origin path and records body-free evidence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"secret":"not-recorded"}', { status: 201 }));
    const executor = new FixtureHttpExecutor({ fetch });

    const result = await executor.execute({ fixture: createFixture(), lifecycle: 'setup', environment });

    expect(fetch).toHaveBeenCalledWith('https://app.example.test/api/test-data/orders', expect.objectContaining({
      method: 'POST',
      body: '{"kind":"fixture"}',
      credentials: 'omit',
    }));
    expect(result.evidence).toEqual(expect.objectContaining({
      fixtureId: 'fixture-orders',
      fixtureVersion: 3,
      lifecycle: 'setup',
      method: 'POST',
      path: '/api/test-data/orders',
      expectedStatuses: [201],
      outcome: 'passed',
      httpStatus: 201,
    }));
    expect(JSON.stringify(result.evidence)).not.toContain('not-recorded');
  });

  it('fails an unexpected HTTP status without reading the response body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ignored', { status: 409 }));
    const result = await new FixtureHttpExecutor({ fetch }).execute({ fixture: createFixture(), lifecycle: 'setup', environment });

    expect(result.evidence).toEqual(expect.objectContaining({ outcome: 'failed', httpStatus: 409 }));
  });

  it('keeps declared setup response outputs transient and out of lifecycle evidence', async () => {
    const fixture = createFixture({
      outputs: [{ name: 'orderId', type: 'string', required: true }],
      setup: {
        mode: 'http',
        summary: '创建订单。',
        http: {
          method: 'POST',
          path: '/api/test-data/orders',
          expectedStatuses: [201],
          responseOutputs: [{ outputName: 'orderId', jsonPointer: '/orderId' }],
        },
      },
    });
    const executor = new FixtureHttpExecutor({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"orderId":"order-from-fixture-response"}', { status: 201 })),
    });

    const result = await executor.execute({ fixture, lifecycle: 'setup', environment });

    expect(result.evidence).toEqual(expect.objectContaining({ outcome: 'passed', httpStatus: 201 }));
    expect(result.outputValues).toEqual({ orderId: 'order-from-fixture-response' });
    expect(JSON.stringify(result.evidence)).not.toContain('order-from-fixture-response');
    expect(JSON.stringify({ evidence: result.evidence, message: result.message })).not.toContain('order-from-fixture-response');
  });

  it('fails a setup lifecycle when a declared response output is missing or has the wrong type', async () => {
    const fixture = createFixture({
      outputs: [{ name: 'orderId', type: 'string', required: true }],
      setup: {
        mode: 'http',
        summary: '创建订单。',
        http: {
          method: 'POST',
          path: '/api/test-data/orders',
          expectedStatuses: [201],
          responseOutputs: [{ outputName: 'orderId', jsonPointer: '/orderId' }],
        },
      },
    });
    const executor = new FixtureHttpExecutor({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"orderId":42}', { status: 201 })),
    });

    const result = await executor.execute({ fixture, lifecycle: 'setup', environment });

    expect(result.evidence).toEqual(expect.objectContaining({ outcome: 'failed', httpStatus: 201 }));
    expect(result.outputValues).toBeUndefined();
    expect(result.message).not.toContain('42');
  });

  it('rejects cross-origin, malformed fixture paths before any network activity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = createFixture({
      setup: {
        mode: 'http',
        summary: 'unsafe',
        http: {
          method: 'POST',
          path: 'https://outside.example.test/seed',
          expectedStatuses: [200],
        },
      },
    });

    const result = await new FixtureHttpExecutor({ fetch }).execute({ fixture, lifecycle: 'setup', environment });

    expect(result.evidence.outcome).toBe('neutral');
    expect(fetch).not.toHaveBeenCalled();
    expect(resolveFixtureHttpTarget(environment, '/api/test-data/orders')).toHaveProperty('origin', 'https://app.example.test');
    expect(resolveFixtureHttpTarget(environment, '//outside.example.test/seed')).toBeUndefined();
    expect(resolveFixtureHttpTarget(environment, '/api/test-data/orders?token=unsafe')).toBeUndefined();
  });

  it('cancels an in-flight fixture request and reports a neutral lifecycle outcome', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const executor = new FixtureHttpExecutor({ fetch });
    const pending = executor.execute({ fixture: createFixture(), lifecycle: 'setup', environment, cancellationSignal: controller.signal });

    controller.abort();

    await expect(pending).resolves.toEqual(expect.objectContaining({
      evidence: expect.objectContaining({ outcome: 'neutral' }),
    }));
  });
});
