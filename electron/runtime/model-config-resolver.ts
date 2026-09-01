import type {
  AgentModelConfig,
  AgentModelRole,
  AgentRoleModelConfig,
  ChatCommandRequest,
  MidsceneConfig,
  ModelSecretScope,
  RunWorkflowRequest,
} from '../../shared/studio.js';

export interface ResolvedMidsceneConfig extends MidsceneConfig {
  modelApiKey: string;
}

export interface ResolvedAgentRoleModelConfig extends AgentRoleModelConfig {
  modelApiKey: string;
}

export type ResolvedAgentModelConfig = Record<AgentModelRole, ResolvedAgentRoleModelConfig>;

export type AgentProviderRole = Exclude<AgentModelRole, 'executor'>;

export interface ResolvedAgentProviderConfig {
  config?: {
    modelBaseUrl: string;
    modelApiKey: string;
    modelName: string;
    modelFamily: string;
    temperature: string;
  };
  fallbackReason?: string;
}

/** Main-process-only callbacks that resolve a provider configuration at use time. */
export interface LazyModelConfigResolver {
  resolveMidsceneConfig: () => Promise<ResolvedMidsceneConfig>;
  resolveAgentProviderConfig: (role: AgentProviderRole) => Promise<ResolvedAgentProviderConfig>;
}

export type ResolvedChatCommandRequest = Omit<ChatCommandRequest, 'midsceneConfig' | 'agentModelConfig'> & {
  midsceneConfig?: ResolvedMidsceneConfig;
  agentModelConfig?: ResolvedAgentModelConfig;
  modelConfigResolver?: LazyModelConfigResolver;
};

export type ResolvedRunWorkflowRequest = Omit<RunWorkflowRequest, 'midsceneConfig' | 'agentModelConfig'> & {
  midsceneConfig?: ResolvedMidsceneConfig;
  agentModelConfig?: ResolvedAgentModelConfig;
  modelConfigResolver?: LazyModelConfigResolver;
};

export interface ResolvedModelConfigs {
  midsceneConfig: ResolvedMidsceneConfig;
  agentModelConfig: ResolvedAgentModelConfig;
}

interface ModelSecretResolver {
  resolve: (request: { scope: ModelSecretScope }) => Promise<string>;
}

const agentRoles: AgentModelRole[] = ['planner', 'executor', 'verifier', 'reporter'];

export class ModelConfigResolver {
  constructor(private readonly secretStore: ModelSecretResolver) {}

  async resolve(configs: {
    midsceneConfig: MidsceneConfig;
    agentModelConfig: AgentModelConfig;
  }): Promise<ResolvedModelConfigs> {
    const [midsceneConfig, agentModelConfig] = await Promise.all([
      this.resolveMidsceneConfig(configs.midsceneConfig),
      this.resolveAgentModelConfig(configs.agentModelConfig),
    ]);
    return { midsceneConfig, agentModelConfig };
  }

  async resolveMidsceneConfig(config: MidsceneConfig): Promise<ResolvedMidsceneConfig> {
    return {
      ...config,
      modelApiKey: await this.resolveSecret('midscene', config.modelSecret),
    };
  }

  async resolveAgentModelConfig(config: AgentModelConfig): Promise<ResolvedAgentModelConfig> {
    const entries = await Promise.all(agentRoles.map(async (role) => {
      const roleConfig = config[role];
      return [
        role,
        {
          ...roleConfig,
          modelApiKey: role !== 'executor' && roleConfig.enabled && roleConfig.provider === 'openaiCompatible'
            ? await this.resolveSecret(`agent:${role}`, roleConfig.modelSecret)
            : '',
        },
      ] as const;
    }));
    return Object.fromEntries(entries) as ResolvedAgentModelConfig;
  }

  async resolveAgentProviderConfig(
    role: AgentProviderRole,
    configs: { midsceneConfig: MidsceneConfig; agentModelConfig: AgentModelConfig },
  ): Promise<ResolvedAgentProviderConfig> {
    const roleConfig = configs.agentModelConfig[role];
    const label = role[0].toUpperCase() + role.slice(1);
    if (!roleConfig.enabled) {
      return { fallbackReason: `${label} 角色已停用` };
    }

    const config = roleConfig.provider === 'openaiCompatible'
      ? await this.resolveAgentRoleConfig(role, roleConfig)
      : await this.resolveMidsceneConfig(configs.midsceneConfig);
    const providerConfig = {
      modelBaseUrl: config.modelBaseUrl,
      modelApiKey: config.modelApiKey,
      modelName: config.modelName,
      modelFamily: config.modelFamily,
      temperature: roleConfig.temperature,
    };
    if (!providerConfig.modelBaseUrl.trim() || !providerConfig.modelApiKey.trim() || !providerConfig.modelName.trim()) {
      return { fallbackReason: `${label} 模型配置不完整` };
    }
    return { config: providerConfig };
  }

  private async resolveAgentRoleConfig(
    role: AgentProviderRole,
    config: AgentModelConfig[AgentProviderRole],
  ): Promise<ResolvedAgentRoleModelConfig> {
    return {
      ...config,
      modelApiKey: await this.resolveSecret(`agent:${role}`, config.modelSecret),
    };
  }

  private async resolveSecret(
    scope: ModelSecretScope,
    reference: { id: string; hasKey: boolean },
  ): Promise<string> {
    if (reference.id !== scope) {
      throw new Error('模型密钥引用范围不匹配。');
    }
    return reference.hasKey ? this.secretStore.resolve({ scope }) : '';
  }
}
