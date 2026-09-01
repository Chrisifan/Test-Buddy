import type { ProjectEnvironment } from '../../shared/studio.js';

/** The controlled production worker pool stays deliberately small by default. */
export const CONTROLLED_BROWSER_POOL_CAPACITY = 2;

export type BrowserPoolEnvironment = Pick<
  ProjectEnvironment,
  'id' | 'browser' | 'locale' | 'viewport' | 'headless'
>;

export interface BrowserPoolContext {
  close: () => Promise<unknown>;
}

export interface BrowserPoolBrowser {
  newContext: (options?: Record<string, unknown>) => Promise<BrowserPoolContext>;
  close?: () => Promise<unknown>;
}

export interface BrowserPoolAcquireRequest {
  environment: BrowserPoolEnvironment;
  /** Main-process project identity used to resolve a private storage state. */
  projectId?: string;
  /** Opaque main-process reference used for compatibility, never renderer state. */
  storageStateRef?: string;
  /** Fixture, credential, and resource lock keys required by this worker. */
  locks?: readonly string[];
  signal?: AbortSignal;
}

export interface BrowserPoolLease {
  context: BrowserPoolContext;
  release: () => Promise<void>;
  close: () => Promise<void>;
}

export interface BrowserPoolOptions {
  /** Maximum number of worker contexts reserved at once. Defaults to one. */
  capacity?: number;
  /** An already-launched worker browser. It is never the interactive BrowserRuntime browser. */
  browser?: BrowserPoolBrowser;
  /** Lazy main-process browser factory, allowing unit tests to inject a seam. */
  createBrowser?: () => Promise<BrowserPoolBrowser>;
  /** Resolves private context options, such as serialized storage state, in the main process. */
  createContextOptions?: (request: BrowserPoolAcquireRequest) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface BrowserPoolStorageStateResolver {
  resolve: (projectId: string, storageStateId: string) => Promise<{ serializedState: string }>;
}

export interface ControlledChromiumBrowserPoolOptions {
  capacity?: number;
  /** Main/CLI-owned resolver. Serialized state never leaves this process. */
  storageStateResolver?: BrowserPoolStorageStateResolver;
  /** Test seam for the lazy Chromium launcher. */
  createBrowser?: () => Promise<BrowserPoolBrowser>;
}

interface PendingAcquire {
  request: BrowserPoolAcquireRequest;
  resolve: (lease: BrowserPoolLease) => void;
  reject: (reason: Error) => void;
  settled: boolean;
  cancelled: boolean;
  removeAbortListener: () => void;
}

interface ActiveAcquire {
  pending: PendingAcquire;
  environmentKey: string;
  projectId?: string;
  storageStateRef?: string;
  locks: ReadonlySet<string>;
  context?: BrowserPoolContext;
  phase: 'creating' | 'leased';
  closing: boolean;
  creation: Promise<void>;
  closePromise?: Promise<void>;
}

/**
 * Owns worker-only Playwright contexts. It deliberately has no relationship
 * with BrowserRuntime's interactive browser/session state.
 */
export class BrowserPool {
  private readonly capacity: number;
  private readonly createContextOptions?: BrowserPoolOptions['createContextOptions'];
  private readonly createBrowser: () => Promise<BrowserPoolBrowser>;
  private readonly queued: PendingAcquire[] = [];
  private readonly active = new Set<ActiveAcquire>();
  private browserPromise: Promise<BrowserPoolBrowser> | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private cleanupFailure: Error | undefined;

  constructor(options: BrowserPoolOptions = {}) {
    this.capacity = clampCapacity(options.capacity ?? 1);
    this.createContextOptions = options.createContextOptions;
    this.createBrowser = options.browser
      ? async () => options.browser!
      : options.createBrowser ?? (() => Promise.reject(new Error('BrowserPool requires an injected browser or createBrowser factory.')));
    this.browserPromise = options.browser ? Promise.resolve(options.browser) : undefined;
  }

  get activeLeaseCount(): number {
    return this.active.size;
  }

  get maxConcurrency(): number {
    return this.capacity;
  }

