import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState } from '../../../shared/studio.js';
import { NaturalLanguagePage } from './NaturalLanguagePage.js';

const state = createInitialStudioState();

describe('NaturalLanguagePage', () => {
  it('uses Chinese workbench labels by default', () => {
    render(
      <NaturalLanguagePage
        chatInput=""
        commandMode="ai"
        deepLocate={false}
        deepThink={false}
        isRunning={false}
        isSending={false}
        midsceneConfig={state.midsceneConfig}
        onChangeChatInput={vi.fn()}
        onChangeCommandMode={vi.fn()}
        onChangeDeepLocate={vi.fn()}
        onChangeDeepThink={vi.fn()}
        onChangeTargetEnvironment={vi.fn()}
        onSavePromptAsStep={vi.fn()}
        onSendMessage={vi.fn()}
        onToggleSession={vi.fn()}
        recentChatEntries={[]}
        runtimeProfile={state.runtimeProfile}
        sessionActive={false}
        targetEnvironment="staging"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '自然语言测试' })).toBeInTheDocument();
    expect(screen.getByText('测试会话')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存为步骤' })).toBeInTheDocument();
    expect(screen.queryByText('Testing Session')).not.toBeInTheDocument();
  });
});
