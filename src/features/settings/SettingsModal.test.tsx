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
  onUpdateAgentModelConfig = vi.fn(),
  requiresMidsceneBeforeSave = false,
  locale = 'zh-CN',
}: {
  agentModelConfig?: AgentModelConfig;
  modelName?: string;
  midsceneReady?: boolean;
  onSave?: Parameters<typeof SettingsModal>[0]['onSave'];
  onUpdateAgentModelConfig?: Parameters<typeof SettingsModal>[0]['onUpdateAgentModelConfig'];
  requiresMidsceneBeforeSave?: boolean;
  locale?: 'zh-CN' | 'en-US';
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
        locale={locale}
        onClose={vi.fn()}
        onSave={onSave}
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
    renderSettingsModal();

    expect(screen.getByText('配置完成后可进入')).toBeInTheDocument();
    expect(screen.getByText('自然语言测试')).toBeInTheDocument();
    expect(screen.getByText('流程编排测试')).toBeInTheDocument();
    expect(screen.getByText('录制回放')).toBeInTheDocument();
  });

  it('renders the settings shell in Chinese by default', () => {
    renderSettingsModal();

    expect(screen.getByRole('heading', { name: '项目设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /外观/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Appearance' })).not.toBeInTheDocument();
    expect(screen.queryByText('MidScene optional')).not.toBeInTheDocument();
    expect(screen.getByText('界面语言')).toBeInTheDocument();
  });

  it('shows agent role model settings for the four automation roles', () => {
    renderSettingsModal();

    expect(screen.getAllByText('Agent 模型').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('规划器')).toBeInTheDocument();
    expect(screen.getByText('执行器')).toBeInTheDocument();
    expect(screen.getByText('校验器')).toBeInTheDocument();
    expect(screen.getByText('报告器')).toBeInTheDocument();
  });

  it('defaults agent roles to reusing the MidScene model with inherited model hint', () => {
    renderSettingsModal({ modelName: 'gpt-4o-mini' });

    expect(screen.getAllByText('复用 MidScene 模型')).toHaveLength(4);
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
      onUpdateAgentModelConfig,
    });

    const plannerSection = screen.getByTestId('agent-model-role-planner');
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
      locale: 'en-US',
    });

    expect(screen.getByLabelText('Planner Model Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Planner Model Family')).toBeInTheDocument();
  });
});
