import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  modelSecret: {
    id: 'midscene',
    hasKey: false,
    updatedAt: new Date(0).toISOString(),
  },
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
  modelSecret = midsceneConfig.modelSecret,
  modelName = '',
  midsceneReady = false,
  onSave = vi.fn(),
  onTestMidsceneConnection = vi.fn(),
  onUpdateAgentModelConfig = vi.fn(),
  onUpdateMidsceneConfig = vi.fn(),
  onSaveModelSecret = vi.fn().mockResolvedValue(undefined),
  onClearModelSecret = vi.fn().mockResolvedValue(undefined),
  requiresMidsceneBeforeSave = false,
  locale = 'zh-CN',
  initialSection = 'appearance',
}: {
  agentModelConfig?: AgentModelConfig;
  modelSecret?: MidsceneConfig['modelSecret'];
  modelName?: string;
  midsceneReady?: boolean;
  onSave?: Parameters<typeof SettingsModal>[0]['onSave'];
  onTestMidsceneConnection?: Parameters<typeof SettingsModal>[0]['onTestMidsceneConnection'];
  onUpdateAgentModelConfig?: Parameters<typeof SettingsModal>[0]['onUpdateAgentModelConfig'];
  onUpdateMidsceneConfig?: Parameters<typeof SettingsModal>[0]['onUpdateMidsceneConfig'];
  onSaveModelSecret?: Parameters<typeof SettingsModal>[0]['onSaveModelSecret'];
  onClearModelSecret?: Parameters<typeof SettingsModal>[0]['onClearModelSecret'];
  requiresMidsceneBeforeSave?: boolean;
  locale?: 'zh-CN' | 'en-US';
  initialSection?: 'appearance' | 'midscene' | 'agentModels' | 'runtime';
} = {}) {
  return {
    onSave,
    onSaveModelSecret,
    onClearModelSecret,
    onUpdateAgentModelConfig,
    onUpdateMidsceneConfig,
    ...render(
      <SettingsModal
        agentModelConfig={agentModelConfig}
        midsceneConfig={{ ...midsceneConfig, modelName, modelSecret }}
        midsceneReady={midsceneReady}
        appearance={{ themeMode: 'light', localeMode: locale }}
        effectiveTheme="light"
        initialSection={initialSection}
        locale={locale}
        onClose={vi.fn()}
        onClearModelSecret={onClearModelSecret}
        onSave={onSave}
        onSaveModelSecret={onSaveModelSecret}
        onTestMidsceneConnection={onTestMidsceneConnection}
        onUpdateAgentModelConfig={onUpdateAgentModelConfig}
        onUpdateAppearance={vi.fn()}
        onUpdateMidsceneConfig={onUpdateMidsceneConfig}
        onUpdateRuntimeProfile={vi.fn()}
        open
        requiresMidsceneBeforeSave={requiresMidsceneBeforeSave}
        runtimeProfile={runtimeProfile}
      />,
    ),
  };
}

