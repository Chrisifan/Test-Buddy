import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

describe('App shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the startup page on first load', async () => {
    render(<App />);

    expect(await screen.findByLabelText('启动屏')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '先把 AI 测试引擎接入工作台' })).toBeInTheDocument();
  });

  it('uses the Automation Pro shell after startup is skipped', async () => {
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '跳过，进入工作台' }));

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByText('TestBuddy')).toBeInTheDocument();
    expect(container.querySelectorAll('img[src*="testbuddy-hammer-bot"]').length).toBe(2);
    expect(screen.queryByText('Project Context')).not.toBeInTheDocument();
    expect(container.querySelector('.app-topbar')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索资源...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '连接设备' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目设置' })).toBeInTheDocument();
    expect(container.querySelector('.app-project-context')).toBeNull();
    expect(screen.queryByText('Connect Device')).not.toBeInTheDocument();
    expect(container.querySelector('.app-runtimebar')).toBeInTheDocument();
  });

  it('opens application settings as a modal over the current workbench', async () => {
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '跳过，进入工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(await screen.findByRole('heading', { name: '应用设置' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(container.querySelector('.settings-page-shell')).toBeNull();
    expect(screen.getByLabelText('空态首页')).toBeInTheDocument();
  });

  it('uses an in-app confirmation dialog when deleting a project', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '跳过，进入工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '创建新项目' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除项目' }));

    const dialog = await screen.findByRole('dialog', { name: '删除此项？' });
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('确认删除项目');

    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));

    expect(await screen.findByLabelText('空态首页')).toBeInTheDocument();
    nativeConfirm.mockRestore();
  });
});
