import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState } from '../../../shared/studio.js';
import { NaturalLanguagePage } from './NaturalLanguagePage.js';

const state = createInitialStudioState();

describe('NaturalLanguagePage', () => {
  it('uses Chinese workbench labels by default', () => {
    render(
      <NaturalLanguagePage
        chatInput=""
        browserSession={state.browserSession}
        commandMode="ai"
        deepLocate={false}
        deepThink={false}
        isRunning={false}
        isSending={false}
        latestAgentRun={undefined}
        onChangeChatInput={vi.fn()}
        onChangeCommandMode={vi.fn()}
        onChangeDeepLocate={vi.fn()}
        onChangeDeepThink={vi.fn()}
        onChangeTargetEnvironment={vi.fn()}
        onSaveLatestRunAsTestCase={vi.fn()}
        onSavePromptAsStep={vi.fn()}
        onSendMessage={vi.fn()}
        onToggleSession={vi.fn()}
        recentChatEntries={[]}
        sessionActive={false}
        targetEnvironment="staging"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '自然语言测试' })).toBeInTheDocument();
    expect(screen.getByText('测试会话')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存为步骤' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '启动会话' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: '浏览器状态' })).toHaveTextContent('浏览器尚未连接');
    expect(screen.queryByText('当前流程步骤')).not.toBeInTheDocument();
    expect(screen.queryByText('https://app.demo-workspace.com')).not.toBeInTheDocument();
    expect(screen.queryByText('Testing Session')).not.toBeInTheDocument();

    const commandPanel = screen.getByRole('heading', { level: 2, name: '测试会话' }).closest('aside');
    const composer = screen.getByPlaceholderText('输入命令，例如：提取所有图表图例').closest('.nl-command-composer');

    expect(commandPanel).toHaveClass('grid-rows-[auto_minmax(0,1fr)_auto]');
    expect(composer).toHaveClass('shrink-0');
  });

  it('shows browser evidence only after the runtime reports a ready browser', () => {
    render(
      <NaturalLanguagePage
        browserSession={{
          ...state.browserSession,
          currentUrl: 'https://app.example.com/orders',
          message: '已捕获订单列表页面。',
          status: 'ready',
        }}
        chatInput=""
        commandMode="ai"
        deepLocate={false}
        deepThink={false}
        isRunning={false}
        isSending={false}
        latestAgentRun={undefined}
        onChangeChatInput={vi.fn()}
        onChangeCommandMode={vi.fn()}
        onChangeDeepLocate={vi.fn()}
        onChangeDeepThink={vi.fn()}
        onChangeTargetEnvironment={vi.fn()}
        onSaveLatestRunAsTestCase={vi.fn()}
        onSavePromptAsStep={vi.fn()}
        onSendMessage={vi.fn()}
        onToggleSession={vi.fn()}
        recentChatEntries={[]}
        sessionActive={true}
        targetEnvironment="staging"
      />,
    );

    const browserStatus = screen.getByRole('region', { name: '浏览器状态' });

    expect(browserStatus).toHaveTextContent('受控浏览器已连接');
    expect(browserStatus).toHaveTextContent('https://app.example.com/orders');
    expect(browserStatus).toHaveTextContent('已捕获订单列表页面。');
    expect(browserStatus).not.toHaveTextContent('浏览器尚未连接');
  });

  it('reports a closed browser truthfully even while a session remains active', () => {
    render(
      <NaturalLanguagePage
        browserSession={{
          ...state.browserSession,
          message: '受控浏览器已关闭。',
          status: 'closed',
        }}
        chatInput=""
        commandMode="ai"
        deepLocate={false}
        deepThink={false}
        isRunning={false}
        isSending={false}
        latestAgentRun={undefined}
        onChangeChatInput={vi.fn()}
        onChangeCommandMode={vi.fn()}
        onChangeDeepLocate={vi.fn()}
        onChangeDeepThink={vi.fn()}
        onChangeTargetEnvironment={vi.fn()}
        onSaveLatestRunAsTestCase={vi.fn()}
        onSavePromptAsStep={vi.fn()}
        onSendMessage={vi.fn()}
        onToggleSession={vi.fn()}
        recentChatEntries={[]}
        sessionActive={true}
        targetEnvironment="staging"
      />,
    );

    const browserStatus = screen.getByRole('region', { name: '浏览器状态' });

    expect(browserStatus).toHaveTextContent('浏览器已断开');
    expect(browserStatus).toHaveTextContent('受控浏览器已关闭。');
    expect(browserStatus).not.toHaveTextContent('正在等待浏览器事件');
  });

  it('offers the current passed run as an editable test case', () => {
    const onSaveLatestRunAsTestCase = vi.fn();
    render(
      <NaturalLanguagePage
        browserSession={state.browserSession}
        chatInput=""
        commandMode="ai"
        deepLocate={false}
        deepThink={false}
        isRunning={false}
        isSending={false}
        latestAgentRun={{ status: 'passed' }}
        onChangeChatInput={vi.fn()}
        onChangeCommandMode={vi.fn()}
        onChangeDeepLocate={vi.fn()}
        onChangeDeepThink={vi.fn()}
        onChangeTargetEnvironment={vi.fn()}
        onSaveLatestRunAsTestCase={onSaveLatestRunAsTestCase}
        onSavePromptAsStep={vi.fn()}
        onSendMessage={vi.fn()}
        onToggleSession={vi.fn()}
        recentChatEntries={[]}
        sessionActive={false}
        targetEnvironment="staging"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存为用例' }));

    expect(onSaveLatestRunAsTestCase).toHaveBeenCalledOnce();
  });
});