  acquire(request: BrowserPoolAcquireRequest): Promise<BrowserPoolLease> {
    if (this.cleanupFailure) {
      return Promise.reject(this.cleanupFailure);
    }
    if (this.closed) {
      return Promise.reject(new Error('BrowserPool is closed.'));
    }
    if (request.signal?.aborted) {
      return Promise.reject(abortedError());
    }

    return new Promise<BrowserPoolLease>((resolve, reject) => {
      const pending: PendingAcquire = {
        request: { ...request, locks: uniqueLocks(request.locks) },
        resolve,
        reject,
        settled: false,
        cancelled: false,
        removeAbortListener: () => undefined,
      };
      const abort = () => this.cancel(pending);
      request.signal?.addEventListener('abort', abort, { once: true });
      pending.removeAbortListener = () => request.signal?.removeEventListener('abort', abort);
      this.queued.push(pending);
      this.drain();
    });
  }

  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closed = true;
    while (this.queued.length) {
      const pending = this.queued.shift()!;
      pending.cancelled = true;
      this.reject(pending, new Error('BrowserPool is closed.'));
    }

    this.closePromise = (async () => {
      const activeAtClose = Array.from(this.active);
      activeAtClose.forEach((active) => {
        active.closing = true;
        if (active.phase === 'creating') {
          this.reject(active.pending, new Error('BrowserPool is closed.'));
        }
      });
      const closeResults = await Promise.allSettled(activeAtClose.map((active) => active.phase === 'leased'
        ? this.closeActive(active)
        : active.creation));
      const browser = await this.browserPromise?.catch(() => undefined);
      let browserCloseError: unknown;
      if (browser?.close) {
        try {
          await browser.close();
        } catch (error) {
          browserCloseError = error;
        }
      }
      const closeFailure = closeResults.find((result) => result.status === 'rejected');
      if (closeFailure?.status === 'rejected') {
        throw closeFailure.reason;
      }
      if (browserCloseError) {
        throw browserCloseError;
      }
      if (this.cleanupFailure) {
        throw this.cleanupFailure;
      }
    })();
    return this.closePromise;
  }

  private drain(): void {
    if (this.closed) {
      return;
    }

    while (this.active.size < this.capacity) {
      // Strict FIFO prevents a compatible later request from starving an
      // earlier request blocked by an incompatible state or resource lock.
      const pending = this.queued[0];
      if (!pending) {
        return;
      }
      if (pending.cancelled) {
        this.queued.shift();
        continue;
      }
      if (!this.compatibleWithActive(pending.request)) {
        return;
      }
      this.queued.shift();
      const active = this.createActive(pending);
      this.active.add(active);
      active.creation = this.createLease(active);
    }
  }

  private createActive(pending: PendingAcquire): ActiveAcquire {
    return {
      pending,
      environmentKey: environmentKey(pending.request.environment),
      projectId: pending.request.projectId,
      storageStateRef: pending.request.storageStateRef,
      locks: new Set(pending.request.locks),
      phase: 'creating',
      closing: false,
      creation: Promise.resolve(),
    };
  }

