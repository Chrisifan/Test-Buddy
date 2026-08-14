import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState } from '../../../shared/studio.js';
import { StartupPage } from './StartupPage.js';

const state = createInitialStudioState();

describe('StartupPage', () => {
  it('renders the supplied TestBuddy brand asset above the startup steps', () => {
    const brandLogo = '/assets/testbuddy-hammer-bot.png';

    render(
      <StartupPage
        brandLogo={brandLogo}
        midsceneConfig={state.midsceneConfig}
        midsceneReady={false}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        onUpdateMidsceneConfig={vi.fn()}
      />,
    );

    expect(screen.getByRole('banner', { name: 'TestBuddy' })).toContainElement(
      screen.getByRole('img', { name: 'TestBuddy' }),
    );
    expect(screen.getByRole('img', { name: 'TestBuddy' })).toHaveAttribute('src', brandLogo);
    expect(screen.getAllByText('配置 MidScene').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('进入工作台')).toBeInTheDocument();
    expect(screen.getByText('开始测试')).toBeInTheDocument();
  });

  it('shows first-run Midscene setup with a skippable stepper', () => {
    render(
      <StartupPage
        brandLogo="/assets/testbuddy-hammer-bot.png"
        midsceneConfig={state.midsceneConfig}
        midsceneReady={false}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        onUpdateMidsceneConfig={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('启动屏')).toBeInTheDocument();
    expect(screen.getByLabelText('启动步骤')).toBeInTheDocument();
    expect(screen.getAllByText('配置 MidScene').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('进入工作台')).toBeInTheDocument();
    expect(screen.getByText('开始测试')).toBeInTheDocument();
    expect(screen.getByLabelText('MidScene 快速配置')).toBeInTheDocument();
    expect(screen.getByText('MIDSCENE_MODEL_BASE_URL')).toBeInTheDocument();
    expect(screen.getByText('MIDSCENE_MODEL_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('必填')).toBeInTheDocument();
    expect(screen.getByText('启动就绪')).toBeInTheDocument();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
    expect(screen.queryByText('Startup Ready')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并进入工作台' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '跳过，进入工作台' })).toBeInTheDocument();
  });

  it('allows skipping startup setup', () => {
    const onSkip = vi.fn();

    render(
      <StartupPage
        brandLogo="/assets/testbuddy-hammer-bot.png"
        midsceneConfig={state.midsceneConfig}
        midsceneReady={false}
        onComplete={vi.fn()}
        onSkip={onSkip}
        onUpdateMidsceneConfig={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '跳过，进入工作台' }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
