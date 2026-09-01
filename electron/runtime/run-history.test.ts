import { describe, expect, it } from 'vitest';

import { createInitialStudioState, type RunTestCaseResponse } from '../../shared/studio.js';
import { appendRunToStudioState, appendSuiteRunToStudioState } from './run-history.js';

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
        status: 'blocked',
        startedAt: '2026-08-03T00:00:00.000Z',
        endedAt: '2026-08-03T00:00:02.000Z',
        duration: '00:00:02',
        summary: '通过',
        reason: { code: 'fixturePreflight', message: 'Fixture is unavailable.' },
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
      expect.objectContaining({
        id: 'run-1', projectId: 'project-web', environmentName: 'CI',
        reason: { code: 'fixturePreflight', message: 'Fixture is unavailable.' },
      }),
    ]);
    expect(next.browserSession.status).toBe('closed');
  });

  it('keeps Suite parent history separate from Case details and copies its provenance', () => {
    const state = createInitialStudioState();
    const legacyState = { ...state } as typeof state & { suiteRunRecords?: typeof state.suiteRunRecords };
    delete legacyState.suiteRunRecords;
    const parentRecord = {
      id: 'suite-run-1',
      provenance: {
        schemaVersion: 1 as const,
        projectId: 'project-web',
        projectRevision: 'a'.repeat(64),
        source: 'projectDirectory' as const,
        reproducibility: 'versioned' as const,
        suite: {
          reference: { id: 'suite-login', version: 1 },
          parentRunId: 'suite-run-1',
        },
        fixtures: [],
        reusableFlows: [],
        baselines: [],
        environment: {
          id: 'env-ci',
          name: 'CI',
          baseUrl: 'https://example.test',
        },
        browserProfile: { engine: 'chromium' as const, headless: true },
        executor: { appVersion: 'test-buddy-desktop', runnerVersion: 'runtime-bundle-v1' },
        model: { hasKey: false },
        createdAt: '2026-08-15T00:00:00.000Z',
      },
      startedAt: '2026-08-15T00:00:00.000Z',
      finishedAt: '2026-08-15T00:00:02.000Z',
      status: 'passed' as const,
      memberRunIds: ['case-run-1'],
      members: [{
        testCaseId: 'case-login',
        testCaseVersion: 1,
        status: 'passed' as const,
        summary: 'Case completed after a retry.',
        attempts: 2,
        flaky: true,
        runId: 'case-run-1',
        provenance: {
          schemaVersion: 1 as const,
          projectId: 'project-web',
          projectRevision: 'a'.repeat(64),
          source: 'projectDirectory' as const,
          reproducibility: 'versioned' as const,
          testCase: { id: 'case-login', version: 1 },
          suite: {
            reference: { id: 'suite-login', version: 1 },
            parentRunId: 'suite-run-1',
          },
          fixtures: [],
          reusableFlows: [{ id: 'flow-login', version: 3 }],
          baselines: [],
          environment: {
            id: 'env-ci',
            name: 'CI',
            baseUrl: 'https://example.test',
          },
          browserProfile: { engine: 'chromium' as const, headless: true },
          executor: { appVersion: 'test-buddy-desktop', runnerVersion: 'runtime-bundle-v1' },
          model: { hasKey: false },
          createdAt: '2026-08-15T00:00:00.000Z',
        },
      }],
      summary: {
        passed: 1,
        failed: 0,
        blocked: 0,
        skipped: 0,
        cancelled: 0,
        error: 0,
      },
    };

    const next = appendSuiteRunToStudioState(legacyState, parentRecord);
    parentRecord.provenance.suite.reference.version = 2;
    parentRecord.memberRunIds.push('case-run-2');
    parentRecord.members[0]!.provenance.reusableFlows[0]!.version = 4;

    expect(next.runDetails).toEqual([]);
    expect(next.suiteRunRecords).toEqual([
      expect.objectContaining({
        id: 'suite-run-1',
        provenance: expect.objectContaining({
          suite: {
            reference: { id: 'suite-login', version: 1 },
            parentRunId: 'suite-run-1',
          },
        }),
        memberRunIds: ['case-run-1'],
        members: [expect.objectContaining({
          testCaseId: 'case-login',
          attempts: 2,
          flaky: true,
          runId: 'case-run-1',
          provenance: expect.objectContaining({
            testCase: { id: 'case-login', version: 1 },
            reusableFlows: [{ id: 'flow-login', version: 3 }],
          }),
        })],
      }),
    ]);
  });
});
