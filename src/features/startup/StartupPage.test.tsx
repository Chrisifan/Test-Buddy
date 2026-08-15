import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState } from '../../../shared/studio.js';
import { StartupPage } from './StartupPage.js';

const state = createInitialStudioState();

describe('StartupPage', () => {
  it('turns the project logo into a central test hub and places untitled capability cards at the bottom', () => {
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

    expect(screen.getByTestId('startup-flow-visual')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('startup-flow-orbit')).toBeInTheDocument();
    expect(screen.getByTestId('startup-flow-hub')).toContainElement(screen.getByTestId('startup-flow-logo'));
    expect(screen.getByTestId('startup-flow-logo')).toHaveAttribute('src', brandLogo);
    expect(screen.getAllByTestId('startup-flow-trace')).toHaveLength(5);
    expect(screen.queryByTestId('startup-flow-ring')).not.toBeInTheDocument();
    expect(screen.queryByTestId('startup-flow-path')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('startup-flow-node')).toHaveLength(3);
    expect(screen.getByTestId('startup-flow-success')).toBeInTheDocument();
    expect(screen.queryByTestId('startup-flow-suite')).not.toBeInTheDocument();
    expect(screen.queryByTestId('startup-flow-case')).not.toBeInTheDocument();
    expect(screen.queryByTestId('startup-flow-passed')).not.toBeInTheDocument();
    expect(screen.getByTestId('startup-flow-visual')).not.toHaveTextContent('登录校验');
    expect(screen.getByTestId('startup-flow-visual')).not.toHaveTextContent('提交订单');
    expect(screen.getByTestId('startup-flow-visual')).not.toHaveTextContent('结果断言');
    expect(screen.getByTestId('startup-flow-visual')).not.toHaveTextContent('3 / 3 测试通过');
    const flowVisual = screen.getByTestId('startup-flow-visual');
    const capabilityCards = screen.getAllByTestId('startup-brand-capability');
    expect(capabilityCards).toHaveLength(3);
    expect(screen.queryByText('已启用的平台能力')).not.toBeInTheDocument();
    expect(flowVisual.compareDocumentPosition(capabilityCards[0])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole('heading', { level: 1, name: '欢迎来到测试的新未来' })).not.toBeInTheDocument();
    expect(screen.queryByText('98%')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('启动步骤')).not.toBeInTheDocument();
    expect(screen.queryByText('进入工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('开始测试')).not.toBeInTheDocument();
  });

  it('shows a single full-height Midscene setup screen with a skip action', () => {
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
    expect(screen.queryByLabelText('启动步骤')).not.toBeInTheDocument();
    expect(screen.queryByText('STEP 01 / 引擎')).not.toBeInTheDocument();
    expect(screen.getByText('配置 MidScene')).toBeInTheDocument();
    expect(screen.getByLabelText('MidScene 快速配置')).toBeInTheDocument();
    expect(screen.getByText('MIDSCENE_MODEL_BASE_URL')).toBeInTheDocument();
    expect(screen.getByText('MIDSCENE_MODEL_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('必填')).toBeInTheDocument();
    expect(screen.getByText('API Key 仅在本地加密存储。')).toBeInTheDocument();
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

  it('defines the Figma split layout with a mobile single-column fallback', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/luminous-precision.css'), 'utf8');
    const startupStyles = styles.slice(
      styles.indexOf('/* First-run configuration follows the same shell as the Figma onboarding view. */'),
      styles.indexOf('/* Page-specific structure sourced from the Figma workbench screens. */'),
    );
    expect(startupStyles).toMatch(
      /\.startup-shell\s*\{[^}]*grid-template-columns:\s*minmax\(360px,\s*45%\)\s*minmax\(0,\s*1fr\);/,
    );
    expect(startupStyles).toMatch(/\.startup-workspace\s*\{[^}]*overflow:\s*auto;/);
    expect(startupStyles).toContain('.startup-midscene-meta {');
    expect(startupStyles).not.toContain('.startup-header {');
    expect(startupStyles).toMatch(/\.startup-flow-visual\s*\{[^}]*animation:/);
    expect(startupStyles).toMatch(/\.startup-shell\s*\{[^}]*grid-template-columns:\s*1fr;/);
    expect(startupStyles).toMatch(
      /\.startup-test-orbit-trace,\s*\.startup-test-orbit-node\s*\{[^}]*display:\s*none;/,
    );
  });

  it('keeps the configuration workspace independently scrollable', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/luminous-precision.css'), 'utf8');
    const startupStyles = styles.slice(
      styles.indexOf('/* First-run configuration follows the same shell as the Figma onboarding view. */'),
      styles.indexOf('/* Page-specific structure sourced from the Figma workbench screens. */'),
    );

    expect(startupStyles).toMatch(/\.startup-workspace\s*\{[^}]*overflow:\s*auto;/);
    expect(startupStyles).toMatch(/\.startup-workspace-inner\s*\{[^}]*min-height:\s*100%;/);
    expect(startupStyles).toMatch(
      /\.startup-workspace \.home-midscene-card\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\);/,
    );
    expect(startupStyles).toMatch(
      /\.startup-workspace \.home-midscene-grid\s*\{[^}]*align-content:\s*start;/,
    );
    expect(startupStyles).toContain('.startup-midscene-footer {');
  });

  it('uses an animated logo hub in the Figma dark panel and preserves the 48px desktop gutter', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/luminous-precision.css'), 'utf8');
    const startupStyles = styles.slice(
      styles.indexOf('/* First-run configuration follows the same shell as the Figma onboarding view. */'),
      styles.indexOf('/* Page-specific structure sourced from the Figma workbench screens. */'),
    );

    expect(startupStyles).toMatch(/\.startup-test-hub\s*\{[^}]*width:\s*112px;/);
    expect(startupStyles).toMatch(/\.startup-test-hub\s*\{[^}]*animation:\s*startup-test-hub-pulse/);
    expect(startupStyles).toMatch(
      /\.startup-brand-panel\s*\{[^}]*grid-template-rows:\s*minmax\(320px,\s*1fr\)\s+auto;/,
    );
    expect(startupStyles).toMatch(/\.startup-workspace\s*\{[^}]*padding:\s*32px\s+48px;/);
    expect(startupStyles).toMatch(/\.startup-workspace-inner\s*\{[^}]*padding-bottom:\s*0;/);
  });
});
