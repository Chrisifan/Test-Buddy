import { describe, expect, it, vi } from 'vitest';

import { createEmptyProject, type ChatCommandRequest, type DesktopApi } from '../../shared/studio.js';
import * as runtime from './runtime.js';

const { runRecording, runWorkflow, sendChatCommand } = runtime;

const request: ChatCommandRequest = {
  mode: 'ai',
  prompt: '点击登录按钮',
  targetEnvironment: 'staging',
  deepThink: true,
  deepLocate: true,
  runtimeProfile: {
    browser: 'chromium',
    baseUrl: 'https://example.test',
    viewport: 'desktop',
    locale: 'zh-CN',
    headless: false,
  },
};

describe('browser fallback agent runtime', () => {
  it('keeps semantic actions neutral when no Midscene runtime is connected', async () => {
    const response = await sendChatCommand(request);

    expect(response.agentRun?.status).toBe('neutral');
    expect(response.agentRun?.events.find((event) => event.type === 'agent:browser-action')?.message).toContain(
      '等待 Midscene 语义定位',
    );
  });

  it('keeps parsed selectors neutral when the browser fallback cannot execute them', async () => {
    const response = await sendChatCommand({ ...request, prompt: '点击 #login-button' });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.agentRun.events.find((event) => event.type === 'agent:assertion-result')?.message).toContain(
      '浏览器 fallback 模式未执行页面动作',
    );
  });

  it('keeps workflow runs neutral instead of simulating a pass', async () => {
    const response = await runWorkflow({
      workflow: {
        id: 'workflow-login',
        kind: 'scenario',
        name: '登录流程',
        category: '核心链路',
        lastEdited: '刚刚',
        url: 'https://example.test/login',
        notes: '',
        steps: [{ id: 'step-click', type: 'ai', title: '点击登录', body: '点击登录按钮' }],
      },
      targetEnvironment: 'local',
      runtimeProfile: request.runtimeProfile,
    });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.status).toBe('neutral');
    expect(response.detail.agentRun).toBe(response.agentRun);
    expect(response.detail.summary).toContain('等待完成执行');
  });

  it('creates a neutral recording plan when desktop replay is unavailable', async () => {
    const project = createEmptyProject(1);
    const environment = project.environments[0];
    const recording = {
      id: 'recording-fallback',
      name: 'Fallback 回放',
      summary: '',
      source: 'live' as const,
      groupId: project.groups[0].id,
      environmentId: environment.id,
      startUrl: environment.url,
      comparisonGoal: '页面与基线一致',
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      steps: [],
    };

    const response = await runRecording({ project, environment, recording });

    expect(response.agentRun.status).toBe('neutral');
    expect(response.detail.status).toBe('neutral');
    expect(response.detail.agentRun).toBe(response.agentRun);
  });

  it('delegates artifact opening to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = { openArtifact: vi.fn().mockResolvedValue(undefined) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await runtime.openArtifact('/tmp/playtest-artifacts/agent-run-1-reporter.html');

    expect(desktopApi.openArtifact).toHaveBeenCalledWith('/tmp/playtest-artifacts/agent-run-1-reporter.html');
    window.desktopApi = originalDesktopApi;
  });

  it('delegates artifact export to the desktop bridge', async () => {
    const originalDesktopApi = window.desktopApi;
    const desktopApi = { exportArtifact: vi.fn().mockResolvedValue(true) } as unknown as DesktopApi;
    window.desktopApi = desktopApi;

    await expect(runtime.exportArtifact('/tmp/playtest-artifacts/agent-run-1-reporter.html')).resolves.toBe(true);

    expect(desktopApi.exportArtifact).toHaveBeenCalledWith('/tmp/playtest-artifacts/agent-run-1-reporter.html');
    window.desktopApi = originalDesktopApi;
  });
});
