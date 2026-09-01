import type {
  ClearModelSecretRequest,
  ModelSecretRef,
  ModelSecretScope,
  SaveModelSecretRequest,
} from '../../shared/studio.js';
import type { ModelSecretTransactionCoordinator } from '../model-secret-transaction.js';

type ModelSecretIpcChannel = 'runtime:save-model-secret' | 'runtime:clear-model-secret';

export interface ModelSecretIpcRegistrar {
  handle(
    channel: ModelSecretIpcChannel,
    listener: (event: unknown, request: unknown) => Promise<ModelSecretRef>,
  ): void;
}

export interface ModelSecretIpcDependencies extends ModelSecretIpcRegistrar {
  coordinator: Pick<ModelSecretTransactionCoordinator, 'save' | 'clear'>;
}

export const registerModelSecretIpcHandlers = (dependencies: ModelSecretIpcDependencies): void => {
  dependencies.handle('runtime:save-model-secret', async (_event, request) =>
    dependencies.coordinator.save(validateSaveRequest(request)),
  );
  dependencies.handle('runtime:clear-model-secret', async (_event, request) =>
    dependencies.coordinator.clear(validateClearRequest(request)),
  );
};

const validateSaveRequest = (request: unknown): SaveModelSecretRequest => {
  if (!isPlainObject(request) || !isModelSecretScope(request.scope) || typeof request.value !== 'string' || !request.value.trim()) {
    throw new Error('模型密钥保存请求无效。');
  }
  return { scope: request.scope, value: request.value };
};

const validateClearRequest = (request: unknown): ClearModelSecretRequest => {
  if (!isPlainObject(request) || !isModelSecretScope(request.scope)) {
    throw new Error('模型密钥清除请求无效。');
  }
  return { scope: request.scope };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isModelSecretScope = (value: unknown): value is ModelSecretScope => {
  return value === 'midscene' || value === 'agent:planner' || value === 'agent:executor' ||
    value === 'agent:verifier' || value === 'agent:reporter';
};
