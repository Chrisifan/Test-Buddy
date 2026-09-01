import { describe, expect, it, vi } from 'vitest';

import { defaultAgentModelConfig, defaultMidsceneConfig } from '../../shared/studio.js';
import { ModelConfigResolver } from './model-config-resolver.js';

describe('ModelConfigResolver', () => {
  it('resolves raw keys only into main-process config copies', async () => {
    const secretStore = {
      resolve: vi.fn(async ({ scope }: { scope: string }) => `raw-${scope}`),
    };
    const publicMidsceneConfig = {
      ...defaultMidsceneConfig,
      modelBaseUrl: 'https://models.example.test/v1',
      modelName: 'gpt-4o',
      modelFamily: 'openai',
      modelSecret: { id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
    };
    const publicAgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible' as const,
        modelSecret: { id: 'agent:planner', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
      },
    };

    const resolved = await new ModelConfigResolver(secretStore).resolve({
      midsceneConfig: publicMidsceneConfig,
      agentModelConfig: publicAgentModelConfig,
    });

    expect(secretStore.resolve).toHaveBeenCalledWith({ scope: 'midscene' });
    expect(secretStore.resolve).toHaveBeenCalledWith({ scope: 'agent:planner' });
    expect(resolved.midsceneConfig.modelApiKey).toBe('raw-midscene');
    expect(resolved.agentModelConfig.planner.modelApiKey).toBe('raw-agent:planner');
    expect(JSON.stringify(publicMidsceneConfig)).not.toContain('raw-midscene');
    expect(JSON.stringify(publicAgentModelConfig)).not.toContain('raw-agent:planner');
  });

  it('rejects a reference whose stable id does not match the config scope before resolving', async () => {
    const secretStore = { resolve: vi.fn() };
    const resolver = new ModelConfigResolver(secretStore);

    await expect(resolver.resolveMidsceneConfig({
      ...defaultMidsceneConfig,
      modelSecret: { id: 'agent:planner', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
    })).rejects.toThrow('模型密钥引用范围不匹配。');
    expect(secretStore.resolve).not.toHaveBeenCalled();
  });

  it('keeps an absent key as an empty internal value without asking the secret store', async () => {
    const secretStore = { resolve: vi.fn() };
    const resolved = await new ModelConfigResolver(secretStore).resolveMidsceneConfig(defaultMidsceneConfig);

    expect(resolved.modelApiKey).toBe('');
    expect(secretStore.resolve).not.toHaveBeenCalled();
  });

  it('does not resolve secrets for disabled roles or an unused executor role', async () => {
    const secretStore = {
      resolve: vi.fn(async ({ scope }: { scope: string }) => `raw-${scope}`),
    };
    const resolved = await new ModelConfigResolver(secretStore).resolve({
      midsceneConfig: {
        ...defaultMidsceneConfig,
        modelSecret: { id: 'midscene', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
      },
      agentModelConfig: {
        ...defaultAgentModelConfig,
        planner: {
          ...defaultAgentModelConfig.planner,
          provider: 'openaiCompatible',
          modelSecret: { id: 'agent:planner', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        },
        executor: {
          ...defaultAgentModelConfig.executor,
          provider: 'openaiCompatible',
          modelSecret: { id: 'agent:executor', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        },
        reporter: {
          ...defaultAgentModelConfig.reporter,
          provider: 'openaiCompatible',
          enabled: false,
          modelSecret: { id: 'agent:reporter', hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        },
      },
    });

    const resolvedScopes = secretStore.resolve.mock.calls
      .map(([request]) => request.scope)
      .sort();
    expect(resolvedScopes).toEqual(['agent:planner', 'midscene']);
    expect(resolved.agentModelConfig.executor.modelApiKey).toBe('');
    expect(resolved.agentModelConfig.reporter.modelApiKey).toBe('');
  });

  it('resolves only the planner provider immediately before a planner call', async () => {
    const secretStore = {
      resolve: vi.fn(async ({ scope }: { scope: string }) => `raw-${scope}`),
    };
    const resolver = new ModelConfigResolver(secretStore);
    const configs = {
      midsceneConfig: {
        ...defaultMidsceneConfig,
        modelSecret: { id: 'midscene' as const, hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
      },
      agentModelConfig: {
        ...defaultAgentModelConfig,
        planner: {
          ...defaultAgentModelConfig.planner,
          provider: 'openaiCompatible' as const,
          modelBaseUrl: 'https://planner.example.test/v1',
          modelName: 'planner-model',
          modelSecret: { id: 'agent:planner' as const, hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        },
        verifier: {
          ...defaultAgentModelConfig.verifier,
          provider: 'openaiCompatible' as const,
          modelSecret: { id: 'agent:verifier' as const, hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        },
        reporter: {
          ...defaultAgentModelConfig.reporter,
          provider: 'openaiCompatible' as const,
          modelSecret: { id: 'agent:reporter' as const, hasKey: true, updatedAt: '2026-08-17T00:00:00.000Z' },
        },
      },
    };

    const resolved = await resolver.resolveAgentProviderConfig('planner', configs);

    expect(resolved.config).toMatchObject({ modelApiKey: 'raw-agent:planner', modelName: 'planner-model' });
    expect(secretStore.resolve).toHaveBeenCalledTimes(1);
    expect(secretStore.resolve).toHaveBeenCalledWith({ scope: 'agent:planner' });
  });
});
