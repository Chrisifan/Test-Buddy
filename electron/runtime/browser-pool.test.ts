import { describe, expect, it, vi } from 'vitest';

import {
  BrowserPool,
  CONTROLLED_BROWSER_POOL_CAPACITY,
  createControlledChromiumBrowserPool,
} from './browser-pool.js';

type MockContext = {
  close: ReturnType<typeof vi.fn>;
};

function createContext(): MockContext {
  return { close: vi.fn().mockResolvedValue(undefined) };
}

function createPool(capacity = 2) {
  const contexts: MockContext[] = [];
  const closeBrowser = vi.fn().mockResolvedValue(undefined);
  const newContext = vi.fn(async () => {
    const context = createContext();
    contexts.push(context);
    return context;
  });
  return {
    contexts,
    closeBrowser,
    newContext,
    pool: new BrowserPool({
      capacity,
      createBrowser: async () => ({ newContext, close: closeBrowser }),
    }),
  };
}

const environment = {
  id: 'environment-staging',
  browser: 'chromium' as const,
  locale: 'zh-CN',
  viewport: 'desktop' as const,
  headless: true,
};

describe('BrowserPool', () => {
  it('lazily launches controlled Chromium workers and resolves storage state for the requesting project only', async () => {
    const context = createContext();
    const newContext = vi.fn().mockResolvedValue(context);
    const createBrowser = vi.fn(async () => ({ newContext }));
    const resolve = vi.fn(async (projectId: string, storageStateId: string) => ({
      serializedState: `private:${projectId}:${storageStateId}`,
    }));
    const pool = createControlledChromiumBrowserPool({
      createBrowser,
      storageStateResolver: { resolve },
    });

    expect(pool.maxConcurrency).toBe(CONTROLLED_BROWSER_POOL_CAPACITY);
    expect(createBrowser).not.toHaveBeenCalled();

    const lease = await pool.acquire({
      environment,
      projectId: 'project-orders',
      storageStateRef: 'storage-admin',
      locks: [],
    });

    expect(createBrowser).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('project-orders', 'storage-admin');
    expect(newContext).toHaveBeenCalledWith(expect.objectContaining({
      storageState: 'private:project-orders:storage-admin',
    }));
    await lease.release();
    await pool.close();
  });

  it('refuses to resolve a storage state without its requesting project ID', async () => {
    const resolve = vi.fn();
    const pool = createControlledChromiumBrowserPool({
      createBrowser: async () => ({ newContext: vi.fn() }),
      storageStateResolver: { resolve },
    });

    await expect(pool.acquire({ environment, storageStateRef: 'storage-admin', locks: [] })).rejects.toThrow(/project ID/i);
    expect(resolve).not.toHaveBeenCalled();
    await pool.close();
  });

  it('closes an injected worker browser exactly once even without any acquire', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const pool = new BrowserPool({ browser: { newContext: vi.fn(), close } });

    await pool.close();
    await pool.close();

    expect(close).toHaveBeenCalledOnce();
  });

  it('gives compatible leases separate fresh contexts while capacity permits', async () => {
    const { pool, contexts, newContext } = createPool(2);

    const [first, second] = await Promise.all([
      pool.acquire({ environment, storageStateRef: 'state-team-a', locks: [] }),
      pool.acquire({ environment, storageStateRef: 'state-team-a', locks: [] }),
    ]);

    expect(first.context).not.toBe(second.context);
    expect(contexts).toHaveLength(2);
    expect(newContext).toHaveBeenCalledTimes(2);

    await first.release();
    await second.close();
    contexts.forEach((context) => expect(context.close).toHaveBeenCalledTimes(1));
  });

  it('serializes incompatible storage state and overlapping locks', async () => {
    const { pool, newContext } = createPool(2);
    const storageLease = await pool.acquire({ environment, storageStateRef: 'state-team-a', locks: ['resource:orders'] });
    const incompatibleStorage = pool.acquire({ environment, storageStateRef: 'state-team-b', locks: ['resource:invoices'] });
    const overlappingLock = pool.acquire({ environment, storageStateRef: 'state-team-a', locks: ['resource:orders'] });

    await Promise.resolve();
    expect(newContext).toHaveBeenCalledTimes(1);

    await storageLease.release();
    const next = await incompatibleStorage;
    await Promise.resolve();
    expect(newContext).toHaveBeenCalledTimes(2);

    await next.release();
    const locked = await overlappingLock;
    expect(newContext).toHaveBeenCalledTimes(3);
    await locked.release();
  });

  it('holds queued compatible work until a capacity slot is released', async () => {
    const { pool, newContext } = createPool(2);
    const first = await pool.acquire({ environment, locks: [] });
    const second = await pool.acquire({ environment, locks: [] });
    const queued = pool.acquire({ environment, locks: [] });

    await Promise.resolve();
    expect(newContext).toHaveBeenCalledTimes(2);

    await first.release();
    const third = await queued;
    expect(newContext).toHaveBeenCalledTimes(3);

    await Promise.all([second.release(), third.release()]);
  });

  it('does not let a later compatible request bypass an older blocked request', async () => {
    const { pool, newContext } = createPool(2);
    const first = await pool.acquire({ environment, storageStateRef: 'state-team-a', locks: [] });
    const olderBlocked = pool.acquire({ environment, storageStateRef: 'state-team-b', locks: [] });
    const laterCompatible = pool.acquire({ environment, storageStateRef: 'state-team-a', locks: [] });
    let laterResolved = false;
    laterCompatible.then(() => {
      laterResolved = true;
    });

    await Promise.resolve();
    expect(newContext).toHaveBeenCalledTimes(1);
    expect(laterResolved).toBe(false);

    await first.release();
    const second = await olderBlocked;
    await Promise.resolve();
    expect(newContext).toHaveBeenCalledTimes(2);
    expect(laterResolved).toBe(false);

    await second.release();
    const third = await laterCompatible;
    expect(newContext).toHaveBeenCalledTimes(3);
    await third.release();
  });

  it('cancels waiting work without allocating or double-closing a lease', async () => {
    const { pool, contexts, newContext } = createPool(1);
    const lease = await pool.acquire({ environment, locks: [] });
    const controller = new AbortController();
    const waiting = pool.acquire({ environment, locks: [], signal: controller.signal });

    controller.abort();
    await expect(waiting).rejects.toThrow(/aborted/i);
    expect(newContext).toHaveBeenCalledTimes(1);

    await lease.release();
    await lease.close();
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
    expect(pool.activeLeaseCount).toBe(0);
  });

  it('closes a context once when cancellation wins while a context is being created', async () => {
    let resolveContext: (context: MockContext) => void = () => undefined;
    const contextPromise = new Promise<MockContext>((resolve) => {
      resolveContext = resolve;
    });
    const context = createContext();
    const newContext = vi.fn(() => contextPromise);
    const pool = new BrowserPool({ capacity: 1, createBrowser: async () => ({ newContext }) });
    const controller = new AbortController();

    const pending = pool.acquire({ environment, locks: [], signal: controller.signal });
    await vi.waitFor(() => expect(newContext).toHaveBeenCalledOnce());

    controller.abort();
    resolveContext(context);

    await expect(pending).rejects.toThrow(/aborted/i);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(pool.activeLeaseCount).toBe(0);
  });

  it('fails closed after an acquired context close failure', async () => {
    const { pool, contexts } = createPool(1);
    const first = await pool.acquire({ environment, locks: [] });
    const queued = pool.acquire({ environment, locks: [] });
    const rejectedQueued = expect(queued).rejects.toThrow('context close failed');
    contexts[0]!.close.mockRejectedValueOnce(new Error('context close failed'));

    await expect(first.release()).rejects.toThrow('context close failed');
    await rejectedQueued;
    expect(pool.activeLeaseCount).toBe(0);
  });

  it('still closes the worker browser after a context close failure', async () => {
    const { pool, contexts, closeBrowser } = createPool(1);
    await pool.acquire({ environment, locks: [] });
    contexts[0]!.close.mockRejectedValueOnce(new Error('context close failed'));

    await expect(pool.close()).rejects.toThrow('context close failed');

    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it('propagates a cleanup failure when the pool closes during context creation', async () => {
    let resolveContext: (context: MockContext) => void = () => undefined;
    const contextPromise = new Promise<MockContext>((resolve) => {
      resolveContext = resolve;
    });
    const context = createContext();
    context.close.mockRejectedValueOnce(new Error('in-flight context cleanup failed'));
    const newContext = vi.fn(() => contextPromise);
    const pool = new BrowserPool({ capacity: 1, createBrowser: async () => ({ newContext }) });

    const acquiring = pool.acquire({ environment, locks: [] });
    const rejectedAcquire = expect(acquiring).rejects.toThrow(/closed/i);
    await vi.waitFor(() => expect(newContext).toHaveBeenCalledOnce());
    const closing = pool.close();
    resolveContext(context);

    await rejectedAcquire;
    await expect(closing).rejects.toThrow('in-flight context cleanup failed');
    expect(context.close).toHaveBeenCalledOnce();
    expect(pool.activeLeaseCount).toBe(0);
  });

  it('fails closed when an aborted in-flight context cannot be cleaned up', async () => {
    let resolveContext: (context: MockContext) => void = () => undefined;
    const contextPromise = new Promise<MockContext>((resolve) => {
      resolveContext = resolve;
    });
    const context = createContext();
    context.close.mockRejectedValueOnce(new Error('aborted context cleanup failed'));
    const newContext = vi.fn(() => contextPromise);
    const pool = new BrowserPool({ capacity: 1, createBrowser: async () => ({ newContext }) });
    const controller = new AbortController();

    const acquiring = pool.acquire({ environment, locks: [], signal: controller.signal });
    const rejectedAcquire = expect(acquiring).rejects.toThrow(/aborted/i);
    await vi.waitFor(() => expect(newContext).toHaveBeenCalledOnce());
    controller.abort();
    resolveContext(context);

    await rejectedAcquire;
    await vi.waitFor(() => expect(context.close).toHaveBeenCalledOnce());
    await expect(pool.acquire({ environment, locks: [] })).rejects.toThrow('aborted context cleanup failed');
    expect(newContext).toHaveBeenCalledOnce();
    expect(pool.activeLeaseCount).toBe(0);
  });

  it('rejects and cleans up concurrent context creation after a peer cleanup failure', async () => {
    let resolveFirstContext: (context: MockContext) => void = () => undefined;
    let resolveSecondContext: (context: MockContext) => void = () => undefined;
    const firstContextPromise = new Promise<MockContext>((resolve) => {
      resolveFirstContext = resolve;
    });
    const secondContextPromise = new Promise<MockContext>((resolve) => {
      resolveSecondContext = resolve;
    });
    const firstContext = createContext();
    const secondContext = createContext();
    firstContext.close.mockRejectedValueOnce(new Error('first context cleanup failed'));
    const newContext = vi.fn()
      .mockImplementationOnce(() => firstContextPromise)
      .mockImplementationOnce(() => secondContextPromise);
    const pool = new BrowserPool({ capacity: 2, createBrowser: async () => ({ newContext }) });
    const controller = new AbortController();

    const first = pool.acquire({ environment, locks: [], signal: controller.signal });
    const second = pool.acquire({ environment, locks: [] });
    const firstRejected = expect(first).rejects.toThrow(/aborted/i);
    const secondRejected = expect(second).rejects.toThrow('first context cleanup failed');
    await vi.waitFor(() => expect(newContext).toHaveBeenCalledTimes(2));
    controller.abort();
    resolveFirstContext(firstContext);

    await firstRejected;
    await vi.waitFor(() => expect(firstContext.close).toHaveBeenCalledOnce());
    resolveSecondContext(secondContext);

    await secondRejected;
    expect(secondContext.close).toHaveBeenCalledOnce();
    expect(pool.activeLeaseCount).toBe(0);
    await expect(pool.acquire({ environment, locks: [] })).rejects.toThrow('first context cleanup failed');
  });

  it('rejects queued work and closes active contexts when the pool closes', async () => {
    const { pool, contexts } = createPool(1);
    const lease = await pool.acquire({ environment, locks: [] });
    const waiting = pool.acquire({ environment, locks: [] });

    await pool.close();

    await expect(waiting).rejects.toThrow(/closed/i);
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
    await lease.release();
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
  });
});