describe('SettingsModal', () => {
  it('omits redundant MidScene onboarding content and numbered section labels', () => {
    const midsceneView = renderSettingsModal({ initialSection: 'midscene' });

    expect(screen.queryByText('配置完成后可进入')).not.toBeInTheDocument();
    expect(screen.queryByText('自然语言测试')).not.toBeInTheDocument();
    expect(screen.queryByText('流程编排测试')).not.toBeInTheDocument();
    expect(screen.queryByText('录制回放')).not.toBeInTheDocument();
    expect(screen.queryByText('02 / 引擎')).not.toBeInTheDocument();
    midsceneView.unmount();

    const sectionLabels: Array<{
      initialSection: 'appearance' | 'agentModels' | 'runtime';
      label: string;
    }> = [
      { initialSection: 'appearance', label: '01 / 显示' },
      { initialSection: 'agentModels', label: '03 / Agent 大脑' },
      { initialSection: 'runtime', label: '04 / 执行' },
    ];

    sectionLabels.forEach(({ initialSection, label }) => {
      const view = renderSettingsModal({ initialSection });

      expect(screen.queryByText(label)).not.toBeInTheDocument();
      view.unmount();
    });
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

    const testConnectionButton = screen.getByRole('button', { name: '测试连接' });
    expect(testConnectionButton.querySelector('svg.lucide-plug-zap')).toBeInTheDocument();
    fireEvent.click(testConnectionButton);

    expect(onTestMidsceneConnection).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: 'gpt-4o-mini' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('连接成功 · 84 ms');
  });

  it('keeps a Midscene API key out of public config patches until the user explicitly saves it', async () => {
    const onUpdateMidsceneConfig = vi.fn();
    const onSaveModelSecret = vi.fn().mockResolvedValue(undefined);
    renderSettingsModal({ initialSection: 'midscene', onSaveModelSecret, onUpdateMidsceneConfig });

    const apiKeyInput = screen.getByPlaceholderText('sk-...');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-settings-midscene' } });

    expect(onUpdateMidsceneConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));

    await waitFor(() => {
      expect(onSaveModelSecret).toHaveBeenCalledWith('midscene', 'sk-settings-midscene');
    });
    expect(apiKeyInput).toHaveValue('');
  });

  it('keeps model-secret input values out of React state and ModelSecretInput props', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/settings/SettingsModal.tsx'), 'utf8');

    expect(source).not.toContain('modelSecretValues');
    expect(source).not.toContain('updateModelSecretValue');
    expect(source).not.toContain('value={modelSecretValues');
    expect(source).not.toContain('onChange={(value) => updateModelSecretValue');
  });

  it('scopes settings label hierarchy and field spacing to the settings dialog', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/luminous-precision.css'), 'utf8');

    expect(styles).toContain('.settings-dialog-scroll .form-field {\n  gap: 8px;\n}');
    expect(styles).toContain('.settings-dialog-scroll .form-field > label,\n.settings-dialog-scroll .form-field > div > label');
    expect(styles).toContain('  color: var(--muted-foreground);\n  font-size: var(--font-size-meta);');
  });

  it('keeps a typed Midscene API key in the DOM input when saving fails', async () => {
    const onSaveModelSecret = vi.fn().mockRejectedValue(new Error('secure storage unavailable'));
    renderSettingsModal({ initialSection: 'midscene', onSaveModelSecret });

    const apiKeyInput = screen.getByPlaceholderText('sk-...');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-settings-save-failure' } });
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));

    await waitFor(() => {
      expect(onSaveModelSecret).toHaveBeenCalledWith('midscene', 'sk-settings-save-failure');
    });
    expect(apiKeyInput).toHaveValue('sk-settings-save-failure');
    expect(screen.getByRole('alert')).toHaveTextContent('secure storage unavailable');
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

  it('keeps an independent role API key out of public config patches until explicitly saved', async () => {
    const onUpdateAgentModelConfig = vi.fn();
    const onSaveModelSecret = vi.fn().mockResolvedValue(undefined);
    renderSettingsModal({
      agentModelConfig: {
        ...defaultAgentModelConfig,
        planner: {
          ...defaultAgentModelConfig.planner,
          provider: 'openaiCompatible',
        },
      },
      initialSection: 'agentModels',
      onSaveModelSecret,
      onUpdateAgentModelConfig,
    });

    const plannerSection = screen.getByTestId('agent-model-role-planner');
    fireEvent.click(within(plannerSection).getByRole('button', { name: /规划器/ }));
    const apiKeyInput = within(plannerSection).getByLabelText('规划器 API Key');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-settings-planner' } });

    expect(onUpdateAgentModelConfig).not.toHaveBeenCalled();
    fireEvent.click(within(plannerSection).getByRole('button', { name: '保存密钥' }));

    await waitFor(() => {
      expect(onSaveModelSecret).toHaveBeenCalledWith('agent:planner', 'sk-settings-planner');
    });
    expect(apiKeyInput).toHaveValue('');
  });

  it('lets a stored Midscene key be explicitly cleared without exposing it', async () => {
    const onClearModelSecret = vi.fn().mockResolvedValue(undefined);
    renderSettingsModal({
      initialSection: 'midscene',
      onClearModelSecret,
      modelSecret: {
        id: 'midscene',
        hasKey: true,
        updatedAt: '2026-08-17T00:00:00.000Z',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: '清除密钥' }));

    await waitFor(() => {
      expect(onClearModelSecret).toHaveBeenCalledWith('midscene');
    });
  });

  it('shows stored Midscene keys explicitly and reveals a fresh input only when replacing', () => {
    renderSettingsModal({
      initialSection: 'midscene',
      modelSecret: {
        id: 'midscene',
        hasKey: true,
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    });

    expect(screen.getByText('已安全保存')).toBeInTheDocument();
    expect(screen.queryByLabelText('MIDSCENE_MODEL_API_KEY')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '替换密钥' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '替换密钥' }));

    expect(screen.getByLabelText('MIDSCENE_MODEL_API_KEY')).toHaveValue('');
    expect(screen.getByRole('button', { name: '保存密钥' })).toBeDisabled();
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