  private async createLease(active: ActiveAcquire): Promise<void> {
    try {
      const browser = await this.getBrowser();
      if (this.closed || active.closing || active.pending.cancelled) {
        return;
      }
      const privateOptions = await this.createContextOptions?.(active.pending.request);
      if (this.closed || active.closing || active.pending.cancelled) {
        return;
      }
      const context = await browser.newContext({
        locale: active.pending.request.environment.locale,
        viewport: viewportFor(active.pending.request.environment.viewport),
        ...privateOptions,
      });
      active.context = context;
      if (this.closed || active.closing || active.pending.cancelled) {
        await this.closeContext(active);
        return;
      }

      active.phase = 'leased';
      active.pending.removeAbortListener();
      active.pending.settled = true;
      const release = () => this.closeActive(active);
      active.pending.resolve({ context, release, close: release });
    } catch (error) {
      this.reject(active.pending, error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (active.phase !== 'leased') {
        this.finishActive(active);
      }
    }
  }

  private cancel(pending: PendingAcquire): void {
    if (pending.settled || pending.cancelled) {
      return;
    }
    pending.cancelled = true;
    const queuedIndex = this.queued.indexOf(pending);
    if (queuedIndex >= 0) {
      this.queued.splice(queuedIndex, 1);
      this.reject(pending, abortedError());
      this.drain();
      return;
    }

    for (const active of this.active) {
      if (active.pending === pending) {
        active.closing = true;
        this.reject(pending, abortedError());
        return;
      }
    }
  }

  private compatibleWithActive(request: BrowserPoolAcquireRequest): boolean {
    return Array.from(this.active).every((active) => {
      if (active.environmentKey !== environmentKey(request.environment)) {
        return false;
      }
      if (active.projectId !== request.projectId) {
        return false;
      }
      if (active.storageStateRef !== request.storageStateRef) {
        return false;
      }
      return !hasOverlappingLock(active.locks, request.locks);
    });
  }

  private closeActive(active: ActiveAcquire): Promise<void> {
    if (active.closePromise) {
      return active.closePromise;
    }
    active.closing = true;
    active.closePromise = (async () => {
      try {
        await this.closeContext(active);
      } finally {
        this.finishActive(active);
      }
    })();
    return active.closePromise;
  }

  private async closeContext(active: ActiveAcquire): Promise<void> {
    const context = active.context;
    active.context = undefined;
    if (context) {
      try {
        await context.close();
      } catch (error) {
        this.recordCleanupFailure(error);
        throw error;
      }
    }
  }

  private finishActive(active: ActiveAcquire): void {
    if (!this.active.delete(active)) {
      return;
    }
    active.pending.removeAbortListener();
    this.drain();
  }

  private getBrowser(): Promise<BrowserPoolBrowser> {
    if (!this.browserPromise) {
      this.browserPromise = this.createBrowser();
    }
    return this.browserPromise;
  }

  private reject(pending: PendingAcquire, error: Error): void {
    if (pending.settled) {
      return;
    }
    pending.settled = true;
    pending.removeAbortListener();
    pending.reject(error);
  }

  private recordCleanupFailure(error: unknown): void {
    if (this.cleanupFailure) {
      return;
    }
    this.cleanupFailure = error instanceof Error ? error : new Error(String(error));
    this.closed = true;
    while (this.queued.length) {
      const pending = this.queued.shift()!;
      pending.cancelled = true;
      this.reject(pending, this.cleanupFailure);
    }
    this.active.forEach((active) => {
      if (active.phase === 'creating') {
        active.closing = true;
        this.reject(active.pending, this.cleanupFailure!);
      }
    });
  }
}

/**
 * Creates the production worker pool without launching Chromium. The browser
 * launches only when an eligible Suite worker successfully acquires it.
 */
export const createControlledChromiumBrowserPool = (
  options: ControlledChromiumBrowserPoolOptions = {},
): BrowserPool => {
  return new BrowserPool({
    capacity: options.capacity ?? CONTROLLED_BROWSER_POOL_CAPACITY,
    createBrowser: options.createBrowser ?? launchControlledChromium,
    createContextOptions: async (request) => {
      if (!request.storageStateRef) {
        return {};
      }
      if (!request.projectId) {
        throw new Error('BrowserPool requires a project ID to resolve storage state.');
      }
      if (!options.storageStateResolver) {
        throw new Error('BrowserPool storage state resolver is unavailable.');
      }
      const { serializedState } = await options.storageStateResolver.resolve(
        request.projectId,
        request.storageStateRef,
      );
      return { storageState: serializedState };
    },
  });
};

const launchControlledChromium = async (): Promise<BrowserPoolBrowser> => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  return {
    newContext: (options) => browser.newContext(options as never),
    close: () => browser.close(),
  };
};

const clampCapacity = (capacity: number): number => {
  return Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1;
};

const uniqueLocks = (locks: readonly string[] | undefined): string[] => {
  return Array.from(new Set(locks ?? [])).sort();
};

const hasOverlappingLock = (heldLocks: ReadonlySet<string>, requestedLocks: readonly string[] | undefined): boolean => {
  return (requestedLocks ?? []).some((lock) => heldLocks.has(lock));
};

const environmentKey = (environment: BrowserPoolEnvironment): string => {
  return [environment.id, environment.browser, environment.locale, environment.viewport, environment.headless].join('|');
};

const viewportFor = (viewport: ProjectEnvironment['viewport']): { width: number; height: number } => {
  if (viewport === 'mobile') {
    return { width: 390, height: 844 };
  }
  if (viewport === 'laptop') {
    return { width: 1440, height: 900 };
  }
  return { width: 1600, height: 1000 };
};

const abortedError = (): Error => {
  return new Error('BrowserPool acquire aborted.');
};
