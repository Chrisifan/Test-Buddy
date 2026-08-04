import { describe, expect, it } from 'vitest';

import { createInitialStudioState, type RunTestCaseResponse } from '../../shared/studio.js';
import { appendRunToStudioState } from './run-history.js';

describe('appendRunToStudioState', () => {
  it('keeps a detailed run and a bounded recent-run summary in sync', () => {
    const state = createInitialStudioState();
    const environment = {
      id: 'env-ci',
      name: 'CI',
      kind: 'staging' as const,
      url: 'https://example.test',
      entryPath: '/',
      browser: 'chromium' as const,
      viewport: 'desktop' as const,
      locale: 'zh-CN',
      headless: true,
    };
    const result: RunTestCaseResponse = {
      runId: 'run-1',
      title: '登录回归',
      detail: {
        id: 'run-1',
        projectId: 'project-web',
        testCaseId: 'case-login',
        environmentId: environment.id,
        title: '登录回归',
        status: 'passed',
        startedAt: '2026-08-03T00:00:00.000Z',
        endedAt: '2026-08-03T00:00:02.000Z',
        duration: '00:00:02',
        summary: '通过',
        logs: [],
        steps: [],
        artifacts: [],
      },
    };

    const next = appendRunToStudioState(state, result, environment, {
      ...state.browserSession,
      status: 'closed',
      message: 'CI run finished',
    });

    expect(next.runDetails).toEqual([result.detail]);
    expect(next.recentRuns).toEqual([
      expect.objectContaining({ id: 'run-1', projectId: 'project-web', environmentName: 'CI' }),
    ]);
    expect(next.browserSession.status).toBe('closed');
  });
});
