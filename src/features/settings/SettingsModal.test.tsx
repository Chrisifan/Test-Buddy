import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsModal } from './SettingsModal.js';
import {
  defaultAgentModelConfig,
  type AgentModelConfig,
  type MidsceneConfig,
  type RuntimeProfile,
} from '../../../shared/studio.js';

const midsceneConfig: MidsceneConfig = {
  modelBaseUrl: '',
  modelApiKey: '',
  modelName: '',
  modelFamily: '',
  preferredLanguage: 'Chinese',
  replanningCycleLimit: '10',
  openaiHttpProxy: '',
  defaultContext: '',
};

const runtimeProfile: RuntimeProfile = {
  baseUrl: 'https://demo-shop.local',
  browser: 'chromium',
  viewport: 'desktop',
  locale: 'zh-CN',
  headless: true,
};

function renderSettingsModal({
  agentModelConfig = defaultAgentModelConfig,
  modelName = '',
  midsceneReady = false,
  onSave = vi.fn(),
  onTestMidsceneConnection = vi.fn(),
  onUpdateAgentModelConfig = vi.fn(),
  requiresMidsceneBeforeSave = false,
  locale = 'zh-CN',
  initialSection = 'appearance',
}: {
  agentModelConfig?: AgentModelConfig;
  modelName?: string;
  midsceneReady?: boolean;
  onSave?: Parameters<typeof SettingsModal>[0]['onSave'];
  onTestMidsceneConnection?: Parameters<typeof SettingsModal>[0]['onTestMidsceneConnection'];
  onUpdateAgentModelConfig?: Parameters<typeof SettingsModal>[0]['onUpdateAgentModelConfig'];
  requiresMidsceneBeforeSave?: boolean;
  locale?: 'zh-CN' | 'en-US';
  initialSection?: 'appearance' | 'midscene' | 'agentModels' | 'runtime';
} = {}) {
  return {
    onSave,
    onUpdateAgentModelConfig,
    ...render(
      <SettingsModal
        agentModelConfig={agentModelConfig}
        midsceneConfig={{ ...midsceneConfig, modelName }}
        midsceneReady={midsceneReady}
        appearance={{ themeMode: 'light', localeMode: locale }}
        effectiveTheme="light"
        initialSection={initialSection}
        locale={locale}
        onClose={vi.fn()}
        onSave={onSave}
        onTestMidsceneConnection={onTestMidsceneConnection}
        onUpdateAgentModelConfig={onUpdateAgentModelConfig}
        onUpdateAppearance={vi.fn()}
        onUpdateMidsceneConfig={vi.fn()}
        onUpdateRuntimeProfile={vi.fn()}
        open
        requiresMidsceneBeforeSave={requiresMidsceneBeforeSave}
        runtimeProfile={runtimeProfile}
      />,
    ),
  };
}

describe('SettingsModal', () => {
  it('highlights the three feature areas unlocked after configuration', () => {
    renderSettingsModal({ initialSection: 'midscene' });

    expect(screen.getByText('配置完成后可进入')).toBeInTheDocument();
    expect(screen.getByText('自然语言测试')).toBeInTheDocument();
    expect(screen.getByText('流程编排测试')).toBeInTheDocument();
    expect(screen.getByText('录制回放')).toBeInTheDocument();
  });

  it('renders the application settings as a modal with independent categories', () => {
    renderSettingsModal();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '应用设置' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /通用/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'MidScene 配置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Appearance' })).not.toBeInTheDocument();
    expect(screen.queryByText('MidScene optional')).not.toBeInTheDocument();
    expect(screen.getByText('界面语言')).toBeInTheDocument();
  });

  it('keeps MidScene field guidance in label tooltips', () => {
    renderSettingsModal({ initialSection: 'midscene' });

    const baseUrlHint = 'OpenAI 兼容模型服务地址，例如 OpenAI、Qwen、Doubao、Azure OpenAI 或自建代理。';
    const familyHint = '用于告诉 MidScene 当前模型的能力族；不同模型供应商需要填写对应 family。';
    expect(screen.getByRole('button', { name: baseUrlHint })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: familyHint })).toBeInTheDocument();
    expect(screen.getAllByRole('tooltip')).toHaveLength(2);
  });

  it('shows agent role model settings for the four automation roles', () => {
    renderSettingsModal({ initialSection: 'agentModels' });

    expect(screen.getAllByText('Agent 模型').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('规划器')).toBeInTheDocument();
    expect(screen.getByText('执行器')).toBeInTheDocument();
    expect(screen.getByText('校验器')).toBeInTheDocument();
    expect(screen.getByText('报告器')).toBeInTheDocument();
    expect(screen.queryByLabelText('规划器 模型名称')).not.toBeInTheDocument();
  });

  it('summarizes inherited models while leaving role details collapsed by default', () => {
    renderSettingsModal({ initialSection: 'agentModels', modelName: 'gpt-4o-mini' });

    expect(screen.queryByText('复用 MidScene 模型')).not.toBeInTheDocument();
    expect(screen.getAllByText('继承模型：gpt-4o-mini')).toHaveLength(4);
  });

  it('allows saving general settings when MidScene is not configured', () => {
    const { onSave } = renderSettingsModal();

    expect(screen.queryByText('Missing required fields')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('requires MidScene only when saving before entering gated features', () => {
    const { onSave } = renderSettingsModal({ requiresMidsceneBeforeSave: true });
    const saveButton = screen.getByRole('button', { name: '保存并继续' });

    expect(screen.getByText('缺少必填项')).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('tests the current MidScene configuration and reports a successful connection', async () => {
    const onTestMidsceneConnection = vi.fn().mockResolvedValue({
      status: 'passed',
      modelName: 'gpt-4o-mini',
      durationMs: 84,
    });
    renderSettingsModal({ initialSection: 'midscene', modelName: 'gpt-4o-mini', midsceneReady: true, onTestMidsceneConnection });

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    expect(onTestMidsceneConnection).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: 'gpt-4o-mini' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('连接成功 · 84 ms');
  });

  it('updates an independent role model from the agent model section', () => {
    const onUpdateAgentModelConfig = vi.fn();
    renderSettingsModal({
      agentModelConfig: {
        ...defaultAgentModelConfig,
        planner: {
          ...defaultAgentModelConfig.planner,
          provider: 'openaiCompatible',
        },
      },
      initialSection: 'agentModels',
      onUpdateAgentModelConfig,
    });

    const plannerSection = screen.getByTestId('agent-model-role-planner');
    fireEvent.click(within(plannerSection).getByRole('button', { name: /规划器/ }));
    fireEvent.change(within(plannerSection).getByLabelText('规划器 模型名称'), {
      target: { value: 'gpt-4.1-mini' },
    });

    expect(onUpdateAgentModelConfig).toHaveBeenCalledWith('planner', {
      modelName: 'gpt-4.1-mini',
    });
  });

  it('translates independent Agent model field labels to English', () => {
    renderSettingsModal({
      agentModelConfig: {
        ...defaultAgentModelConfig,
        planner: {
          ...defaultAgentModelConfig.planner,
          provider: 'openaiCompatible',
        },
      },
      initialSection: 'agentModels',
      locale: 'en-US',
    });

    fireEvent.click(screen.getByRole('button', { name: /Planner/ }));
    expect(screen.getByLabelText('Planner Model Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Planner Model Family')).toBeInTheDocument();
  });
});
