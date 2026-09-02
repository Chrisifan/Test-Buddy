import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDemoStudioState } from '../../shared/studio.js';
import { I18nProvider } from '../i18n/index.js';
import { BrowserSessionPanel } from './BrowserSessionPanel.js';

const state = createDemoStudioState();
const project = state.projects[0];
const environment = project.environments[0];

const renderPanel = (locale: 'zh-CN' | 'en-US' = 'zh-CN') => {
  return render(
    <I18nProvider locale={locale}>
      <BrowserSessionPanel
        environment={environment}
        isBusy={false}
        navigateUrl={environment.url}
        onCapture={vi.fn()}
        onChangeNavigateUrl={vi.fn()}
        onNavigate={vi.fn()}
        onStartSession={vi.fn()}
        project={project}
        session={state.browserSession}
      />
    </I18nProvider>,
  );
};

describe('BrowserSessionPanel', () => {
  it('uses Chinese browser controls by default', () => {
    renderPanel();

    expect(screen.getByText('受控浏览器')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '受控浏览器会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动会话' })).toBeInTheDocument();
    expect(screen.queryByText('Controlled Browser')).not.toBeInTheDocument();
  });

  it('switches browser controls to English', () => {
    renderPanel('en-US');

    expect(screen.getByRole('heading', { name: 'Controlled Browser Session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument();
  });
});
