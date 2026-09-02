import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyProject, createEmptySuiteAsset, createEmptyTestCase, createInitialStudioState } from '../shared/studio.js';
import { cliExitCode, executeCliCommand, main, parseCliArguments, renderJUnitReport, type CliRunSummary } from './cli.js';
import { ProjectAssetStore } from './projectAssetStore.js';
import { ModelConfigResolver } from './runtime/model-config-resolver.js';
import * as runtimeBundle from './runtime/runtime-bundle.js';
import { StudioStore } from './studioStore.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('TestBuddy CLI', () => {
  it('requires explicit versioned data, project, and test case references', () => {
    expect(
      parseCliArguments([
        '--',
        'run',
        '--data-dir',
        '/workspace/testbuddy',
        '--project-id',
        'project-web',
        '--case-id',
        'case-login@2',
        '--case-id',
        'case-checkout@4',
        '--environment-id',
        'env-ci',
      ]),
    ).toEqual({
      kind: 'run',
      dataDir: '/workspace/testbuddy',
      projectId: 'project-web',
      caseReferences: [{ id: 'case-login', version: 2 }, { id: 'case-checkout', version: 4 }],
      environmentId: 'env-ci',
    });
  });

  it('rejects bare Case IDs and de-duplicates exact Case references', () => {
    expect(() => parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web', '--case-id', 'case-login',
    ])).toThrow('--case-id 必须使用 <id@version> 格式。');
    expect(parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web',
      '--case-id', 'case-login@2', '--case-id', 'case-login@2',
    ])).toMatchObject({ caseReferences: [{ id: 'case-login', version: 2 }] });
  });

  it('accepts an exact immutable Suite reference and rejects ambiguous selection mixes', () => {
    expect(parseCliArguments([
      'run',
      '--data-dir',
      '/workspace/testbuddy',
      '--project-id',
      'project-web',
      '--suite-id',
      'release/core@2',
    ])).toEqual({
      kind: 'run',
      dataDir: '/workspace/testbuddy',
      projectId: 'project-web',
      caseReferences: [],
      suiteReference: { id: 'release/core', version: 2 },
    });
    expect(() => parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web', '--suite-id', 'release@1', '--case-id', 'case-login@1',
    ])).toThrow('不能同时使用');
    expect(() => parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web', '--suite-id', 'release',
    ])).toThrow('<id@version>');
  });

  it('rejects incomplete and unknown commands before it reads state', () => {
    expect(() => parseCliArguments(['run', '--data-dir', '/workspace/testbuddy'])).toThrow(
      '--project-id',
    );
    expect(() => parseCliArguments(['run', '--data-dir', '/workspace/testbuddy', '--all'])).toThrow(
      '未知选项',
    );
    expect(() => parseCliArguments(['inspect'])).toThrow('未知命令');
  });

  it('renders each explicit terminal outcome as portable JUnit XML', () => {
    const summary: CliRunSummary = {
      command: 'run',
      status: 'failed',
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:03.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [
        {
          projectId: 'project-web',
          testCaseId: 'case-passed',
          environmentId: 'env-ci',
          title: '登录成功',
          status: 'passed',
          duration: '00:00:01',
          summary: '通过',
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-failed',
          environmentId: 'env-ci',
          title: '支付 <确认>',
          status: 'failed',
          duration: '00:00:02',
          summary: '失败',
          failureReason: '期望 "成功"，实际 <错误>',
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-error',
          environmentId: 'env-ci',
          title: '执行器异常',
          status: 'error',
          summary: '执行器崩溃',
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-blocked',
          environmentId: 'env-ci',
          title: '缺少固定资产',
          status: 'blocked',
          summary: '缺少历史版本',
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-skipped',
          environmentId: 'env-ci',
          title: '依赖失败',
          status: 'skipped',
          summary: '上游失败',
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-cancelled',
          environmentId: 'env-ci',
          title: '用户取消',
          status: 'cancelled',
          summary: '已取消',
          artifacts: [],
        },
      ],
    };

    const report = renderJUnitReport(summary);

    expect(report).toContain('tests="6" failures="1" errors="1" skipped="3" time="3.000"');
    expect(report).toContain('<failure message="期望 &quot;成功&quot;，实际 &lt;错误&gt;">');
    expect(report).toContain('<error message="执行器崩溃">');
    expect(report).toContain('<skipped message="缺少历史版本"/>');
    expect(report).toContain('<skipped message="上游失败"/>');
    expect(report).toContain('<skipped message="已取消"/>');
    expect(report).toContain('name="支付 &lt;确认&gt;" time="2.000"');
  });

  it('renders a Suite parent JUnit report with its own explicit terminal counts', () => {
    const summary: CliRunSummary = {
      command: 'run',
      status: 'failed',
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:03.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [
        {
          projectId: 'project-web',
          testCaseId: 'case-failed',
          environmentId: 'env-ci',
          title: 'Checkout',
          status: 'failed',
          duration: '00:00:02',
          summary: 'Checkout did not complete.',
          reason: { code: 'actionFailed', message: 'Payment confirmation failed.' },
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-cancelled',
          environmentId: 'env-ci',
          title: 'Cleanup',
          status: 'cancelled',
          summary: 'Suite cancelled before this Case started.',
          reason: { code: 'userCancelled', message: 'Suite cancelled before this Case started.' },
          artifacts: [],
        },
      ],
      suite: {
        id: 'release-checks',
        version: 2,
        runId: 'suite-run-1',
        status: 'failed',
        effectiveConcurrency: 1,
        issues: [],
        startedAt: '2026-08-03T00:00:00.000Z',
        finishedAt: '2026-08-03T00:00:03.000Z',
        summary: { passed: 0, failed: 1, blocked: 0, skipped: 0, cancelled: 1, error: 0 },
        members: [
          {
            testCaseId: 'case-failed',
            testCaseVersion: 3,
            status: 'failed',
            summary: 'Checkout did not complete.',
            reason: { code: 'actionFailed', message: 'Payment confirmation failed.' },
            attempts: 2,
            flaky: false,
            runId: 'run-checkout',
            provenance: {
              schemaVersion: 1, projectId: 'project-web', projectRevision: 'a'.repeat(64), source: 'projectDirectory', reproducibility: 'versioned',
              testCase: { id: 'case-failed', version: 3 }, suite: { reference: { id: 'release-checks', version: 2 }, parentRunId: 'suite-run-1' },
              fixtures: [], reusableFlows: [], baselines: [], environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
              browserProfile: { engine: 'chromium', headless: true }, executor: { appVersion: 'test-buddy-cli', runnerVersion: 'runtime-bundle-v1' }, model: { hasKey: false }, createdAt: '2026-08-03T00:00:00.000Z',
            },
          },
          {
            testCaseId: 'case-cancelled',
            testCaseVersion: 1,
            status: 'cancelled',
            summary: 'Suite cancelled before this Case started.',
            reason: { code: 'userCancelled', message: 'Suite cancelled before this Case started.' },
            attempts: 0,
            flaky: false,
            provenance: {
              schemaVersion: 1, projectId: 'project-web', projectRevision: 'a'.repeat(64), source: 'projectDirectory', reproducibility: 'versioned',
              testCase: { id: 'case-cancelled', version: 1 }, suite: { reference: { id: 'release-checks', version: 2 }, parentRunId: 'suite-run-1' },
              fixtures: [], reusableFlows: [], baselines: [], environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
              browserProfile: { engine: 'chromium', headless: true }, executor: { appVersion: 'test-buddy-cli', runnerVersion: 'runtime-bundle-v1' }, model: { hasKey: false }, createdAt: '2026-08-03T00:00:00.000Z',
            },
          },
        ],
        provenance: {
          schemaVersion: 1,
          projectId: 'project-web',
          projectRevision: 'a'.repeat(64),
          source: 'projectDirectory',
          reproducibility: 'versioned',
          suite: { reference: { id: 'release-checks', version: 2 }, parentRunId: 'suite-run-1' },
          fixtures: [],
          reusableFlows: [],
          baselines: [],
          environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
          browserProfile: { engine: 'chromium', headless: true },
          executor: { appVersion: 'test-buddy-cli', runnerVersion: 'runtime-bundle-v1' },
          model: { hasKey: false },
          createdAt: '2026-08-03T00:00:00.000Z',
        },
        reason: { code: 'actionFailed', message: 'Payment confirmation failed.' },
      },
    };

    const report = renderJUnitReport(summary);

    expect(report).toContain('<testsuites name="TestBuddy CLI" tests="2" failures="1" errors="0" skipped="1"');
    expect(report).toContain('<testsuite name="Suite release-checks@2" parentRunId="suite-run-1" status="failed" tests="2" failures="1" errors="0" skipped="1"');
    expect(report).toContain('status="failed"');
    expect(report).toContain('attempts="2"');
    expect(report).toContain('flaky="false"');
    expect(report).toContain('Suite cancelled before this Case started.');
  });

  it('renders a parent-only Suite executor error as a standard JUnit error testcase', () => {
    const summary: CliRunSummary = {
      command: 'run',
      status: 'failed',
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:01.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [],
      suite: {
        id: 'release-checks',
        version: 2,
        runId: 'suite-run-parent-error',
        status: 'error',
        effectiveConcurrency: 0,
        issues: ['Suite executor crashed before any Case could complete.'],
        startedAt: '2026-08-03T00:00:00.000Z',
        finishedAt: '2026-08-03T00:00:01.000Z',
        summary: { passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
        members: [],
        provenance: {
          schemaVersion: 1,
          projectId: 'project-web',
          projectRevision: 'a'.repeat(64),
          source: 'projectDirectory',
          reproducibility: 'versioned',
          suite: { reference: { id: 'release-checks', version: 2 }, parentRunId: 'suite-run-parent-error' },
          fixtures: [],
          reusableFlows: [],
          baselines: [],
          environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
          browserProfile: { engine: 'chromium', headless: true },
          executor: { appVersion: 'test-buddy-cli', runnerVersion: 'runtime-bundle-v1' },
          model: { hasKey: false },
          createdAt: '2026-08-03T00:00:00.000Z',
        },
        reason: { code: 'executorError', message: 'Suite executor crashed before any Case could complete.' },
      },
    };

    const report = renderJUnitReport(summary);

    expect(cliExitCode(summary)).toBe(1);
    expect(report).toContain('tests="1" failures="0" errors="1" skipped="0"');
    expect(report).toContain('<testcase classname="project-web" name="Suite release-checks@2"');
    expect(report).toContain('<error message="Suite executor crashed before any Case could complete.">');
  });

  it.each([
    ['blocked' as const, 'missingAssetVersion' as const, 'Suite preflight could not resolve its immutable assets.'],
    ['cancelled' as const, 'userCancelled' as const, 'Suite was cancelled before any Case started.'],
  ])('renders a parent-only %s Suite outcome as a standard skipped JUnit testcase', (status, reasonCode, reasonMessage) => {
    const report = renderJUnitReport({
      command: 'run',
      status: 'passed',
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:01.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [],
      suite: {
        id: 'release-checks',
        version: 2,
        runId: `suite-run-parent-${status}`,
        status,
        effectiveConcurrency: 0,
        issues: [reasonMessage],
        startedAt: '2026-08-03T00:00:00.000Z',
        finishedAt: '2026-08-03T00:00:01.000Z',
        summary: { passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
        members: [],
        provenance: {
          schemaVersion: 1,
          projectId: 'project-web',
          projectRevision: 'a'.repeat(64),
          source: 'projectDirectory',
          reproducibility: 'versioned',
          suite: { reference: { id: 'release-checks', version: 2 }, parentRunId: `suite-run-parent-${status}` },
          fixtures: [],
          reusableFlows: [],
          baselines: [],
          environment: { id: 'env-ci', name: 'CI', baseUrl: 'https://example.test' },
          browserProfile: { engine: 'chromium', headless: true },
          executor: { appVersion: 'test-buddy-cli', runnerVersion: 'runtime-bundle-v1' },
          model: { hasKey: false },
          createdAt: '2026-08-03T00:00:00.000Z',
        },
        reason: { code: reasonCode, message: reasonMessage },
      },
    });

    expect(report).toContain('tests="1" failures="0" errors="0" skipped="1"');
    expect(report).toContain('<testcase classname="project-web" name="Suite release-checks@2"');
    expect(report).toContain(`<skipped message="${reasonMessage}"/>`);
    expect(report).toContain(`reasonCode="${reasonCode}" reason="${reasonMessage}"`);
  });

  it('prefers a structured reason message over legacy JUnit failure fields', () => {
    const report = renderJUnitReport({
      command: 'run',
      status: 'failed',
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:01.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [{
        projectId: 'project-web',
        testCaseId: 'case-failed',
        environmentId: 'env-ci',
        title: 'Structured reason wins',
        status: 'failed',
        summary: 'Summary must not be used.',
        failureReason: 'Legacy failure reason must not be used.',
        reason: { code: 'assertionFailed', message: 'Structured reason must be used.' },
        artifacts: [],
      }],
    });

    expect(report).toContain('<failure message="Structured reason must be used.">Structured reason must be used.</failure>');
    expect(report).not.toContain('Legacy failure reason must not be used.');
  });

  it('removes XML-invalid controls while preserving permitted whitespace and escaped JUnit text', () => {
    const invalidControls = '\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000B\u000C\u000E\u000F\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A\u001B\u001C\u001D\u001E\u001F\uD800';
    const report = renderJUnitReport({
      command: 'run',
      status: 'failed',
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:01.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [{
        projectId: 'project-web',
        testCaseId: 'case-invalid-xml',
        environmentId: 'env-ci',
        title: `Case${invalidControls}\tTitle\nLine\rReturn <&>"'`,
        status: 'failed',
        summary: `Summary${invalidControls}\tDetail\nNext\rReturn <&>"'`,
        artifacts: [],
      }],
    });

    expect(report).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/);
    expect(report).toContain('name="Case\tTitle\nLine\rReturn &lt;&amp;&gt;&quot;&apos;"');
    expect(report).toContain('<system-out>Summary\tDetail\nNext\rReturn &lt;&amp;&gt;&quot;&apos;</system-out>');
  });

  it('returns a nonzero CLI exit code only for failed and error results', () => {
    const summary = {
      command: 'run' as const,
      status: 'passed' as const,
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:00.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [{
        projectId: 'project-web',
        testCaseId: 'case-blocked',
        environmentId: 'env-ci',
        title: 'Blocked Case',
        status: 'blocked' as const,
        summary: 'Missing historical asset',
        artifacts: [],
      }],
    } satisfies CliRunSummary;

    expect(cliExitCode(summary)).toBe(0);
    expect(cliExitCode({ ...summary, results: [{ ...summary.results[0]!, status: 'skipped' }] })).toBe(0);
    expect(cliExitCode({ ...summary, results: [{ ...summary.results[0]!, status: 'cancelled' }] })).toBe(0);
    expect(cliExitCode({ ...summary, results: [{ ...summary.results[0]!, status: 'failed' }] })).toBe(1);
    expect(cliExitCode({ ...summary, results: [{ ...summary.results[0]!, status: 'error' }] })).toBe(1);
  });

  it('creates CI reports from an explicit data directory without starting Electron', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    project.testCases = [
      {
        id: 'case-agent',
        kind: 'scenario',
        name: '需要模型的用例',
        category: '回归',
        lastEdited: new Date(0).toISOString(),
        url: environment.url,
        notes: '',
        groupId: project.groups[0]!.id,
        environmentId: environment.id,
        source: 'manual',
        steps: [{ id: 'step-agent', type: 'ai', title: '执行', body: '点击登录按钮' }],
      },
    ];
    const state = createInitialStudioState();
    state.projects = [project];
    await new StudioStore(directory).save(state);

    const summary = await executeCliCommand({
      kind: 'run',
      dataDir: directory,
      projectId: project.id,
      caseReferences: [{ id: 'case-agent', version: 1 }],
    });

    expect(summary.status).toBe('passed');
    expect(summary.results).toEqual([
      expect.objectContaining({ testCaseId: 'case-agent', status: 'blocked', failureReason: 'Midscene 模型未配置。' }),
    ]);
    await expect(fs.readFile(summary.reports.junit, 'utf8')).resolves.toContain('该 Agent 用例需要已配置的 Midscene 模型，当前数据目录未包含可用模型配置。');
  });

  it('adds status-matched fallback reasons to direct non-passed Case output', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-fallback-reasons-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const outcomes = [
      { status: 'failed', code: 'actionFailed' },
      { status: 'blocked', code: 'unsupportedAction' },
      { status: 'skipped', code: 'dependencyFailed' },
      { status: 'cancelled', code: 'userCancelled' },
      { status: 'error', code: 'executorError' },
    ] as const;
    project.testCases = outcomes.map((outcome) => ({
      id: `case-${outcome.status}`,
      version: 1,
      kind: 'scenario' as const,
      name: `${outcome.status} Case`,
      category: '',
      lastEdited: '',
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual' as const,
      steps: [{ id: `step-${outcome.status}`, type: 'manual' as const, title: 'Run', body: 'Run' }],
    }));
    const state = createInitialStudioState();
    state.projects = [project];
    await new StudioStore(directory).save(state);
    const runTestCase = vi.fn(async (request: { testCase: { id: string; name: string } }) => {
      const outcome = outcomes.find((candidate) => request.testCase.id === `case-${candidate.status}`);
      if (!outcome) throw new Error('Unexpected Case.');
      return {
        runId: `run-${outcome.status}`,
        title: request.testCase.name,
        detail: {
          id: `run-${outcome.status}`,
          projectId: project.id,
          testCaseId: request.testCase.id,
          environmentId: environment.id,
          title: request.testCase.name,
          status: outcome.status,
          startedAt: '2026-08-14T00:00:00.000Z',
          endedAt: '2026-08-14T00:00:01.000Z',
          duration: '00:00:01',
          summary: `${outcome.status} summary`,
          ...(outcome.status === 'failed' ? { failureReason: 'Failure details' } : {}),
          logs: [],
          steps: [],
          artifacts: [],
        },
      };
    });
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase,
      browserRuntime: { getState: vi.fn(() => state.browserSession) },
      close: vi.fn(),
    } as never);

    const summary = await executeCliCommand({
      kind: 'run',
      dataDir: directory,
      projectId: project.id,
      caseReferences: outcomes.map((outcome) => ({ id: `case-${outcome.status}`, version: 1 })),
    });

    expect(summary.results.map((result) => ({
      status: result.status,
      reason: result.reason,
    }))).toEqual(outcomes.map((outcome) => ({
      status: outcome.status,
      reason: { code: outcome.code, message: `${outcome.status} summary` },
    })));
    expect(summary.results.find((result) => result.status === 'failed')).toMatchObject({
      failureReason: 'Failure details',
    });
    const persisted = await new StudioStore(directory).loadExisting();
    expect(persisted.runDetails).toEqual(expect.arrayContaining(outcomes.map((outcome) =>
      expect.objectContaining({
        testCaseId: `case-${outcome.status}`,
        status: outcome.status,
        reason: { code: outcome.code, message: `${outcome.status} summary` },
      }),
    )));
  });

  it('appends a Case run to the latest concurrent Studio state', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-concurrent-case-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-concurrent', version: 1, kind: 'scenario' as const, name: 'Concurrent Case', category: '', lastEdited: '',
      url: environment.url, notes: '', groupId: project.groups[0]!.id, environmentId: environment.id,
      source: 'manual' as const, steps: [{ id: 'step-case', type: 'manual' as const, title: '检查', body: '检查' }],
    };
    project.testCases = [testCase];
    const initialState = createInitialStudioState();
    initialState.projects = [project];
    const store = new StudioStore(directory);
    await store.save(initialState);

    let startRun!: () => void;
    let resolveRun!: (result: { runId: string; title: string; detail: Record<string, unknown> }) => void;
    const runStarted = new Promise<void>((resolve) => { startRun = resolve; });
    const runResult = new Promise<{ runId: string; title: string; detail: Record<string, unknown> }>((resolve) => { resolveRun = resolve; });
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase: vi.fn(async () => {
        startRun();
        return runResult;
      }),
      browserRuntime: { getState: vi.fn(() => initialState.browserSession) },
      close: vi.fn(),
    } as never);

    const command = parseCliArguments([
      'run', '--data-dir', directory, '--project-id', project.id, '--case-id', 'case-concurrent@1',
    ]);
    if (command.kind === 'help') throw new Error('Expected run command.');
    const pending = executeCliCommand(command);
    await runStarted;
    const concurrentState = await store.loadExisting();
    concurrentState.projects[0]!.description = 'Concurrent project change';
    concurrentState.projectAssetBindings = [{
      projectId: project.id,
      projectDirectory: path.join(directory, 'concurrent-binding'),
      revision: 'a'.repeat(64),
      boundAt: '2026-08-14T00:00:00.000Z',
    }];
    concurrentState.midsceneConfig.modelName = 'concurrent-model';
    await store.save(concurrentState);
    resolveRun({
      runId: 'run-concurrent',
      title: testCase.name,
      detail: {
        id: 'run-concurrent', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
        title: testCase.name, status: 'passed', startedAt: '2026-08-14T00:00:00.000Z', endedAt: '2026-08-14T00:00:01.000Z',
        duration: '00:00:01', summary: 'passed', logs: [], steps: [], artifacts: [],
      },
    });
    await pending;

    const persisted = await store.loadExisting();
    expect(persisted.projects[0]!.description).toBe('Concurrent project change');
    expect(persisted.projectAssetBindings).toEqual(concurrentState.projectAssetBindings);
    expect(persisted.midsceneConfig.modelName).toBe('concurrent-model');
    expect(persisted.runDetails.map((detail) => detail.id)).toContain('run-concurrent');
  });

  it('serializes Suite run persistence against concurrent Studio edits', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-concurrent-suite-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-suite-concurrent', version: 1, kind: 'scenario' as const, name: 'Concurrent Suite Case', category: '', lastEdited: '',
      url: environment.url, notes: '', groupId: project.groups[0]!.id, environmentId: environment.id,
      source: 'manual' as const, steps: [{ id: 'step-suite', type: 'manual' as const, title: '检查', body: '检查' }],
    };
    project.testCases = [testCase];
    project.suites = [{
      schemaVersion: 1, id: 'suite-concurrent', version: 1, name: 'Concurrent Suite', description: '', tags: [], environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: 1, dependsOn: [] }],
      execution: { concurrency: 2, failurePolicy: 'continue', retryLimit: 0 },
      createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
    }];
    const initialState = createInitialStudioState();
    initialState.projects = [project];
    const store = new StudioStore(directory);
    await store.save(initialState);

    let startRun!: () => void;
    let resolveRun!: (result: { runId: string; title: string; detail: Record<string, unknown> }) => void;
    const runStarted = new Promise<void>((resolve) => { startRun = resolve; });
    const runResult = new Promise<{ runId: string; title: string; detail: Record<string, unknown> }>((resolve) => { resolveRun = resolve; });
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase: vi.fn(async () => {
        startRun();
        return runResult;
      }),
      browserRuntime: { getState: vi.fn(() => initialState.browserSession) },
      close: vi.fn(),
    } as never);

    const pending = executeCliCommand({
      kind: 'run', dataDir: directory, projectId: project.id, caseReferences: [], suiteReference: { id: 'suite-concurrent', version: 1 },
    });
    await runStarted;
    const concurrentState = await store.loadExisting();
    concurrentState.projects[0]!.description = 'Concurrent Suite project change';
    concurrentState.projectAssetBindings = [{
      projectId: project.id,
      projectDirectory: path.join(directory, 'concurrent-suite-binding'),
      revision: 'b'.repeat(64),
      boundAt: '2026-08-14T00:00:00.000Z',
    }];
    concurrentState.midsceneConfig.modelName = 'concurrent-suite-model';
    await store.save(concurrentState);
    resolveRun({
      runId: 'run-suite-concurrent',
      title: testCase.name,
      detail: {
        id: 'run-suite-concurrent', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
        title: testCase.name, status: 'passed', startedAt: '2026-08-14T00:00:00.000Z', endedAt: '2026-08-14T00:00:01.000Z',
        duration: '00:00:01', summary: 'passed', logs: [], steps: [], artifacts: [],
      },
    });
    await pending;

    const persisted = await store.loadExisting();
    expect(persisted.projects[0]!.description).toBe('Concurrent Suite project change');
    expect(persisted.projectAssetBindings).toEqual(concurrentState.projectAssetBindings);
    expect(persisted.midsceneConfig.modelName).toBe('concurrent-suite-model');
    expect(persisted.runDetails.map((detail) => detail.id)).toContain('run-suite-concurrent');
  });

  it('runs a fixed Suite reference through the shared scheduler without allowing an environment override', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-suite-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    project.testCases = [{
      id: 'case-agent',
      kind: 'scenario',
      name: '需要模型的 Suite 用例',
      category: '回归',
      lastEdited: new Date(0).toISOString(),
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual',
      steps: [{ id: 'step-agent', type: 'ai', title: '执行', body: '点击登录按钮' }],
    }];
    project.suites = [{
      schemaVersion: 1,
      id: 'suite-release',
      version: 1,
      name: '发布 Suite',
      description: '',
      tags: ['release'],
      environmentId: environment.id,
      caseReferences: [{ id: 'case-agent', version: 1, dependsOn: [] }],
      execution: { concurrency: 3, failurePolicy: 'failFast', retryLimit: 0 },
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    }];
    const state = createInitialStudioState();
    state.projects = [project];
    state.midsceneConfig.modelSecret = {
      id: 'midscene',
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    state.midsceneConfig.modelBaseUrl = 'https://suite-cli-user:suite-cli-password@models.example.test/v1?tenant=secret';
    await new StudioStore(directory).save(state);

    const summary = await executeCliCommand({
      kind: 'run',
      dataDir: directory,
      projectId: project.id,
      caseReferences: [],
      suiteReference: { id: 'suite-release', version: 1 },
    });

    expect(summary.status).toBe('passed');
    expect(summary.suite).toMatchObject({ id: 'suite-release', version: 1, status: 'blocked', effectiveConcurrency: 1, issues: [] });
    expect(summary.suite).toMatchObject({
      provenance: {
        projectId: project.id,
        projectRevision: expect.any(String),
        source: 'legacyStudioStore',
        reproducibility: 'legacy',
        suite: {
          reference: { id: 'suite-release', version: 1 },
          parentRunId: expect.stringMatching(/^cli-suite-run-/u),
        },
        environment: { id: environment.id, name: environment.name },
        model: { hasKey: true },
      },
    });
    expect(JSON.stringify(summary)).not.toContain('https://suite-cli-user:suite-cli-password@models.example.test/v1?tenant=secret');
    expect(summary.results).toEqual([
      expect.objectContaining({ testCaseId: 'case-agent', status: 'blocked', attempts: 1, flaky: false }),
    ]);
    expect(() => parseCliArguments([
      'run', '--data-dir', directory, '--project-id', project.id, '--suite-id', 'suite-release@1', '--environment-id', environment.id,
    ])).toThrow('固定目标环境');
  });

  it('preserves already persisted Suite children when terminal parent persistence fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-suite-parent-retry-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-preserved-child',
      name: 'Persisted child',
      steps: [{ id: 'step-preserved-child', type: 'manual' as const, title: 'Manual child', body: 'Complete the child.' }],
    };
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-preserve-child-links',
      environmentId: environment.id,
      caseReferences: [{ id: testCase.id, version: testCase.version ?? 1, dependsOn: [] }],
      execution: { concurrency: 1, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    project.testCases = [testCase];
    project.suites = [suite];
    const state = createInitialStudioState();
    state.projects = [project];
    await new StudioStore(directory).save(state);

    const originalSave = StudioStore.prototype.save;
    let saveCount = 0;
    const saveSpy = vi.spyOn(StudioStore.prototype, 'save');
    saveSpy.mockImplementation(async (nextState) => {
      saveCount += 1;
      if (saveCount === 4) {
        throw new Error('terminal parent persistence failed');
      }
      const currentStore = saveSpy.mock.instances[saveCount - 1] as StudioStore;
      return originalSave.call(currentStore, nextState);
    });
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase: vi.fn().mockResolvedValue({
        runId: 'run-preserved-child',
        title: testCase.name,
        detail: {
          id: 'run-preserved-child', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
          title: testCase.name, status: 'passed', startedAt: '2026-08-22T00:00:00.000Z', endedAt: '2026-08-22T00:00:01.000Z',
          duration: '00:00:01', summary: 'passed', logs: [], steps: [], artifacts: [],
        },
      }),
      browserRuntime: { getState: vi.fn(() => state.browserSession) },
      close: vi.fn(),
    } as never);

    const summary = await executeCliCommand({
      kind: 'run', dataDir: directory, projectId: project.id, caseReferences: [], suiteReference: { id: suite.id, version: suite.version },
    });

    expect(summary).toMatchObject({
      status: 'failed',
      results: [expect.objectContaining({ runId: 'run-preserved-child', status: 'passed' })],
      suite: {
        status: 'error',
        members: [expect.objectContaining({ runId: 'run-preserved-child', status: 'passed' })],
      },
    });
    const persisted = await new StudioStore(directory).loadExisting();
    expect(persisted.suiteRunRecords).toEqual([
      expect.objectContaining({
        status: 'error',
        memberRunIds: ['run-preserved-child'],
        summary: { passed: 1, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
        members: [expect.objectContaining({ runId: 'run-preserved-child', status: 'passed' })],
      }),
    ]);
  });

  it('persists an empty Suite preflight parent without requiring a JSON report', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-suite-preflight-history-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    project.suites = [{
      schemaVersion: 1, id: 'suite-empty', version: 1, name: 'Empty Suite', description: '', tags: [], environmentId: environment.id,
      caseReferences: [], execution: { concurrency: 1, failurePolicy: 'continue', retryLimit: 0 },
      createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
    }];
    const state = createInitialStudioState();
    state.projects = [project];
    state.midsceneConfig.modelSecret = {
      id: 'midscene',
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    state.midsceneConfig.modelBaseUrl = 'https://empty-suite-user:empty-suite-password@models.example.test/v1?tenant=secret';
    await new StudioStore(directory).save(state);
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(), runTestCase: vi.fn(), browserRuntime: { getState: vi.fn(() => state.browserSession) }, close: vi.fn(),
    } as never);

    const summary = await executeCliCommand({
      kind: 'run', dataDir: directory, projectId: project.id, caseReferences: [], suiteReference: { id: 'suite-empty', version: 1 },
    });

    expect(summary.reports.json).toBeUndefined();
    expect(summary.results).toEqual([]);
    expect(summary.suite).toMatchObject({
      status: 'blocked',
      reason: { code: 'missingAssetVersion' },
      provenance: { suite: { reference: { id: 'suite-empty', version: 1 } } },
    });
    const persisted = await new StudioStore(directory).loadExisting();
    expect(persisted.suiteRunRecords).toEqual([
      expect.objectContaining({
        id: summary.suite!.provenance.suite.parentRunId,
        provenance: summary.suite!.provenance,
        status: summary.suite!.status,
        reasonCode: summary.suite!.reason?.code,
        memberRunIds: [],
        summary: { passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, error: 0 },
      }),
    ]);
    const serializedHistory = JSON.stringify(persisted.suiteRunRecords);
    expect(serializedHistory).not.toContain('https://empty-suite-user:empty-suite-password@models.example.test/v1?tenant=secret');
  });

  it('serializes structured reasons for every non-passed Suite outcome', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-suite-scheduler-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const agentCase = {
      id: 'case-agent', version: 1, kind: 'scenario' as const, name: 'Agent Case', category: '', lastEdited: '',
      url: environment.url, notes: '', groupId: project.groups[0]!.id, environmentId: environment.id,
      source: 'manual' as const, steps: [{ id: 'step-agent', type: 'ai' as const, title: 'Agent', body: 'Agent' }],
    };
    const erroredCase = {
      id: 'case-error', version: 1, kind: 'scenario' as const, name: 'Error Case', category: '', lastEdited: '',
      url: environment.url, notes: '', groupId: project.groups[0]!.id, environmentId: environment.id,
      source: 'manual' as const, steps: [{ id: 'step-error', type: 'manual' as const, title: 'Error', body: 'Error' }],
    };
    const cancelledCase = {
      id: 'case-cancelled', version: 1, kind: 'scenario' as const, name: 'Cancelled Case', category: '', lastEdited: '',
      url: environment.url, notes: '', groupId: project.groups[0]!.id, environmentId: environment.id,
      source: 'manual' as const, steps: [{ id: 'step-cancelled', type: 'manual' as const, title: 'Cancelled', body: 'Cancelled' }],
    };
    const dependentCase = {
      id: 'case-dependent', version: 1, kind: 'scenario' as const, name: 'Dependent Case', category: '', lastEdited: '',
      url: environment.url, notes: '', groupId: project.groups[0]!.id, environmentId: environment.id,
      source: 'manual' as const, steps: [{ id: 'step-dependent', type: 'manual' as const, title: 'Dependent', body: 'Dependent' }],
    };
    project.testCases = [agentCase, erroredCase, cancelledCase, dependentCase];
    project.suites = [{
      schemaVersion: 1, id: 'suite-mixed', version: 1, name: 'Mixed Suite', description: '', tags: [], environmentId: environment.id,
      caseReferences: [
        { id: agentCase.id, version: 1, dependsOn: [] },
        { id: erroredCase.id, version: 1, dependsOn: [] },
        { id: cancelledCase.id, version: 1, dependsOn: [] },
        { id: dependentCase.id, version: 1, dependsOn: [{ id: agentCase.id, version: 1 }] },
      ],
      execution: { concurrency: 3, failurePolicy: 'continue', retryLimit: 0 },
      createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
    }];
    const state = createInitialStudioState();
    state.projects = [project];
    state.midsceneConfig.modelSecret = {
      id: 'midscene',
      hasKey: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    state.midsceneConfig.modelBaseUrl = 'https://suite-member-user:suite-member-password@models.example.test/v1?tenant=secret';
    await new StudioStore(directory).save(state);
    const runTestCase = vi.fn(async (request: { testCase: typeof erroredCase }) => ({
      runId: `run-${request.testCase.id}`,
      title: request.testCase.name,
      detail: {
        id: `run-${request.testCase.id}`, projectId: project.id, testCaseId: request.testCase.id, environmentId: environment.id,
        title: request.testCase.name,
        ...(request.testCase.id === erroredCase.id
          ? {
              status: 'error' as const,
              summary: 'Executor crashed.',
            }
          : {
              status: 'cancelled' as const,
              summary: 'Cancelled by user.',
            }),
        startedAt: '2026-08-14T00:00:00.000Z', endedAt: '2026-08-14T00:00:01.000Z',
        duration: '00:00:01', logs: [], steps: [], artifacts: [],
      },
    }));
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(), runTestCase, browserRuntime: { getState: vi.fn(() => state.browserSession) }, close: vi.fn(),
    } as never);

    const summary = await executeCliCommand({
      kind: 'run', dataDir: directory, projectId: project.id, caseReferences: [], suiteReference: { id: 'suite-mixed', version: 1 },
    });

    expect(JSON.parse(JSON.stringify(summary))).toMatchObject({
      suite: { status: 'error', reason: { code: 'executorError', message: 'Executor crashed.' } },
      results: expect.arrayContaining([
        expect.objectContaining({
          testCaseId: agentCase.id,
          status: 'blocked',
          reason: {
            code: 'credentialUnavailable',
            message: '该 Agent 用例需要已配置的 Midscene 模型，当前数据目录未包含可用模型配置。',
          },
        }),
        expect.objectContaining({ testCaseId: erroredCase.id, status: 'error', reason: { code: 'executorError', message: 'Executor crashed.' } }),
        expect.objectContaining({ testCaseId: cancelledCase.id, status: 'cancelled', reason: { code: 'userCancelled', message: 'Cancelled by user.' } }),
        expect.objectContaining({
          testCaseId: dependentCase.id,
          status: 'skipped',
          reason: { code: 'dependencyFailed', message: 'A required Suite dependency did not pass.' },
        }),
      ]),
    });
    expect(runTestCase).toHaveBeenCalledTimes(2);

    const suiteMembership = summary.suite!.provenance.suite;
    expect(suiteMembership).toMatchObject({
      reference: { id: 'suite-mixed', version: 1 },
      parentRunId: expect.stringMatching(/^cli-suite-run-/u),
    });
    expect(summary.results).toHaveLength(4);
    summary.results.forEach((result) => {
      expect(result.provenance?.suite).toEqual(suiteMembership);
    });

    const persisted = await new StudioStore(directory).loadExisting();
    expect(summary.suite).toMatchObject({
      runId: suiteMembership.parentRunId,
      summary: { passed: 0, failed: 0, blocked: 1, skipped: 1, cancelled: 1, error: 1 },
      members: expect.arrayContaining([
        expect.objectContaining({ testCaseId: erroredCase.id, status: 'error', attempts: 1, flaky: false, reason: { code: 'executorError', message: 'Executor crashed.' } }),
        expect.objectContaining({ testCaseId: cancelledCase.id, status: 'cancelled', attempts: 1, flaky: false, reason: { code: 'userCancelled', message: 'Cancelled by user.' } }),
        expect.objectContaining({ testCaseId: dependentCase.id, status: 'skipped', attempts: 0, flaky: false, reason: { code: 'dependencyFailed', message: 'A required Suite dependency did not pass.' } }),
      ]),
    });
    expect(persisted.suiteRunRecords).toEqual([
      expect.objectContaining({
        id: suiteMembership.parentRunId,
        memberRunIds: expect.arrayContaining(persisted.runDetails.map((detail) => detail.id)),
        members: expect.arrayContaining([
          expect.objectContaining({ testCaseId: erroredCase.id, provenance: expect.objectContaining({ testCase: { id: erroredCase.id, version: 1 }, suite: suiteMembership }) }),
        ]),
      }),
    ]);
    expect(persisted.runDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        testCaseId: agentCase.id,
        status: 'blocked',
        reason: {
          code: 'credentialUnavailable',
          message: '该 Agent 用例需要已配置的 Midscene 模型，当前数据目录未包含可用模型配置。',
        },
        provenance: expect.objectContaining({ suite: suiteMembership }),
      }),
      expect.objectContaining({
        testCaseId: erroredCase.id,
        reason: { code: 'executorError', message: 'Executor crashed.' },
        provenance: expect.objectContaining({ suite: suiteMembership }),
      }),
      expect.objectContaining({
        testCaseId: cancelledCase.id,
        reason: { code: 'userCancelled', message: 'Cancelled by user.' },
        provenance: expect.objectContaining({ suite: suiteMembership }),
      }),
      expect.objectContaining({
        testCaseId: dependentCase.id,
        status: 'skipped',
        reason: { code: 'dependencyFailed', message: 'A required Suite dependency did not pass.' },
        provenance: expect.objectContaining({ suite: suiteMembership }),
      }),
    ]));
    expect(persisted.runDetails).toHaveLength(4);
    persisted.runDetails.forEach((detail) => {
      expect(detail.provenance?.suite).toEqual(suiteMembership);
    });
    expect(JSON.stringify(persisted.runDetails)).not.toContain('https://suite-member-user:suite-member-password@models.example.test/v1?tenant=secret');
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain('https://suite-member-user:suite-member-password@models.example.test/v1?tenant=secret');
  });

  it('persists an executor exception as a terminal Case RunDetail', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-persist-executor-error-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      id: 'case-executor-error', version: 1, kind: 'scenario' as const, name: 'Executor Error Case', category: '', lastEdited: '',
      url: environment.url, notes: '', groupId: project.groups[0]!.id, environmentId: environment.id,
      source: 'manual' as const, steps: [{ id: 'step-executor-error', type: 'manual' as const, title: 'Run', body: 'Run' }],
    };
    project.testCases = [testCase];
    const state = createInitialStudioState();
    state.projects = [project];
    await new StudioStore(directory).save(state);
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase: vi.fn(async () => {
        throw new Error('Browser runtime stopped unexpectedly.');
      }),
      browserRuntime: { getState: vi.fn(() => state.browserSession) },
      close: vi.fn(),
    } as never);

    const summary = await executeCliCommand({
      kind: 'run', dataDir: directory, projectId: project.id, caseReferences: [{ id: testCase.id, version: testCase.version ?? 1 }],
    });

    expect(summary.results).toEqual([
      expect.objectContaining({
        testCaseId: testCase.id,
        status: 'error',
        reason: { code: 'executorError', message: '执行异常：Browser runtime stopped unexpectedly.' },
      }),
    ]);
    const persisted = await new StudioStore(directory).loadExisting();
    expect(persisted.runDetails).toEqual([
      expect.objectContaining({
        projectId: project.id,
        testCaseId: testCase.id,
        environmentId: environment.id,
        status: 'error',
        reason: { code: 'executorError', message: '执行异常：Browser runtime stopped unexpectedly.' },
        provenance: summary.results[0]!.provenance,
      }),
    ]);
  });

  it('returns an operational failure for an unavailable bound project directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-unavailable-binding-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const state = createInitialStudioState();
    state.projects = [project];
    state.projectAssetBindings = [{
      projectId: project.id,
      projectDirectory: path.join(directory, 'missing-bound-project'),
      revision: 'a'.repeat(64),
      boundAt: '2026-08-14T00:00:00.000Z',
    }];
    await new StudioStore(directory).save(state);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(main([
      'run', '--data-dir', directory, '--project-id', project.id, '--case-id', 'case-login@1',
    ])).resolves.toBe(1);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('无法读取项目'));
  });

  it('runs the exact Case revision from a bound project snapshot instead of a newer StudioStore draft', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-bound-case-'));
    temporaryDirectories.push(directory);
    const snapshotProject = createEmptyProject(1);
    const environment = snapshotProject.environments[0]!;
    snapshotProject.id = 'project-bound-case';
    snapshotProject.testCases = [{
      id: 'case-login', version: 1, kind: 'scenario', name: 'Snapshot Case v1', category: '回归', lastEdited: '',
      url: environment.url, notes: '', groupId: snapshotProject.groups[0]!.id, environmentId: environment.id,
      source: 'manual', steps: [{ id: 'step-v1', type: 'manual', title: '执行 v1', body: '执行 v1' }],
    }];
    const projectDirectory = path.join(directory, 'bound-project');
    const assetStore = new ProjectAssetStore(projectDirectory);
    await assetStore.saveInitial(snapshotProject);
    const snapshot = await assetStore.loadWithRevision();
    const stateProject = structuredClone(snapshotProject);
    stateProject.testCases = [{
      ...stateProject.testCases[0]!, version: 2, name: 'Mutable StudioStore Case v2', steps: [{ id: 'step-v2', type: 'manual', title: '执行 v2', body: '执行 v2' }],
    }];
    const state = createInitialStudioState();
    state.projects = [stateProject];
    state.projectAssetBindings = [{
      projectId: snapshotProject.id,
      projectDirectory,
      revision: snapshot.revision,
      boundAt: '2026-08-14T00:00:00.000Z',
    }];
    await new StudioStore(directory).save(state);
    const runTestCase = vi.fn(async (request: { testCase: typeof snapshotProject.testCases[number]; environment: typeof environment }) => ({
      runId: 'run-snapshot-v1',
      title: request.testCase.name,
      detail: {
        id: 'run-snapshot-v1', projectId: snapshotProject.id, testCaseId: request.testCase.id, environmentId: request.environment.id,
        title: request.testCase.name, status: 'passed' as const, startedAt: '2026-08-14T00:00:00.000Z', endedAt: '2026-08-14T00:00:01.000Z',
        duration: '00:00:01', summary: 'passed', logs: [], steps: [], artifacts: [],
      },
    }));
    vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(), runTestCase, browserRuntime: { getState: vi.fn(() => state.browserSession) }, close: vi.fn(),
    } as never);

    const command = parseCliArguments([
      'run', '--data-dir', directory, '--project-id', snapshotProject.id, '--case-id', 'case-login@1',
    ]);
    if (command.kind === 'help') throw new Error('Expected run command.');
    const summary = await executeCliCommand(command);

    expect(summary.results).toEqual([
      expect.objectContaining({ testCaseId: 'case-login', title: 'Snapshot Case v1', status: 'passed' }),
    ]);
    expect(summary.results[0]?.provenance).toMatchObject({
      projectRevision: snapshot.revision,
      testCase: { id: 'case-login', version: 1 },
      environment: { id: environment.id },
    });
    expect(runTestCase).toHaveBeenCalledWith(expect.objectContaining({
      projectSnapshot: expect.objectContaining({
        source: 'projectDirectory',
        project: expect.objectContaining({
          testCases: [expect.objectContaining({ id: 'case-login', version: 1, name: 'Snapshot Case v1' })],
        }),
      }),
      testCase: expect.objectContaining({ id: 'case-login', version: 1, name: 'Snapshot Case v1' }),
      environment: expect.objectContaining({ id: environment.id }),
    }));
  });

  it('injects the lazy controlled worker pool into the CLI runtime bundle', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-worker-pool-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-cli-worker-pool',
      version: 1,
    };
    project.testCases = [testCase];
    const state = createInitialStudioState();
    state.projects = [project];
    await new StudioStore(directory).save(state);
    const createBundle = vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase: vi.fn().mockResolvedValue({
        runId: 'run-cli-worker-pool',
        title: testCase.name,
        detail: {
          id: 'run-cli-worker-pool', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
          title: testCase.name, status: 'passed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(),
          duration: '00:00:00', summary: 'Passed', logs: [], steps: [], artifacts: [],
        },
      }),
      browserRuntime: { getState: vi.fn(() => state.browserSession) },
      close: vi.fn(),
    } as never);

    await executeCliCommand({
      kind: 'run', dataDir: directory, projectId: project.id, caseReferences: [{ id: testCase.id, version: testCase.version! }],
    });

    const [options] = createBundle.mock.calls[0]!;
    expect(options.browserPool).toMatchObject({ maxConcurrency: 2, activeLeaseCount: 0 });
  });

  it('injects a lazy main-only interaction policy that resolves configured model secrets', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-interaction-policy-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-cli-interaction-policy',
      version: 1,
    };
    project.testCases = [testCase];
    const state = createInitialStudioState();
    state.projects = [project];
    state.midsceneConfig.modelSecret = { id: 'midscene', hasKey: true, updatedAt: new Date(0).toISOString() };
    await new StudioStore(directory).save(state);
    const resolvedSecret = 'cli-resolved-secret-must-not-leak';
    const resolveModelConfigs = vi.spyOn(ModelConfigResolver.prototype, 'resolve').mockResolvedValue({
      midsceneConfig: { ...state.midsceneConfig, modelApiKey: resolvedSecret },
      agentModelConfig: Object.fromEntries(
        ['planner', 'executor', 'verifier', 'reporter'].map((role) => [role, { modelApiKey: '' }]),
      ),
    } as never);
    const createBundle = vi.spyOn(runtimeBundle, 'createRuntimeBundle').mockReturnValue({
      ensureReady: vi.fn(),
      runTestCase: vi.fn().mockResolvedValue({
        runId: 'run-cli-interaction-policy',
        title: testCase.name,
        detail: {
          id: 'run-cli-interaction-policy', projectId: project.id, testCaseId: testCase.id, environmentId: environment.id,
          title: testCase.name, status: 'passed', startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(),
          duration: '00:00:00', summary: 'Passed', logs: [], steps: [], artifacts: [],
        },
      }),
      browserRuntime: { getState: vi.fn(() => state.browserSession) },
      close: vi.fn(),
    } as never);

    const summary = await executeCliCommand({
      kind: 'run', dataDir: directory, projectId: project.id, caseReferences: [{ id: testCase.id, version: testCase.version! }],
    });

    const [options] = createBundle.mock.calls[0]!;
    expect(options.deterministicInteractionPreflightPolicy).toBeDefined();
    expect(resolveModelConfigs).not.toHaveBeenCalled();
    await expect(options.deterministicInteractionPreflightPolicy!.resolve({
      projectId: project.id,
      environmentId: environment.id,
      testCaseId: testCase.id,
    })).resolves.toEqual({ knownSecrets: [resolvedSecret] });
    expect(JSON.stringify(summary)).not.toContain(resolvedSecret);
  });
});
