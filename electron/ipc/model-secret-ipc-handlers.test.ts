import { describe, expect, it, vi } from 'vitest';

describe('registerModelSecretIpcHandlers', () => {
  it.each([
    null,
    [],
    {},
    { scope: 'agent:unknown', value: 'sk-invalid-scope' },
    { scope: 'midscene', value: null },
    { scope: 'midscene', value: 42 },
    { scope: 'midscene', value: '   ' },
  ])('rejects malformed save requests without invoking the secret transaction: %j', async (request) => {
    const { handlers, coordinator } = await registerHandlers();

    const error = await reject(handlers.get('runtime:save-model-secret')!({}, request));

    expect(error.message).toBe('模型密钥保存请求无效。');
    expect(error.message).not.toContain('sk-invalid-scope');
    expect(coordinator.save).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { scope: 'agent:unknown' },
    { scope: 42 },
  ])('rejects malformed clear requests without invoking the secret transaction: %j', async (request) => {
    const { handlers, coordinator } = await registerHandlers();

    const error = await reject(handlers.get('runtime:clear-model-secret')!({}, request));

    expect(error.message).toBe('模型密钥清除请求无效。');
    expect(coordinator.clear).not.toHaveBeenCalled();
  });

  it('forwards only validated model secret requests to the transaction coordinator', async () => {
    const { handlers, coordinator } = await registerHandlers();

    await expect(handlers.get('runtime:save-model-secret')!({}, { scope: 'agent:reporter', value: 'sk-valid' }))
      .resolves.toMatchObject({ id: 'agent:reporter', hasKey: true });
    await expect(handlers.get('runtime:clear-model-secret')!({}, { scope: 'agent:reporter' }))
      .resolves.toMatchObject({ id: 'agent:reporter', hasKey: false });

    expect(coordinator.save).toHaveBeenCalledWith({ scope: 'agent:reporter', value: 'sk-valid' });
    expect(coordinator.clear).toHaveBeenCalledWith({ scope: 'agent:reporter' });
  });
});

async function registerHandlers() {
  const { registerModelSecretIpcHandlers } = await import('./model-secret-ipc-handlers.js');
  const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();
  const coordinator = {
    save: vi.fn().mockResolvedValue({ id: 'agent:reporter', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' }),
    clear: vi.fn().mockResolvedValue({ id: 'agent:reporter', hasKey: false, updatedAt: '2026-08-17T00:00:00.000Z' }),
  };
  registerModelSecretIpcHandlers({
    handle: (channel: string, listener: (event: unknown, request: unknown) => unknown) => handlers.set(channel, listener),
    coordinator,
  });
  return { handlers, coordinator };
}

async function reject(value: unknown): Promise<Error> {
  try {
    await value;
    throw new Error('Expected request to reject.');
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
