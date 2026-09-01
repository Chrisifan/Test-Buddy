import type {
  ClearModelSecretRequest,
  ModelSecretRef,
  ModelSecretScope,
  SaveModelSecretRequest,
  StudioState,
} from '../shared/studio.js';
import { ModelSecretTransactionJournal } from './model-secret-transaction-journal.js';
import type { ModelSecretSnapshot } from './runtime/model-secret-store.js';
import { DurableAtomicFileCommitError } from './durable-atomic-file.js';
import { DurableStudioStateCommitError } from './studioStore.js';

export interface ModelSecretTransactionalStore {
  snapshot(scope: ModelSecretScope): Promise<ModelSecretSnapshot | undefined>;
  save(request: SaveModelSecretRequest, reference: ModelSecretRef): Promise<ModelSecretRef>;
  clear(request: ClearModelSecretRequest, reference: ModelSecretRef): Promise<ModelSecretRef>;
  restore(scope: ModelSecretScope, snapshot: ModelSecretSnapshot | undefined): Promise<void>;
}

export type ModelSecretReferencePersister = (
  scope: ModelSecretScope,
  modelSecret: ModelSecretRef,
) => Promise<void>;

export type ModelSecretReferenceReader = (scope: ModelSecretScope) => Promise<ModelSecretRef>;

/**
 * Keeps the encrypted secret record and its public StudioState reference in
 * lockstep when the latter persistence step fails.
 */
export class ModelSecretTransactionCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly secrets: ModelSecretTransactionalStore,
    private readonly persistReference: ModelSecretReferencePersister,
    private readonly journal: ModelSecretTransactionJournal,
  ) {}

  save(request: SaveModelSecretRequest): Promise<ModelSecretRef> {
    return this.enqueue(() => this.mutate(
      request.scope,
      true,
      (reference) => this.secrets.save(request, reference),
    ));
  }

  clear(request: ClearModelSecretRequest): Promise<ModelSecretRef> {
    return this.enqueue(() => this.mutate(
      request.scope,
      false,
      (reference) => this.secrets.clear(request, reference),
    ));
  }

  reconcile(readReference: ModelSecretReferenceReader): Promise<void> {
    return this.enqueue(async () => {
      const entry = await this.journal.load();
      if (!entry) {
        return;
      }
      try {
        const current = await readReference(entry.scope);
        if (sameReference(current, entry.next)) {
          await this.journal.clear();
          return;
        }
        await this.secrets.restore(entry.scope, entry.previous);
        await this.journal.clear();
      } catch {
        throw new Error('模型密钥状态恢复失败，无法安全启动。');
      }
    });
  }

  withConsistentState<T>(
    loadState: () => Promise<StudioState>,
    callback: (state: StudioState) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => callback(await loadState()));
  }

  private async mutate(
    scope: ModelSecretScope,
    hasKey: boolean,
    mutateSecret: (reference: ModelSecretRef) => Promise<ModelSecretRef>,
  ): Promise<ModelSecretRef> {
    const previous = await this.secrets.snapshot(scope);
    const next: ModelSecretRef = { id: scope, hasKey, updatedAt: new Date().toISOString() };
    await this.journal.stage({ scope, previous, next });
    try {
      await mutateSecret(next);
    } catch (error) {
      if (error instanceof DurableAtomicFileCommitError) {
        throw new Error('模型密钥持久化提交结果不确定，需在下次启动时恢复。', { cause: error });
      }
      await this.clearJournalAfterFailedMutation(error);
      throw error;
    }
    try {
      await this.persistReference(scope, next);
    } catch (error) {
      if (error instanceof DurableStudioStateCommitError) {
        throw new Error('模型密钥状态提交结果不确定，需在下次启动时恢复。', { cause: error });
      }
      try {
        await this.secrets.restore(scope, previous);
        await this.journal.clear();
      } catch {
        throw new Error('模型密钥状态同步失败，且无法自动恢复。');
      }
      throw new Error('模型密钥状态同步失败，已恢复原有设置。');
    }
    try {
      await this.journal.clear();
    } catch {
      throw new Error('模型密钥状态已提交，但恢复日志尚未清除。');
    }
    return next;
  }

  private async clearJournalAfterFailedMutation(error: unknown): Promise<void> {
    try {
      await this.journal.clear();
    } catch {
      throw new Error('模型密钥状态同步失败，且无法自动恢复。', { cause: error });
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.tail.then(operation, operation);
    this.tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }
}

const sameReference = (left: ModelSecretRef, right: ModelSecretRef): boolean => {
  return left.id === right.id && left.hasKey === right.hasKey && left.updatedAt === right.updatedAt;
};
